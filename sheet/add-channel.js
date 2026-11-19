// Thêm kênh mới từ Sheet ⚙config: tạo profile GPM (Chrome 129 mặc định) -> gán proxy ->
// ghi Profile ID ngược vào Sheet -> đăng nhập YouTube Studio.
//
// Cột Sheet dùng: "Tên kênh" (tên profile), "proxy", "GPM Profile ID", "tk" (tài khoản) và
// tuỳ chọn "Phiên bản Chrome". Cột "tk" gồm các phần cách nhau bằng dấu |:
//     gmail|mật khẩu|mail khôi phục|mã 2FA        (mail khôi phục và 2FA có thể bỏ trống)
//
// An toàn khi chạy lại: Profile ID được ghi vào Sheet NGAY sau khi tạo, và trước khi tạo luôn
// tìm profile cùng tên trong GPM — nên lỗi giữa chừng không sinh profile trùng.

import { readChannelRows, assertTaskColumns, parseAccount, makeStatusWriter } from "./channel-sheet.js";
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
 * action: "create" | "reuse" (dùng profile có sẵn) | "skip" | "error"
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
      if (!r.account) return { ...item, action: "skip", note: "ô tk trống" };
      const key = r.sheetName.trim().toLowerCase();
      if (seen.has(key)) return fail("tên kênh bị lặp trong Sheet");
      seen.add(key);

      item.account = parseAccount(r.account);
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

function readRows(values) {
  assertTaskColumns(values, "addchannel");
  const { rows, cols } = readChannelRows(values);
  return { rows, cols };
}

// Bỏ dòng đã có Profile ID (kênh cũ) trừ khi người dùng nêu tên rõ ràng.
function pickRows(rows, selectedNames) {
  const want = new Set((selectedNames || []).map((s) => String(s).trim().toLowerCase()).filter(Boolean));
  if (want.size) return rows.filter((r) => want.has(r.sheetName.trim().toLowerCase()));
  return rows.filter((r) => !r.gpmProfileId);
}

export async function previewAddChannels({ selectedNames, defaultVersion }, deps) {
  const { rows } = readRows(await deps.readValues());
  const plan = planAddChannels({ rows: pickRows(rows, selectedNames), profiles: await deps.listProfiles(), defaultVersion });
  return plan.map(({ account, proxy, ...safe }) => safe); // không đưa mật khẩu/proxy gốc ra ngoài
}

export async function runAddChannels(o, deps) {
  const log = o.onLog || console.log;
  const { rows, cols } = readRows(await deps.readValues());
  let profiles = await deps.listProfiles();
  const plan = planAddChannels({ rows: pickRows(rows, o.selectedNames), profiles, defaultVersion: o.defaultVersion });
  if (!plan.length) throw new Error("Không có dòng nào để chạy (kênh mới cần ô tk có dữ liệu và ô GPM Profile ID trống)");

  const res = { total: plan.length, created: 0, reused: 0, skipped: 0, errors: 0, login: null };
  const ready = []; // profile sẵn sàng để đăng nhập
  const acctById = new Map();

  for (const it of plan) {
    deps.checkCancelled?.();
    const tag = `[${it.sheetName}]`;
    if (it.action === "skip") { res.skipped++; log(`${tag} — bỏ qua: ${it.note}`); continue; }
    if (it.action === "error") { res.errors++; log(`${tag} ❌ ${it.note}`); continue; }

    try {
      let id = it.profileId;
      if (it.action === "create") {
        log(`${tag} tạo profile Chrome ${it.version}${it.proxyMasked ? `, proxy ${it.proxyMasked}` : ", KHÔNG có proxy"}`);
        ({ id } = await deps.createProfile({ name: it.sheetName, rawProxy: it.proxy, browserVersion: it.version, startupUrl: STUDIO_URL }));
        res.created++;
      } else {
        res.reused++;
        if (it.setProxy) { log(`${tag} gán proxy ${it.proxyMasked}`); await deps.updateProxy(id, it.proxy); }
        if (it.proxyDiffers) log(`${tag} ⚠️ proxy trong Sheet khác proxy của profile — giữ nguyên proxy của profile`);
      }

      // Ghi ID vào Sheet NGAY. Nếu ghi hỏng thì dừng cả lượt: tiếp tục sẽ tạo thêm profile mà
      // Sheet không biết, lượt sau lại tạo trùng.
      if (it.action === "create" || it.writeId) {
        try { await deps.writeCell(it.rowIndex, cols.gpmProfileId, id); }
        catch (e) {
          throw Object.assign(new Error(`ĐÃ tạo/tìm profile (ID ${id}) nhưng KHÔNG ghi được vào Sheet: ${e.message}. Hãy điền ID này vào ô "GPM Profile ID" của dòng ${it.rowIndex} rồi chạy lại.`), { fatal: true });
        }
      }
      log(`${tag} ✅ profile ${id}`);
      ready.push({ id, name: it.sheetName, rowIndex: it.rowIndex });
      acctById.set(id, it.account);
    } catch (e) {
      if (e.fatal) { log(`${tag} ❌ ${e.message}`); throw e; }
      res.errors++;
      log(`${tag} ❌ ${e.message}`);
    }
  }

  if (o.doLogin !== false && ready.length) {
    log(`\n🔐 Đăng nhập ${ready.length} profile…`);
    res.login = await deps.forEach({
      gpmHost: o.gpmHost, profiles: ready, concurrency: 1, log,
      onResult: makeStatusWriter({ writeCell: deps.writeCell, cols, key: "loginStatus" }),
      work: (page, p, plog) => deps.login(page, acctById.get(p.id), plog),
    });
  }

  const loginPart = res.login ? `; đăng nhập ${res.login.ok}/${res.login.total}` : "";
  const message = `tạo mới ${res.created}, dùng lại ${res.reused}, bỏ qua ${res.skipped}, lỗi ${res.errors}${loginPart}`;
  log(`\n🏁 ${message}`);
  return { success: true, ...res, message };
}
