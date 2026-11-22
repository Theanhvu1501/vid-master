// Khóa AI theo TỪNG KÊNH, lưu TẠI MÁY người dùng và được MÃ HÓA (safeStorage của hệ điều hành).
// Khóa không bao giờ đi lên server (cấu hình kênh nằm trên server nên web xem được), không bao giờ trả lại cho giao diện:
// giao diện chỉ biết "đã có khóa" và 4 ký tự cuối. Không mã hóa được thì KHÔNG lưu (không bao giờ ghi khóa dạng thô).
//
// Nhận io (đọc/ghi theo tên) và crypto (mã hóa/giải mã) từ ngoài để test được, không đụng Electron/đĩa.

const FILE = "ai-channel-keys";
const KEY_RE = /^[!-~]{8,300}$/; // khóa API là chuỗi ASCII in được, không khoảng trắng

const nameOf = (n) => String(n ?? "").trim().slice(0, 100);

export function createChannelKeyStore({ io, crypto }) {
  const readAll = () => {
    try { const v = io.read(FILE); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; } catch { return {}; }
  };

  /** Khóa thật của kênh (chỉ dùng ở tiến trình chính). Rỗng nếu chưa có / không giải mã được. */
  function get(channel) {
    const n = nameOf(channel);
    if (!n) return "";
    try {
      const enc = readAll()[n];
      if (typeof enc !== "string" || !enc || !crypto.available()) return "";
      const k = String(crypto.decrypt(enc) || "").trim();
      return KEY_RE.test(k) ? k : "";
    } catch { return ""; }
  }

  function set(channel, key) {
    const n = nameOf(channel), k = String(key ?? "").trim();
    if (!n) return { ok: false, error: "Thiếu tên kênh." };
    if (!KEY_RE.test(k)) return { ok: false, error: "Khóa không hợp lệ (không có khoảng trắng, tối thiểu 8 ký tự)." };
    if (!crypto.available()) return { ok: false, error: "Hệ điều hành không hỗ trợ mã hóa nên không lưu khóa." };
    const all = readAll();
    all[n] = crypto.encrypt(k);
    io.write(FILE, all);
    return { ok: true };
  }

  function clear(channel) {
    const n = nameOf(channel), all = readAll();
    if (n in all) { delete all[n]; io.write(FILE, all); }
    return { ok: true };
  }

  /** Bản cho giao diện: KHÔNG có khóa. */
  function view(channel) {
    const k = get(channel);
    return { hasKey: k.length > 0, keyHint: k.length >= 8 ? "…" + k.slice(-4) : "" };
  }

  /** Kênh bị đổi tên/xóa thì khóa cũ không còn ai dùng: gỡ những tên không còn trong danh sách. */
  function prune(validNames) {
    const keep = new Set((validNames || []).map(nameOf));
    const all = readAll(); let changed = false;
    for (const n of Object.keys(all)) if (!keep.has(n)) { delete all[n]; changed = true; }
    if (changed) io.write(FILE, all);
  }

  return { get, set, clear, view, prune };
}
