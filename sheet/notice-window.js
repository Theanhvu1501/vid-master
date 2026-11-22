// Cửa sổ thông báo / xác nhận nhỏ theo style của app, thay cho dialog.showMessageBox mặc định của hệ điều hành.
// Chạy được cả khi CHƯA có cửa sổ chính (lỗi lúc khởi động, bị buộc đăng xuất) vì tự dựng cửa sổ riêng.
//
// Nhận phụ thuộc (BrowserWindow, ipcMain, đường dẫn...) từ ngoài để test không cần Electron thật.
// Trả về Promise<{ response }>: response là chỉ số nút được bấm; đóng cửa sổ/Esc = cancelId. Không bao giờ ném lỗi:
// không dựng được cửa sổ thì dùng hộp mặc định (fallback) để người dùng vẫn nhìn thấy thông báo.

const clampText = (v, max) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").slice(0, max);

/** Chuẩn hóa tùy chọn người gọi đưa vào (kiểu dialog.showMessageBox) thành dữ liệu an toàn gửi sang cửa sổ. */
export function normalizeNotice(o = {}) {
  const buttons = (Array.isArray(o.buttons) && o.buttons.length ? o.buttons : ["OK"]).slice(0, 4).map((b) => clampText(b, 40) || "OK");
  const last = buttons.length - 1;
  const idx = (v, def) => (Number.isInteger(v) && v >= 0 && v <= last ? v : def);
  const kind = ["question", "warning", "error", "info"].includes(o.type) ? o.type : "info";
  return {
    kind, danger: o.danger === true, icon: o.icon ? clampText(o.icon, 4) : "",
    title: clampText(o.title, 80), message: clampText(o.message, 400), detail: clampText(o.detail, 1200),
    buttons, defaultId: idx(o.defaultId, 0), cancelId: idx(o.cancelId, last),
  };
}

export function createNoticeService({ BrowserWindow, ipcMain, htmlPath, preloadPath, iconPath, fallback = null, windowOptions = {} }) {
  let seq = 0;
  let chain = Promise.resolve(); // mở lần lượt, không chồng nhiều cửa sổ

  function show(parent, options) {
    const run = () => new Promise((resolve) => {
      const o = normalizeNotice(options);
      const id = ++seq, chInfo = "app-notice:info", chChoose = "app-notice:choose";
      let win = null, done = false;
      const finish = (response) => { if (done) return; done = true; try { ipcMain.removeHandler(chInfo); ipcMain.removeHandler(chChoose); } catch { /* đã gỡ */ } if (win && !win.isDestroyed()) { try { win.close(); } catch { /* đã đóng */ } } resolve({ response }); };
      try {
        const height = 230 + (o.detail ? Math.min(150, 40 + Math.ceil(o.detail.length / 38) * 17) : 0) + (o.message.length > 70 ? 24 : 0);
        win = new BrowserWindow({
          width: 440, height, resizable: false, minimizable: false, maximizable: false, autoHideMenuBar: true, show: false, title: o.title || "VidMaster",
          icon: iconPath, backgroundColor: "#151b23", skipTaskbar: false, alwaysOnTop: !parent,
          ...(parent && !parent.isDestroyed?.() ? { parent, modal: true } : {}),
          webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: preloadPath },
          ...windowOptions,
        });
        win.setMenuBarVisibility(false);
        win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
        win.webContents.on("will-navigate", (e) => e.preventDefault());
        // Chỉ nhận yêu cầu từ ĐÚNG cửa sổ này (không cho trang khác giả nút bấm).
        ipcMain.removeHandler(chInfo); ipcMain.removeHandler(chChoose);
        ipcMain.handle(chInfo, (e) => (win && e.sender === win.webContents ? o : null));
        ipcMain.handle(chChoose, (e, i) => { if (win && e.sender === win.webContents) finish(Number.isInteger(i) && i >= 0 && i < o.buttons.length ? i : o.cancelId); return true; });
        win.on("closed", () => { win = null; finish(o.cancelId); }); // đóng bằng nút X = hủy
        win.once("ready-to-show", () => win?.show());
        win.loadFile(htmlPath).catch(() => finish(o.cancelId));
      } catch (err) {
        done = true; try { if (win && !win.isDestroyed()) win.destroy(); } catch { /* ignore */ }
        // Không dựng được cửa sổ: dùng hộp mặc định để vẫn thấy thông báo
        Promise.resolve(fallback ? fallback(parent, options) : { response: o.cancelId }).then((r) => resolve({ response: r?.response ?? o.cancelId })).catch(() => resolve({ response: o.cancelId }));
      }
    });
    const p = chain.then(run, run);
    chain = p.catch(() => {});
    return p;
  }
  return { show };
}
