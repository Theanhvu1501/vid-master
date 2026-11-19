// Cầu nối tối thiểu cho cửa sổ đăng nhập: chỉ 4 việc, không lộ gì khác của Electron/Node.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("loginApi", {
  info: () => ipcRenderer.invoke("app-login:info"),
  submit: (username, password) => ipcRenderer.invoke("app-login:submit", { username, password }),
  copy: (text) => ipcRenderer.invoke("app-login:copy", String(text || "")),
  quit: () => ipcRenderer.invoke("app-login:quit"),
});
