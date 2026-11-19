// Luồng tự động hoá trong Theo dõi Sheet đọc kênh từ tab ⚙config và ghi kết quả về đó. Mọi lựa chọn
// (kênh nào tạo profile, kênh nào tạo channel, bản Chrome...) nằm ở Sheet, không cấu hình trong app.
// File này gom phần dùng chung: danh sách cột, đọc các hàng kênh, đọc cờ bật/tắt, kiểm tra/tạo cột
// còn thiếu, ghi trạng thái từng kênh về Sheet.

import { locateConfigColumns } from "./sheets-service.js";
import { formatStamp } from "./schedule-slots.js";

// Tên hiển thị của từng cột (đúng chữ sẽ được ghi vào dòng tiêu đề khi tạo cột).
export const COLUMN_LABELS = {
  sheetName: "Tên kênh",
  gpmProfileId: "GPM Profile ID",
  monetized: "Kênh BKT",
  autoProfile: "Tạo profile",
  autoChannel: "Tạo channel",
  account: "tk",
  chromeVersion: "Phiên bản Chrome",
  proxy: "Proxy tải",
  profileProxy: "Proxy profile",
  channelTitle: "Tên hiển thị",
  channelDesc: "Mô tả kênh",
  videoDesc: "Mô tả video",
  videoTags: "Tag",
  channelHandle: "Handle kênh",
  autoStatus: "Trạng thái tự động hóa",
};
const KEYS = Object.keys(COLUMN_LABELS);

// Nhóm cột của phần tự động hoá: mỗi nhóm một màu để nhìn Sheet biết ngay cột nào thuộc việc gì.
// band = màu dải nhóm (dòng trên tiêu đề, gộp ô); tint = màu nhạt cho dòng tên cột.
// Chọn khác các nhóm sẵn có của ⚙config (render, tải xuống, lên lịch...) để không lẫn.
export const COLUMN_GROUPS = [
  { id: "profile", label: "TỰ ĐỘNG HOÁ — TẠO PROFILE", keys: ["autoProfile", "gpmProfileId", "account", "chromeVersion", "profileProxy", "monetized"], band: "#F2A65A", tint: "#FCE8D2" },
  { id: "channel", label: "TỰ ĐỘNG HOÁ — TẠO CHANNEL", keys: ["autoChannel", "channelTitle", "channelDesc", "videoDesc", "videoTags", "channelHandle"], band: "#B39DDB", tint: "#E8E1F5" },
  { id: "status", label: "TỰ ĐỘNG HOÁ — KẾT QUẢ", keys: ["autoStatus"], band: "#B0BEC5", tint: "#ECEFF1" },
];
const groupIndexOf = (key) => COLUMN_GROUPS.findIndex((g) => g.keys.includes(key));

// Sắp các cột sắp tạo theo nhóm (cột cùng nhóm nằm liền nhau để gộp ô dải nhóm được).
export function orderCreatable(keys) {
  const rank = (k) => { const i = groupIndexOf(k); return i < 0 ? COLUMN_GROUPS.length : i; };
  return [...new Set(keys)].map((k, i) => ({ k, i })).sort((x, y) => rank(x.k) - rank(y.k) || x.i - y.i).map((x) => x.k);
}

/**
 * Kế hoạch định dạng cho các cột mới (hàm thuần): mỗi nhóm liền nhau là một dải cần gộp ô + tô màu.
 * bandRow < 0 nghĩa là Sheet không có dòng nhóm phía trên tiêu đề -> chỉ tô màu dòng tên cột.
 * bandFree = các ô dải nhóm của nhóm đó còn TRỐNG (không ghi đè nội dung có sẵn của người dùng).
 */
export function planColumnFormat({ values, headerRowIndex, startCol, keys }) {
  const ordered = orderCreatable(keys);
  const bandRow = headerRowIndex > 0 ? headerRowIndex - 1 : -1;
  const runs = [];
  ordered.forEach((key, i) => {
    const gi = groupIndexOf(key);
    if (gi < 0) return;
    const col = startCol + i;
    const last = runs[runs.length - 1];
    if (last && last.gi === gi && last.endCol === col) last.endCol = col + 1;
    else runs.push({ gi, startCol: col, endCol: col + 1 });
  });
  const cellEmpty = (r, c) => String(values?.[r]?.[c] ?? "").trim() === "";
  return {
    bandRow,
    headerRow: headerRowIndex,
    groups: runs.map((r) => {
      const g = COLUMN_GROUPS[r.gi];
      let free = bandRow >= 0;
      for (let c = r.startCol; free && c < r.endCol; c++) free = cellEmpty(bandRow, c);
      return { id: g.id, label: g.label, band: g.band, tint: g.tint, startCol: r.startCol, endCol: r.endCol, bandFree: free };
    }),
  };
}

const req = (key) => ({ key, required: true });
const opt = (key) => ({ key, required: false });
const mk = (key) => ({ key, required: false, make: true }); // tuỳ chọn nhưng tạo cùng khi bấm "Tạo cột còn thiếu"

// reads = cột chức năng lấy dữ liệu từ đó; writes = cột chức năng ghi kết quả vào.
export const TASKS = {
  automation: {
    label: "Tự động hóa",
    reads: [
      req("sheetName"), mk("autoProfile"), mk("autoChannel"), mk("monetized"), opt("account"), opt("proxy"), opt("profileProxy"), opt("chromeVersion"),
      mk("channelTitle"), mk("channelDesc"), mk("videoDesc"), mk("videoTags"), mk("channelHandle"),
    ],
    writes: [req("gpmProfileId"), mk("autoStatus")],
  },
};

// ---------------------------------------------------------------------------------------------
// Cờ bật/tắt của ô "Tạo profile" / "Tạo channel"
// ---------------------------------------------------------------------------------------------

const fold = (s) => String(s ?? "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d");
const ON = new Set(["co", "c", "yes", "y", "true", "1", "x", "on", "bat", "✓", "✔", "☑"]);
const DONE = new Set(["xong", "done", "da xong"]);

/**
 * "on"  : người dùng muốn chạy (có / yes / 1 / x ...)
 * "done": đã chạy xong (app ghi "xong" vào ô sau khi thành công) — không chạy lại
 * "off" : trống hoặc giá trị khác — KHÔNG chạy. Khác các cột bật/tắt cũ (trống = bật), vì đây là
 *         thao tác tạo thật nên phải do người dùng chủ động bật.
 */
export function flagState(v) {
  const s = fold(v);
  if (!s) return "off";
  if (ON.has(s)) return "on";
  if (DONE.has(s) || s.startsWith("✅")) return "done";
  return "off";
}
export const FLAG_DONE_TEXT = "xong";

// "gmail|mật khẩu|mail khôi phục|mã 2FA" -> object. Ném lỗi nếu thiếu gmail/mật khẩu.
export function parseAccount(text) {
  const [email = "", password = "", recoveryEmail = "", twoFactorSecret = ""] = String(text ?? "").split("|").map((s) => s.trim());
  if (!email.includes("@")) throw new Error('cột tk phải có dạng "gmail|mật khẩu|mail khôi phục|2FA"');
  if (!password) throw new Error("cột tk thiếu mật khẩu");
  return { email, password, recoveryEmail, twoFactorSecret };
}

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
      monetized: flagState(cell(r, "monetized")) === "on",
      autoProfile: flagState(cell(r, "autoProfile")),
      autoChannel: flagState(cell(r, "autoChannel")),
      account: cell(r, "account"),
      chromeVersion: cell(r, "chromeVersion"),
      // Proxy của profile: cột "Proxy profile" nếu có, không thì dùng cột "Proxy tải" sẵn có.
      proxy: cell(r, "profileProxy") || cell(r, "proxy"),
      channelTitle: cell(r, "channelTitle"),
      channelDesc: cell(r, "channelDesc"),
      videoDesc: cell(r, "videoDesc"),
      videoTags: cell(r, "videoTags"),
      channelHandle: cell(r, "channelHandle"),
    });
  }
  return { rows, cols, headerRowIndex };
}

// Mô tả cột của một chức năng: có hay chưa, bắt buộc hay không. Dùng cho khung cột trên giao diện.
export function describeTask(values, taskId) {
  const t = TASKS[taskId];
  if (!t) throw new Error(`Chức năng không tồn tại: ${taskId}`);
  const { headerRowIndex, cols } = locateConfigColumns(values, KEYS);
  if (headerRowIndex < 0) throw new Error('Không thấy dòng tiêu đề có cột "Tên kênh" trong tab ⚙config');
  const map = (list) => list.map((c) => ({ key: c.key, label: COLUMN_LABELS[c.key], required: c.required, make: !!c.make, present: cols[c.key] !== undefined, band: COLUMN_GROUPS[groupIndexOf(c.key)]?.band || "" }));
  const reads = map(t.reads), writes = map(t.writes);
  const missingRequired = [...reads, ...writes].filter((c) => c.required && !c.present).map((c) => c.label);
  // Cột có thể tạo giúp: bắt buộc + tuỳ chọn đánh dấu make. Không tạo cột "Tên kênh".
  const creatableKeys = orderCreatable([...reads, ...writes].filter((c) => !c.present && c.key !== "sheetName" && (c.required || c.make)).map((c) => c.key));
  const creatable = creatableKeys.map((k) => COLUMN_LABELS[k]);
  const hasFlag = cols.autoProfile !== undefined || cols.autoChannel !== undefined;
  return { task: taskId, label: t.label, reads, writes, missingRequired, creatable, creatableKeys, hasFlag, ready: missingRequired.length === 0 };
}

export function assertTaskColumns(values, taskId) {
  const d = describeTask(values, taskId);
  if (!d.ready) {
    throw new Error(`Sheet ⚙config thiếu cột bắt buộc cho "${d.label}": ${d.missingRequired.map((l) => `"${l}"`).join(", ")} — bấm "Tạo cột còn thiếu" hoặc tự thêm vào dòng tiêu đề`);
  }
  return d;
}

// Thêm các cột còn thiếu vào CUỐI dòng tiêu đề, theo thứ tự nhóm, rồi tô màu dải nhóm + tên cột mới.
// Chỉ gọi khi người dùng bấm nút. Không sửa hay tô lại cột đang có. Tô màu hỏng (thiếu quyền, API lỗi)
// thì cột vẫn đã được tạo: lỗi được báo qua deps.onFormatError thay vì ném ra.
export async function createMissingColumns(deps, taskIds) {
  const values = await deps.readValues();
  const { headerRowIndex } = locateConfigColumns(values, KEYS);
  if (headerRowIndex < 0) throw new Error('Không thấy dòng tiêu đề có cột "Tên kênh"');
  const keys = [];
  for (const id of [].concat(taskIds)) for (const k of describeTask(values, id).creatableKeys) if (!keys.includes(k)) keys.push(k);
  if (!keys.length) return [];
  const ordered = orderCreatable(keys);
  const labels = ordered.map((k) => COLUMN_LABELS[k]);
  const width = Math.max(0, ...values.map((r) => (Array.isArray(r) ? r.length : 0)));
  await deps.ensureColumns?.(width + labels.length);
  for (let i = 0; i < labels.length; i++) await deps.writeCell(headerRowIndex + 1, width + i, labels[i]);

  if (deps.formatGroups) {
    try { await deps.formatGroups(planColumnFormat({ values, headerRowIndex, startCol: width, keys: ordered })); }
    catch (e) { deps.onFormatError?.(e); }
  }
  return labels;
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
