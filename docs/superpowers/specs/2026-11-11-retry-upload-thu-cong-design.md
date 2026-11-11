# Đăng lại upload thủ công

Ngày: 2026-11-11
Phạm vi: `sheet/pending-uploads.js` (mới), `sheet/sheet-runner.js`, `electron-main.js`,
`preload.cjs`, `renderer.js`, `renderer.html` (CSS + không cần markup mới).

## Vấn đề

Upload lên YouTube hỏng là **ngõ cụt**. Trạng thái thật trên Sheet ngày 2026-11-11:

| Trạng thái cột C | Số dòng |
|---|---|
| `bỏ qua: … (đã thử 3 lần)` | 41 |
| `❌ lỗi: …` | 1 |
| `⏳ đang upload` (kẹt) | 3 |

Lỗi thật là `elementHandle.click: Timeout 30000ms exceeded` — Playwright bấm vào một phần
tử của Studio 30 giây không được (dialog/overlay che, trang chưa sẵn sàng). Lỗi này chập
chờn: cùng một kênh vẫn có video upload thành công.

Ba đường cùng dẫn tới "không đăng lại được":

1. **Trần 3 lượt.** `upload-queue` thử 3 lần trong một lượt, rồi `decideAction` trả
   `upload-exhausted` và runner ghi `bỏ qua:`. Từ đây URL nghỉ vĩnh viễn.
2. **Xoá ô C vô ích.** `decideAction` coi B = `done` + C trống là `skip`, nên sửa Sheet
   không ép được upload lại.
3. **Chỉ còn cách xoá ô B.** Nhưng `full` nghĩa là tải lại từ YouTube + render lại — trong
   khi file `.mp4` đã render vẫn nằm nguyên trong `output/`.

Hệ quả thực tế (cách người dùng đang chữa cháy): thả tay 8 file vào Studio một lượt, rồi
gõ tiêu đề / thumb / giờ cho từng cái.

## Vì sao không thể "đăng lại mù"

`uploadAndSchedule` gọi `onUploaded()` ngay sau `setFile` (thả file vào Studio). Hỏng ở
`b2`/`b3`/`b4` nghĩa là **đã có bản nháp trên YouTube**. Đăng lại không kiểm tra sẽ tạo
bản nháp thứ hai. Đồng thời, khi hỏng, runner ghi đè cột C bằng `❌ lỗi: …`, xoá mất dấu
"đã tới bước nào" — nên không có cách nào biết chắc từ dữ liệu hiện có.

## Mục tiêu

- Thấy được **danh sách video đã render nhưng chưa lên lịch**, bền qua lần tắt/mở app.
- Bấm một nút để **đăng lại ngay**, dùng lại file đã render — không tải lại, không render lại.
- Đăng lại thủ công **xoá trần 3 lượt** cho video đó (retry tự động sau này lại có 3 lượt).
- Video "có thể đã đăng dở" được đánh dấu rõ và phải xác nhận trước khi đăng lại.
- Ý định đăng lại được ghi xuống trước khi hành động, nên tắt app giữa chừng vẫn không mất.

## Không nằm trong phạm vi

- Không tự dò bản nháp trên Studio (phương án A/B của phần mất điện — người dùng chọn
  "chỉ làm retry thủ công").
- Không tự phục hồi sau mất điện; không ghi state kiểu nguyên tử (temp + rename).
- Không nâng/bỏ trần 3 lượt cho lượt chạy tự động.
- Không sửa nguyên nhân gốc (`elementHandle.click` timeout, SEL Studio).
- Không có panel cho các dòng tải/render hỏng (`bỏ qua:` ở cột B, không có file output).
- Không thêm cột Sheet, không đổi từ vựng cột B/C.
- Không có nút "đăng lại tất cả mọi kênh".

## Anti-goals

- **Không bao giờ tạo bản nháp trùng mà người dùng không biết.** Vì vậy dòng `⏳` phải
  xác nhận, và mọi hành động phải log ra bảng Log.
- **Không đổi hành vi lượt chạy tự động.** Nút này là cửa phụ, không phải đường chính.
- **Không đụng vào video đã xong** (B = `done` + C = `✅`).
- Không render lại, không tải lại, không tính quota render.

## Ràng buộc kỹ thuật

- Sheet là nguồn sự thật cho trạng thái con người; `resume-state.json` giữ đường dẫn file và
  bộ đếm. `load`/`save` của resume-state là đồng bộ, **không `await` giữa hai lời gọi**.
- Danh sách video trong card (`c.videos`) chỉ là bộ nhớ của lượt chạy hiện tại — panel mới
  **không được** dựng từ đó.
- Hàng đợi upload là serial theo từng kênh (`chains` trong `upload-queue.js`).
- Job upload cần đúng shape của `enqueueUpload`: `sheetName`, `gpmHost`, `profileId`,
  `videoPath`, `overlaysDir`, `title`, `postTimes`, `locale`, `rowIndex`, `sourceUrl`.
- `videoPath` lấy từ `entry.outputPath`; `rowIndex` lấy từ dòng Sheet (A = url).

## Phương án đã cân nhắc

| | Cách làm | Vì sao loại / chọn |
|---|---|---|
| **1** | Nút "Đăng lại" trong app: panel "Chờ đăng" dựng từ Sheet + `resume-state.json` + file trên đĩa; mỗi video một nút, mỗi kênh một nút "Đăng lại tất cả"; bấm là reset bộ đếm và đưa vào hàng đợi ngay | **Chọn.** Đúng chỗ đau, không đổi hành vi tự động, dùng lại toàn bộ máy có sẵn |
| 2 | Bỏ trần 3 lượt, tự đăng lại mãi | Loại: lỗi hệ thống thì quay vòng vô hạn mỗi 5 phút, đốt phiên GPM; vẫn không an toàn cho dòng `⏳` |
| 3 | App thả cả loạt file vào Studio rồi tự điền thumb + giờ cho từng bản nháp | Loại: mảng mới lớn (đọc danh sách bản nháp, khớp file theo tên), build lâu; người dùng chọn làm retry trước |

Người dùng đã chọn phương án 1 và yêu cầu **chưa** làm phần tự phục hồi sau mất điện.

## Thiết kế

### 1. `sheet/pending-uploads.js` — hàm thuần, không I/O

```js
listPendingUploads({ rows, entries, fileExists })
// rows: [{ url, status (B), uploadStatus (C), rowIndex }]
// entries: tra cứu theo url -> { outputPath, uploadAttempts } | null
// fileExists: (p) => boolean
// -> [{ url, rowIndex, title, outputPath, kind, statusText, uploadAttempts }]
```

Một dòng vào danh sách khi **tất cả** đúng:

- `status === "done"` (cột B).
- `entries[url].outputPath` tồn tại và `fileExists(outputPath)`.
- C rỗng **hoặc** thuộc một trong các tiền tố: `❌`, `⏸ chờ:`, `⏳ đang upload`, `bỏ qua:`.

`kind` suy từ C — quyết định nhãn và việc có cần xác nhận hay không:

| C | kind | Ý nghĩa | Đăng lại có xác nhận? |
|---|---|---|---|
| `❌ lỗi: …` | `failed` | lỗi còn lượt | không |
| `⏸ chờ: …` | `waiting` | lỗi hạ tầng, chưa gửi byte nào | không |
| `bỏ qua: …` | `gave-up` | đã chạm trần 3 lượt | không |
| `""` | `rendered` | render xong nhưng chưa từng vào hàng đợi (app tắt giữa chừng) | không |
| `⏳ đang upload` | `maybe-uploaded` | **có thể đã có bản nháp** | **có** |

`title` lấy từ entry (`entry.title`), không lấy từ cột A (cột A là URL nguồn).
`statusText` là C đã cắt gọn để hiện dưới tiêu đề (bỏ tiền tố, cắt ~200 ký tự).

Hàm này không biết gì về kênh: caller quyết định chỉ gọi cho kênh có upload bật.

### 2. `createSheetRunner` — `retryUploads(sheetName, urls)`

Trả `{ ok, queued, skipped: [{ url, reason }], error? }`.

Thứ tự kiểm tra (mọi nhánh hỏng trả `ok:false` kèm `error` đọc được, không ném):

1. `running` đang true → `"Đang chạy một lượt — thử lại sau khi lượt xong."` Lý do: một lượt
   đang chạy có thể vừa nhặt cùng URL đó qua nhánh `upload-only`, dẫn tới hai lần enqueue.
2. Đọc `readConfigSheet`, tìm kênh theo `sheetName`; không thấy → lỗi.
3. `ch.uploadEnabled === false` → `"Kênh đang tắt upload."`
4. `!config.gpmEnabled || !ch.gpmProfileId || !ch.postTimes` → `"Thiếu cấu hình GPM/giờ đăng."`
5. `checkGpm()` (nếu có) ném hoặc trả `false` → `"chưa kết nối được GPM — mở GPM rồi bấm lại."`
6. `readChannelUrls` để có `rowIndex` từng URL.

Với từng URL trong `urls`:

- Không có dòng trong Sheet → `skipped` (`"không thấy URL trong Sheet"`).
- Không có entry, hoặc `outputPath` không tồn tại → `skipped` (`"mất file đã render"`).
- Ngược lại:
  1. Reset `uploadAttempts = 0` trong `resume-state.json` (load → set → save, không `await`).
     Không đụng `attempts`, `stage`, `filePath`, `outputPath`.
  2. Ghi cột C = `⏸ chờ: đăng lại thủ công`. Đây là **ý định bền**: nếu app tắt trước khi job
     chạy, lượt tự động sau sẽ thấy `⏸` → `upload-wait` → nhặt lại, **không tính lượt**.
  3. `emit({ type: "upload-status", channel, status: "⏸ chờ: đăng lại thủ công", title, url })`.
  4. `uploadQueue.enqueue({...})` với `videoPath = entry.outputPath`,
     `overlaysDir = path.join(config.channelsRoot, sheetName, "overlays")`, `postTimes`,
     `locale`, `gpmHost`, `profileId`, `rowIndex`, `sourceUrl = url`, `title = entry.title`.
     Hàng đợi tự ghi tiếp `⏳ đang upload` → `✅ lên lịch …` (hoặc `❌`).

Không `await` job upload: hàm trả ngay sau khi enqueue để UI không treo. Thứ tự enqueue giữ
nguyên thứ tự `urls`.

Lượt chạy tự động **không đổi**: `retryUploads` chỉ là cửa vào thứ hai của cùng hàng đợi.
Vì nó reset bộ đếm, video vừa đăng lại hỏng sẽ có lại đủ 3 lượt tự động.

### 3. IPC + preload

- `sheet:pending-uploads` `(sheetName?)` → `{ ok, channels: [{ sheetName, videos: [...] }] }`.
  Đọc: `readConfigSheet` (lọc **chỉ** `uploadEnabled !== false` — cố ý KHÔNG lọc theo `enabled`:
  kênh đang tạm dừng vẫn có video đã render chờ đăng, và upload lại không cần tải/render; ẩn
  chúng đi đúng là lỗi đang sửa) → với mỗi kênh `readChannelUrls` + `resume-state.json` +
  `fs.existsSync`. Không truyền `sheetName` thì trả hết các kênh đủ điều kiện. Lỗi trả
  `{ ok:false, error }`, không ném.
- `sheet:retry-upload` `({ sheetName, urls })` → `{ ok, queued, skipped, error }`.
  Dựng runner theo đúng lối `sheet:run-now`: `sheetRunner || buildSheetRunner(win)`.
  **Khác một điểm:** runner dựng cho retry được **giữ lại** ở biến `sheetRunner` (không
  `start()`), để bấm nhiều lần không tạo nhiều `uploadQueue`/nhiều kết nối GPM. Lượt `start`
  sau đó vẫn thay thế nó như cũ.
- `preload.cjs`: thêm `pendingUploads(sheetName)` và `retryUpload({ sheetName, urls })` vào
  namespace `sheet`.

### 4. UI (tab "Theo dõi Sheet")

- **Pill trên card:** khi kênh có video chờ đăng, `sw-card-top` hiện một pill nhỏ
  `N chờ đăng`. Không có thì ẩn — pill là thứ duy nhất cho biết phải mở card ra.
- **Mục trong card body** (trong `renderVideos`, đặt trước hàng nút hiện có):

```text
Chờ đăng (3)                         [Đăng lại tất cả (3)]
  Tiêu đề video 1        bỏ qua: … (đã thử 3 lần)        [Đăng lại]
  Tiêu đề video 2        ⏳ đang upload   ⚠ có thể đã đăng  [Đăng lại]
```

- Nút "Đăng lại" gọi `api.retryUpload({ sheetName, urls: [url] })`. Nút kênh "Đăng lại tất cả"
  **chỉ gửi các dòng không phải `maybe-uploaded`** — dòng `⏳`/`b1..b4` phải bấm riêng từng cái
  (nút hàng loạt không được phép tạo bản nháp trùng mà không hỏi).
- **Xác nhận cho `maybe-uploaded`:** bấm lần đầu, nút đổi thành `⚠ Chắc chắn đăng lại?`
  trong 5 giây; bấm lần hai mới gửi. Không dùng `window.confirm` (renderer chưa dùng ở đâu
  trong app, và nó chặn cả cửa sổ). Từ chối/hết giờ → trả nút về như cũ, không chặn các dòng
  khác. Nhãn dưới tiêu đề nói rõ "có thể đã đăng dở — đăng lại có thể tạo bản nháp thứ hai".
- Trong lúc chờ IPC: nút chuyển `⏳ đang gửi…` và disable; xong thì refresh danh sách.
- **Nạp lại danh sách:** khi mở tab (sau `loadChannelsOnce`), sau sự kiện `done`, và sau mỗi
  lần đăng lại thành công. Nạp theo từng kênh (`pendingUploads(sheetName)`) để mở card không
  phải đọc lại cả 13 tab; kết quả cache theo `sheetName` trong Map của tab.
- Không phụ thuộc `c.videos` cho mục này. Hai nguồn cùng hiển thị trong một card là chấp nhận
  được: `c.videos` nói "lượt này đang làm gì", panel nói "còn nợ gì trên đĩa".

Màu/nhãn dùng lại các class `sw-vid`, `sw-vid-state`, `sw-vid-err`, `sw-done-note`,
`sw-card-actions` đã có; chỉ thêm CSS cho pill.

### 5. Ghi chú vận hành

- Bấm "Đăng lại tất cả" cho 8 video: hàng đợi chạy **tuần tự** đúng như lượt tự động, mỗi
  video lấy một slot giờ trống kế tiếp (đọc từ cột C như hiện nay). Không tính quota render.
- Bấm khi GPM chưa mở: nhận lỗi rõ ràng, không enqueue, không ghi gì vào Sheet.
- Bấm khi đang có lượt chạy: nhận lỗi "đang chạy", không enqueue.

## Các ca biên đã chốt (theo review)

Bốn lỗi dưới đây là điều kiện sống còn, không phải chi tiết phụ:

1. **Chỉ một runner mỗi cửa sổ.** Hiện `sheet:run-now` và `sheet:test-render` dựng runner
   tạm rồi vứt đi, nên nếu retry dựng runner riêng thì có **hai** `uploadQueue` và hai phiên
   GPM cùng profile → bản nháp trùng + tranh slot. Cả ba đường (`run-now`, `test-render`,
   `retry-upload`) dùng chung một `getSheetRunner(win)`: dựng một lần, giữ lại; dựng lại chỉ
   khi chưa chạy lượt nào và cấu hình đã đổi (khoá cấu hình = ảnh chụp các trường ảnh hưởng
   tới runner). `sheet:start` dùng runner đó rồi `start()`.
2. **Retry phải làm mới cache slot.** `channelCache` (url đã lên lịch + slot đã dùng),
   `reported`, `channelEnded` chỉ được xoá trong `uploadQueue.beginRun()`. Không gọi thì
   retry có thể lấy lại giờ đã dùng hoặc job tự bỏ qua vì "Sheet báo đã lên lịch". Vì vậy
   retry bọc phần enqueue bằng `beginRun()` … `endRun()` (endRun ngay sau enqueue là an toàn:
   `pending > 0` nên digest chưa gửi), và gọi `endChannel(sheetName)` để tin báo riêng kênh
   vẫn chạy như một lượt bình thường.
3. **Không đè lên trạng thái mới hơn.** Trước khi ghi `⏸`, retry đọc lại Sheet và bỏ qua url
   nếu: cột B không còn `done`, cột C đã `✅`, hoặc chính URL đó còn job trong hàng đợi
   (`uploadQueue.hasPending(sheetName, url)` — bộ đếm mới trong `upload-queue.js`, vì upload
   vẫn tiếp tục chạy sau khi `runNow()` trả về và cờ `running` đã tắt).
4. **Runner không đóng băng cấu hình.** `buildSheetRunner` đọc `loadSheetSettings()` một lần;
   giữ runner nghĩa là sửa cấu hình rồi bấm lại vẫn dùng bản cũ. `getSheetRunner` so khoá
   cấu hình: đổi mà đang rảnh thì dựng lại, đang chạy thì giữ bản cũ (đúng quy ước "đổi cấu
   hình khi đang chạy thì Stop → Start").

## Kiểm thử

- `tests/pending-uploads.test.js` — bảng quyết định: đủ 5 `kind`; loại khi B khác `done`;
  loại khi `outputPath` mất; loại khi C là `✅ …`; không có entry → loại; giữ đúng `rowIndex`.
- `tests/sheet-runner.test.js` (bổ sung) — dep giả:
  - reset `uploadAttempts` về 0 và **ghi ⏸ vào cột C trước khi** enqueue (kiểm thứ tự bằng
    mảng sự kiện).
  - `enqueue` nhận đúng `videoPath`/`rowIndex`/`title`/`sourceUrl`.
  - `uploadEnabled:false`, `gpmEnabled:false`, `checkGpm` ném → `ok:false`, **không** enqueue,
    **không** ghi Sheet.
  - mất file output → `skipped`, không enqueue.
  - `running === true` → `ok:false`, không enqueue (dùng `testRenderNow`/`runNow` để bật cờ).
  - hai lần gọi liên tiếp cùng URL → hai lần enqueue (người dùng chủ động, không dedup).
- Không test UI (repo chưa có hạ tầng renderer test).

## Kiểm tra tay

1. Chọn một dòng `bỏ qua:` ở LINE_01 (có file trong `output/`) → mở card → thấy trong
   "Chờ đăng" → bấm "Đăng lại" → cột C chuyển `⏸ chờ: đăng lại thủ công` → `⏳ đang upload`
   → `✅ lên lịch …`.
2. Tắt app ngay sau khi bấm (trước khi job chạy) → mở lại, bấm "Chạy tất cả ngay" → video
   được nhặt lại qua nhánh `upload-wait`, `uploadAttempts` không tăng.
3. Bấm "Đăng lại" khi GPM đang tắt → thấy lỗi, cột C không đổi.
4. Bấm vào dòng `⏳` → nút đổi thành "Chắc chắn đăng lại?"; bấm lại lần nữa mới gửi, bỏ qua
   hoặc để hết 5 giây thì không có gì xảy ra.

## Việc để builder tự quyết

- Câu chữ nhãn nút, màu pill, khoảng cách, thứ tự sắp xếp trong danh sách (đề xuất: `⏳` lên
  đầu vì cần người xử lý, sau đó `❌`, `bỏ qua:`, rồi `""`).
- Có giữ cache danh sách theo kênh hay đọc lại mỗi lần mở card (miễn là không đọc cả 13 tab
  mỗi lần mở một card).
- Thời gian chờ tối đa cho `checkGpm` trước khi báo lỗi.
