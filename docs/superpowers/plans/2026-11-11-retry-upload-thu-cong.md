# Đăng lại upload thủ công — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm panel "Chờ đăng" trong tab Theo dõi Sheet để đăng lại một video (hoặc cả loạt) đã render mà upload hỏng, dùng lại file đã render, không tải/render lại.

**Architecture:** Một hàm thuần phân loại dòng chờ đăng (`sheet/pending-uploads.js`), một phương thức `retryUploads` trên runner hiện có (dùng lại `uploadQueue` sẵn có, bọc `beginRun/endRun`), hai IPC (`sheet:pending-uploads`, `sheet:retry-upload`) với `getSheetRunner` dùng chung, và UI trong card kênh.

**Tech Stack:** Electron 28, Node ESM, `node:test`, Playwright/GPM có sẵn.

**Spec:** `docs/superpowers/specs/2026-11-11-retry-upload-thu-cong-design.md`

## Global Constraints

- Không tải lại video, không render lại, không tính quota render.
- Không đổi từ vựng cột B/C; không thêm cột Sheet.
- `resume-state.json`: load/save đồng bộ, không `await` giữa load-modify-save.
- Không đổi hành vi lượt chạy tự động (trần 3 lượt giữ nguyên).
- Mọi hàm mới phải chịu được dep giả trong test (không I/O cứng trong hàm thuần).
- Lệnh test: `npm test` (chạy `node --test 'tests/*.test.js'`).

## Review Focus

- **`⏳ đang upload` / `b1..b4` (có thể đã có bản nháp):** đăng lại có thể tạo bản nháp thứ hai → UI bắt xác nhận hai lần.
- **C đổi thành `✅` giữa lúc mở panel và lúc bấm:** không được đè `✅` bằng `⏸` → retry đọc lại Sheet và bỏ qua.
- **Hai runner cùng lúc (retry khi run-now/test-render đang chạy):** không được tạo `uploadQueue` thứ hai → `getSheetRunner` dùng chung + chặn khi đang chạy.
- **Upload còn chạy sau khi `runNow()` trả về:** cùng URL có thể bị enqueue hai lần → `hasPending` chặn theo từng URL.
- **Cấu hình đổi giữa hai lần bấm retry:** phải dựng lại runner khi rảnh → khoá cấu hình trong `getSheetRunner`.

---

### Task 1: Hàm thuần phân loại `sheet/pending-uploads.js`

**Files:**
- Create: `sheet/pending-uploads.js`
- Test: `tests/pending-uploads.test.js`

**Interfaces:**
- Produces:
  - `classifyUploadStatus(statusC: string) -> "maybe-uploaded" | "failed" | "waiting" | "gave-up" | "rendered" | null`
  - `listPendingUploads({ rows, resolveEntry, fileExists }) -> Array<{ url, rowIndex, title, outputPath, kind, statusText, uploadAttempts }>`
  - `rows`: `[{ rowIndex, url, status, uploadStatus }]` (như `readChannelUrls`), `resolveEntry(url) -> entry | null`, `fileExists(path) -> boolean`

- [x] **Step 1: Viết test thất bại**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyUploadStatus, listPendingUploads } from "../sheet/pending-uploads.js";

test("classify: tiền tố cột C -> kind", () => {
  assert.equal(classifyUploadStatus(""), "rendered");
  assert.equal(classifyUploadStatus("⏳ đang upload"), "maybe-uploaded");
  assert.equal(classifyUploadStatus("b1: đã tải file video"), "maybe-uploaded");
  assert.equal(classifyUploadStatus("b4: đã đặt giờ lịch"), "maybe-uploaded");
  assert.equal(classifyUploadStatus("⏸ chờ: chưa kết nối được GPM"), "waiting");
  assert.equal(classifyUploadStatus("❌ lỗi: click timeout"), "failed");
  assert.equal(classifyUploadStatus("bỏ qua: lỗi (đã thử 3 lần)"), "gave-up");
  assert.equal(classifyUploadStatus("✅ lên lịch 09/07/2026 08:00"), null);
  assert.equal(classifyUploadStatus("chuỗi lạ"), "failed");
});

test("listPendingUploads: chỉ lấy B=done, có file, C chưa ✅", () => {
  const rows = [
    { rowIndex: 2, url: "u1", status: "done", uploadStatus: "bỏ qua: lỗi (đã thử 3 lần)" },
    { rowIndex: 3, url: "u2", status: "done", uploadStatus: "✅ lên lịch 09/07/2026 08:00" },
    { rowIndex: 4, url: "u3", status: "đã tải", uploadStatus: "❌ lỗi: x" },
    { rowIndex: 5, url: "u4", status: "done", uploadStatus: "" },
    { rowIndex: 6, url: "u5", status: "done", uploadStatus: "❌ lỗi: mất file" },
  ];
  const entries = {
    u1: { outputPath: "/out/a.mp4", title: "A", uploadAttempts: 3 },
    u2: { outputPath: "/out/b.mp4", title: "B" },
    u3: { outputPath: "/out/c.mp4", title: "C" },
    u4: { outputPath: "/out/d.mp4", title: "D" },
    u5: { outputPath: "/out/e.mp4", title: "E" },
  };
  const out = listPendingUploads({
    rows,
    resolveEntry: (u) => entries[u] ?? null,
    fileExists: (p) => p !== "/out/e.mp4",
  });
  assert.deepEqual(out.map((v) => v.url), ["u1", "u4"]);
  assert.equal(out[0].kind, "gave-up");
  assert.equal(out[0].title, "A");
  assert.equal(out[0].rowIndex, 2);
  assert.equal(out[1].kind, "rendered");
});

test("listPendingUploads: title dự phòng từ tên file khi entry không có title", () => {
  const out = listPendingUploads({
    rows: [{ rowIndex: 2, url: "u1", status: "done", uploadStatus: "❌ lỗi: x" }],
    resolveEntry: () => ({ outputPath: "/out/tiêu đề.mp4" }),
    fileExists: () => true,
  });
  assert.equal(out[0].title, "tiêu đề");
});

test("listPendingUploads: thứ tự maybe-uploaded trước", () => {
  const rows = [
    { rowIndex: 2, url: "u1", status: "done", uploadStatus: "bỏ qua: x (đã thử 3 lần)" },
    { rowIndex: 3, url: "u2", status: "done", uploadStatus: "⏳ đang upload" },
    { rowIndex: 4, url: "u3", status: "done", uploadStatus: "❌ lỗi: y" },
  ];
  const out = listPendingUploads({
    rows,
    resolveEntry: (u) => ({ outputPath: `/out/${u}.mp4`, title: u }),
    fileExists: () => true,
  });
  assert.deepEqual(out.map((v) => v.kind), ["maybe-uploaded", "failed", "gave-up"]);
});
```

- [x] **Step 2: Chạy test để chắc nó fail**

Run: `node --test tests/pending-uploads.test.js`
Expected: FAIL `Cannot find module .../sheet/pending-uploads.js`

- [x] **Step 3: Cài đặt `sheet/pending-uploads.js`**

Bảng tiền tố đúng như test. `statusText` = C cắt 200 ký tự. Không đọc I/O. Sắp xếp theo
`kind` (maybe-uploaded, failed, waiting, gave-up, rendered) rồi `title` (localeCompare "vi").

- [x] **Step 4: Chạy test**

Run: `node --test tests/pending-uploads.test.js`
Expected: PASS 4 test

- [x] **Step 5: Commit**

```bash
git add sheet/pending-uploads.js tests/pending-uploads.test.js
git commit -m "feat(sheet): hàm thuần liệt kê video đã render chờ đăng"
```

---

### Task 2: `upload-queue.js` biết URL nào đang trong hàng đợi

**Files:**
- Modify: `sheet/upload-queue.js` (enqueue + finally + return)
- Test: `tests/upload-queue.test.js` (bổ sung)

**Interfaces:**
- Produces: `hasPending(sheetName: string, url: string) -> boolean` trên object trả về của `createUploadQueue`.

- [x] **Step 1: Viết test thất bại** — trong `tests/upload-queue.test.js`:

```js
test("queue: hasPending đúng theo từng kênh + url, tắt sau khi job xong", async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const q = createUploadQueue({ runUpload: async () => { await gate; } });
  q.enqueue({ sheetName: "K", title: "a", videoPath: "/v/a.mp4", sourceUrl: "u1" });
  assert.equal(q.hasPending("K", "u1"), true);
  assert.equal(q.hasPending("K", "u2"), false);
  assert.equal(q.hasPending("Khác", "u1"), false);
  release();
  await q.drain();
  assert.equal(q.hasPending("K", "u1"), false);
});
```

- [x] **Step 2: Chạy test**

Run: `node --test tests/upload-queue.test.js`
Expected: FAIL `q.hasPending is not a function`

- [x] **Step 3: Cài đặt**

`const pendingUrls = new Map();` (`sheetName -> Map<url, count>`). Tăng trong `enqueue` khi
`job.sourceUrl` có giá trị, giảm trong `.finally` của chuỗi, xoá entry khi về 0 (và xoá Map
kênh khi rỗng). Thêm `hasPending` vào object trả về.

- [x] **Step 4: Chạy test**

Run: `node --test tests/upload-queue.test.js`
Expected: PASS toàn bộ file

- [x] **Step 5: Commit**

```bash
git add sheet/upload-queue.js tests/upload-queue.test.js
git commit -m "feat(sheet): hàng đợi upload biết url nào đang chờ"
```

---

### Task 3: `retryUploads` trên runner

**Files:**
- Modify: `sheet/sheet-runner.js` (thêm `retryUploads`, `isRunning`; import `listPendingUploads` không cần — chỉ `decideAction`/`ST` sẵn có)
- Test: `tests/sheet-runner.test.js` (bổ sung)

**Interfaces:**
- Consumes: `resumeStore`, `sheetsApi`, `uploadQueue`, `checkGpm`, `fileExists`, `config` từ `deps` (đã có sẵn).
- Produces: `retryUploads(sheetName: string, urls: string[]) -> Promise<{ ok: boolean, queued: number, skipped: Array<{url, reason}>, error?: string }>`, `isRunning() -> boolean`.

- [x] **Step 1: Viết test thất bại** — 5 test, dùng `makeDeps` có sẵn:

```js
test("retryUploads: reset uploadAttempts, ghi ⏸ trước khi enqueue, đúng job shape", async () => {
  const order = [];
  const { deps } = makeDeps({
    sheetsApi: {
      readConfigSheet: async () => [ch()],
      readChannelUrls: async () => [{ rowIndex: 2, url: "u1", status: "done", uploadStatus: "bỏ qua: x (đã thử 3 lần)" }],
      setUploadStatus: async (n, r, s) => { order.push(["sheet", r, s]); },
    },
    uploadQueue: { enqueue: (j) => { order.push(["enqueue", j]); }, beginRun: () => order.push(["begin"]), endRun: () => order.push(["end"]), endChannel: () => order.push(["endChannel"]), hasPending: () => false },
    fileExists: () => true,
  });
  deps.resumeStore.save({ K: { u1: { attempts: 0, uploadAttempts: 3, stage: "rendered", outputPath: "/out/u1.mp4", title: "T1" } } });
  const r = await createSheetRunner(deps).retryUploads("K", ["u1"]);
  assert.equal(r.ok, true);
  assert.equal(r.queued, 1);
  assert.equal(deps.resumeStore.load().K.u1.uploadAttempts, 0);
  assert.deepEqual(order.map((o) => o[0]), ["begin", "sheet", "enqueue", "endChannel", "end"]);
  assert.equal(order[1][2], "⏸ chờ: đăng lại thủ công");
  assert.equal(order[2][1].videoPath, "/out/u1.mp4");
  assert.equal(order[2][1].rowIndex, 2);
  assert.equal(order[2][1].sourceUrl, "u1");
});
```

Bốn test còn lại (cùng file), mỗi test một nhánh chặn:
1. `uploadEnabled:false` → `ok:false`, không `begin`, không `enqueue`, không ghi Sheet.
2. `checkGpm` ném → `ok:false`, `error` chứa "GPM".
3. Cột C đã `✅` → `skipped` có `reason` "đã lên lịch", không enqueue.
4. `fileExists` false → `skipped` "mất file", không enqueue; và `hasPending` true → `skipped` "đang trong hàng đợi".
5. `running` true (gọi `retryUploads` trong lúc một `runNow` đang treo) → `ok:false`.

- [x] **Step 2: Chạy test**

Run: `node --test tests/sheet-runner.test.js`
Expected: FAIL `retryUploads is not a function`

- [x] **Step 3: Cài đặt**

Hai lượt: (1) kiểm tra kênh + preflight GPM + đọc `readChannelUrls`, phân loại từng url thành
`candidates`/`skipped`; (2) nếu có `candidates` thì `beginRun()`, rồi với từng cái: reset
`uploadAttempts = 0`, ghi `⏸ chờ: đăng lại thủ công`, `emit upload-status`, `enqueue`, cuối
cùng `endChannel(sheetName)` + `endRun()` trong `finally`. Trả `{ ok: true, queued, skipped }`.

- [x] **Step 4: Chạy test**

Run: `node --test tests/sheet-runner.test.js`
Expected: PASS toàn bộ file (giữ nguyên các test cũ)

- [x] **Step 5: Commit**

```bash
git add sheet/sheet-runner.js tests/sheet-runner.test.js
git commit -m "feat(sheet): runner có retryUploads — đăng lại thủ công từ file đã render"
```

---

### Task 4: IPC + `getSheetRunner` dùng chung

**Files:**
- Modify: `electron-main.js` (import `listPendingUploads`, `getEntry`; thêm `getSheetRunner`, 2 handler)
- Modify: `preload.cjs`

**Interfaces:**
- Produces: IPC `sheet:pending-uploads` `(sheetName?)` → `{ ok, channels: [{ sheetName, videos }] }`; `sheet:retry-upload` `({ sheetName, urls })` → kết quả của `retryUploads`; preload `sheet.pendingUploads(sheetName)`, `sheet.retryUpload(urls payload)`.

- [x] **Step 1: `getSheetRunner(win)`**

Thay 3 chỗ dựng runner (`sheet:start`, `sheet:test-render`, `sheet:run-now`) bằng một helper:
giữ `sheetRunner` + `sheetRunnerKey` (JSON các trường cấu hình ảnh hưởng runner) + `sheetRunnerWin`;
dựng lại khi khoá đổi **và** `!sheetRunner.isRunning()`, ngược lại trả bản cũ.

- [x] **Step 2: Hai handler**

`sheet:pending-uploads`: đọc settings, trả `channels: []` nếu thiếu cấu hình hoặc `!gpmEnabled`;
lọc `enabled !== false && uploadEnabled !== false`; mỗi kênh đọc `readChannelUrls` +
`getEntry(loadResume(resumePath), sheetName, url)` + `fs.existsSync`, gọi `listPendingUploads`.

`sheet:retry-upload`: `getSheetRunner(win).retryUploads(sheetName, urls)`, bọc try/catch trả
`{ ok:false, error }`.

- [x] **Step 3: preload**

Thêm 2 method vào namespace `sheet`.

- [x] **Step 4: Kiểm chứng cú pháp + test hồi quy**

Run: `node --check electron-main.js; node --check preload.cjs; npm test`
Expected: `node --check` im lặng; `npm test` PASS toàn bộ.

- [x] **Step 5: Commit**

```bash
git add electron-main.js preload.cjs
git commit -m "feat(sheet): IPC liệt kê + đăng lại video chờ đăng, dùng chung một runner"
```

---

### Task 5: UI panel "Chờ đăng" + pill + CSS

**Files:**
- Modify: `renderer.js` (`initSheetWatch`: state, `refreshPending`, pill, section trong `renderVideos`, handler nút)
- Modify: `renderer.html` (CSS `.sw-pending`, `.sw-pending-head`, `.sw-pending-row`)

**Interfaces:**
- Consumes: `api.pendingUploads`, `api.retryUpload` (Task 4).

- [x] **Step 1: CSS** — pill màu vàng nhạt, hàng có nút nhỏ, không phá layout card hiện có.

- [x] **Step 2: State + nạp**

`const pending = new Map()` (sheetName → videos). `refreshPending(c, force)` gọi
`api.pendingUploads(c.name)`, lưu, `renderCard(c)`. Gọi khi: mở tab (sau `loadChannelsOnce`),
sự kiện `done` (xoá cache + nạp lại các card đã mở), và lúc bấm caret mở card.

- [x] **Step 3: Pill + section**

Trong `buildCard` thêm `<span class="sw-pending">`; `renderCard` hiện `N chờ đăng` khi N > 0.
Trong `renderVideos`, trước hàng nút: header `Chờ đăng (N)` + nút `Đăng lại tất cả`, mỗi video
một hàng `title | statusText | [Đăng lại]`. Dòng `maybe-uploaded` có nhãn cảnh báo và nút cần
bấm hai lần trong 5 giây (`c.confirmUntil = new Map()`), hết giờ thì tự trả lại nhãn.

- [x] **Step 4: Gọi IPC**

`retry(c, urls)`: disable nút, gọi `api.retryUpload({ sheetName: c.name, urls })`, log
`queued`/`skipped`, `refreshPending(c, true)`; lỗi → log đỏ trong khung Log. Không chặn UI.

- [x] **Step 5: Kiểm chứng**

Run: `node --check renderer.js; npm test`
Expected: im lặng + PASS. Kiểm tra tay theo mục "Kiểm tra tay" của spec.

- [x] **Step 6: Commit**

```bash
git add renderer.js renderer.html
git commit -m "feat(sheet): panel Chờ đăng + nút đăng lại trong card kênh"
```

---

### Task 6: Soát toàn bộ

- [x] `npm test` — PASS toàn bộ.
- [x] `node --check` cho `electron-main.js`, `preload.cjs`, `renderer.js`.
- [x] Đọc lại diff: không đụng `decideAction`, không đổi trần 3 lượt, không thêm cột Sheet.
- [ ] (chưa chạy) Chạy tay 4 mục "Kiểm tra tay" trong spec (cần GPM + Sheet thật).
