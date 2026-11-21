import test from "node:test";
import assert from "node:assert/strict";
import BA from "../sheet/batch-actions.cjs";
const { ACTIONS, ACTION_IDS, ACTION_LABEL, TASK_KEY, planAction, resultFromAutomation, normalizeOutcome, defaultSettings, mergeSettings } = BA;

const BATCH = { id: 1, name: "Mẻ A", channels: [{ gpmProfileId: "p1", name: "K1" }, { gpmProfileId: "p2", name: "K2" }] };
const EMPTY = { id: 2, name: "Mẻ rỗng", channels: [] };

test("có đúng 3 hành động độc lập: Render, Thay thumbnail, Lên lịch; khóa tác vụ khớp với phía báo web", () => {
  assert.deepEqual(ACTION_IDS, ["render", "thumb", "schedule"]);
  assert.deepEqual(ACTIONS.map((a) => a.label), ["Render", "Thay thumbnail", "Lên lịch"]);
  assert.equal(ACTION_LABEL.thumb, "Thay thumbnail");
  assert.deepEqual(TASK_KEY, { render: "render.js", thumb: "automation:change-thumb", schedule: "automation:schedule" });
  for (const a of ACTIONS) assert.ok(a.hint.length > 10);
});

test("planAction render: không cần kênh, không bắt buộc thư mục (để trống = giữ như tab Render)", () => {
  assert.equal(planAction("render", EMPTY, {}).ok, true);
  assert.equal(planAction("render", BATCH, { overlayFolder: "D:/src", outputFolder: "E:/out" }).ok, true);
  assert.equal(planAction("render", BATCH, undefined).ok, true);
});

test("planAction thumb: cần kênh, cần thư mục ảnh; số video sai thì báo, để trống thì dùng mặc định", () => {
  assert.deepEqual(planAction("thumb", EMPTY, { thumbFolder: "D:/t" }).errors, ["Mẻ chưa có kênh nào. Hãy thêm kênh vào mẻ trước"]);
  assert.ok(planAction("thumb", BATCH, {}).errors.some((e) => /thư mục/i.test(e)));
  assert.equal(planAction("thumb", BATCH, { thumbFolder: "D:/t" }).ok, true);
  for (const bad of ["0", "201", "abc", "-1", "3.5"]) assert.equal(planAction("thumb", BATCH, { thumbFolder: "D:/t", numVideos: bad }).ok, false, bad);
  assert.equal(planAction("thumb", BATCH, { thumbFolder: "D:/t", numVideos: "" }).ok, true);
});

test("planAction schedule: cần kênh và giờ đăng; số ngày 1-60; ngày bắt đầu phải là ngày có thật", () => {
  assert.equal(planAction("schedule", EMPTY, { postTimes: "8:00" }).ok, false);
  assert.ok(planAction("schedule", BATCH, {}).errors.some((e) => /giờ đăng/i.test(e)));
  assert.equal(planAction("schedule", BATCH, { postTimes: "8:00, 18:00", numDays: "3", startDate: "2026-07-09" }).ok, true);
  for (const bad of ["0", "61", "x", "1.5"]) assert.equal(planAction("schedule", BATCH, { postTimes: "8:00", numDays: bad }).ok, false, "ngày " + bad);
  for (const bad of ["2026-02-30", "09/07/2026", "2026-13-01", "hôm nay", "2026-7-9"]) assert.equal(planAction("schedule", BATCH, { postTimes: "8:00", startDate: bad }).ok, false, "bắt đầu " + bad);
  assert.equal(planAction("schedule", BATCH, { postTimes: "8:00", startDate: "" }).ok, true);
  assert.equal(planAction("schedule", BATCH, { postTimes: "8:00", startDate: "2028-02-29" }).ok, true, "năm nhuận");
});

test("planAction: các hành động ĐỘC LẬP — cài đặt của hành động này không ảnh hưởng hành động kia", () => {
  const onlySchedule = { postTimes: "8:00" };                         // thiếu thư mục thumbnail
  assert.equal(planAction("schedule", BATCH, onlySchedule).ok, true);
  assert.equal(planAction("thumb", BATCH, onlySchedule).ok, false);
  assert.equal(planAction("render", BATCH, onlySchedule).ok, true);
});

test("planAction: đầu vào rác không ném lỗi và bị từ chối rõ ràng", () => {
  assert.equal(planAction("khong-co", BATCH, {}).ok, false);
  for (const b of [null, undefined, "x", 5]) assert.equal(planAction("thumb", b, { thumbFolder: "x" }).ok, false);
  assert.equal(planAction("thumb", { channels: [null, {}, { gpmProfileId: "  " }] }, { thumbFolder: "x" }).ok, false, "kênh thiếu Profile ID không tính");
  assert.equal(planAction("thumb", BATCH, "chuỗi").ok, false);
});

test("resultFromAutomation: thành công chỉ khi có kênh chạy xong và không kênh nào lỗi", () => {
  assert.deepEqual(resultFromAutomation({ success: true, total: 3, ok: 3, fail: 0, skipped: 0 }), { ok: true, message: "3/3 kênh xong" });
  const r = resultFromAutomation({ success: true, total: 3, ok: 2, fail: 0, skipped: 1 });
  assert.equal(r.ok, true); assert.match(r.message, /1 bỏ qua/);
});

test("resultFromAutomation: có kênh lỗi / không kênh nào chạy / total 0 đều là thất bại dù success=true", () => {
  const f = resultFromAutomation({ success: true, total: 4, ok: 3, fail: 1, skipped: 0 });
  assert.equal(f.ok, false); assert.match(f.message, /1\/4 kênh lỗi/); assert.match(f.message, /3 kênh xong/);
  assert.equal(resultFromAutomation({ success: true, total: 2, ok: 0, fail: 2 }).ok, false);
  const s = resultFromAutomation({ success: true, total: 3, ok: 0, fail: 0, skipped: 3 }); assert.equal(s.ok, false); assert.match(s.message, /bỏ qua/);
  assert.equal(resultFromAutomation({ success: true, total: 0 }).ok, false);
});

test("resultFromAutomation: success=false lấy lý do từ error; kết quả rác là thất bại", () => {
  assert.deepEqual(resultFromAutomation({ success: false, error: "Đang chạy khác" }), { ok: false, message: "Đang chạy khác" });
  for (const bad of [null, undefined, "ok", 5, {}, { success: "true" }, { success: 1 }]) assert.equal(resultFromAutomation(bad).ok, false, JSON.stringify(bad));
  assert.equal(resultFromAutomation({ success: true, message: "Hoàn tất" }).ok, true);
});

test("normalizeOutcome: success / failed / canceled; thiếu hoặc không rõ thì là failed", () => {
  assert.deepEqual(normalizeOutcome({ ok: true, message: "Xong" }), { status: "success", message: "Xong" });
  assert.deepEqual(normalizeOutcome({ ok: false, message: "GPM tắt" }), { status: "failed", message: "GPM tắt" });
  assert.deepEqual(normalizeOutcome({ ok: false, canceled: true }), { status: "canceled", message: "Đã dừng" });
  for (const bad of [undefined, null, {}, "ok", { ok: "true" }, { ok: 1 }]) assert.equal(normalizeOutcome(bad).status, "failed", JSON.stringify(bad));
  assert.equal(normalizeOutcome({}).message, "Lỗi không rõ");
});

test("defaultSettings / mergeSettings: lấy mặc định từ máy, ghi đè bằng bản đã lưu, bỏ khóa lạ và kiểu sai", () => {
  const d = { overlayFolder: "D:/o", outputFolder: "E:/done", thumbFolder: "D:/t", postTimes: "9:00" };
  const base = defaultSettings(d);
  assert.equal(base.render.overlayFolder, "D:/o"); assert.equal(base.render.backgroundFolder, ""); assert.equal(base.thumb.numVideos, "8"); assert.equal(base.schedule.numDays, "3"); assert.equal(base.schedule.postTimes, "9:00");
  const m = mergeSettings({ render: { outputFolder: "F:/moi", hack: "x" }, thumb: { numVideos: 5 }, schedule: { startDate: "2026-07-09" }, bay: {} }, d);
  assert.equal(m.render.outputFolder, "F:/moi"); assert.ok(!("hack" in m.render), "khóa lạ bị bỏ");
  assert.equal(m.thumb.numVideos, "8", "kiểu sai (số) thì giữ mặc định"); assert.equal(m.schedule.startDate, "2026-07-09"); assert.ok(!("bay" in m));
  for (const bad of [null, undefined, "x", 5, []]) assert.deepEqual(mergeSettings(bad, d), base);
  assert.deepEqual(defaultSettings(null).schedule, { numDays: "3", startDate: "", postTimes: "8:00, 12:00, 18:00" });
});

const { judgeRender } = BA;

test("judgeRender: render chỉ tính là thành công khi thư mục đích có video MỚI (không tin mã thoát 0)", () => {
  assert.deepEqual(judgeRender({ ok: true }, { count: 0, newest: 0 }, { count: 3, newest: 200 }), { ok: true, message: "Render xong, có 3 video mới" });
  assert.equal(judgeRender({ ok: true }, { count: 2, newest: 100 }, { count: 2, newest: 100 }).ok, false, "không có video mới");
  assert.equal(judgeRender({ ok: true }, { count: 0, newest: 0 }, { count: 0, newest: 0 }).ok, false, "thư mục đích trống");
});

test("judgeRender: ghi đè file cũ (số lượng không đổi nhưng mốc sửa đổi mới hơn) vẫn tính là có video mới", () => {
  const r = judgeRender({ ok: true }, { count: 2, newest: 100 }, { count: 2, newest: 500 });
  assert.equal(r.ok, true); assert.match(r.message, /video/);
});

test("judgeRender: render báo lỗi thì giữ nguyên lỗi, không bị thay bằng kết quả đếm file", () => {
  assert.deepEqual(judgeRender({ ok: false, message: "GPU lỗi" }, { count: 0, newest: 0 }, { count: 5, newest: 9 }), { ok: false, message: "GPU lỗi" });
  assert.equal(judgeRender({ ok: false, canceled: true, message: "Đã dừng" }, null, null).canceled, true);
});

test("judgeRender: không đếm được thư mục đích (null) thì KHÔNG coi là thành công, nói rõ lý do", () => {
  for (const [b, a] of [[null, null], [{ count: 0, newest: 0 }, null], [null, { count: 3, newest: 5 }], [undefined, undefined], ["x", 5]]) {
    const r = judgeRender({ ok: true }, b, a); assert.equal(r.ok, false); assert.match(r.message, /thư mục đích|đếm/i);
  }
});

test("judgeRender: kết quả render rác không bao giờ là thành công", () => {
  for (const bad of [null, undefined, {}, "ok", { ok: "true" }]) assert.equal(judgeRender(bad, { count: 0, newest: 0 }, { count: 9, newest: 9 }).ok, false, JSON.stringify(bad));
});
