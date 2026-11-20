/* Hộp xác nhận dùng chung, đúng kiểu hộp "Xác nhận đăng xuất" / "Xóa dự án" của app (delete-confirm-dialog),
 * thay cho window.confirm của hệ điều hành (khác hẳn giao diện và không theo giao diện tối).
 * Dùng: const ok = await window.appConfirm({ title, message, detail, confirmText, danger }); ok === true nếu người dùng đồng ý.
 * Chỉ dùng textContent (không nội suy HTML) vì tên kênh/mẻ đến từ server và GPM. Enter = đồng ý, Esc hoặc bấm nền = hủy. */
(function () {
  "use strict";
  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

  function appConfirm({ title = "Xác nhận", message = "", detail = "", confirmText = "Đồng ý", cancelText = "Hủy", danger = true, icon = danger ? "🗑️" : "❓" } = {}) {
    return new Promise((resolve) => {
      const dlg = el("div", "delete-confirm-dialog active");
      dlg.setAttribute("role", "alertdialog"); dlg.setAttribute("aria-modal", "true");
      const header = el("div", "delete-confirm-header"); header.append(el("span", "icon", icon), el("h3", "", title));
      const msg = el("div", "delete-confirm-message"); msg.append(el("strong", "", message));
      const body = el("div", "delete-confirm-body"); body.append(msg);
      if (detail) { const w = el("div", "delete-confirm-warning", detail); body.append(w); }
      const cancel = el("button", "delete-confirm-btn cancel", cancelText); cancel.type = "button";
      const ok = el("button", "delete-confirm-btn confirm", confirmText); ok.type = "button";
      if (!danger) ok.style.background = "var(--gradient-primary, linear-gradient(135deg,#fa6e03,#e85d04))";
      const actions = el("div", "delete-confirm-actions"); actions.append(cancel, ok); body.append(actions);
      const content = el("div", "delete-confirm-content"); content.append(header, body);
      dlg.append(content);
      const done = (v) => { document.removeEventListener("keydown", onKey, true); dlg.remove(); resolve(v); };
      const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); done(false); } else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); done(true); } };
      cancel.addEventListener("click", () => done(false));
      ok.addEventListener("click", () => done(true));
      dlg.addEventListener("click", (e) => { if (e.target === dlg) done(false); });
      document.addEventListener("keydown", onKey, true);
      document.body.append(dlg);
      cancel.focus();
    });
  }
  window.appConfirm = appConfirm;
})();
