// Đồng bộ ĐỊA CHỈ proxy (scheme://host:port) từ GPM profile lên web, để web tra hạn proxy.
// User và mật khẩu proxy chỉ nằm trong GPM trên máy này, không bao giờ đi qua file này lên web.
//
// Nguyên tắc: kênh đã gắn GPM profile thì proxy của profile là nguồn sự thật cho địa chỉ proxy trên web.
// Kênh chưa gắn profile, hoặc profile không còn trong GPM, thì KHÔNG đụng tới proxy đang có trên web.

const SCHEMES = new Set(["http", "https", "socks4", "socks5", "socks5h"]);

/**
 * "socks5://1.2.3.4:80:user:pass" (kiểu GPM) hoặc "scheme://user:pass@1.2.3.4:80" -> "socks5://1.2.3.4:80".
 * Rỗng -> "" (không dùng proxy). Không đọc được địa chỉ -> null.
 * Chỉ cần địa chỉ nên KHÔNG kiểm tra mật khẩu: mật khẩu có ký tự lạ (@ : /) vẫn lấy được đúng host:port.
 */
export function addrOfProxy(raw) {
  let s = String(raw ?? "").trim();
  if (!s) return "";
  let scheme = "http";
  const m = s.match(/^([A-Za-z0-9]+):\/\/(.*)$/);
  if (m) { scheme = m[1].toLowerCase(); s = m[2]; }
  if (!SCHEMES.has(scheme)) return null;
  const okHost = (h) => /^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(h || "");
  const okPort = (p) => /^\d{1,5}$/.test(p || "") && Number(p) >= 1 && Number(p) <= 65535;
  // Dạng GPM trước (nguồn dữ liệu ở đây là GPM): host:port hoặc host:port:user:pass, mật khẩu được chứa mọi ký tự.
  const p = s.split(":");
  if ((p.length === 2 || p.length >= 4) && okHost(p[0]) && okPort(p[1])) return `${scheme}://${p[0]}:${p[1]}`;
  // Dạng user:pass@host:port
  const at = s.lastIndexOf("@");
  if (at >= 0) {
    const hp = s.slice(at + 1).split(":");
    if (hp.length === 2 && okHost(hp[0]) && okPort(hp[1])) return `${scheme}://${hp[0]}:${hp[1]}`;
  }
  return null;
}

/**
 * channels: danh sách cấu hình từ web [{ id, version, gpmProfileId, proxy }]
 * rawByProfileId: Map profileId -> proxy đầy đủ trong GPM ("" nếu profile không dùng proxy)
 * Trả các lệnh cần gửi lên web: [{ id, version, proxy }] (proxy "" = bỏ proxy, kênh không còn hạn).
 */
export function planProxySync(channels, rawByProfileId) {
  const out = [];
  for (const ch of channels || []) {
    const pid = String(ch.gpmProfileId || "").trim();
    if (!pid || !rawByProfileId.has(pid)) continue;
    const want = addrOfProxy(rawByProfileId.get(pid));
    if (want === null) continue; // proxy trong GPM không đọc được: không đoán, giữ nguyên
    if (want === String(ch.proxy || "")) continue;
    out.push({ id: ch.id, version: ch.version, proxy: want });
  }
  return out;
}
