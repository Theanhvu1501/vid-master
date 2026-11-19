// Thông báo và hộp thoại xác nhận theo giao diện của app, thay cho alert()/confirm() mặc định của
// hệ thống (hộp trắng, không theo theme tối).
//
//   appToast(message, { kind })      thông báo nổi góc phải, tự tắt; kind: success | error | warning | info
//                                    (không truyền kind thì đoán theo nội dung câu chữ)
//   appConfirm(message, { title, okText, cancelText, danger })  -> Promise<boolean>
//   window.alert(...)                được thay bằng appToast, nên mọi chỗ gọi alert() sẵn có tự đổi style
//
// Nạp TRƯỚC renderer.js. alert() cũ không chặn luồng chạy nữa (toast không chờ người dùng bấm), nên
// các chỗ cần chờ trả lời phải dùng `await appConfirm(...)`.

(function (root) {
  "use strict";

  // ---------------------------------------------------------------------------------------------
  // Phân loại câu chữ -> loại thông báo (hàm thuần, có test)
  // ---------------------------------------------------------------------------------------------
  const fold = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d");

  function classifyMessage(msg) {
    const raw = String(msg ?? "").trimStart();
    if (/^(⚠|❗|‼)/u.test(raw)) return "warning";
    if (/^(❌|✖|✘|🚫)/u.test(raw)) return "error";
    if (/^(✅|✔|☑|🎉)/u.test(raw)) return "success";
    const t = fold(raw);
    if (/^(loi\b|khong\b|that bai|error\b|failed\b)/.test(t)) return "error";
    if (/^(hay |vui long|chua |canh bao|luu y)/.test(t)) return "warning";
    if (/^(da |thanh cong|hoan tat|xong\b)/.test(t) || /\bthanh cong\b/.test(t)) return "success";
    return "info";
  }

  // Thời gian hiện (ms): lỗi ở lâu hơn để kịp đọc, thành công tắt nhanh.
  const DURATION = { success: 4000, info: 5000, warning: 7000, error: 10000 };
  const MAX_TOASTS = 5;

  if (typeof document === "undefined") {
    // Chạy ngoài trình duyệt (test): chỉ xuất phần thuần.
    if (typeof module !== "undefined" && module.exports) module.exports = { classifyMessage, DURATION, MAX_TOASTS };
    return;
  }

  // ---------------------------------------------------------------------------------------------
  // Biểu tượng (nét mảnh, cùng bộ Lucide với menu)
  // ---------------------------------------------------------------------------------------------
  const svg = (inner) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  const ICONS = {
    success: svg('<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>'),
    error: svg('<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>'),
    warning: svg('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>'),
    info: svg('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>'),
    close: svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
  };

  // ---------------------------------------------------------------------------------------------
  // CSS (dùng biến theme của app)
  // ---------------------------------------------------------------------------------------------
  const CSS = `
#app-toast-host { position: fixed; top: 64px; right: 20px; z-index: 20000; display: flex; flex-direction: column; gap: 10px; width: min(420px, calc(100vw - 40px)); pointer-events: none; }
.app-toast { --k: var(--accent-primary); pointer-events: auto; display: flex; align-items: flex-start; gap: 12px; padding: 12px 12px 12px 14px; background: var(--bg-elevated); border: 1px solid var(--border-default); border-left: 4px solid var(--k); border-radius: var(--radius-lg); box-shadow: var(--shadow-lg); color: var(--text-primary); font-size: 13px; line-height: 1.5; animation: app-toast-in 0.2s ease; }
.app-toast.success { --k: var(--accent-success); }
.app-toast.error { --k: var(--accent-danger); }
.app-toast.warning { --k: var(--accent-warning); }
.app-toast.leaving { opacity: 0; transform: translateX(24px); transition: opacity 0.16s ease, transform 0.16s ease; }
.app-toast .app-ico { color: var(--k); flex-shrink: 0; margin-top: 1px; display: inline-flex; }
.app-toast .app-msg { flex: 1; min-width: 0; white-space: pre-wrap; word-break: break-word; overflow-wrap: anywhere; max-height: 240px; overflow-y: auto; }
.app-toast .app-count { color: var(--text-muted); font-size: 11px; margin-left: 6px; }
.app-toast .app-close { flex-shrink: 0; width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center; padding: 0; background: transparent; border: none; border-radius: var(--radius-sm); color: var(--text-muted); cursor: pointer; }
.app-toast .app-close:hover { background: var(--bg-hover); color: var(--text-primary); }
.app-toast .app-close svg { width: 16px; height: 16px; }
.app-toast .app-close:focus-visible, .app-dlg button:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 2px; }
@keyframes app-toast-in { from { opacity: 0; transform: translateX(24px); } to { opacity: 1; transform: translateX(0); } }

.app-dlg-overlay { position: fixed; inset: 0; z-index: 20001; display: flex; align-items: center; justify-content: center; background: rgba(0, 0, 0, 0.72); backdrop-filter: blur(6px); animation: app-fade 0.15s ease; }
.app-dlg { --k: var(--accent-primary); width: min(460px, calc(100vw - 40px)); max-height: calc(100vh - 80px); display: flex; flex-direction: column; background: var(--bg-secondary); border: 1px solid var(--border-default); border-top: 3px solid var(--k); border-radius: var(--radius-xl); box-shadow: var(--shadow-lg); animation: app-pop 0.18s cubic-bezier(0.34, 1.4, 0.64, 1); }
.app-dlg.danger { --k: var(--accent-danger); }
.app-dlg-head { display: flex; align-items: center; gap: 12px; padding: 18px 22px 6px; }
.app-dlg-head .app-ico { color: var(--k); display: inline-flex; }
.app-dlg-head h3 { margin: 0; font-size: 16px; font-weight: 600; color: var(--text-primary); }
.app-dlg-body { padding: 8px 22px 6px; color: var(--text-secondary); font-size: 13.5px; line-height: 1.65; white-space: pre-wrap; word-break: break-word; overflow-wrap: anywhere; overflow-y: auto; }
.app-dlg-actions { display: flex; justify-content: flex-end; gap: 10px; padding: 16px 22px 20px; }
.app-dlg-actions .btn { min-width: 96px; }
.app-choices { display: flex; flex-direction: column; gap: 8px; padding: 10px 22px 0; }
.app-choice { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; width: 100%; padding: 11px 14px; text-align: left; background: var(--bg-tertiary); border: 1px solid var(--border-default); border-radius: var(--radius-md); color: var(--text-primary); cursor: pointer; transition: var(--transition-fast); }
.app-choice:hover { background: var(--bg-hover); border-color: var(--accent-primary); }
.app-choice-label { font-size: 14px; font-weight: 600; }
.app-choice-hint { font-size: 12px; color: var(--text-secondary); line-height: 1.5; }
@keyframes app-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes app-pop { from { opacity: 0; transform: scale(0.94) translateY(-10px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) {
  .app-toast, .app-dlg, .app-dlg-overlay { animation: none; }
  .app-toast.leaving { transition: none; }
}
`;
  function injectStyles() {
    if (document.getElementById("app-dialog-styles")) return;
    const el = document.createElement("style");
    el.id = "app-dialog-styles";
    el.textContent = CSS;
    (document.head || document.documentElement).appendChild(el);
  }

  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };
  const reducedMotion = () => !!(root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches);

  // ---------------------------------------------------------------------------------------------
  // Toast
  // ---------------------------------------------------------------------------------------------
  let host = null;
  const live = []; // { key, node, count, timer, kind, text }

  function ensureHost() {
    if (host && host.isConnected) return host;
    injectStyles();
    host = el("div");
    host.id = "app-toast-host";
    (document.body || document.documentElement).appendChild(host);
    return host;
  }

  function dismiss(entry) {
    const i = live.indexOf(entry);
    if (i < 0) return;
    live.splice(i, 1);
    clearTimeout(entry.timer);
    const done = () => entry.node.remove();
    if (reducedMotion()) return done();
    entry.node.classList.add("leaving");
    setTimeout(done, 200); // dự phòng nếu transition không chạy
  }

  function arm(entry, ms) {
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => dismiss(entry), ms);
  }

  // Bỏ khỏi danh sách theo dõi những toast đã bị gỡ khỏi DOM từ bên ngoài (hoặc host bị làm mới),
  // để bộ đếm giới hạn và việc gộp trùng luôn khớp với những gì thật sự đang hiện.
  function pruneDetached() {
    for (let i = live.length - 1; i >= 0; i--) {
      if (!live[i].node.isConnected) { clearTimeout(live[i].timer); live.splice(i, 1); }
    }
  }

  function appToast(message, opts = {}) {
    const text = String(message ?? "").trim();
    pruneDetached();
    if (!text) return null;
    const kind = ["success", "error", "warning", "info"].includes(opts.kind) ? opts.kind : classifyMessage(text);
    const key = `${kind}|${text}`;
    const ms = opts.duration ?? DURATION[kind];

    // Cùng một thông báo đang hiện: không xếp chồng, chỉ tăng bộ đếm và gia hạn.
    const dup = live.find((e) => e.key === key);
    if (dup) {
      dup.count += 1;
      let badge = dup.node.querySelector(".app-count");
      if (!badge) { badge = el("span", "app-count"); dup.node.querySelector(".app-msg").appendChild(badge); }
      badge.textContent = `×${dup.count}`;
      arm(dup, ms);
      return dup.node;
    }

    const h = ensureHost();
    const node = el("div", `app-toast ${kind}`);
    node.setAttribute("role", kind === "error" || kind === "warning" ? "alert" : "status");
    const ico = el("span", "app-ico", ICONS[kind]);
    const msg = el("div", "app-msg");
    msg.textContent = text; // textContent: nội dung có thể chứa đường dẫn/tên người dùng, không được hiểu là HTML
    const close = el("button", "app-close", ICONS.close);
    close.type = "button";
    close.title = "Đóng";
    close.setAttribute("aria-label", "Đóng thông báo");
    node.append(ico, msg, close);
    h.appendChild(node);

    const entry = { key, node, count: 1, timer: null, kind };
    live.push(entry);
    while (live.length > MAX_TOASTS) dismiss(live[0]); // quá nhiều thì bỏ cái cũ nhất

    close.addEventListener("click", () => dismiss(entry));
    node.addEventListener("mouseenter", () => clearTimeout(entry.timer));
    node.addEventListener("mouseleave", () => arm(entry, 2000));
    arm(entry, ms);
    return node;
  }

  // ---------------------------------------------------------------------------------------------
  // Hộp thoại xác nhận (xếp hàng: mở lần lượt, không chồng nhau)
  // ---------------------------------------------------------------------------------------------
  let chain = Promise.resolve();

  function appConfirm(message, opts = {}) {
    const run = () => new Promise((resolve) => {
      injectStyles();
      const danger = !!opts.danger;
      const prevFocus = document.activeElement;
      const uid = `app-dlg-${Math.random().toString(36).slice(2, 8)}`;

      const overlay = el("div", "app-dlg-overlay");
      const dlg = el("div", `app-dlg${danger ? " danger" : ""}`);
      dlg.setAttribute("role", "alertdialog");
      dlg.setAttribute("aria-modal", "true");
      dlg.setAttribute("aria-labelledby", `${uid}-t`);
      dlg.setAttribute("aria-describedby", `${uid}-b`);

      const head = el("div", "app-dlg-head");
      head.append(el("span", "app-ico", ICONS[danger ? "warning" : "info"]));
      const title = el("h3"); title.id = `${uid}-t`; title.textContent = opts.title || "Xác nhận";
      head.append(title);
      const body = el("div", "app-dlg-body"); body.id = `${uid}-b`; body.textContent = String(message ?? "");

      const actions = el("div", "app-dlg-actions");
      const cancel = el("button", "btn btn-secondary"); cancel.type = "button"; cancel.textContent = opts.cancelText || "Huỷ";
      const ok = el("button", `btn ${danger ? "btn-danger" : "btn-primary"}`); ok.type = "button"; ok.textContent = opts.okText || "Đồng ý";
      actions.append(cancel, ok);
      dlg.append(head, body, actions);
      overlay.append(dlg);
      document.body.appendChild(overlay);

      let closed = false;
      const finish = (value) => {
        if (closed) return;
        closed = true;
        document.removeEventListener("keydown", onKey, true);
        overlay.remove();
        try { prevFocus?.focus?.(); } catch { /* phần tử cũ có thể đã bị gỡ */ }
        resolve(value);
      };
      function onKey(e) {
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false); return; }
        if (e.key === "Tab") { // giữ focus trong hộp thoại
          e.preventDefault();
          const order = [cancel, ok];
          const i = order.indexOf(document.activeElement);
          order[(i + (e.shiftKey ? -1 : 1) + order.length) % order.length].focus();
        }
      }
      document.addEventListener("keydown", onKey, true);
      cancel.addEventListener("click", () => finish(false));
      ok.addEventListener("click", () => finish(true));
      overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) finish(false); });

      // Việc nguy hiểm thì focus mặc định ở "Huỷ" để lỡ bấm Enter không xoá nhầm.
      (danger ? cancel : ok).focus();
    });
    const p = chain.then(run);
    chain = p.catch(() => {});
    return p;
  }

  // ---------------------------------------------------------------------------------------------
  // Hộp thoại chọn một trong nhiều lựa chọn. Trả về value của lựa chọn được bấm, hoặc null nếu huỷ (Esc, bấm ra ngoài, Đóng).
  // choices: [{ label, value, hint? }]
  // ---------------------------------------------------------------------------------------------
  function appChoose(message, choices, opts = {}) {
    const list = Array.isArray(choices) ? choices.filter((c) => c && c.value != null) : [];
    if (!list.length) return Promise.resolve(null);
    const run = () => new Promise((resolve) => {
      injectStyles();
      const prevFocus = document.activeElement;
      const uid = `app-dlg-${Math.random().toString(36).slice(2, 8)}`;
      const overlay = el("div", "app-dlg-overlay");
      const dlg = el("div", "app-dlg");
      dlg.setAttribute("role", "dialog");
      dlg.setAttribute("aria-modal", "true");
      dlg.setAttribute("aria-labelledby", `${uid}-t`);
      dlg.setAttribute("aria-describedby", `${uid}-b`);

      const head = el("div", "app-dlg-head");
      head.append(el("span", "app-ico", ICONS.info));
      const title = el("h3"); title.id = `${uid}-t`; title.textContent = opts.title || "Chọn";
      head.append(title);
      const body = el("div", "app-dlg-body"); body.id = `${uid}-b`; body.textContent = String(message ?? "");

      const opts_ = el("div", "app-choices");
      const buttons = list.map((c) => {
        const b = el("button", "app-choice"); b.type = "button";
        const l = el("span", "app-choice-label"); l.textContent = c.label;
        b.append(l);
        if (c.hint) { const h = el("span", "app-choice-hint"); h.textContent = c.hint; b.append(h); }
        b.addEventListener("click", () => finish(c.value));
        opts_.append(b);
        return b;
      });
      const actions = el("div", "app-dlg-actions");
      const cancel = el("button", "btn btn-secondary"); cancel.type = "button"; cancel.textContent = opts.cancelText || "Đóng";
      actions.append(cancel);
      dlg.append(head, body, opts_, actions);
      overlay.append(dlg);
      document.body.appendChild(overlay);

      let closed = false;
      const all = [...buttons, cancel];
      const finish = (value) => {
        if (closed) return;
        closed = true;
        document.removeEventListener("keydown", onKey, true);
        overlay.remove();
        try { prevFocus?.focus?.(); } catch { /* phần tử cũ có thể đã bị gỡ */ }
        resolve(value);
      };
      function onKey(e) {
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(null); return; }
        if (e.key === "Tab" || e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const back = e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey);
          const i = all.indexOf(document.activeElement);
          all[(i + (back ? -1 : 1) + all.length) % all.length].focus();
        }
      }
      document.addEventListener("keydown", onKey, true);
      cancel.addEventListener("click", () => finish(null));
      overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) finish(null); });
      buttons[0].focus();
    });
    const p = chain.then(run);
    chain = p.catch(() => {});
    return p;
  }

  root.appChoose = appChoose;
    root.appToast = appToast;
  root.appConfirm = appConfirm;
  root.__nativeAlert = root.alert ? root.alert.bind(root) : null;
  // Mọi alert() sẵn có tự đổi style. Không chặn luồng chạy (khác alert gốc).
  root.alert = (message) => { appToast(message); };

  if (typeof module !== "undefined" && module.exports) module.exports = { classifyMessage, DURATION, MAX_TOASTS };
})(typeof window !== "undefined" ? window : globalThis);
