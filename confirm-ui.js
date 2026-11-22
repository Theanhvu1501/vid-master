/* Hộp xác nhận dùng chung, đúng kiểu hộp "Xác nhận đăng xuất" / "Xóa dự án" của app (delete-confirm-dialog),
 * thay cho window.confirm của hệ điều hành (khác hẳn giao diện và không theo giao diện tối).
 * Dùng: const ok = await window.appConfirm({ title, message, detail, confirmText, danger }); ok === true nếu người dùng đồng ý.
 * Chỉ dùng textContent (không nội suy HTML) vì tên kênh/mẻ đến từ server và GPM. Enter = đồng ý, Esc hoặc bấm nền = hủy. */
(function () {
  "use strict";
  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

  // Nhận HAI kiểu gọi, vì app-dialog.cjs (nạp trước) cũng định nghĩa appConfirm kiểu chuỗi và file này ghi đè nó:
  //   appConfirm({ title, message, detail, confirmText, danger })        (kiểu đối tượng)
  //   appConfirm("Nội dung?", { title, okText, cancelText, danger })     (kiểu chuỗi: composer, tự động hóa)
  // Trước đây kiểu chuỗi bị mất nội dung (hộp chỉ hiện tiêu đề "Xác nhận" và hai nút).
  // Mặc định danger: kiểu đối tượng giữ nguyên như trước (true, các hộp xóa kênh/mẻ vẫn đỏ); kiểu chuỗi mặc định false (hộp "Chạy" tự động hóa không đỏ).
  function normalize(a, b) {
    if (typeof a === "string") { const o = b && typeof b === "object" ? b : {}; return { danger: false, ...o, message: a, confirmText: o.confirmText ?? o.okText }; }
    return a && typeof a === "object" ? { danger: true, ...a, confirmText: a.confirmText ?? a.okText } : { danger: true };
  }
  function appConfirm(arg1, arg2) {
    const { title = "Xác nhận", message = "", detail = "", confirmText = "Đồng ý", cancelText = "Hủy", danger = true, icon } = normalize(arg1, arg2);
    const ico = icon || (danger ? "🗑️" : "❓");
    return new Promise((resolve) => {
      const dlg = el("div", "delete-confirm-dialog active");
      dlg.setAttribute("role", "alertdialog"); dlg.setAttribute("aria-modal", "true");
      const header = el("div", "delete-confirm-header"); header.append(el("span", "icon", ico), el("h3", "", title));
      const msg = el("div", "delete-confirm-message"); msg.append(el("strong", "", message));
      const body = el("div", "delete-confirm-body"); body.append(msg);
      if (detail) { const w = el("div", "delete-confirm-warning", detail); body.append(w); }
      const cancel = el("button", "delete-confirm-btn cancel", cancelText); cancel.type = "button";
      const ok = el("button", "delete-confirm-btn confirm", confirmText); ok.type = "button";
      // Hành động nguy hiểm (xóa) dùng nút đỏ như hộp mặc định của app; hành động thường dùng nút cam của app.
      if (!danger) ok.style.background = "var(--gradient-primary, linear-gradient(135deg,#fa6e03,#e85d04))";
      else header.style.background = "rgba(255, 107, 107, 0.08)";
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
