// Lập kế hoạch tạo profile GPM cho từng hàng kênh trong Sheet (hàm thuần, không gọi GPM/Sheet):
// tạo mới hay dùng lại profile có sẵn, gán proxy, kiểm tra bản Chrome. Phần chạy thật nằm ở
// sheet-automation.js.
//
// Cột Sheet dùng: "Tên kênh" (tên profile), "proxy", "GPM Profile ID", "tk" (tài khoản) và
// tuỳ chọn "Phiên bản Chrome". Cột "tk" gồm các phần cách nhau bằng dấu |:
//     gmail|mật khẩu|mail khôi phục|mã 2FA        (mail khôi phục và 2FA có thể bỏ trống)

import { parseAccount } from "./channel-sheet.js";
import { maskProxy, toGpmProxy } from "./proxy-tools.js";

export { parseAccount, toGpmProxy };

export const STUDIO_URL = "https://studio.youtube.com";
export const DEFAULT_CHROME_MAJOR = 129;
// Bản đầy đủ của Chrome 129 đang có trong GPM của người dùng (đọc từ các profile hiện có).
const KNOWN_FULL = { 129: "129.0.6668.59" };

const verNum = (v) => v.split(".").map(Number);
function cmpVer(a, b) {
  const x = verNum(a), y = verNum(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d;
  }
  return 0;
}

/**
 * "129" -> bản đầy đủ GPM cần ("129.0.6668.59"). Bỏ trống -> 129.
 * Chỉ nhận "129" hoặc dạng đầy đủ 4 số; không đoán bản đầy đủ cho major chưa biết.
 * @param {string[]} knownVersions bản đầy đủ đang có trong các profile hiện tại của GPM
 */
export function resolveChromeVersion(input, knownVersions = []) {
  const s = String(input ?? "").trim() || String(DEFAULT_CHROME_MAJOR);
  if (/^\d+\.\d+\.\d+\.\d+$/.test(s)) return s;
  if (!/^\d+$/.test(s)) throw new Error(`phiên bản Chrome "${s}" không hợp lệ (nhập 129 hoặc đủ dạng 129.0.6668.59)`);
  const major = Number(s);
  const known = knownVersions.filter((v) => v.startsWith(`${major}.`)).sort(cmpVer);
  if (known.length) return known[known.length - 1];
  if (KNOWN_FULL[major]) return KNOWN_FULL[major];
  throw new Error(`chưa biết bản đầy đủ của Chrome ${major} — hãy nhập đủ dạng ${major}.0.xxxx.xx`);
}

const sameProxy = (a, b) => {
  const c = (x) => { try { return toGpmProxy(x); } catch { return String(x ?? "").trim(); } };
  return c(a) === c(b);
};

/**
 * Lập kế hoạch cho từng dòng (hàm thuần, dùng cho cả Xem trước lẫn Chạy).
 * action: "create" | "reuse" (dùng profile có sẵn) | "error"
 */
export function planAddChannels({ rows, profiles, defaultVersion }) {
  const byId = new Map(profiles.map((p) => [p.id, p]));
  const byName = new Map();
  for (const p of profiles) {
    const k = p.name.trim().toLowerCase();
    byName.set(k, [...(byName.get(k) || []), p]);
  }
  const known = profiles.map((p) => p.browserVersion).filter(Boolean);
  const seen = new Set();

  return rows.map((r) => {
    const item = { sheetName: r.sheetName, rowIndex: r.rowIndex, action: "error", note: "" };
    const fail = (note) => ({ ...item, action: "error", note });
    try {
      const key = r.sheetName.trim().toLowerCase();
      if (seen.has(key)) return fail("tên kênh bị lặp trong Sheet");
      seen.add(key);

      item.account = r.account ? parseAccount(r.account) : null; // trống = không đăng nhập
      item.proxy = toGpmProxy(r.proxy);
      item.proxyMasked = maskProxy(item.proxy);
      item.version = resolveChromeVersion(r.chromeVersion || defaultVersion, known);
      const major = item.version.split(".")[0];

      let existing = null;
      if (r.gpmProfileId) {
        existing = byId.get(r.gpmProfileId);
        if (!existing) return fail(`Profile ID ${r.gpmProfileId} trong Sheet không có trong GPM`);
      } else {
        const same = byName.get(key) || [];
        if (same.length > 1) return fail(`GPM có ${same.length} profile cùng tên "${r.sheetName}"`);
        existing = same[0] || null;
      }

      if (!existing) return { ...item, action: "create", note: `tạo mới, Chrome ${item.version}` };

      if (existing.browserVersion && !existing.browserVersion.startsWith(`${major}.`)) {
        return fail(`profile có sẵn dùng Chrome ${existing.browserVersion}, khác ${item.version} — xoá profile trong GPM rồi chạy lại`);
      }
      item.profileId = existing.id;
      item.writeId = !r.gpmProfileId; // tìm thấy theo tên -> cần ghi ID vào Sheet
      item.setProxy = !!item.proxy && !existing.rawProxy;
      item.proxyDiffers = !!item.proxy && !!existing.rawProxy && !sameProxy(item.proxy, existing.rawProxy);
      const notes = ["dùng profile có sẵn"];
      if (item.setProxy) notes.push("gán proxy");
      if (item.proxyDiffers) notes.push("proxy khác Sheet — giữ nguyên proxy hiện tại");
      return { ...item, action: "reuse", note: notes.join(", ") };
    } catch (e) {
      return fail(e.message);
    }
  });
}
