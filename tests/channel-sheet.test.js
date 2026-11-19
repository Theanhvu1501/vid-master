import test from "node:test";
import assert from "node:assert/strict";
import {
  readChannelRows, describeTask, assertTaskColumns, makeStatusWriter, statusText,
  createMissingColumns, parseAccount, flagState, TASKS,
} from "../sheet/channel-sheet.js";
import { splitPostTimes, parsePostTimes, toStudioTime, assignTomorrowSlots } from "../sheet/schedule-slots.js";

const HEAD = ["Tên kênh", "Proxy tải", "GPM Profile ID", "tk", "Tên hiển thị", "Mô tả kênh", "Handle kênh"];
const VALUES = [
  ["nhóm"],                                   // dòng nhóm phía trên, header ở dòng 2
  HEAD,
  ["K1", "1.1.1.1:80:u:SECRETP", "P1", "a@gmail.com|PW1|r@x.com|ABCD", "Kênh Một", "mô tả 1", "@kenh1"],
  ["K2", "", "", "b@gmail.com|PW2", "", "", ""],
  ["", "", "", "", "", "", ""],
];

test("readChannelRows: đọc đúng cột, số dòng 1-based, bỏ dòng trống", () => {
  const { rows } = readChannelRows(VALUES);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].sheetName, "K1");
  assert.equal(rows[0].rowIndex, 3);
  assert.equal(rows[0].gpmProfileId, "P1");
  assert.equal(rows[0].channelTitle, "Kênh Một");
  assert.equal(rows[0].channelHandle, "@kenh1");
  assert.equal(rows[1].gpmProfileId, "");
});

test("readChannelRows: thiếu cột Tên kênh -> báo lỗi", () => {
  assert.throws(() => readChannelRows([["a", "b"], ["1", "2"]]), /Tên kênh/);
});

test("describeTask: nói rõ cột nào có/thiếu và có cột cờ hay chưa", () => {
  const d = describeTask(VALUES, "automation");
  assert.equal(d.ready, true);
  assert.equal(d.hasFlag, false, "Sheet mẫu chưa có cột Tạo profile/Tạo channel");
  assert.ok(d.creatable.includes("Tạo profile") && d.creatable.includes("Tạo channel") && d.creatable.includes("Trạng thái tự động hóa"));
  assert.ok(!d.creatable.includes("Phiên bản Chrome"), "cột tuỳ chọn không tạo giúp");
});

test("describeTask: thiếu cột bắt buộc -> ready=false và liệt kê", () => {
  const d = describeTask([["Tên kênh"], ["K1"]], "automation");
  assert.equal(d.ready, false);
  assert.deepEqual(d.missingRequired, ["GPM Profile ID"]);
  assert.throws(() => assertTaskColumns([["Tên kênh"], ["K1"]], "automation"), /"GPM Profile ID"/);
});

test("describeTask: đã có cột cờ thì hasFlag=true", () => {
  const d = describeTask([["Tên kênh", "GPM Profile ID", "Tạo profile"], ["K1", "", "có"]], "automation");
  assert.equal(d.hasFlag, true);
  assert.ok(!d.creatable.includes("Tạo profile"));
});

test("chỉ còn một chức năng cho Sheet, đọc Tên kênh", () => {
  assert.deepEqual(Object.keys(TASKS), ["automation"]);
  assert.ok(TASKS.automation.reads.some((c) => c.key === "sheetName"));
});

// ---- cờ bật/tắt ----
test("flagState: trống hoặc lạ = off (khác các cột cũ, trống KHÔNG phải bật)", () => {
  for (const v of ["", "  ", undefined, null, "không", "no", "0", "false", "abc"]) assert.equal(flagState(v), "off", String(v));
});
test("flagState: nhận nhiều cách viết 'bật', không phân biệt hoa thường và dấu", () => {
  for (const v of ["có", "Có", "CÓ", "co", "yes", "Y", "1", "x", "TRUE", "bật", "✓"]) assert.equal(flagState(v), "on", v);
});
test("flagState: 'xong' (app tự ghi) = done, không chạy lại", () => {
  for (const v of ["xong", "Xong", "done", "✅ 05/01/2026"]) assert.equal(flagState(v), "done", v);
});
test("readChannelRows: đọc cờ Tạo profile / Tạo channel thành on/off/done", () => {
  const { rows } = readChannelRows([
    ["Tên kênh", "GPM Profile ID", "Tạo profile", "Tạo channel"],
    ["A", "", "có", ""], ["B", "P", "xong", "yes"], ["C", "", "", ""],
  ]);
  assert.deepEqual(rows.map((r) => [r.autoProfile, r.autoChannel]), [["on", "off"], ["done", "on"], ["off", "off"]]);
});

// ---- ghi trạng thái ----
test("statusText: có dấu thời gian, ngắn gọn, cắt dòng thứ hai của lỗi", () => {
  const now = new Date(2026, 0, 5, 9, 7);
  assert.equal(statusText({ status: "ok", message: "đăng nhập" }, now), "✅ 05/01/2026 09:07 · đăng nhập");
  assert.match(statusText({ status: "error", message: "lỗi A\nchi tiết dài" }, now), /^❌ .* · lỗi A$/);
  assert.match(statusText({ status: "skip", message: "thiếu tk" }, now), /^⏭/);
});

test("makeStatusWriter: ghi tuần tự đúng ô; cột chưa có thì bỏ qua không lỗi", async () => {
  const writes = [];
  let active = 0, maxActive = 0;
  const writeCell = async (r, c) => { active++; maxActive = Math.max(maxActive, active); await new Promise((x) => setTimeout(x, 5)); writes.push([r, c]); active--; };
  const w = makeStatusWriter({ writeCell, cols: { autoStatus: 7 }, key: "autoStatus" });
  await Promise.all([w({ rowIndex: 3 }, { status: "ok" }), w({ rowIndex: 4 }, { status: "ok" }), w({ rowIndex: 5 }, { status: "ok" })]);
  assert.deepEqual(writes, [[3, 7], [4, 7], [5, 7]]);
  assert.equal(maxActive, 1, "không ghi chồng nhau");
  const none = makeStatusWriter({ writeCell, cols: {}, key: "autoStatus" });
  await none({ rowIndex: 3 }, { status: "ok" }); // không ném
  assert.equal(writes.length, 3);
});

// ---- tạo cột còn thiếu ----
test("createMissingColumns: thêm vào CUỐI dòng tiêu đề, mở rộng lưới, không đụng cột cũ", async () => {
  const writes = []; let ensured = 0;
  const made = await createMissingColumns({
    readValues: async () => VALUES,
    ensureColumns: async (n) => { ensured = n; },
    writeCell: async (r, c, v) => writes.push([r, c, v]),
  }, "automation");
  assert.ok(made.includes("Tạo profile") && made.includes("Tạo channel") && made.includes("Trạng thái tự động hóa"));
  assert.ok(!made.includes("Tên hiển thị"), "cột đã có không tạo lại");
  assert.equal(writes[0][0], 2, "ghi vào dòng tiêu đề (dòng 2)");
  assert.equal(writes[0][1], 7, "ngay sau cột cuối hiện có");
  assert.deepEqual(writes.map((w) => w[2]), made);
  assert.equal(ensured, 7 + made.length);
});

test("createMissingColumns: đủ cột rồi thì không làm gì", async () => {
  const writes = [];
  const full = ["Tên kênh", "GPM Profile ID", "Tạo profile", "Tạo channel", "tk", "Tên hiển thị", "Mô tả kênh", "Mô tả video", "Tag", "Handle kênh", "Kênh BKT", "Trạng thái tự động hóa"];
  const made = await createMissingColumns({
    readValues: async () => [full, ["K1", "P1", "có"]],
    writeCell: async (...x) => writes.push(x),
  }, "automation");
  assert.deepEqual(made, []);
  assert.equal(writes.length, 0);
});

// ---- Giờ đăng thống nhất ----
test("splitPostTimes: nhận 24h và AM/PM, cả dấu phẩy lẫn chấm phẩy, báo giờ sai", () => {
  assert.deepEqual(splitPostTimes("8:00 AM; 6:30 PM, 12:00 PM, 12:00 AM").times, ["08:00", "18:30", "12:00", "00:00"]);
  assert.deepEqual(splitPostTimes("8:00, 25:00, abc, 13:00 PM"), { times: ["08:00"], invalid: ["25:00", "abc", "13:00 PM"] });
  assert.deepEqual(splitPostTimes("").times, []);
});

test("parsePostTimes cũ vẫn chạy như trước với giờ 24h", () => {
  assert.deepEqual(parsePostTimes("8:00, 18:00"), ["08:00", "18:00"]);
  assert.deepEqual(parsePostTimes("  9:5 , 25:00, 12:30 "), ["12:30"]);
});

test("toStudioTime: đổi sang dạng ô giờ của Studio", () => {
  assert.equal(toStudioTime("08:00"), "8:00 AM");
  assert.equal(toStudioTime("18:30"), "6:30 PM");
  assert.equal(toStudioTime("00:15"), "12:15 AM");
  assert.equal(toStudioTime("12:00"), "12:00 PM");
});

test("assignTomorrowSlots (theo dõi Sheet) nhận cả giờ AM/PM", () => {
  const out = assignTomorrowSlots("8:00 AM, 6:30 PM", [], new Date(2026, 5, 1, 10), 2);
  assert.deepEqual(out, ["2026-06-02T08:00:00", "2026-06-02T18:30:00"]);
});
