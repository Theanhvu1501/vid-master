// Tab ⚙config của Google Sheet là NGUỒN DUY NHẤT về kênh: mỗi hàng là một kênh, mọi chức năng
// automation đọc dữ liệu từ đó và ghi kết quả về đó. File này gom phần dùng chung:
//   - danh sách cột mỗi chức năng ĐỌC và GHI (để giao diện hiện cho người dùng thấy rõ),
//   - đọc các hàng kênh, chọn kênh chạy được cho từng chức năng (kèm lý do loại),
//   - ghi trạng thái từng kênh về Sheet, tạo cột còn thiếu khi người dùng bấm nút.

import fs from "fs";
import path from "path";
import { locateConfigColumns } from "./sheets-service.js";
import { splitPostTimes, formatStamp } from "./schedule-slots.js";
import { maskProxy } from "./proxy-tools.js";

// Tên hiển thị của từng cột (đúng chữ sẽ được ghi vào dòng tiêu đề khi tạo cột).
export const COLUMN_LABELS = {
  sheetName: "Tên kênh",
  gpmProfileId: "GPM Profile ID",
  account: "tk",
  chromeVersion: "Phiên bản Chrome",
  postTimes: "Giờ đăng",
  proxy: "Proxy tải",
  profileProxy: "Proxy profile",
  loginStatus: "Trạng thái login",
  thumbStatus: "Trạng thái thumb",
  scheduleStatus: "Trạng thái lịch",
};
const KEYS = Object.keys(COLUMN_LABELS);

const req = (key) => ({ key, required: true });
const opt = (key) => ({ key, required: false });

// reads  = cột chức năng lấy dữ liệu từ đó; writes = cột chức năng ghi kết quả vào.
export const TASKS = {
  addchannel: {
    label: "Thêm kênh mới",
    reads: [req("sheetName"), req("account"), opt("proxy"), opt("profileProxy"), opt("chromeVersion")],
    writes: [req("gpmProfileId"), opt("loginStatus")],
  },
  login: { label: "Auto Login", reads: [req("sheetName"), req("gpmProfileId"), req("account")], writes: [opt("loginStatus")] },
  thumb: { label: "Auto đổi Thumbnail", reads: [req("sheetName"), req("gpmProfileId")], writes: [opt("thumbStatus")] },
  schedule: { label: "Auto Lên lịch", reads: [req("sheetName"), req("gpmProfileId"), req("postTimes")], writes: [opt("scheduleStatus")] },
  distribute: { label: "Rải video cho kênh", reads: [req("sheetName"), req("gpmProfileId"), req("postTimes")], writes: [opt("scheduleStatus")] },
  proxycheck: { label: "Kiểm tra proxy", reads: [req("sheetName"), req("gpmProfileId")], writes: [] },
  proxysync: { label: "Đồng bộ proxy", reads: [req("sheetName"), req("gpmProfileId"), req("proxy"), opt("profileProxy")], writes: [] },
};

// Chức năng nào ghi trạng thái vào cột nào.
export const STATUS_KEY = { login: "loginStatus", thumb: "thumbStatus", schedule: "scheduleStatus", distribute: "scheduleStatus", addchannel: "loginStatus" };

const lower = (s) => String(s ?? "").trim().toLowerCase();

// "gmail|mật khẩu|mail khôi phục|mã 2FA" -> object. Ném lỗi nếu thiếu gmail/mật khẩu.
export function parseAccount(text) {
  const [email = "", password = "", recoveryEmail = "", twoFactorSecret = ""] = String(text ?? "").split("|").map((s) => s.trim());
  if (!email.includes("@")) throw new Error('cột tk phải có dạng "gmail|mật khẩu|mail khôi phục|2FA"');
  if (!password) throw new Error("cột tk thiếu mật khẩu");
  return { email, password, recoveryEmail, twoFactorSecret };
}

// ---------------------------------------------------------------------------------------------
// Đọc Sheet
// ---------------------------------------------------------------------------------------------

export function readChannelRows(values) {
  const { headerRowIndex, cols } = locateConfigColumns(values, KEYS);
  if (headerRowIndex < 0 || cols.sheetName === undefined) {
    throw new Error('Không thấy dòng tiêu đề có cột "Tên kênh" trong tab ⚙config');
  }
  const cell = (r, key) => (cols[key] === undefined ? "" : String(values[r]?.[cols[key]] ?? "").trim());
  const rows = [];
  for (let r = headerRowIndex + 1; r < values.length; r++) {
    const sheetName = cell(r, "sheetName");
    if (!sheetName) continue;
    rows.push({
      sheetName,
      rowIndex: r + 1, // 1-based, dùng thẳng trong A1 notation
      gpmProfileId: cell(r, "gpmProfileId"),
      account: cell(r, "account"),
      chromeVersion: cell(r, "chromeVersion"),
      postTimes: cell(r, "postTimes"),
      // Proxy của profile: cột "Proxy profile" nếu có, không thì dùng cột "Proxy tải" sẵn có.
      proxy: cell(r, "profileProxy") || cell(r, "proxy"),
      loginStatus: cell(r, "loginStatus"),
      thumbStatus: cell(r, "thumbStatus"),
      scheduleStatus: cell(r, "scheduleStatus"),
    });
  }
  return { rows, cols, headerRowIndex };
}

// Mô tả cột của một chức năng: có hay chưa, bắt buộc hay không. Dùng cho khung "Đọc/Ghi" trên giao diện.
export function describeTask(values, taskId) {
  const t = TASKS[taskId];
  if (!t) throw new Error(`Chức năng không tồn tại: ${taskId}`);
  const { cols } = locateConfigColumns(values, KEYS);
  const map = (list) => list.map((c) => ({ key: c.key, label: COLUMN_LABELS[c.key], required: c.required, present: cols[c.key] !== undefined }));
  const reads = map(t.reads), writes = map(t.writes);
  const missingRequired = [...reads, ...writes].filter((c) => c.required && !c.present).map((c) => c.label);
  // Cột có thể tạo giúp: cột đọc bắt buộc + cột ghi. Không tạo cột đọc tuỳ chọn (proxy, phiên bản...).
  const creatable = [...reads.filter((c) => c.required), ...writes].filter((c) => !c.present && c.key !== "sheetName").map((c) => c.label);
  return { task: taskId, label: t.label, reads, writes, missingRequired, creatable, ready: missingRequired.length === 0 };
}

export function assertTaskColumns(values, taskId) {
  const d = describeTask(values, taskId);
  if (!d.ready) {
    throw new Error(`Sheet ⚙config thiếu cột bắt buộc cho "${d.label}": ${d.missingRequired.map((l) => `"${l}"`).join(", ")} — bấm "Tạo cột còn thiếu" hoặc tự thêm vào dòng tiêu đề`);
  }
  return d;
}

// Thêm các cột còn thiếu vào CUỐI dòng tiêu đề. Chỉ gọi khi người dùng bấm nút.
export async function createMissingColumns(deps, taskId) {
  const values = await deps.readValues();
  const { headerRowIndex } = locateConfigColumns(values, KEYS);
  if (headerRowIndex < 0) throw new Error('Không thấy dòng tiêu đề có cột "Tên kênh"');
  const d = describeTask(values, taskId);
  if (!d.creatable.length) return [];
  const width = Math.max(0, ...values.map((r) => (Array.isArray(r) ? r.length : 0)));
  await deps.ensureColumns?.(width + d.creatable.length);
  for (let i = 0; i < d.creatable.length; i++) await deps.writeCell(headerRowIndex + 1, width + i, d.creatable[i]);
  return d.creatable;
}

// ---------------------------------------------------------------------------------------------
// Danh sách kênh cho giao diện (KHÔNG chứa mật khẩu hay proxy gốc)
// ---------------------------------------------------------------------------------------------

export function listChannelsForUi({ rows, profiles, groups }) {
  const byId = new Map(profiles.map((p) => [p.id, p]));
  const groupName = new Map((groups || []).map((g) => [String(g.id), g.name]));
  return rows.map((r) => {
    const prof = r.gpmProfileId ? byId.get(r.gpmProfileId) : null;
    return {
      sheetName: r.sheetName, rowIndex: r.rowIndex,
      profileId: r.gpmProfileId, profileFound: !!prof,
      groupName: prof ? groupName.get(String(prof.groupId)) || "" : "",
      hasAccount: !!r.account,
      hasProxy: !!r.proxy, proxyMasked: maskProxy(r.proxy),
      hasPostTimes: !!r.postTimes,
      loginStatus: r.loginStatus, thumbStatus: r.thumbStatus, scheduleStatus: r.scheduleStatus,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Chọn kênh chạy được cho từng chức năng
// ---------------------------------------------------------------------------------------------

/**
 * @returns {{ profiles: object[], skipped: {name,rowIndex,reason}[] }}
 *   profiles: các kênh sẵn sàng chạy, kèm đúng dữ liệu chức năng đó cần (id, name, rowIndex, + riêng từng việc)
 *   skipped : kênh được chọn nhưng bị loại, kèm lý do để hiện cho người dùng
 */
export function selectForTask({ task, rows, names, gpmProfiles, channelsRoot = "", thumbFolder = "", exists = fs.existsSync }) {
  if (!Array.isArray(names) || !names.length) throw new Error("Chưa chọn kênh nào");
  const want = new Set(names.map(lower));
  const byId = new Map(gpmProfiles.map((p) => [p.id, p]));
  const profiles = [], skipped = [];

  for (const r of rows.filter((x) => want.has(lower(x.sheetName)))) {
    const skip = (reason) => skipped.push({ name: r.sheetName, rowIndex: r.rowIndex, reason });
    if (!r.gpmProfileId) { skip("chưa có GPM Profile ID"); continue; }
    if (!byId.has(r.gpmProfileId)) { skip(`Profile ID ${r.gpmProfileId} không có trong GPM`); continue; }
    const item = { id: r.gpmProfileId, name: r.sheetName, rowIndex: r.rowIndex };

    if (task === "login") {
      try { item.account = parseAccount(r.account); } catch (e) { skip(e.message); continue; }
    } else if (task === "thumb") {
      const folder = thumbFolder || (channelsRoot ? path.join(channelsRoot, r.sheetName, "overlays") : "");
      if (!folder) { skip('chưa có "Channels root" để suy ra thư mục thumbnail'); continue; }
      if (!exists(folder)) { skip(`không thấy thư mục thumbnail ${folder}`); continue; }
      item.thumbFolder = folder;
    } else if (task === "schedule" || task === "distribute") {
      const { times, invalid } = splitPostTimes(r.postTimes);
      if (invalid.length) { skip(`ô Giờ đăng có giờ không đọc được: ${invalid.map((x) => `"${x}"`).join(", ")}`); continue; }
      if (!times.length) { skip("ô Giờ đăng trống"); continue; }
      item.postTimes = r.postTimes;
    } else if (task === "proxysync" || task === "proxycheck") {
      item.proxy = r.proxy;
    }
    profiles.push(item);
  }

  const found = new Set(rows.map((r) => lower(r.sheetName)));
  for (const n of names) if (!found.has(lower(n))) skipped.push({ name: n, rowIndex: 0, reason: "không thấy trong Sheet (có thể đã đổi tên hoặc xoá)" });
  return { profiles, skipped };
}

// ---------------------------------------------------------------------------------------------
// Ghi trạng thái về Sheet
// ---------------------------------------------------------------------------------------------

export function statusText(r, now = new Date()) {
  const stamp = formatStamp(now);
  let t;
  if (r.status === "ok") t = `✅ ${stamp}${r.message ? ` · ${r.message}` : ""}`;
  else if (r.status === "skip") t = `⏭ ${stamp} · ${r.message || "bỏ qua"}`;
  else t = `❌ ${stamp} · ${String(r.message || "lỗi").split("\n")[0]}`;
  return t.slice(0, 200);
}

// Trả hàm ghi trạng thái. Ghi tuần tự (tránh chạm giới hạn của Sheets khi nhiều kênh chạy cùng lúc);
// cột chưa có trong Sheet thì bỏ qua — kết quả vẫn hiện ở log.
export function makeStatusWriter({ writeCell, cols, key, now = () => new Date() }) {
  const col = cols[key];
  let chain = Promise.resolve();
  return (p, r) => {
    if (col === undefined || !p?.rowIndex) return Promise.resolve();
    const text = statusText(r, now());
    const run = chain.then(() => writeCell(p.rowIndex, col, text));
    chain = run.catch(() => {});
    return run;
  };
}

/** Đọc Sheet + GPM rồi chọn kênh chạy được cho `task`. Dùng cho cả Xem trước lẫn Chạy. */
export async function loadTask({ task, o, deps, exists = fs.existsSync }) {
  const values = await deps.readValues();
  assertTaskColumns(values, task);
  const { rows, cols } = readChannelRows(values);
  const gpmProfiles = await deps.listProfiles();
  const sel = selectForTask({
    task, rows, names: o.names, gpmProfiles, channelsRoot: deps.channelsRoot || "", thumbFolder: o.thumbFolder || "", exists,
  });
  return { ...sel, rows, cols };
}

/**
 * Chạy một chức năng cho các kênh đã chọn: đọc Sheet -> kiểm tra cột -> chọn kênh -> chạy -> ghi trạng thái.
 * deps: { readValues, listProfiles, writeCell, channelsRoot, now? }
 */
export async function runSheetTask({ task, o, deps, runFn, onLog = console.log, exists = fs.existsSync }) {
  const { profiles, skipped, cols } = await loadTask({ task, o, deps, exists });
  const writer = STATUS_KEY[task] ? makeStatusWriter({ writeCell: deps.writeCell, cols, key: STATUS_KEY[task], now: deps.now }) : null;

  for (const s of skipped) {
    onLog(`[${s.name}] ⏭ bỏ qua: ${s.reason}`);
    if (writer && s.rowIndex) await writer({ rowIndex: s.rowIndex }, { status: "skip", message: s.reason }).catch(() => {});
  }
  if (!profiles.length) throw new Error("Không có kênh nào chạy được — xem các dòng bỏ qua ở trên");

  const res = await runFn({ ...o, profiles, onLog, onResult: writer });
  return skipped.length
    ? { ...res, preSkipped: skipped.length, message: `${res.message}; ${skipped.length} kênh bị loại trước khi chạy` }
    : res;
}
