import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { normalizeNotice, createNoticeService } from "../sheet/notice-window.js";

test("normalizeNotice: nút mặc định OK; defaultId/cancelId hợp lệ hoặc rơi về mặc định; cắt độ dài, bỏ ký tự điều khiển, kiểu lạ -> info", () => {
  const a = normalizeNotice({});
  assert.deepEqual({ k: a.kind, b: a.buttons, d: a.defaultId, c: a.cancelId, danger: a.danger }, { k: "info", b: ["OK"], d: 0, c: 0, danger: false });
  const b = normalizeNotice({ type: "question", buttons: ["Đăng xuất", "Hủy"], defaultId: 1, cancelId: 1, message: "x".repeat(900), detail: "a\u0000b".repeat(900) });
  assert.deepEqual({ k: b.kind, d: b.defaultId, c: b.cancelId }, { k: "question", d: 1, c: 1 });
  assert.equal(b.message.length, 400); assert.ok(b.detail.length <= 1200 && !b.detail.includes("\u0000"));
  assert.equal(normalizeNotice({ type: "hack" }).kind, "info");
  assert.equal(normalizeNotice({ buttons: ["A", "B"], cancelId: 9, defaultId: -1 }).cancelId, 1, "cancelId ngoài khoảng -> nút cuối");
  assert.equal(normalizeNotice({ buttons: ["A", "B", "C", "D", "E", "F"] }).buttons.length, 4);
});

function makeEnv({ failLoad = false, throwOnCreate = false } = {}) {
  const handlers = new Map(), wins = [];
  const ipcMain = { handle: (c, f) => handlers.set(c, f), removeHandler: (c) => handlers.delete(c) };
  class FakeWin extends EventEmitter {
    constructor(opts) { super(); if (throwOnCreate) throw new Error("không dựng được"); this.opts = opts; this.destroyed = false; this.webContents = { setWindowOpenHandler() {}, on() {}, id: wins.length }; wins.push(this); }
    setMenuBarVisibility() {} isDestroyed() { return this.destroyed; }
    loadFile() { return failLoad ? Promise.reject(new Error("x")) : Promise.resolve(); }
    show() { this.shown = true; } close() { if (this.destroyed) return; this.destroyed = true; this.emit("closed"); } destroy() { this.destroyed = true; }
    once(ev, f) { if (ev === "ready-to-show") setImmediate(f); else super.once(ev, f); return this; }
  }
  const svc = createNoticeService({ BrowserWindow: FakeWin, ipcMain, htmlPath: "n.html", preloadPath: "p.cjs", iconPath: "i.ico", fallback: async () => ({ response: 7 }) });
  return { svc, handlers, wins };
}
const tick = () => new Promise((r) => setTimeout(r, 5));

test("hiện hộp: cửa sổ nhận đúng nội dung, bấm nút nào trả về chỉ số nút đó; chỉ nhận từ đúng cửa sổ", async () => {
  const { svc, handlers, wins } = makeEnv();
  const p = svc.show(null, { type: "question", title: "Đăng xuất", message: "Chắc chắn?", buttons: ["Đăng xuất", "Hủy"], defaultId: 1, cancelId: 1 });
  await tick();
  const w = wins[0], info = await handlers.get("app-notice:info")({ sender: w.webContents });
  assert.equal(info.title, "Đăng xuất"); assert.deepEqual(info.buttons, ["Đăng xuất", "Hủy"]);
  assert.equal(await handlers.get("app-notice:info")({ sender: { fake: 1 } }), null, "cửa sổ khác không đọc được nội dung");
  await handlers.get("app-notice:choose")({ sender: { fake: 1 } }, 0); // giả mạo: bị bỏ qua
  await handlers.get("app-notice:choose")({ sender: w.webContents }, 0);
  assert.deepEqual(await p, { response: 0 });
  assert.equal(handlers.size, 0, "gỡ handler sau khi xong");
});

test("đóng bằng nút X hoặc chỉ số lạ thì coi là Hủy (cancelId); chỉ có một nút thì trả 0", async () => {
  const { svc, handlers, wins } = makeEnv();
  let p = svc.show(null, { buttons: ["Đăng xuất", "Hủy"], cancelId: 1 }); await tick(); wins[0].close();
  assert.deepEqual(await p, { response: 1 });
  p = svc.show(null, { buttons: ["Đăng xuất", "Hủy"], cancelId: 1 }); await tick();
  await handlers.get("app-notice:choose")({ sender: wins[1].webContents }, 99);
  assert.deepEqual(await p, { response: 1 });
  p = svc.show(null, { message: "xong" }); await tick(); await handlers.get("app-notice:choose")({ sender: wins[2].webContents }, 0);
  assert.deepEqual(await p, { response: 0 });
});

test("nhiều hộp liên tiếp mở lần lượt, không chồng nhau", async () => {
  const { svc, handlers, wins } = makeEnv();
  const p1 = svc.show(null, { message: "một" }), p2 = svc.show(null, { message: "hai" });
  await tick(); assert.equal(wins.length, 1, "hộp thứ hai chờ hộp thứ nhất");
  await handlers.get("app-notice:choose")({ sender: wins[0].webContents }, 0); await p1; await tick();
  assert.equal(wins.length, 2);
  await handlers.get("app-notice:choose")({ sender: wins[1].webContents }, 0); await p2;
});

test("không dựng được cửa sổ hoặc không tải được trang thì không ném lỗi: dùng hộp dự phòng / trả hủy", async () => {
  assert.deepEqual(await makeEnv({ throwOnCreate: true }).svc.show(null, { buttons: ["A", "B"], cancelId: 1 }), { response: 7 }, "có fallback thì dùng");
  assert.deepEqual(await makeEnv({ failLoad: true }).svc.show(null, { buttons: ["A", "B"], cancelId: 1 }), { response: 1 });
});

test("cửa sổ cha: có cha thì modal, không cha (lúc khởi động) thì luôn nằm trên cùng", async () => {
  const { svc, handlers, wins } = makeEnv();
  const parent = { isDestroyed: () => false };
  let p = svc.show(parent, { message: "a" }); await tick();
  assert.equal(wins[0].opts.modal, true); assert.equal(wins[0].opts.alwaysOnTop, false);
  await handlers.get("app-notice:choose")({ sender: wins[0].webContents }, 0); await p;
  p = svc.show(null, { message: "b" }); await tick();
  assert.equal(wins[1].opts.alwaysOnTop, true); assert.equal(wins[1].opts.modal, undefined);
  await handlers.get("app-notice:choose")({ sender: wins[1].webContents }, 0); await p;
});
