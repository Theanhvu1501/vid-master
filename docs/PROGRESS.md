# Tiến độ: VidMaster (app Electron)

Cập nhật lần cuối: sau commit "tab Kênh dạng bảng + khung chi tiết bên phải". Làm cùng `D:\Code\license-server` (xem `docs/PROGRESS.md` bên đó cho phần máy chủ).

## Mô hình chung
- App đã **bỏ hoàn toàn Google Sheet**: cấu hình kênh, danh sách video và trạng thái video lấy từ máy chủ qua `sheet/web-store.js` (cache trên đĩa theo ETag, hàng đợi ghi bù cho trạng thái video, chạy offline bằng bản đã lưu).
- Đăng nhập bằng tài khoản admin cấp (`app-session.js`, `login-dialog.html`); máy tự đăng ký bằng machine ID + hostname.
- Cấu hình kênh: máy chủ giữ bản gốc, app sửa kênh của máy mình qua `PUT /api/app/channel-configs/:id`. App không tạo/xóa kênh, không đổi tên/máy. Mất mạng thì khóa nút Lưu. Gmail/mật khẩu/2FA chỉ nhập trong app.

## Đã xong
- Tab "Kênh" (trước là "Theo dõi Sheet") là **bảng bên trái + khung chi tiết bên phải** giống web: cột Kênh, Bật, Hạn proxy, Hôm nay, Lỗi, Tổng; bấm dòng mở form cấu hình ngay trong khung; hai tab Cấu hình và Đang chạy; công tắc Bật lưu thẳng lên máy chủ.
- Form dựng từ định nghĩa trường do máy chủ gửi kèm (`channel-config-ui.js`, hàm `mount(host, name)`), nên không bao giờ lệch với web. Proxy nhập một ô `ip:port:user:pass`; hạn proxy do máy chủ tự tra, không nhập tay.
- Cửa sổ mở maximize, zoom giao diện 0.85 (`electron-main.js`, đặt lại sau mỗi lần nạp trang). Khung chi tiết rộng khoảng 48% (tối thiểu 560px), chữ lớn hơn.
- Test: 976 test qua; bài thử Electron thật bằng playwright-core (đăng nhập, bảng, chọn dòng, sửa proxy, công tắc, xung đột 409).

## Việc còn lại / ý định
- **Chưa xác định được nút "0.5" vỡ giao diện** mà người dùng chỉ ra bằng ảnh crop (chỉ thấy chữ "0.5"). Đã quét mọi tab và cả 8 kiểu render, không phần tử nào hiển thị "0.5". Nghi: ô `composer-preview-second` (`step="0.5"`) hoặc phần tử trong tab Composer ở zoom 85%. Cần người dùng cho ảnh chụp cả cửa sổ.
- Người dùng nói "mở 85%": hiện hiểu là **zoom giao diện 0.85**. Nếu ý là cửa sổ chiếm 85% màn hình (không maximize) thì đổi `mainWindow.maximize()` thành kích thước cố định.
- Cột "Hôm nay" lấy từ máy chủ, chưa gộp với số render trong phiên của runner (`runner-state`). Tab "Đang chạy" còn thô so với web.
- Code cũ còn sót: `sheet/channel-sheet.js`, `sheet/diag-config.js`, `sheet/sheets-service.js` và các test liên quan không còn được dùng; dọn được sau khi chắc chắn không còn đường gọi. Hàm `buildCard`/`renderCard` còn giữ để lưu danh sách video đang chạy (thẻ không gắn vào trang).
- Tạo profile GPM tự động từ cấu hình web (`sheet/sheet-automation.js`, `add-channel.js`) chưa nối lại sau khi bỏ Sheet.
- **Chế độ 2** (render, upload tay, tự đổi thumbnail, tự lên lịch) chưa làm, người dùng hoãn.
- Chưa phát hành: máy chủ production phải chạy bản mới và dùng HTTPS trước khi tạo bản cài mới. `package.json` (version 1.4.9) và `presets/` đang chưa commit, không thuộc công việc này.

## Chạy / kiểm thử
- Chạy dev với máy chủ local: `VIDMASTER_SERVER_URL=http://localhost:3000 ./node_modules/electron/dist/electron.exe .` (máy chủ ở `D:\Code\license-server`, `node server.js`).
- Test: `node --test 'tests/*.test.js'`. Thử giao diện: playwright-core + `_electron.launch`, tạo tài khoản tạm trên máy chủ, gán máy thật cho tài khoản đó rồi trả lại cho `sonDang` (máy `f6239ec6-28f5-4641-a767-d844ad25695b`) khi xong.
- Dữ liệu dev: `sonDang` có 15 kênh gán máy này, 13.955 video; số kênh bật đang là 3 (gốc 6).

## Cạm bẫy
- `renderer.js` là script thường (không phải module): kiểm cú pháp bằng cách copy sang `.cjs` rồi `node --check`.
- Patch bằng heredoc dễ hỏng dấu `\`; dùng Write để tạo script `.cjs` rồi chạy, hoặc Edit trực tiếp. Lỗi hay gặp: `\\n` thành xuống dòng thật trong chuỗi.
- Zoom `setZoomFactor` bị đặt lại khi trang nạp lại, nên gắn vào sự kiện `did-finish-load`.
