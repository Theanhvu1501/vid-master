import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import XLSX from "xlsx";
import {
  generateTOTP, buildScheduleDays, appendRowsToExcel,
} from "../sheet/youtube-automation.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "yt-auto-"));

test("generateTOTP khớp vector RFC 6238 (t=59 -> 287082)", () => {
  assert.equal(generateTOTP("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59_000), "287082");
});

test("generateTOTP chấp nhận secret có khoảng trắng và chữ thường", () => {
  assert.equal(generateTOTP("gezd gnbv gy3t qojq gezd gnbv gy3t qojq", 59_000), "287082");
});

test("generateTOTP báo lỗi khi secret rỗng", () => {
  assert.throws(() => generateTOTP("   "), /2FA/);
});

test("buildScheduleDays: tính từ ngày kế tiếp của startDate, định dạng MM/DD/YYYY", () => {
  assert.deepEqual(buildScheduleDays(3, "2026_04_04"), ["04/05/2026", "04/06/2026", "04/07/2026"]);
  assert.deepEqual(buildScheduleDays(2, "20260404"), ["04/05/2026", "04/06/2026"]);
});

test("buildScheduleDays: qua cuối tháng và cuối năm", () => {
  assert.deepEqual(buildScheduleDays(2, "2026-12-31"), ["01/01/2027", "01/02/2027"]);
});

test("buildScheduleDays: startDate rỗng thì tính từ hôm nay", () => {
  assert.deepEqual(buildScheduleDays(1, "", new Date(2026, 0, 31)), ["02/01/2026"]);
});

test("appendRowsToExcel: tạo file mới rồi ghi nối, không mất dòng cũ", () => {
  const dir = tmp();
  const file = path.join(dir, "links.xlsx");
  appendRowsToExcel(file, [["https://youtu.be/a", "P1", "video 1"]]);
  appendRowsToExcel(file, [["https://youtu.be/b", "P2", "video 2"], ["https://youtu.be/c", "P2", "video 3"]]);

  const wb = XLSX.readFile(file);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
  assert.equal(rows.length, 3);
  assert.equal(rows[0][0], "https://youtu.be/a");
  assert.equal(rows[2][2], "video 3");
  fs.rmSync(dir, { recursive: true, force: true });
});
