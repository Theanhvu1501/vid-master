import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import XLSX from "xlsx";
import { readLoginAccounts, readChannelPlans, attachProfileData, countNames } from "../sheet/excel-import.js";

function xlsx(rows) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xl-"));
  const file = path.join(dir, "t.xlsx");
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "S");
  XLSX.writeFile(wb, file);
  return { file, clean: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test("readLoginAccounts: bỏ dòng tiêu đề, đọc đủ 5 cột", () => {
  const t = xlsx([
    ["profile", "gmail", "pass", "recovery", "2fa"],
    ["LINE_01", "a@gmail.com", "pw1", "r@x.com", "ABCD EFGH"],
    ["LINE_02", "b@gmail.com", "pw2", "", ""],
  ]);
  const rows = readLoginAccounts(t.file);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { profileName: "LINE_01", email: "a@gmail.com", password: "pw1", recoveryEmail: "r@x.com", twoFactorSecret: "ABCD EFGH" });
  assert.equal(rows[1].recoveryEmail, "");
  t.clean();
});

test("readChannelPlans: đọc 6 cột theo thứ tự script GPM, bỏ dòng thiếu cột A/tên kênh và dòng tiêu đề", () => {
  const t = xlsx([
    ["Profile ID hoặc tên profile", "Tên kênh", "Mô tả", "Mô tả video", "Tag", "Handle"],   // tiêu đề -> bỏ
    ["LINE_01", "Kênh Một", "mô tả kênh", "mô tả video", "a,b,c", "@kenh1"],
    ["LINE_02", "", "thiếu tên kênh", "", "", ""],                                          // bỏ
    ["", "Kênh mồ côi", "", "", "", ""],                                                   // bỏ: thiếu cột A
    ["LINE_03", "Kênh Ba", "", "", "", ""],
  ]);
  const rows = readChannelPlans(t.file);
  assert.deepEqual(rows.map((r) => r.profileName), ["LINE_01", "LINE_03"]);
  assert.deepEqual(rows[0], { profileName: "LINE_01", title: "Kênh Một", description: "mô tả kênh", videoDescription: "mô tả video", tags: "a,b,c", handle: "@kenh1" });
  t.clean();
});

test("tiêu đề cột A: nhận 'Profile ID...', 'Tên profile...', nhưng profile thật tên 'Profile 01' KHÔNG bị bỏ nhầm", () => {
  const t = xlsx([
    ["Profile ID hoặc tên profile", "Tên kênh"], ["Tên profile (GPM)", "x"], ["profile name", "x"], ["Profile 01", "Kênh A"],
  ]);
  assert.deepEqual(readChannelPlans(t.file).map((r) => r.profileName), ["Profile 01"]);
  t.clean();
});

// ---------- ghép theo Profile ID trước, tên sau ----------
const PROFILES = [
  { id: "aaaa-1111", name: "LINE_01" },
  { id: "bbbb-2222", name: "LINE_02" },
  { id: "cccc-3333", name: "LINE_03" },
];
const COUNTS = countNames(PROFILES);

test("countNames: đếm theo tên không phân biệt hoa thường", () => {
  const c = countNames([{ name: "A" }, { name: "a" }, { name: "B" }]);
  assert.equal(c.get("a"), 2);
  assert.equal(c.get("b"), 1);
});

test("attach: ghép theo PROFILE ID (chắc chắn nhất)", () => {
  const r = attachProfileData(PROFILES, [{ profileName: "bbbb-2222", email: "b@x" }], COUNTS);
  assert.deepEqual(r.matched.map((p) => [p.id, p.by, p.data.email]), [["bbbb-2222", "id", "b@x"]]);
});

test("attach: ID không phân biệt hoa thường và bỏ khoảng trắng thừa", () => {
  const r = attachProfileData(PROFILES, [{ profileName: "  BBBB-2222 ", email: "b@x" }], COUNTS);
  assert.equal(r.matched[0].by, "id");
});

test("attach: không có ID thì ghép theo TÊN khi tên là duy nhất trong GPM", () => {
  const r = attachProfileData(PROFILES, [{ profileName: "line_01", email: "a@x" }], COUNTS);
  assert.deepEqual(r.matched.map((p) => [p.id, p.by]), [["aaaa-1111", "name"]]);
});

test("attach: TÊN TRÙNG trong GPM thì KHÔNG ghép theo tên (khỏi nhầm kênh), báo rõ", () => {
  const all = [{ id: "i1", name: "LINE_01" }, { id: "i2", name: "LINE_01" }];
  const r = attachProfileData(all, [{ profileName: "LINE_01", email: "a@x" }], countNames(all));
  assert.equal(r.matched.length, 0);
  assert.deepEqual(r.duplicated, ["LINE_01", "LINE_01"]);
});

test("attach: TÊN TRÙNG nhưng Excel ghi PROFILE ID thì ghép đúng từng cái", () => {
  const all = [{ id: "i1", name: "LINE_01" }, { id: "i2", name: "LINE_01" }];
  const r = attachProfileData(all, [{ profileName: "i1", email: "một@x" }, { profileName: "i2", email: "hai@x" }], countNames(all));
  assert.deepEqual(r.matched.map((p) => [p.id, p.data.email, p.by]), [["i1", "một@x", "id"], ["i2", "hai@x", "id"]]);
  assert.equal(r.duplicated.length, 0);
});

test("attach: ID thắng tên khi cùng một profile có cả hai dòng", () => {
  const items = [{ profileName: "LINE_01", email: "theo-ten@x" }, { profileName: "aaaa-1111", email: "theo-id@x" }];
  const r = attachProfileData([PROFILES[0]], items, COUNTS);
  assert.equal(r.matched[0].data.email, "theo-id@x");
  assert.equal(r.matched[0].by, "id");
});

test("attach: thiếu dòng -> missing; hai dòng cùng khoá -> ambiguous (không tự chọn)", () => {
  const items = [{ profileName: "LINE_02", email: "1" }, { profileName: "line_02", email: "2" }, { profileName: "cccc-3333", email: "3" }, { profileName: "cccc-3333", email: "4" }];
  const r = attachProfileData(PROFILES, items, COUNTS);
  assert.deepEqual(r.missing, ["LINE_01"]);
  assert.deepEqual(r.ambiguous.sort(), ["LINE_02", "LINE_03"]);
  assert.equal(r.matched.length, 0);
});

test("attach: label (tên + đuôi ID) được dùng để báo, không dùng để ghép", () => {
  const all = [{ id: "i1", name: "LINE_01", label: "LINE_01 #i1" }, { id: "i2", name: "LINE_01", label: "LINE_01 #i2" }];
  const r = attachProfileData(all, [], countNames(all));
  assert.deepEqual(r.duplicated, ["LINE_01 #i1", "LINE_01 #i2"]);
});
