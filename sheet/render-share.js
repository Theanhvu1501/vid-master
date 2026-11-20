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

// ---------------------------------------------------------------- nối cấu hình render <-> mẻ
// Trong tab Render: "Số ngày" (day) = số ngày của một vòng, "Số video/folder" (videos) = video mỗi ngày mỗi kênh, "Chu kỳ" = cycleDays.
// Ba số này cũng là thông số của mẻ nên đi cùng nhau.
const toInt = (v, lo, hi) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null; };

/** Cấu hình render của app -> phần gửi lên mẻ: thông số mẻ + phần render dùng chung. Không có gì nhạy cảm. */
export function renderToBatchPatch(render) {
  const { shared } = splitRenderSettings(render);
  const patch = { render: shared };
  const days = toInt(shared.day, 1, 365), per = toInt(shared.videos, 1, 100), cyc = toInt(shared.cycleDays, 1, 365);
  if (days !== null) patch.totalDays = days;
  if (per !== null) patch.videosPerDay = per;
  if (cyc !== null) patch.cycleDays = cyc;
  return patch;
}

/** Mẻ -> cấu hình render áp lên máy này: phần render dùng chung của mẻ, rồi ba thông số của mẻ đè lên (mẻ là nơi giữ giá trị chuẩn). */
export function batchToRenderShared(batch) {
  const out = mergeRenderSettings({}, batch && batch.render);
  if (!batch || typeof batch !== "object") return out;
  if (Number.isFinite(Number(batch.totalDays))) out.day = String(batch.totalDays);
  if (Number.isFinite(Number(batch.videosPerDay))) out.videos = String(batch.videosPerDay);
  if (Number.isFinite(Number(batch.cycleDays))) out.cycleDays = String(batch.cycleDays);
  return out;
}

// ---------------------------------------------------------------- trường cấu hình render của MẺ
// Giống tab Render: kiểu render + thông số của từng kiểu. Ảnh khung/hiệu ứng/ảnh người và file màu là ĐƯỜNG DẪN nên không nằm ở đây
// (chọn ở tab Render của máy). Khóa nào cũng phải nằm trong SHARED_RENDER_KEYS (có test kiểm).
const NUM = (key, label, def, min, max, step) => ({ key, label, type: "num", def: String(def), min, max, step });
const INT = (key, label, def, min, max) => ({ key, label, type: "int", def: String(def), min, max });
const BOOL = (key, label, def = false) => ({ key, label, type: "bool", def });
const TXT = (key, label, def, help) => ({ key, label, type: "text", def, help });
const SEL = (key, label, def, options) => ({ key, label, type: "select", def, options });

export const BATCH_RENDER_MODES = Object.freeze([
  { id: "topTransparent", label: "Top Transparent" },
  { id: "chromaKey", label: "Chroma Key" },
  { id: "crop", label: "Crop" },
  { id: "keepColor", label: "Keep Color" },
  { id: "blurFrame", label: "Nền mờ + Khung" },
  { id: "dualFrame", label: "Khung đôi (nhỏ + lớn)" },
]);
export const BATCH_COMMON_FIELDS = Object.freeze([NUM("videoSpeed", "Tốc độ video", 0.95, 0, 1, 0.01)]);
export const BATCH_MODE_FIELDS = Object.freeze({
  topTransparent: [NUM("opacity", "Độ mờ overlay", 0.7, 0, 1, 0.1)],
  chromaKey: [TXT("chromaKeyColor", "Màu phông (hex)", "D4F9D7", "6 ký tự, vd D4F9D7"), NUM("chromaKeySimilarity", "Độ nhạy", 0.3, 0.1, 1, 0.1)],
  crop: [INT("height", "Chiều cao dải", 220, 1, 4000), INT("y_offset", "Vị trí Y", 490, 0, 4000), BOOL("personEnabled", "Dùng ảnh người"),
    SEL("personPos", "Vị trí ảnh người", "center", ["left", "center", "right", "random"]), NUM("personScale", "Phóng ảnh người", 0.9, 0.05, 5, 0.05)],
  keepColor: [TXT("keepColorColors", "Màu giữ lại (hex, cách nhau dấu phẩy)", "FBFF02", "vd FBFF02,FF0000"), BOOL("keepColorCrop", "Bật cắt"), INT("keepColorHeight", "Chiều cao cắt", 220, 1, 4000),
    INT("keepColorYOffset", "Vị trí Y", 490, 0, 4000), BOOL("keepColorAddDarkLayer", "Thêm lớp nền tối")],
  blurFrame: [BOOL("bgBlurEnabled", "Làm mờ nền"), INT("bgBlur", "Độ mờ nền", 20, 1, 50), NUM("mainScale", "Tỉ lệ video", 0.85, 0.1, 1, 0.01), NUM("mainOpacity", "Độ đục video", 0.85, 0, 1, 0.05),
    BOOL("frameEnabled", "Dùng khung"), NUM("frameScale", "Phóng khung", 1, 0.05, 5, 0.05), BOOL("effectEnabled", "Dùng hiệu ứng"), NUM("effectOpacity", "Độ mạnh hiệu ứng", 0.15, 0, 1, 0.05),
    SEL("effectBlend", "Cách ghép hiệu ứng", "normal", ["normal", "screen", "lumakey"]), NUM("effectKeyThreshold", "Ngưỡng khử nền tối", 0.15, 0, 1, 0.05)],
  dualFrame: [INT("dualFrameMainX", "Khung to X", 40, -8000, 8000), INT("dualFrameMainY", "Khung to Y", 40, -8000, 8000), INT("dualFrameMainWidth", "Khung to rộng", 960, 1, 8000), INT("dualFrameMainHeight", "Khung to cao", 560, 1, 8000),
    NUM("dualFrameMainOpacity", "Độ đục khung to", 1, 0, 1, 0.05), INT("dualFrameSmallX", "Khung nhỏ X", 1000, -8000, 8000), INT("dualFrameSmallY", "Khung nhỏ Y", 520, -8000, 8000),
    INT("dualFrameSmallWidth", "Khung nhỏ rộng", 240, 1, 8000), INT("dualFrameSmallHeight", "Khung nhỏ cao", 160, 1, 8000), NUM("dualFrameSmallOpacity", "Độ đục khung nhỏ", 1, 0, 1, 0.05),
    INT("dualFrameSmallRadius", "Bo viền khung nhỏ", 0, 0, 2000), BOOL("dualFrameFrameEnabled", "Dùng khung viền"), NUM("dualFrameFrameScale", "Phóng khung viền", 1, 0.05, 5, 0.05)],
});

function coerceField(f, raw) {
  if (f.type === "bool") return raw === true || raw === "true" || raw === "1" || raw === 1;
  if (f.type === "select") return f.options.includes(String(raw)) ? String(raw) : f.def;
  if (f.type === "text") {
    const t = String(raw ?? "").trim();
    return t && !isSecretLooking(t) ? t.slice(0, 80) : f.def;
  }
  // Thiếu/rỗng phải về mặc định: Number("") là 0 nên không được đưa thẳng vào (độ mờ 0 và tốc độ 0 làm video hỏng).
  const text = String(raw ?? "").trim().replace(",", ".");
  if (!text) return f.def;
  const n = Number(text);
  if (!Number.isFinite(n)) return f.def;
  const v = Math.min(f.max, Math.max(f.min, f.type === "int" ? Math.round(n) : n));
  return String(v);
}

/**
 * Giá trị nhập trong hộp "Thêm/Sửa mẻ" -> cấu hình render dùng chung của mẻ: kiểu render + CHỈ các thông số của kiểu đó + tốc độ.
 * Giá trị sai/thiếu về mặc định, số bị kẹp trong khoảng. Kiểu lạ về topTransparent.
 */
export function buildBatchRender(mode, values) {
  const id = Object.prototype.hasOwnProperty.call(BATCH_MODE_FIELDS, mode) ? mode : "topTransparent";
  const v = values && typeof values === "object" ? values : {};
  const out = { renderMode: id };
  for (const f of [...BATCH_COMMON_FIELDS, ...BATCH_MODE_FIELDS[id]]) out[f.key] = coerceField(f, v[f.key]);
  return out;
}

/**
 * Sửa một kiểu render của mẻ mà KHÔNG làm mất thông số của các kiểu khác đã lưu (vd lưu từ tab Render có đủ 42 thông số):
 * lấy phần dùng chung đã có, rồi đè bằng kiểu + thông số vừa nhập.
 */
export function mergeBatchRender(existing, mode, values) {
  const { shared } = splitRenderSettings(existing);
  return { ...shared, ...buildBatchRender(mode, values) };
}

/**
 * Thân yêu cầu từ giao diện mẻ -> thân gửi server. Giao diện gửi renderMode + renderValues (+ renderBase là cấu hình đang có);
 * ở đây ghép thành "render" đã làm sạch. Không có renderMode thì không đụng tới render của mẻ.
 */
export function batchBodyWithRender(body) {
  const b = body && typeof body === "object" && !Array.isArray(body) ? { ...body } : {};
  const has = Object.prototype.hasOwnProperty.call(b, "renderMode");
  if (has) b.render = mergeBatchRender(b.renderBase, b.renderMode, b.renderValues);
  delete b.renderMode; delete b.renderValues; delete b.renderBase;
  return b;
}

/** Định nghĩa trường để giao diện tự dựng form (một nguồn duy nhất, giao diện không giữ bản sao danh sách trường). */
export function batchRenderSchema() {
  return { modes: BATCH_RENDER_MODES.map((m) => ({ ...m })), common: BATCH_COMMON_FIELDS.map((f) => ({ ...f })), byMode: Object.fromEntries(Object.entries(BATCH_MODE_FIELDS).map(([k, v]) => [k, v.map((f) => ({ ...f, options: f.options ? [...f.options] : undefined }))])) };
}
