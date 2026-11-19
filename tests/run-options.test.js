import test from "node:test";
import assert from "node:assert/strict";
import { normalizeStartDate, resolveThumbRun, resolveScheduleRun } from "../sheet/run-options.js";

const TODAY = new Date(2026, 3, 10); // 10/04/2026
const P = (...pairs) => pairs.map(([id, name, label]) => ({ id, name, ...(label ? { label } : {}) }));
const dirOk = () => true;
const imgs = () => 3;

// ---------- normalizeStartDate ----------
test("normalizeStartDate: nhận ô chọn ngày 2026-04-12, 2026_04_12, 20260412, 2026/04/12", () => {
  for (const v of ["2026-04-12", "2026_04_12", "20260412", "2026/04/12", " 2026.04.12 "]) {
    assert.deepEqual(normalizeStartDate(v, TODAY), { value: "20260412" }, v);
  }
});
test("normalizeStartDate: trống = hôm nay", () => {
  assert.deepEqual(normalizeStartDate("", TODAY), { value: "" });
  assert.deepEqual(normalizeStartDate(undefined, TODAY), { value: "" });
});
test("normalizeStartDate: dạng ngày/tháng/năm bị từ chối thay vì đoán", () => {
  assert.match(normalizeStartDate("12/04/2026", TODAY).error, /không hợp lệ/);
  assert.match(normalizeStartDate("abc", TODAY).error, /không hợp lệ/);
  assert.match(normalizeStartDate("2026412", TODAY).error, /không hợp lệ/, "7 chữ số liền không đoán được");
});
test("normalizeStartDate: ngày không có thật bị từ chối (không lăn sang tháng sau)", () => {
  assert.match(normalizeStartDate("2026-02-30", TODAY).error, /không có thật/);
  assert.match(normalizeStartDate("2026-13-01", TODAY).error, /không có thật/);
});
test("normalizeStartDate: ngày đã qua bị từ chối, hôm nay thì được", () => {
  assert.match(normalizeStartDate("2026-04-09", TODAY).error, /đã qua/);
  assert.deepEqual(normalizeStartDate("2026-04-10", TODAY), { value: "20260410" });
});

// ---------- resolveThumbRun: ghép theo PROFILE ID ----------
test("thumb: mỗi profile lấy đúng thư mục riêng theo ID; profile không có riêng dùng thư mục chung", () => {
  const r = resolveThumbRun({
    profiles: P(["id-a", "A"], ["id-b", "B"]),
    folders: { "id-a": "D:\\rieng-a" }, defaultFolder: "D:\\chung", numVideos: 5, isDirectory: dirOk, images: imgs,
  });
  assert.deepEqual(r.profiles.map((p) => [p.id, p.thumbFolder, p.numVideos]), [["id-a", "D:\\rieng-a", 5], ["id-b", "D:\\chung", 5]]);
  assert.equal(r.skipped.length, 0);
});

test("thumb: HAI PROFILE TRÙNG TÊN vẫn nhận đúng thư mục riêng của từng cái (ghép theo ID, không theo tên)", () => {
  const r = resolveThumbRun({
    profiles: P(["id-1", "LINE_01", "LINE_01 #id-1"], ["id-2", "LINE_01", "LINE_01 #id-2"]),
    folders: { "id-1": "D:\\kenh-mot", "id-2": "D:\\kenh-hai" }, defaultFolder: "", numVideos: 8, isDirectory: dirOk, images: imgs,
  });
  assert.deepEqual(r.profiles.map((p) => [p.id, p.thumbFolder]), [["id-1", "D:\\kenh-mot"], ["id-2", "D:\\kenh-hai"]]);
  assert.deepEqual(r.profiles.map((p) => p.label), ["LINE_01 #id-1", "LINE_01 #id-2"]);
});

test("thumb: thư mục riêng của profile KHÁC (không được chọn) bị bỏ qua, không rò sang profile đang chạy", () => {
  const r = resolveThumbRun({ profiles: P(["id-a", "A"]), folders: { "id-z": "D:\\cua-z" }, defaultFolder: "D:\\chung", isDirectory: dirOk, images: imgs });
  assert.equal(r.profiles[0].thumbFolder, "D:\\chung");
});

test("thumb: thiếu thư mục (cả riêng lẫn chung) -> chỉ profile đó bị loại, có lý do", () => {
  const r = resolveThumbRun({ profiles: P(["id-a", "A"], ["id-b", "B"]), folders: { "id-a": "D:\\a" }, defaultFolder: "", isDirectory: dirOk, images: imgs });
  assert.deepEqual(r.profiles.map((p) => p.id), ["id-a"]);
  assert.match(r.skipped[0].reason, /chưa có thư mục thumbnail/);
  assert.equal(r.skipped[0].id, "id-b");
});

test("thumb: thư mục không tồn tại hoặc không có ảnh -> loại kèm đường dẫn, profile khác vẫn chạy", () => {
  const r = resolveThumbRun({
    profiles: P(["id-a", "A"], ["id-b", "B"], ["id-c", "C"]),
    folders: { "id-a": "D:\\khong-co", "id-b": "D:\\rong", "id-c": "D:\\ok" }, numVideos: 8,
    isDirectory: (p) => p !== "D:\\khong-co", images: (p) => (p === "D:\\rong" ? 0 : 4),
  });
  assert.deepEqual(r.profiles.map((p) => p.id), ["id-c"]);
  const why = Object.fromEntries(r.skipped.map((s) => [s.id, s.reason]));
  assert.match(why["id-a"], /không thấy thư mục thumbnail: D:\\khong-co/);
  assert.match(why["id-b"], /không có ảnh/);
});

test("thumb: số video mặc định 8; sai thì báo lỗi cả lượt (không đổi âm thầm)", () => {
  assert.equal(resolveThumbRun({ profiles: P(["i", "A"]), defaultFolder: "D:\\x", isDirectory: dirOk, images: imgs }).profiles[0].numVideos, 8);
  for (const bad of ["0", "201", "abc", "-3", "2.5"]) {
    const r = resolveThumbRun({ profiles: P(["i", "A"]), defaultFolder: "D:\\x", numVideos: bad, isDirectory: dirOk, images: imgs });
    assert.match(r.error, /Số video/, bad);
    assert.equal(r.profiles.length, 0);
  }
});

test("thumb: khoá kỳ lạ trong folders (__proto__, constructor) không rò sang profile bình thường", () => {
  const folders = JSON.parse(String.raw`{"__proto__": "D:/xau", "constructor": "D:/xau2", "id-a": "D:/a"}`);
  const r = resolveThumbRun({ profiles: P(["id-a", "A"], ["id-b", "B"], ["toString", "C"]), folders, defaultFolder: "D:/chung", isDirectory: dirOk, images: imgs });
  const by = Object.fromEntries(r.profiles.map((p) => [p.id, p.thumbFolder]));
  assert.equal(by["id-a"], "D:/a");
  assert.equal(by["id-b"], "D:/chung", "profile thường KHÔNG được nhận thư mục của khoá __proto__");
  assert.equal(by["toString"], "D:/chung", "tên trùng thuộc tính của Object cũng không bị nhầm là có thư mục riêng");
  assert.equal({}.polluted, undefined, "không làm ô nhiễm Object.prototype");
});

// ---------- resolveScheduleRun ----------
test("lịch: giờ + số ngày + ngày bắt đầu hợp lệ -> danh sách ngày, giờ kiểu Studio, số video cần có", () => {
  const r = resolveScheduleRun({ profiles: P(["a", "A"], ["b", "B"]), postTimes: "8:00, 18:30", numDays: 3, startDate: "2026-04-12", today: TODAY });
  assert.deepEqual(r.days, ["04/13/2026", "04/14/2026", "04/15/2026"], "tính từ ngày KẾ TIẾP của ngày bắt đầu");
  assert.deepEqual(r.studioTimes, ["8:00 AM", "6:30 PM"]);
  assert.equal(r.videosPerProfile, 6);
  assert.deepEqual(r.options, { postTimes: "8:00, 18:30", numDays: 3, startDate: "20260412" });
  assert.deepEqual(r.profiles.map((p) => p.id), ["a", "b"]);
});

test("lịch: ngày bắt đầu trống = hôm nay (bắt đầu đặt từ ngày mai)", () => {
  const r = resolveScheduleRun({ profiles: P(["a", "A"]), postTimes: "8:00", numDays: 2, startDate: "", today: TODAY });
  assert.deepEqual(r.days, ["04/11/2026", "04/12/2026"]);
  assert.equal(r.options.startDate, undefined);
});

test("lịch: nhận giờ AM/PM và dấu chấm phẩy", () => {
  const r = resolveScheduleRun({ profiles: P(["a", "A"]), postTimes: "8:00 AM; 6:30 PM", numDays: 1, today: TODAY });
  assert.deepEqual(r.studioTimes, ["8:00 AM", "6:30 PM"]);
});

test("lịch: giờ trống/sai, số ngày sai, ngày sai đều báo lỗi cả lượt và nói rõ giá trị nào", () => {
  const base = { profiles: P(["a", "A"]), today: TODAY };
  assert.match(resolveScheduleRun({ ...base, postTimes: "", numDays: 1 }).error, /Chưa nhập giờ đăng/);
  assert.match(resolveScheduleRun({ ...base, postTimes: "8:00, 25:99", numDays: 1 }).error, /"25:99"/);
  assert.match(resolveScheduleRun({ ...base, postTimes: "8:00", numDays: 0 }).error, /Số ngày/);
  assert.match(resolveScheduleRun({ ...base, postTimes: "8:00", numDays: 61 }).error, /từ 1 đến 60/);
  assert.match(resolveScheduleRun({ ...base, postTimes: "8:00", numDays: 1, startDate: "2026-04-01" }).error, /đã qua/);
  assert.match(resolveScheduleRun({ ...base, postTimes: "8:00", numDays: 1, startDate: "12/04/2026" }).error, /không hợp lệ/);
});

test("lịch: label của profile trùng tên được giữ để log phân biệt được", () => {
  const r = resolveScheduleRun({ profiles: P(["i1", "LINE_01", "LINE_01 #i1"], ["i2", "LINE_01", "LINE_01 #i2"]), postTimes: "8:00", numDays: 1, today: TODAY });
  assert.deepEqual(r.profiles.map((p) => p.label), ["LINE_01 #i1", "LINE_01 #i2"]);
});
