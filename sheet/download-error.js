// Lấy ra lý do lỗi tải THẬT từ một lỗi do youtube-dl-exec / child_process ném ra.
// Vấn đề: thông tin thật của yt-dlp nằm trong e.stderr (và đôi khi e.stdout), còn e.message
// thường chỉ là "Command failed with exit code 1" hoặc rỗng -> hiện ra "Unknown error".
// Hàm thuần, test được. Trả chuỗi ngắn gọn, ưu tiên dòng "ERROR:" của yt-dlp.

const MAX = 300;

// Rút gọn và gom các khoảng trắng; cắt theo MAX ký tự.
function tidy(s) {
  return String(s || "").replace(/\s+/g, " ").trim().slice(0, MAX);
}

// yt-dlp in lỗi ra nhiều dòng; dòng hữu ích nhất bắt đầu bằng "ERROR:".
// Có thì lấy dòng ERROR đầu tiên (bỏ tiền tố "ERROR:"), không thì lấy toàn bộ text đã rút gọn.
function pickYtdlpLine(text) {
  const t = String(text || "");
  if (!t.trim()) return "";
  const err = t.split(/\r?\n/).map((l) => l.trim()).find((l) => /^ERROR:/i.test(l));
  if (err) return tidy(err.replace(/^ERROR:\s*/i, ""));
  return tidy(t);
}

/**
 * @param {any} e  lỗi bắt được (Error của youtube-dl-exec: có thể kèm .stderr/.stdout)
 * @returns {string} lý do ngắn gọn, không bao giờ rỗng
 */
export function describeDownloadError(e) {
  if (e == null) return "Lỗi không rõ";
  // Ưu tiên stderr (nơi yt-dlp ghi lỗi thật), rồi stdout.
  const fromStd = pickYtdlpLine(e.stderr) || pickYtdlpLine(e.stdout);
  if (fromStd) return fromStd;
  // message của youtube-dl-exec thường vô nghĩa ("Command failed with exit code 1") -> chỉ dùng khi không còn gì khác.
  const msg = tidy(e.message || (typeof e === "string" ? e : ""));
  if (msg && !/^Command failed/i.test(msg)) return msg;
  if (msg) return msg; // vẫn còn hơn "Unknown error"
  return "Lỗi không rõ";
}
