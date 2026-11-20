// Tách cấu hình render thành hai phần:
//   shared: thông số GIỐNG NHAU giữa các máy (kiểu render, độ mờ, chroma key, tốc độ...) -> lên server gắn với mẻ, máy nào cũng dùng được
//   local : thứ RIÊNG của máy (đường dẫn thư mục/file, GPU, khóa API, proxy, cookies) -> ở lại máy, KHÔNG BAO GIỜ lên server
//
// Nguyên tắc an toàn: danh sách CHO PHÉP (SHARED_RENDER_KEYS). Khóa nào không có trong danh sách, kể cả khóa thêm sau này, mặc định ở
// lại máy. Thêm trường dùng chung phải sửa danh sách này một cách có chủ ý. Ngoài ra mọi GIÁ TRỊ trông như đường dẫn/khóa/proxy kèm
// mật khẩu đều bị giữ lại máy dù khóa nằm trong danh sách (phòng người dùng dán nhầm).

export const SHARED_RENDER_KEYS = Object.freeze([
  "day", "videos", "videoSpeed", "cycleDays",
  "renderMode", "opacity",
  "chromaKeyMode", "chromaKeyColor", "chromaKeySimilarity",
  "keepColorColors", "keepColorCrop", "keepColorHeight", "keepColorYOffset", "keepColorAddDarkLayer", "keepSimilarity",
  "height", "y_offset", "personEnabled", "personPos", "personScale",
  "bgBlurEnabled", "bgBlur", "mainScale", "mainOpacity", "frameEnabled", "frameScale",
  "effectEnabled", "effectOpacity", "effectBlend", "effectKeyThreshold",
  "dualFrameMainX", "dualFrameMainY", "dualFrameMainWidth", "dualFrameMainHeight", "dualFrameMainOpacity",
  "dualFrameSmallX", "dualFrameSmallY", "dualFrameSmallWidth", "dualFrameSmallHeight", "dualFrameSmallOpacity", "dualFrameSmallRadius",
  "dualFrameFrameEnabled", "dualFrameFrameScale",
]);
const SHARED = new Set(SHARED_RENDER_KEYS);
// lastRenderAt là trạng thái của mẻ (server giữ riêng), không phải cấu hình

/** Giá trị có vẻ là bí mật hoặc thứ riêng của máy: đường dẫn, URL có user:pass, khóa Google, JWT. Số, bool, tên kiểu render, mã màu thì không. */
export function isSecretLooking(v) {
  if (typeof v !== "string") return false;
  const s = v.trim();
  if (!s) return false;
  if (/^[a-z]:[\\/]/i.test(s)) return true;                         // C:\... hoặc D:/...
  if (/^\\\\/.test(s)) return true;                                  // \\server\share
  if (/^\/(?:[^/\s]+\/){1,}/.test(s) || /^\/(home|users|var|etc|mnt|tmp)\b/i.test(s)) return true; // đường dẫn Unix
  if (/^[a-z][a-z0-9+.-]*:\/\/[^\s/@]+@/i.test(s)) return true;      // scheme://user:pass@host
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return true;               // mọi URL: thông số render không cần URL
  if (/\bAIza[0-9A-Za-z_-]{30,}\b/.test(s)) return true;             // khóa Google
  if (/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/.test(s)) return true; // JWT
  if (/\b(?:gh[pousr]_|sk-|xox[abprs]-)[A-Za-z0-9_-]{16,}\b/.test(s)) return true;
  return false;
}

const isPlain = (o) => o && typeof o === "object" && !Array.isArray(o);

/** Tách cấu hình render đầy đủ thành { shared, local }. Không sửa đối tượng gốc. Đầu vào rác trả hai phần rỗng. */
export function splitRenderSettings(render) {
  const shared = {}, local = {};
  if (!isPlain(render)) return { shared, local };
  for (const [k, v] of Object.entries(render)) {
    if (SHARED.has(k) && !isSecretLooking(v) && (v === null || ["string", "number", "boolean"].includes(typeof v))) shared[k] = v;
    else local[k] = v;
  }
  return { shared, local };
}

/**
 * Gộp: phần riêng của máy làm gốc, thông số dùng chung từ server đè lên. Server KHÔNG bao giờ ghi đè được khóa riêng của máy
 * (đường dẫn, khóa API, GPU...) dù có gửi nhầm: chỉ khóa trong danh sách cho phép và giá trị an toàn mới được nhận.
 */
export function mergeRenderSettings(local, shared) {
  const out = isPlain(local) ? { ...local } : {};
  if (!isPlain(shared)) return out;
  for (const [k, v] of Object.entries(shared)) {
    if (!SHARED.has(k) || isSecretLooking(v)) continue;
    if (v === null || ["string", "number", "boolean"].includes(typeof v)) out[k] = v;
  }
  return out;
}
