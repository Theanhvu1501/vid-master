// Cầu nối tối thiểu cho cửa sổ thông báo/xác nhận nhỏ: nhận nội dung cần hiện và gửi lại nút được bấm. Không lộ gì khác của Electron/Node.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("noticeApi", {
  info: () => ipcRenderer.invoke("app-notice:info"),
  choose: (index) => ipcRenderer.invoke("app-notice:choose", index),
});
