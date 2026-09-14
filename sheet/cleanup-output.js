// Chọn file cũ để dọn cho đỡ đầy ổ. Bộ quyết định THUẦN: nhận danh sách file đã
// stat sẵn + danh sách đường dẫn phải giữ, trả về những file được phép xoá. Không
// I/O, không fs — test được độc lập như resume-plan.js / schedule-slots.js.
//
// Hai luật, và luật thứ hai mới là luật giữ mạng:
//   1) Cũ hơn mốc "giữ N ngày" (N=1 -> mốc là 00:00 hôm nay).
//   2) KHÔNG nằm trong keepPaths. Bên gọi dựng keepPaths từ resume-state.json, nơi
//      chỉ bị xoá entry khi cột B="done" VÀ cột C bắt đầu "✅" — tức video đã nằm
//      trên YouTube. Nên "còn entry" đồng nghĩa "còn việc phải làm với file này":
//      chờ upload, upload lỗi, GPM chết qua đêm. Xoá nhầm là mất vĩnh viễn, vì cột B
//      đã "done" nên không render lại, mà decideAction trả "skip" khi mất output.

// output/: chỉ video thành phẩm.
// overlays/: video nguồn mồ côi do render lỗi (nặng ngang video gốc) + file .part dở
// dang của yt-dlp. Cố tình KHÔNG có .jpg: đó là thumbnail, nhẹ, và lần upload lại còn cần.
export const CLEAN_EXTS = {
  output: [".mp4"],
  overlays: [".mp4", ".part"],
};

// So khớp đường dẫn phải chịu được Windows: "D:\A\b.mp4" và "d:/a/B.mp4" là một file.
// Chuẩn hoá rộng tay có thể giữ nhầm file không cần giữ — hướng sai an toàn.
function norm(p) {
  return String(p ?? "").replace(/\\/g, "/").toLowerCase();
}

function hasExt(filePath, exts) {
  const p = norm(filePath);
  return exts.some((e) => p.endsWith(String(e).toLowerCase()));
}

// Mốc cắt là 00:00 của ngày, KHÔNG phải "24h trước": người dùng nghĩ theo ngày lịch
// ("xoá video hôm qua"), không theo đồng hồ đếm ngược.
function cutoffMs(now, keepDays) {
  // null/"" là "chưa cấu hình", KHÔNG phải 0 — mà Number() ép cả hai về 0, đúng bằng
  // giá trị hợp lệ nghĩa là "xoá cả hôm nay". Không chặn riêng thì ô UI để trống hoá
  // ra lệnh dọn sạch.
  const n = keepDays === null || keepDays === "" ? NaN : Number(keepDays);
  const days = Number.isFinite(n) && n >= 0 ? Math.floor(n) : 1;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  d.setDate(d.getDate() - (days - 1));
  return d.getTime();
}

// Dung lượng cho câu log. Chỉ MB/GB: dọn xong mà báo "5033164 byte" thì người dùng
// phải tự chia mới biết có đáng bật hay không.
export function formatBytes(n) {
  const mb = Number(n) / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`;
}

/**
 * @param {{path: string, mtimeMs: number, size: number}[]} files - nội dung một thư mục đã stat.
 * @param {Iterable<string>} keepPaths - đường dẫn tuyệt đối không được đụng tới.
 * @param {Date} now
 * @param {number} keepDays - giữ lại N ngày gần nhất; 0 = xoá cả hôm nay; sai kiểu -> 1.
 * @param {string[]} exts - phần mở rộng được phép dọn (xem CLEAN_EXTS).
 * @returns {{path: string, mtimeMs: number, size: number}[]} - file được phép xoá, giữ nguyên size.
 */
export function planCleanup({ files = [], keepPaths = [], now = new Date(), keepDays = 1, exts = [] } = {}) {
  const cutoff = cutoffMs(now, keepDays);
  const keep = new Set([...keepPaths].map(norm));
  return files.filter(
    (f) => hasExt(f.path, exts) && Number(f.mtimeMs) < cutoff && !keep.has(norm(f.path)),
  );
}
