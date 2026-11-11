// Phân loại dòng "đã render nhưng chưa lên lịch" để UI cho đăng lại thủ công.
// Hàm thuần: không đọc Sheet, không đọc đĩa — caller đưa dữ liệu vào (xem spec
// docs/superpowers/specs/2026-11-11-retry-upload-thu-cong-design.md).

import { ST } from "./resume-plan.js";

export const PENDING_KIND_ORDER = ["maybe-uploaded", "failed", "waiting", "gave-up", "rendered"];

const STEP_RE = /^b[1-4]:/;

/**
 * Cột C -> kind. null = không phải việc chờ đăng.
 *
 * `b1`..`b4` và `⏳` đều nghĩa là file ĐÃ được thả vào Studio (onUploaded chạy ngay sau
 * setFile), nên phải tách riêng: đăng lại có thể tạo bản nháp thứ hai.
 */
export function classifyUploadStatus(statusC) {
  const s = String(statusC ?? "").trim();
  if (!s) return "rendered"; // render xong nhưng chưa từng vào hàng đợi (app tắt giữa chừng)
  if (s.startsWith("⏳")) return "maybe-uploaded";
  if (STEP_RE.test(s)) return "maybe-uploaded";
  if (s.startsWith(ST.WAIT_UPLOAD)) return "waiting";
  if (s.startsWith("❌")) return "failed";
  if (s.startsWith(ST.SKIP)) return "gave-up";
  if (s.startsWith("✅")) return null; // đã lên lịch — không phải việc
  return "failed"; // trạng thái lạ: hiện ra để người dùng đọc, đừng giấu
}

function titleOf(entry, outputPath) {
  const t = String(entry?.title ?? "").trim();
  if (t) return t;
  const base = String(outputPath ?? "").split(/[\\/]/).pop() || "";
  return base.replace(/\.[^.]+$/, "");
}

/**
 * @param {object} args
 * @param {Array<{rowIndex:number,url:string,status:string,uploadStatus:string}>} args.rows
 * @param {(url:string)=>object|null} args.resolveEntry
 * @param {(path:string)=>boolean} args.fileExists
 */
export function listPendingUploads({ rows = [], resolveEntry = () => null, fileExists = () => false } = {}) {
  const out = [];
  for (const row of rows) {
    const url = String(row?.url ?? "").trim();
    if (!url) continue;
    // Chỉ video đã render xong mới có file để đăng lại.
    if (String(row?.status ?? "").trim() !== ST.DONE) continue;
    const kind = classifyUploadStatus(row?.uploadStatus);
    if (!kind) continue;

    const entry = resolveEntry(url);
    const outputPath = String(entry?.outputPath ?? "");
    if (!outputPath || !fileExists(outputPath)) continue;

    out.push({
      url,
      rowIndex: row.rowIndex,
      title: titleOf(entry, outputPath),
      outputPath,
      kind,
      // Giữ nguyên chuỗi cột C để người dùng thấy lỗi thật, chỉ cắt cho vừa card.
      statusText: String(row?.uploadStatus ?? "").trim().slice(0, 200),
      uploadAttempts: entry?.uploadAttempts ?? 0,
    });
  }
  out.sort((a, b) => {
    const d = PENDING_KIND_ORDER.indexOf(a.kind) - PENDING_KIND_ORDER.indexOf(b.kind);
    if (d) return d;
    return a.title.localeCompare(b.title, "vi");
  });
  return out;
}
