import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import XLSX from "xlsx";
import { writeSample, buildSample } from "../sheet/excel-samples.js";
import { COLUMN_LABELS, TASKS, readChannelRows, describeTask } from "../sheet/channel-sheet.js";
import { parseConfigRows } from "../sheet/sheets-service.js";
import { planSheetAutomation } from "../sheet/sheet-automation.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "tpl-"));
const rm = (d) => fs.rmSync(d, { recursive: true, force: true });
const FULL_SRC = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "docs", "sheet-mau", "Vid-Master-Template-3.xlsx");

// Đọc file mẫu và trả rows của ⚙config. fullsheet là async nên hàm này cũng async.
async function cfgRows(kind) {
  const d = tmp();
  const f = await writeSample(kind, path.join(d, "t.xlsx"), { fullSheetSource: FULL_SRC });
  const wb = XLSX.readFile(f);
  const r = XLSX.utils.sheet_to_json(wb.Sheets["⚙config"], { header: 1, defval: "" });
  rm(d);
  return r;
}

test("mẫu tự động hoá: có ĐỦ mọi cột mà app đọc/ghi cho luồng này (không cột nào bị sót khi thêm tính năng)", async () => {
  const header = (await cfgRows("sheet"))[1].map(String);
  const want = [...new Set([...TASKS.automation.reads, ...TASKS.automation.writes].map((c) => c.key))];
  const missing = want.filter((k) => !header.includes(COLUMN_LABELS[k])).map((k) => COLUMN_LABELS[k]);
  assert.deepEqual(missing, [], "mẫu thiếu cột: " + missing.join(", "));
});

test("mẫu tự động hoá: bao gồm cột Kênh BKT và cột Proxy profile", async () => {
  const header = (await cfgRows("sheet"))[1].map(String);
  assert.ok(header.includes("Kênh BKT"));
  assert.ok(header.includes("Proxy profile"));
});

test("mẫu tự động hoá: app đọc lại được cả 2 dòng ví dụ và cờ BKT/Tạo profile/Tạo channel đều TẮT", async () => {
  const rows = await cfgRows("sheet");
  const { rows: parsed } = readChannelRows(rows);
  assert.equal(parsed.length, 2);
  assert.deepEqual(parsed.map((r) => [r.autoProfile, r.autoChannel, r.monetized]), [["off", "off", false], ["off", "off", false]]);
  assert.deepEqual(parseConfigRows(rows).map((c) => c.monetized), [false, false], "Theo dõi Sheet cũng đọc là kênh thường");
  assert.deepEqual(planSheetAutomation({ rows: parsed, profiles: [] }), [], "dán nguyên mẫu không chạy gì");
  assert.equal(describeTask(rows, "automation").ready, true);
});

test("tab Hướng dẫn của mẫu tự động hoá: có quy trình từng bước và giải thích TỪNG cột", () => {
  const guide = buildSample("sheet").find((s) => s.name === "Hướng dẫn").rows;
  const text = guide.flat().join("\n");
  for (const step of ["Bước 1", "Bước 2", "Bước 3", "Bước 4", "Bước 5"]) assert.ok(text.includes(step), step);
  const explained = new Set(guide.map((r) => r[0]));
  for (const k of ["sheetName", "proxy", "gpmProfileId", "autoProfile", "account", "chromeVersion", "profileProxy", "monetized", "autoChannel", "channelTitle", "channelDesc", "videoDesc", "videoTags", "channelHandle", "autoStatus"]) {
    assert.ok(explained.has(COLUMN_LABELS[k]), `hướng dẫn chưa giải thích cột ${COLUMN_LABELS[k]}`);
  }
  assert.match(text, /KIẾM TIỀN|kiếm tiền/i, "giải thích Kênh BKT là kênh bật kiếm tiền");
  assert.match(text, /xong/, "giải thích ô đổi thành \"xong\"");
});

test("template đầy đủ: đọc file gốc, thêm cột tự động hoá, giữ màu đẹp", async () => {
  const d = tmp();
  const out = await writeSample("fullsheet", path.join(d, "full"), { fullSheetSource: FULL_SRC });
  const wb = XLSX.readFile(out);
  assert.ok(wb.SheetNames.includes("⚙config"));
  assert.ok(wb.SheetNames.includes("Hướng dẫn"));
  // File lớn hơn gốc vì thêm cột
  assert.ok(fs.statSync(out).size >= fs.statSync(FULL_SRC).size);
  rm(d);
});

test("template đầy đủ CÓ sẵn các cột tự động hoá (Kênh BKT, Tạo profile...)", async () => {
  const header = (await cfgRows("fullsheet"))[1].map(String).map((x) => x.trim().toLowerCase());
  assert.ok(header.includes("kênh bkt"), "có cột Kênh BKT");
  assert.ok(header.includes("tạo profile"), "có cột Tạo profile");
  assert.ok(header.includes("tạo channel"), "có cột Tạo channel");
});
