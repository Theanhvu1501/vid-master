// User/mật khẩu proxy của từng kênh: chỉ nằm trên MÁY NÀY (mã hóa bằng kho của hệ điều hành), không bao giờ lên web.
// Web chỉ giữ scheme://host:port. Khi runner cần dùng, web-store ghép user/mật khẩu vào.
//
// File này chỉ chứa phần thuần (đọc bảng Excel, kiểm tra) để test được; việc mã hóa và ghi đĩa nằm ở electron-main.

const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "d").trim().toLowerCase().replace(/\s+/g, " ");
const NAME_COLS = new Set(["ten kenh"]);
const PROXY_COLS = new Set(["proxy tai", "proxy"]);
const MAX_ENTRIES = 1000;

/** Tách "scheme://user:pass@host:port", "scheme://host:port:user:pass", "host:port:user:pass" -> { host, port, user, pass }. */
export function parseProxyParts(raw) {
  let s = String(raw ?? "").trim();
  if (!s || s.length > 500) return null;
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  let user = "", pass = "", host, port;
  const at = s.lastIndexOf("@");
  if (at >= 0) {
    const auth = s.slice(0, at), i = auth.indexOf(":");
    user = i < 0 ? auth : auth.slice(0, i); pass = i < 0 ? "" : auth.slice(i + 1);
    const hp = s.slice(at + 1).split(":");
    if (hp.length !== 2) return null;
    [host, port] = hp;
  } else {
    const p = s.split(":");
    if (p.length < 2) return null;
    host = p[0]; port = p[1];
    if (p.length >= 4) { user = p[2]; pass = p.slice(3).join(":"); }
    else if (p.length === 3) return null; // host:port:user (thiếu mật khẩu) không hợp lệ
  }
  if (!/^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(host)) return null;
  if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) return null;
  return { host, port, user, pass };
}

/**
 * Đọc bảng (mảng các dòng) của tab ⚙config: lấy user/mật khẩu proxy theo tên kênh.
 * Trả { entries: [{ name, user, pass, hostPort }], skipped: [{ name, why }], error? }.
 */
export function extractProxyAuth(rows) {
  if (!Array.isArray(rows)) return { entries: [], skipped: [], error: "Không đọc được bảng" };
  const hi = rows.findIndex((r) => Array.isArray(r) && r.some((c) => NAME_COLS.has(norm(c))));
  if (hi < 0) return { entries: [], skipped: [], error: "Không thấy cột “Tên kênh”. Chọn đúng file/tab cấu hình (⚙config)." };
  const head = rows[hi];
  const ni = head.findIndex((c) => NAME_COLS.has(norm(c)));
  const pi = head.findIndex((c) => PROXY_COLS.has(norm(c)));
  if (pi < 0) return { entries: [], skipped: [], error: "Không thấy cột “Proxy tải”." };
  const entries = [], skipped = [], seen = new Set();
  for (let r = hi + 1; r < rows.length; r++) {
    const row = Array.isArray(rows[r]) ? rows[r] : [];
    const name = String(row[ni] ?? "").replace(/\s+/g, " ").trim();
    const raw = String(row[pi] ?? "").trim();
    if (!name || !raw) continue;
    if (seen.has(name.toLowerCase())) { skipped.push({ name, why: "trùng tên kênh trong file" }); continue; }
    seen.add(name.toLowerCase());
    const p = parseProxyParts(raw);
    if (!p) { skipped.push({ name, why: "không đọc được proxy" }); continue; }
    if (!p.user) { skipped.push({ name, why: "proxy không có user/mật khẩu" }); continue; }
    if (entries.length >= MAX_ENTRIES) { skipped.push({ name, why: "quá nhiều kênh" }); continue; }
    entries.push({ name, user: p.user, pass: p.pass, hostPort: `${p.host}:${p.port}` });
  }
  return { entries, skipped };
}

/** Kiểm tra một cặp user/mật khẩu nhập tay. Trả { user, pass } hoặc { error }. */
export function cleanAuthInput(user, pass) {
  const u = String(user ?? "").trim(), p = String(pass ?? "");
  if (!u) return { error: "Chưa nhập user proxy" };
  if (u.length > 200 || p.length > 500) return { error: "Quá dài" };
  if (/[\u0000-\u001f]/.test(u + p)) return { error: "Chứa ký tự không hợp lệ" };
  return { user: u, pass: p };
}

/** Gộp các mục nhập vào kho hiện có: ghi đè theo tên kênh, không đụng các kênh khác. Trả bản sao mới. */
export function mergeAuth(store, entries) {
  const out = { ...(store && typeof store === "object" ? store : {}) };
  for (const e of entries) out[e.name] = { user: e.user, pass: e.pass, hostPort: e.hostPort || "" };
  return out;
}

/**
 * Tra user/mật khẩu cho một tên kênh (không phân biệt hoa thường, bỏ khoảng trắng thừa).
 * Mục đã lưu gắn với một host:port mà proxy hiện tại trên web là host:port KHÁC thì không dùng: mật khẩu của proxy cũ
 * không được ghép nhầm sang proxy mới.
 */
export function lookupAuth(store, name, hostPort) {
  if (!store || typeof store !== "object") return null;
  const key = String(name ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  for (const [k, v] of Object.entries(store)) {
    if (k.replace(/\s+/g, " ").trim().toLowerCase() !== key) continue;
    if (!v || !v.user) return null;
    if (v.hostPort && hostPort && v.hostPort !== hostPort) return null;
    return v;
  }
  return null;
}
