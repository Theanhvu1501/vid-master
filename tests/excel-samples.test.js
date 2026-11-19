import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";
import { buildSample, writeSample, SAMPLE_FILES } from "../sheet/excel-samples.js";
import { readLoginAccounts, readChannelPlans } from "../sheet/excel-import.js";
import { COLUMN_LABELS, COLUMN_GROUPS, orderCreatable, planColumnFormat, createMissingColumns, readChannelRows, describeTask } from "../sheet/channel-sheet.js";
import { planSheetAutomation } from "../sheet/sheet-automation.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "sample-"));
const rm = (d) => fs.rmSync(d, { recursive: true, force: true });

// ---------- file mẫu phải ĐỌC ĐƯỢC bằng chính code của app ----------
test("mẫu tài khoản: app đọc lại đúng 2 dòng ví dụ (không nhầm dòng tiêu đề)", () => {
  const d = tmp();
  const f = writeSample("login", path.join(d, "a.xlsx"));
  const rows = readLoginAccounts(f);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].profileName, "PROFILE_ID_HOAC_TEN_1");
  assert.equal(rows[0].email, "tai.khoan.1@example.com");
  assert.equal(rows[0].twoFactorSecret, "JBSWY3DPEHPK3PXP");
  assert.equal(rows[1].recoveryEmail, "");
  rm(d);
});

test("mẫu tạo channel: app đọc lại đúng 2 dòng, dòng tiêu đề bị bỏ", () => {
  const d = tmp();
  const f = writeSample("channel", path.join(d, "a.xlsx"));
  const rows = readChannelPlans(f);
  assert.equal(rows.length, 2, JSON.stringify(rows.map((r) => r.profileName)));
  assert.deepEqual(rows[0], { profileName: "PROFILE_ID_HOAC_TEN_1", title: "Tên kênh ví dụ 1", description: "Mô tả kênh ví dụ 1.", videoDescription: "Mô tả mặc định cho video của kênh 1.", tags: "tag1, tag2, tag3", handle: "@kenhvidu1" });
  assert.equal(rows[1].tags, "");
  rm(d);
});

test("readChannelPlans: profile thật tên 'Profile 01' KHÔNG bị nhầm là dòng tiêu đề", () => {
  const d = tmp();
  const f = path.join(d, "x.xlsx");
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Tên profile (GPM)", "Tên kênh"], ["Profile 01", "Kênh A"], ["profile name", "x"]]), "S");
  XLSX.writeFile(wb, f);
  const rows = readChannelPlans(f);
  assert.deepEqual(rows.map((r) => r.profileName), ["Profile 01"]);
  rm(d);
});

test("mẫu Sheet: tiêu đề khớp CHÍNH XÁC các tên cột app đọc, và readChannelRows đọc được", () => {
  const d = tmp();
  const f = writeSample("sheet", path.join(d, "s.xlsx"));
  const wb = XLSX.readFile(f);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets["⚙config"], { header: 1, defval: "" });
  const { rows: parsed } = readChannelRows(rows);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].sheetName, "TEN_KENH_1");
  assert.equal(parsed[0].channelTitle, "Tên kênh ví dụ 1");
  assert.equal(parsed[0].channelHandle, "@kenhvidu1");
  assert.ok(parsed[0].account.includes("@example.com"));
  // mọi cột tự động hoá phải được nhận ra (không cột nào bị gõ sai tên)
  const header = rows[1];
  for (const key of ["gpmProfileId", "autoProfile", "autoChannel", "account", "channelTitle", "channelDesc", "videoDesc", "videoTags", "channelHandle", "autoStatus"]) {
    assert.ok(header.includes(COLUMN_LABELS[key]), `thiếu cột ${key}`);
  }
  assert.equal(describeTask(rows, "automation").ready, true);
  rm(d);
});

test("mẫu Sheet: cờ bật/tắt để TRỐNG nên dán nguyên mẫu cũng không chạy gì", () => {
  const d = tmp();
  const f = writeSample("sheet", path.join(d, "s.xlsx"));
  const rows = XLSX.utils.sheet_to_json(XLSX.readFile(f).Sheets["⚙config"], { header: 1, defval: "" });
  const { rows: parsed } = readChannelRows(rows);
  assert.deepEqual(parsed.map((r) => [r.autoProfile, r.autoChannel]), [["off", "off"], ["off", "off"]]);
  assert.deepEqual(planSheetAutomation({ rows: parsed, profiles: [] }), []);
  rm(d);
});

test("mẫu Sheet: dòng 1 là dải nhóm có gộp ô, trùng tên nhóm với COLUMN_GROUPS", () => {
  const d = tmp();
  const f = writeSample("sheet", path.join(d, "s.xlsx"));
  const ws = XLSX.readFile(f).Sheets["⚙config"];
  const band = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" })[0].filter(Boolean);
  for (const g of COLUMN_GROUPS) assert.ok(band.includes(g.label), `thiếu nhóm ${g.label}`);
  assert.ok((ws["!merges"] || []).length >= 1);
  rm(d);
});

test("dữ liệu mẫu là dữ liệu giả an toàn: không có proxy/tài khoản thật", () => {
  const all = ["login", "channel", "sheet"].flatMap((k) => buildSample(k).flatMap((s) => s.rows.flat())).join("\n");
  assert.ok(/@example\.com/.test(all));
  assert.ok(/203\.0\.113\./.test(all), "proxy mẫu dùng dải IP tài liệu");
  assert.ok(!/@gmail\.com|@yahoo|@outlook/i.test(all), "không có địa chỉ mail thật");
});

test("writeSample: tự thêm .xlsx, tên file mặc định đúng, loại lạ bị từ chối", () => {
  const d = tmp();
  assert.ok(writeSample("login", path.join(d, "ten")).endsWith("ten.xlsx"));
  assert.deepEqual(Object.keys(SAMPLE_FILES).sort(), ["channel", "chromakey", "fullsheet", "login", "sheet", "urls"]);
  assert.throws(() => buildSample("khong-co"), /Không có file mẫu/);
  rm(d);
});

// ---------- nhóm màu ----------
test("nhóm màu: mỗi cột tự động hoá thuộc đúng một nhóm, màu mỗi nhóm khác nhau", () => {
  const keys = COLUMN_GROUPS.flatMap((g) => g.keys);
  assert.equal(new Set(keys).size, keys.length, "một cột không được nằm ở 2 nhóm");
  assert.equal(new Set(COLUMN_GROUPS.map((g) => g.band)).size, COLUMN_GROUPS.length);
  for (const g of COLUMN_GROUPS) assert.ok(/^#[0-9a-f]{6}$/i.test(g.band) && /^#[0-9a-f]{6}$/i.test(g.tint), g.id);
});

test("orderCreatable: cột cùng nhóm nằm liền nhau, theo thứ tự nhóm, không trùng", () => {
  const out = orderCreatable(["autoStatus", "channelTitle", "autoProfile", "autoChannel", "autoProfile"]);
  assert.deepEqual(out, ["autoProfile", "channelTitle", "autoChannel", "autoStatus"].sort((a, b) => out.indexOf(a) - out.indexOf(b)));
  const gi = (k) => COLUMN_GROUPS.findIndex((g) => g.keys.includes(k));
  const seq = out.map(gi);
  assert.deepEqual(seq, [...seq].sort((a, b) => a - b), "đã xếp theo nhóm");
});

test("planColumnFormat: gom cột liền kề cùng nhóm thành một dải; dải nhóm đã có chữ thì không ghi đè", () => {
  const values = [["", "", "", "BẠN ĐÃ GHI Ở ĐÂY"], ["Tên kênh", "GPM Profile ID", "tk", "x"]];
  const keys = ["autoProfile", "account", "autoChannel", "channelTitle", "autoStatus"];
  const plan = planColumnFormat({ values, headerRowIndex: 1, startCol: 4, keys });
  assert.equal(plan.bandRow, 0);
  assert.deepEqual(plan.groups.map((g) => [g.id, g.startCol, g.endCol]), [["profile", 4, 6], ["channel", 6, 8], ["status", 8, 9]]);
  assert.ok(plan.groups.every((g) => g.bandFree));
  const occupied = planColumnFormat({ values, headerRowIndex: 1, startCol: 3, keys: ["autoProfile"] });
  assert.equal(occupied.groups[0].bandFree, false, "ô dải đã có chữ của người dùng -> không ghi đè");
});

test("planColumnFormat: Sheet không có dòng nhóm phía trên -> chỉ tô dòng tên cột", () => {
  const plan = planColumnFormat({ values: [["Tên kênh"]], headerRowIndex: 0, startCol: 1, keys: ["autoProfile"] });
  assert.equal(plan.bandRow, -1);
  assert.equal(plan.groups[0].bandFree, false);
});

test("createMissingColumns: ghi tên cột theo thứ tự nhóm rồi gọi tô màu đúng vùng cột mới", async () => {
  const written = []; let spec = null;
  const made = await createMissingColumns({
    readValues: async () => [["", ""], ["Tên kênh", "GPM Profile ID"], ["K1", ""]],
    ensureColumns: async () => {},
    writeCell: async (r, c, v) => written.push([r, c, v]),
    formatGroups: async (s) => { spec = s; },
  }, "automation");
  assert.deepEqual(written.map((w) => w[2]), made);
  assert.ok(written.every(([r]) => r === 2), "ghi vào dòng tiêu đề");
  assert.equal(written[0][1], 2, "bắt đầu ngay sau cột cuối");
  assert.ok(spec && spec.groups.length >= 2, "có các dải nhóm để tô màu");
  assert.ok(spec.groups.every((g) => g.startCol >= 2), "chỉ tô cột MỚI, không đụng cột cũ");
});

test("createMissingColumns: tô màu lỗi thì cột VẪN được tạo và lỗi được báo ra, không ném", async () => {
  const written = []; let reported = null;
  const made = await createMissingColumns({
    readValues: async () => [["Tên kênh", "GPM Profile ID"], ["K1", ""]],
    writeCell: async (r, c, v) => written.push(v),
    formatGroups: async () => { throw new Error("thiếu quyền chỉnh định dạng"); },
    onFormatError: (e) => { reported = e.message; },
  }, "automation");
  assert.ok(made.length > 0 && written.length === made.length);
  assert.equal(reported, "thiếu quyền chỉnh định dạng");
});

test("mỗi cột của TASKS.automation đều thuộc một nhóm màu (trừ Tên kênh)", () => {
  const grouped = new Set(COLUMN_GROUPS.flatMap((g) => g.keys));
  const d = describeTask([["Tên kênh"], ["K1"]], "automation");
  for (const c of [...d.reads, ...d.writes]) {
    if (c.key === "sheetName" || c.key === "proxy") continue; // cột chung sẵn có của ⚙config
    assert.ok(grouped.has(c.key), `cột ${c.key} chưa có nhóm màu`);
  }
});

// ---------- mẫu .txt: phải đọc được bằng ĐÚNG logic của download.js / render.js ----------
test("mẫu urls.txt: tách theo dòng như download.js, ra đúng 2 URL hợp lệ", () => {
  const d = tmp();
  const f = writeSample("urls", path.join(d, "urls"));
  assert.ok(f.endsWith(".txt"));
  const urls = fs.readFileSync(f, "utf-8").split("\n").filter(Boolean); // y hệt download.js
  assert.equal(urls.length, 2);
  assert.ok(urls.every((u) => /^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}$/.test(u)), JSON.stringify(urls));
  rm(d);
});

test("mẫu chromaKey.txt: đọc như render.js — dòng # là ghi chú, còn lại là mã hex 6 ký tự không dấu #", () => {
  const d = tmp();
  const f = writeSample("chromakey", path.join(d, "ck"));
  // y hệt render.js
  const lines = fs.readFileSync(f, "utf-8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  assert.deepEqual(lines, ["D4F9D7", "22BDD6"]);
  assert.ok(lines.every((l) => /^[0-9A-Fa-f]{6}$/.test(l)), "mọi dòng phải qua kiểm tra hợp lệ của render.js");
  rm(d);
});

test("writeSample .txt: tự thêm đuôi .txt, không thêm nếu đã có", () => {
  const d = tmp();
  assert.ok(writeSample("urls", path.join(d, "a")).endsWith("a.txt"));
  assert.ok(!writeSample("urls", path.join(d, "b.txt")).endsWith(".txt.txt"));
  rm(d);
});

// ---------- mẫu đầy đủ ⚙config: sao chép file có sẵn của repo ----------
const FULL = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "docs", "sheet-mau", "Vid-Master-Template-3.xlsx");

test("mẫu đầy đủ: đọc file gốc, thêm cột tự động hoá, giữ màu đẹp", async () => {
  const d = tmp();
  const out = await writeSample("fullsheet", path.join(d, "full"), { fullSheetSource: FULL });
  assert.ok(out.endsWith("full.xlsx"));
  // File lớn hơn gốc vì thêm cột
  assert.ok(fs.statSync(out).size >= fs.statSync(FULL).size);
  const wb = XLSX.readFile(out);
  assert.ok(wb.SheetNames.includes("⚙config"));
  const header = XLSX.utils.sheet_to_json(wb.Sheets["⚙config"], { header: 1 })[1].map(String);
  assert.ok(header.includes("Kênh BKT"), "có cột Kênh BKT");
  rm(d);
});

test("mẫu đầy đủ: không có file nguồn thì báo lỗi rõ ràng, không tạo file rỗng", async () => {
  const d = tmp();
  await assert.rejects(writeSample("fullsheet", path.join(d, "x"), {}), /Không tìm thấy file mẫu/);
  await assert.rejects(writeSample("fullsheet", path.join(d, "x"), { fullSheetSource: path.join(d, "khong-co.xlsx") }), /Không tìm thấy file mẫu/);
  assert.equal(fs.readdirSync(d).length, 0);
  rm(d);
});

test("mẫu đầy đủ: không chứa mail hay proxy thật", () => {
  const wb = XLSX.readFile(FULL);
  const all = wb.SheetNames.flatMap((n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: "" }).flat()).join("\n");
  assert.ok(!/@gmail\.com|@yahoo|@outlook/i.test(all), "không có mail thật");
  assert.ok(!/socks5:\/\/\d|(\d{1,3}\.){3}\d{1,3}:\d{2,5}:\w+:\w+/.test(all), "không có proxy thật");
});
