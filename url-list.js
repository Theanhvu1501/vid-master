/* Danh sách URL video của một kênh trong app: phân loại trạng thái giống hệt trang web (cột B = tải/render, cột C = upload).
 * Hàm thuần, có test. Dùng như script thường (nạp trước renderer.js): window.UrlList. */
(function () {
  "use strict";

  // [khóa, nhãn] theo thứ tự hiện trong bộ lọc và dải số liệu
  const FILTERS = [
    ["all", "Tất cả"], ["new", "Chưa làm"], ["downloaded", "Đã tải"], ["todo", "Chờ upload"], ["uploading", "Đang upload"],
    ["waiting", "Đang chờ"], ["scheduled", "Đã lên lịch"], ["upload-error", "Lỗi upload"], ["failed", "Lỗi tải/render"], ["skipped", "Bỏ qua"],
  ];
  const LABEL = Object.fromEntries(FILTERS);
  // màu chip: ok = xanh, err = đỏ, warn = vàng, brand = cam, "" = trung tính
  const TONE = { scheduled: "ok", "upload-error": "err", failed: "err", skipped: "err", uploading: "brand", waiting: "warn", todo: "brand", downloaded: "", new: "" };

  /** Một dòng { status, uploadStatus } -> khóa trạng thái. Thứ tự kiểm tra giống trang web: cột upload trước, rồi cột tải/render. */
  function stateOf(row) {
    const b = String(row?.status ?? ""), c = String(row?.uploadStatus ?? "");
    if (c.startsWith("✅")) return "scheduled";
    if (c.startsWith("❌")) return "upload-error";
    if (c.startsWith("⏳")) return "uploading";
    if (c.startsWith("⏸")) return "waiting";
    if (b.startsWith("bỏ qua")) return "skipped";
    if (b.startsWith("lỗi")) return "failed";
    if (b === "done") return "todo";
    if (b === "đã tải") return "downloaded";
    return "new";
  }

  /** Đếm theo trạng thái. total = tổng số dòng có URL. */
  function summarize(rows) {
    const out = { total: 0 };
    for (const [k] of FILTERS) if (k !== "all") out[k] = 0;
    for (const r of rows || []) { if (!String(r?.url ?? "").trim()) continue; out.total++; out[stateOf(r)]++; }
    return out;
  }

  /** Lọc theo trạng thái ("all" = không lọc) và theo chuỗi tìm trong URL (không phân biệt hoa thường). */
  function filterRows(rows, filter = "all", q = "") {
    const needle = String(q || "").trim().toLowerCase();
    return (rows || []).filter((r) => {
      const url = String(r?.url ?? "").trim();
      if (!url) return false;
      if (filter !== "all" && stateOf(r) !== filter) return false;
      return !needle || url.toLowerCase().includes(needle);
    });
  }

  /** Chi tiết hiện cạnh URL: trạng thái cột B (trừ "done"/"đã tải" vì đã thể hiện bằng nhãn) và cột C. */
  function detailOf(row) {
    const b = String(row?.status ?? ""), c = String(row?.uploadStatus ?? "");
    return [b && b !== "done" && b !== "đã tải" ? b : "", c].filter(Boolean).join(" · ");
  }

  /** Video ở trạng thái lỗi mà nút "Thử lại" xử lý được: lỗi tải/render, bỏ qua sau N lần, lỗi upload. Đang upload/đang chờ/đã xong thì không. */
  const RETRYABLE = new Set(["failed", "skipped", "upload-error"]);
  const canRetry = (row) => RETRYABLE.has(stateOf(row));
  /** Các url lỗi có thể thử lại trong danh sách. */
  const retryableUrls = (rows) => (rows || []).filter((r) => String(r?.url ?? "").trim() && canRetry(r)).map((r) => String(r.url).trim());

  window.UrlList = { FILTERS, LABEL, TONE, stateOf, summarize, filterRows, detailOf, canRetry, retryableUrls };
})();
