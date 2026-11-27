// Phiên đăng nhập của app VidMaster: tài khoản + mật khẩu + mã máy do admin cấp trên web.
//
// File này chỉ chứa logic thuần (không đụng Electron), nhận fetch/kho lưu/đồng hồ từ ngoài để test được.
//
// Nguyên tắc:
//  - Mật khẩu chỉ đi qua mạng đúng một lần lúc đăng nhập và KHÔNG BAO GIỜ được lưu; app chỉ giữ token.
//  - Token lưu mã hóa bằng kho của hệ điều hành (safeStorage/DPAPI). Không mã hóa được thì không lưu, lần mở sau phải đăng nhập lại.
//  - Server là nơi quyết định. Server nói "không hợp lệ" (gỡ máy, khóa tài khoản, thu hồi license, đổi mật khẩu) là đăng xuất ngay.
//  - Server không trả lời được (mất mạng, 5xx) thì KHÔNG đăng xuất oan: cho dùng offline trong thời gian ân hạn.

export const OFFLINE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 12_000;

const REASON_TEXT = {
  "machine-unassigned": "Máy này không còn được gán cho tài khoản của bạn. Liên hệ quản trị viên.",
  "license-revoked": "License của máy này đã bị thu hồi. Liên hệ quản trị viên.",
  disabled: "Tài khoản đã bị khóa. Liên hệ quản trị viên.",
  expired: "Tài khoản đã hết hạn. Liên hệ quản trị viên để gia hạn.",
  "password-changed": "Mật khẩu đã được đổi. Vui lòng đăng nhập lại.",
  "no-user": "Tài khoản không còn tồn tại.",
  token: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
};
export const reasonText = (r) => REASON_TEXT[r] || "Phiên đăng nhập không còn hợp lệ. Vui lòng đăng nhập lại.";

/**
 * Chuẩn hóa danh sách appFeatures từ server.
 * @param {unknown} value - Giá trị từ server (có thể là array, string, undefined, null, ...)
 * @returns {string[] | null} - Mảng các string "app:*" duy nhất (max 100, mỗi string <= 64 ký tự), hoặc null nếu server không gửi/không hợp lệ.
 */
export function normalizeAppFeatures(value) {
  if (!Array.isArray(value)) return null;
  const seen = new Set();
  const result = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const s = item.slice(0, 64);
    if (!s.startsWith("app:") || seen.has(s)) continue;
    seen.add(s);
    result.push(s);
    if (result.length >= 100) break;
  }
  return result;
}

/**
 * So sánh hai danh sách appFeatures (thứ tự không quan trọng).
 * @param {string[] | null} a
 * @param {string[] | null} b
 * @returns {boolean} - true nếu khác nhau (hoặc một bên null mà bên kia không phải), false nếu giống.
 */
export function appFeaturesChanged(a, b) {
  if (a === null && b === null) return false;
  if (a === null || b === null) return true;
  if (a.length !== b.length) return true;
  const setA = new Set(a);
  for (const x of b) if (!setA.has(x)) return true;
  return false;
}

// Đọc hạn của JWT mà KHÔNG xác thực chữ ký (chỉ để biết "chắc chắn đã hết hạn" khi offline; server mới là nơi xác thực).
export function jwtExpiryMs(token) {
  try {
    const payload = JSON.parse(Buffer.from(String(token).split(".")[1], "base64url").toString("utf-8"));
    return Number.isFinite(payload.exp) ? payload.exp * 1000 : null;
  } catch { return null; }
}

async function postJson(fetchImpl, url, body, token) {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, retryAfter: Number(res.headers?.get?.("retry-after")) || 0 };
}

/**
 * @param {object} o
 * @param {typeof fetch} o.fetchImpl
 * @param {() => string} o.getBase       địa chỉ http(s) của server, không có dấu / ở cuối
 * @param {() => string} o.getMachineId
 * @param {() => string} [o.getHostname]  tên máy (hostname) để admin nhận ra máy nào là máy cũ
 * @param {{load():object|null, save(o:object):boolean|void, clear():void}} o.store
 * @param {() => number} [o.now]
 */
export function createSessionManager({ fetchImpl = fetch, getBase, getMachineId, getHostname = () => "", store, now = () => Date.now() }) {
  let current = null; // { token, user, machineId, verifiedAt }

  const persist = () => { try { store.save(current); } catch { /* không lưu được: lần sau đăng nhập lại */ } };
  const forget = () => { current = null; try { store.clear(); } catch { /* ignore */ } };

  return {
    getToken: () => current?.token || "",
    getUser: () => current?.user || null,
    isLoggedIn: () => !!current,
    /** Trả danh sách appFeatures (string[]) hoặc null nếu chưa biết. null = fail OPEN (UI hiện tất cả tab). */
    getAppFeatures: () => current?.user?.appFeatures ?? null,

    /** Đăng nhập. Trả { ok:true, user } hoặc { ok:false, kind, message }. */
    async login(username, password) {
      const machineId = getMachineId();
      if (!machineId || machineId === "ERROR") return { ok: false, kind: "machine", message: "Không lấy được mã máy của thiết bị này." };
      if (!String(username || "").trim() || !password) return { ok: false, kind: "input", message: "Nhập tài khoản và mật khẩu." };
      let r;
      try { r = await postJson(fetchImpl, `${getBase()}/api/app/login`, { username: String(username).trim(), password, machineId, hostname: String(getHostname() || "").slice(0, 80) }); }
      catch { return { ok: false, kind: "network", message: "Không kết nối được server. Kiểm tra mạng rồi thử lại." }; }

      if (r.status === 200 && typeof r.data.token === "string") {
        const serverUser = r.data.user || {};
        const normalizedFeatures = normalizeAppFeatures(serverUser.appFeatures);
        const user = normalizedFeatures !== null ? { ...serverUser, appFeatures: normalizedFeatures } : serverUser;
        current = { token: r.data.token, user, machineId, verifiedAt: now() };
        persist();
        return { ok: true, user: current.user };
      }
      if (r.status === 429) return { ok: false, kind: "rate", retryAfter: r.retryAfter, message: r.data.message || "Đăng nhập sai quá nhiều lần. Thử lại sau ít phút." };
      if (r.status === 403 && r.data.code === "machine-limit") return { ok: false, kind: "limit", message: r.data.message || "Tài khoản đã dùng hết số máy được phép. Liên hệ quản trị viên." };
      if (r.status === 403) return { ok: false, kind: "denied", message: r.data.message || "Tài khoản hoặc máy bị từ chối." };
      if (r.status === 400 || r.status === 401) return { ok: false, kind: "invalid", message: r.data.message || "Tài khoản hoặc mật khẩu không đúng" };
      return { ok: false, kind: "server", message: "Server đang gặp sự cố. Thử lại sau." };
    },

    /** Hỏi lại server phiên còn hợp lệ không. Dùng khi mở app và định kỳ. */
    async verify() {
      if (!current) return { state: "none" };
      let r;
      try { r = await postJson(fetchImpl, `${getBase()}/api/app/session`, {}, current.token); }
      catch { return this._offline(); }
      if (r.status === 200 && r.data.valid) {
        current.verifiedAt = now();
        if (r.data.user) {
          const serverUser = r.data.user;
          const normalizedFeatures = normalizeAppFeatures(serverUser.appFeatures);
          // Merge user: nếu server gửi appFeatures (kể cả []) thì cập nhật; không gửi thì giữ nguyên
          current.user = {
            ...(current.user || {}),
            ...serverUser,
            appFeatures: normalizedFeatures !== null ? normalizedFeatures : (current.user?.appFeatures ?? null),
          };
        }
        persist();
        return { state: "valid", user: current.user };
      }
      if (r.status === 401 || r.status === 403) {
        const reason = r.data.reason || "token";
        forget();
        return { state: "invalid", reason, message: reasonText(reason) };
      }
      return this._offline(); // 5xx, 429...: lỗi phía server, không đăng xuất oan
    },

    _offline() {
      const exp = jwtExpiryMs(current.token);
      if (exp !== null && exp <= now()) { forget(); return { state: "invalid", reason: "token", message: reasonText("token") }; }
      const age = now() - (current.verifiedAt || 0);
      if (age > OFFLINE_GRACE_MS) return { state: "need-online", message: "Đã quá 7 ngày chưa kết nối server. Kết nối mạng để tiếp tục." };
      return { state: "offline", ageDays: Math.floor(age / 86_400_000), user: current.user };
    },

    /** Mở app: nạp phiên đã lưu và xác minh với server. */
    async restore() {
      let saved = null;
      try { saved = store.load(); } catch { /* ignore */ }
      if (!saved?.token || saved.machineId !== getMachineId()) { forget(); return { state: "none" }; }
      current = { token: saved.token, user: saved.user || null, machineId: saved.machineId, verifiedAt: Number(saved.verifiedAt) || 0 };
      return this.verify();
    },

    logout() { forget(); },
  };
}
