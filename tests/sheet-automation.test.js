import test from "node:test";
import assert from "node:assert/strict";
import { planSheetAutomation, previewSheetAutomation, runSheetAutomation } from "../sheet/sheet-automation.js";

const HEAD = ["Tên kênh", "Proxy tải", "GPM Profile ID", "Tạo profile", "Tạo channel", "tk", "Tên hiển thị", "Mô tả kênh", "Mô tả video", "Tag", "Handle kênh", "Trạng thái tự động hóa"];
const COL = Object.fromEntries(HEAD.map((h, i) => [h, i]));
const VALUES = [
  HEAD,
  /* dòng 2 */ ["K1", "socks5://1.1.1.1:80:u:SECRETP", "", "có", "có", "a@gmail.com|PW1|r@x.com|ABCD", "Kênh Một", "mô tả 1", "mô tả video", "a,b", "@kenh1", ""],
  /* dòng 3 */ ["K2", "", "", "có", "", "b@gmail.com|PW2", "", "", "", "", "", ""],
  /* dòng 4 */ ["K3", "", "P3", "", "có", "", "Kênh Ba", "", "", "", "", ""],
  /* dòng 5 */ ["K4", "", "", "", "", "", "", "", "", "", "", ""],                     // không bật gì
  /* dòng 6 */ ["K5", "", "P5", "xong", "xong", "", "", "", "", "", "", ""],            // đã xong cả hai
  /* dòng 7 */ ["K6", "", "", "", "có", "", "Kênh Sáu", "", "", "", "", ""],            // channel nhưng chưa có profile
  /* dòng 8 */ ["K8", "", "P3", "", "có", "", "", "", "", "", "", ""],                 // channel nhưng thiếu Tên hiển thị
];

function mk(over = {}) {
  const writes = [], created = [], proxied = [], logins = [], channels = [];
  const deps = {
    readValues: async () => VALUES,
    listProfiles: async () => [{ id: "P3", name: "K3", rawProxy: "", browserVersion: "129.0.6668.59" }, { id: "P5", name: "K5", rawProxy: "", browserVersion: "129.0.6668.59" }],
    createProfile: async (a) => { created.push(a); return { id: `ID-${a.name}` }; },
    updateProxy: async (id, raw) => proxied.push([id, raw]),
    writeCell: async (r, c, v) => writes.push([r, c, v]),
    forEach: async ({ profiles, work, onResult, log }) => {
      let ok = 0, fail = 0;
      for (const p of profiles) {
        try { const r = await work({}, p, () => {}); ok++; await onResult?.(p, { status: "ok", message: typeof r === "string" ? r : "" }); }
        catch (e) { fail++; await onResult?.(p, { status: "error", message: e.message }); }
      }
      return { total: profiles.length, ok, fail, skipped: 0 };
    },
    login: async (page, acct) => logins.push(acct.email),
    createChannel: async (page, plan) => channels.push(plan.title),
    ...over,
  };
  return { deps, writes, created, proxied, logins, channels };
}
const flagWrites = (writes, col) => writes.filter((w) => w[1] === COL[col]);

// ---------- lập kế hoạch ----------
test("plan: chỉ lấy hàng có cờ 'có'; hàng trống và 'xong' bị bỏ qua", async () => {
  const { deps } = mk();
  const plan = await previewSheetAutomation({}, deps);
  assert.deepEqual(plan.map((p) => p.sheetName), ["K1", "K2", "K3", "K6", "K8"]);
});

test("plan: mô tả đúng các bước từng kênh", async () => {
  const plan = await previewSheetAutomation({}, mk().deps);
  const by = Object.fromEntries(plan.map((p) => [p.sheetName, p]));
  assert.deepEqual(by.K1.steps, ["tạo profile", "đăng nhập", "tạo channel"]);
  assert.equal(by.K1.action, "create");
  assert.deepEqual(by.K3.steps, ["tạo channel"]);
  assert.equal(by.K3.action, "channel-only");
});

test("plan: bật Tạo channel mà thiếu Tên hiển thị -> lỗi nói rõ cột nào thiếu", async () => {
  const by = Object.fromEntries((await previewSheetAutomation({}, mk().deps)).map((p) => [p.sheetName, p]));
  assert.equal(by.K8.action, "error");
  assert.match(by.K8.note, /Tên hiển thị/);
});

test("plan: kênh chỉ bật Tạo profile và không có tk vẫn được tạo (không đăng nhập)", async () => {
  const by = Object.fromEntries((await previewSheetAutomation({}, mk().deps)).map((p) => [p.sheetName, p]));
  assert.equal(by.K2.action, "create");
  assert.deepEqual(by.K2.steps, ["tạo profile", "đăng nhập"], "K2 có tk nên có đăng nhập");
});

test("plan: kênh bật channel mà chưa có Profile ID và không bật Tạo profile -> lỗi", async () => {
  const by = Object.fromEntries((await previewSheetAutomation({}, mk().deps)).map((p) => [p.sheetName, p]));
  assert.equal(by.K6.action, "error");
  assert.match(by.K6.note, /chưa có GPM Profile ID/);
});

test("preview: không lộ mật khẩu, 2FA, proxy gốc hay dữ liệu chạy nội bộ", async () => {
  const s = JSON.stringify(await previewSheetAutomation({}, mk().deps));
  for (const secret of ["PW1", "PW2", "ABCD", "SECRETP", "_prof", "_channel"]) assert.ok(!s.includes(secret), `lộ ${secret}`);
});

test("thiếu cả hai cột cờ -> từ chối và hướng dẫn tạo cột", async () => {
  const { deps } = mk({ readValues: async () => [["Tên kênh", "GPM Profile ID", "tk"], ["K1", "", "a@g.com|p"]] });
  await assert.rejects(runSheetAutomation({ onLog: () => {} }, deps), /"Tạo profile" hoặc "Tạo channel"/);
});

test("không hàng nào được bật -> báo lỗi rõ ràng", async () => {
  const { deps } = mk({ readValues: async () => [HEAD, ["K4", "", "", "", "", "", "", "", "", "", "", ""]] });
  await assert.rejects(runSheetAutomation({ onLog: () => {} }, deps), /Không có kênh nào được bật/);
});

// ---------- chạy ----------
test("run: tạo profile, ghi ID, đăng nhập, tạo channel cho K1; K3 chỉ tạo channel trên profile có sẵn", async () => {
  const m = mk();
  const r = await runSheetAutomation({ gpmHost: "h", onLog: () => {} }, m.deps);
  assert.deepEqual(m.created.map((c) => c.name), ["K1", "K2"]);
  assert.equal(m.created[0].rawProxy, "socks5://1.1.1.1:80:u:SECRETP");
  assert.deepEqual(m.logins.sort(), ["a@gmail.com", "b@gmail.com"]);
  assert.deepEqual(m.channels.sort(), ["Kênh Ba", "Kênh Một"]);
  assert.ok(m.writes.some(([row, col, v]) => row === 2 && col === COL["GPM Profile ID"] && v === "ID-K1"), "ghi Profile ID vào đúng ô");
  assert.equal(r.created, 2, "K1 và K2 đều chưa có profile");
});

test("run: việc xong thì đổi ô cờ thành 'xong' để lần sau không chạy lại", async () => {
  const m = mk();
  await runSheetAutomation({ gpmHost: "h", onLog: () => {} }, m.deps);
  assert.ok(flagWrites(m.writes, "Tạo profile").some(([row, , v]) => row === 2 && v === "xong"), "K1: Tạo profile -> xong");
  assert.ok(flagWrites(m.writes, "Tạo channel").some(([row, , v]) => row === 2 && v === "xong"), "K1: Tạo channel -> xong");
  assert.ok(flagWrites(m.writes, "Tạo channel").some(([row, , v]) => row === 4 && v === "xong"), "K3: Tạo channel -> xong");
});

test("run: lỗi thì GIỮ NGUYÊN ô cờ (để thử lại) và ghi lỗi vào cột trạng thái", async () => {
  const m = mk({ createChannel: async () => { throw new Error("không thấy nút Xuất bản"); } });
  await runSheetAutomation({ gpmHost: "h", onLog: () => {} }, m.deps);
  assert.equal(flagWrites(m.writes, "Tạo channel").length, 0, "không đánh dấu xong khi lỗi");
  const st = flagWrites(m.writes, "Trạng thái tự động hóa");
  assert.ok(st.some(([, , v]) => v.startsWith("❌") && v.includes("không thấy nút Xuất bản")));
});

test("run: chạy lại sau khi lỗi -> profile đã tạo được dùng lại, không tạo trùng", async () => {
  const m = mk({ listProfiles: async () => [{ id: "EXIST-K1", name: "K1", rawProxy: "socks5://1.1.1.1:80:u:SECRETP", browserVersion: "129.0.6668.59" }, { id: "EXIST-K2", name: "K2", rawProxy: "", browserVersion: "129.0.6668.59" }, { id: "P3", name: "K3", rawProxy: "", browserVersion: "129.0.6668.59" }] });
  const r = await runSheetAutomation({ gpmHost: "h", onLog: () => {} }, m.deps);
  assert.equal(m.created.length, 0);
  assert.equal(r.reused, 2);
  assert.ok(m.writes.some(([row, col, v]) => row === 2 && col === COL["GPM Profile ID"] && v === "EXIST-K1"));
});

test("run: ghi Profile ID hỏng -> DỪNG cả lượt, nói rõ ID cần điền (không sinh profile mồ côi)", async () => {
  const m = mk({ writeCell: async (r, c) => { if (c === COL["GPM Profile ID"]) throw new Error("quota"); } });
  await assert.rejects(runSheetAutomation({ gpmHost: "h", onLog: () => {} }, m.deps), /ID-K1.*dòng 2/s);
  assert.equal(m.created.length, 1);
});

test("run: kênh chỉ bật 'Tạo profile' và không có tk -> tạo xong là đánh dấu xong, không mở trình duyệt", async () => {
  let opened = 0;
  const m = mk({
    readValues: async () => [HEAD, ["K7", "", "", "có", "", "", "", "", "", "", "", ""]],
    listProfiles: async () => [],
    forEach: async ({ profiles }) => { opened += profiles.length; return { total: 0, ok: 0, fail: 0, skipped: 0 }; },
  });
  await runSheetAutomation({ gpmHost: "h", onLog: () => {} }, m.deps);
  assert.equal(m.created.length, 1);
  assert.equal(opened, 0);
  assert.ok(flagWrites(m.writes, "Tạo profile").some(([, , v]) => v === "xong"));
});

test("run: một kênh lỗi không chặn kênh khác", async () => {
  const m = mk({ createProfile: async (a) => { if (a.name === "K1") throw new Error("GPM từ chối"); return { id: `ID-${a.name}` }; } });
  const r = await runSheetAutomation({ gpmHost: "h", onLog: () => {} }, m.deps);
  assert.equal(r.errors >= 1, true);
  assert.deepEqual(m.channels, ["Kênh Ba"], "K3 vẫn tạo được channel");
});

test("run: log không bao giờ chứa mật khẩu, 2FA hay user/pass proxy", async () => {
  const logs = [];
  await runSheetAutomation({ gpmHost: "h", onLog: (x) => logs.push(x) }, mk().deps);
  const all = logs.join("\n");
  for (const secret of ["PW1", "PW2", "ABCD", "SECRETP"]) assert.ok(!all.includes(secret), `lộ ${secret}`);
});
