import test from "node:test";
import assert from "node:assert/strict";
import { lastScheduledSlot, slotToIso } from "../sheet/schedule-slots.js";
import { buildScheduleDays } from "../sheet/youtube-automation.js";

// Ngày kênh "lên lịch tới" = ngày + giờ của video CUỐI CÙNG thực sự được lên lịch (không phải số ngày người dùng nhập:
// kênh chỉ có 5 video nháp mà chọn 3 ngày x 3 khung giờ thì chỉ lên lịch 5 lượt, tới giữa ngày thứ 2).

const DAYS = ["11/21/2026", "11/22/2026", "11/23/2026"]; // dạng MM/DD/YYYY như buildScheduleDays
const SLOTS = ["8:00 AM", "12:00 PM", "6:00 PM"];        // dạng ô giờ của Studio

test("slotToIso: ghép ngày MM/DD/YYYY và giờ Studio thành mốc ISO địa phương", () => {
  assert.equal(slotToIso("11/21/2026", "8:00 AM"), "2026-11-21T08:00:00");
  assert.equal(slotToIso("11/21/2026", "12:00 PM"), "2026-11-21T12:00:00", "12 PM là giữa trưa");
  assert.equal(slotToIso("11/21/2026", "12:00 AM"), "2026-11-21T00:00:00", "12 AM là nửa đêm");
  assert.equal(slotToIso("01/05/2027", "6:30 PM"), "2027-01-05T18:30:00");
  assert.equal(slotToIso("rác", "8:00 AM"), null);
  assert.equal(slotToIso("11/21/2026", "rác"), null);
});

test("lastScheduledSlot: đủ video thì tới ngày cuối, khung giờ cuối", () => {
  assert.deepEqual(lastScheduledSlot({ days: DAYS, timeSlots: SLOTS, count: 9 }), { day: "11/23/2026", time: "6:00 PM", iso: "2026-11-23T18:00:00" });
});

test("lastScheduledSlot: thiếu video thì dừng ở lượt thật sự được lên lịch, không phải theo số ngày đã chọn", () => {
  // 5 lượt = ngày 1 (3 khung) + ngày 2 (2 khung đầu)
  assert.deepEqual(lastScheduledSlot({ days: DAYS, timeSlots: SLOTS, count: 5 }), { day: "11/22/2026", time: "12:00 PM", iso: "2026-11-22T12:00:00" });
  assert.equal(lastScheduledSlot({ days: DAYS, timeSlots: SLOTS, count: 1 }).iso, "2026-11-21T08:00:00");
  assert.equal(lastScheduledSlot({ days: DAYS, timeSlots: SLOTS, count: 3 }).iso, "2026-11-21T18:00:00", "đúng hết ngày 1");
  assert.equal(lastScheduledSlot({ days: DAYS, timeSlots: SLOTS, count: 4 }).iso, "2026-11-22T08:00:00", "sang ngày 2");
});

test("lastScheduledSlot: không lên lịch được video nào thì null (không bịa ngày)", () => {
  assert.equal(lastScheduledSlot({ days: DAYS, timeSlots: SLOTS, count: 0 }), null);
  assert.equal(lastScheduledSlot({ days: DAYS, timeSlots: [], count: 3 }), null);
  assert.equal(lastScheduledSlot({ days: [], timeSlots: SLOTS, count: 3 }), null);
  assert.equal(lastScheduledSlot({ days: DAYS, timeSlots: SLOTS }), null);
  assert.equal(lastScheduledSlot({ days: DAYS, timeSlots: SLOTS, count: -2 }), null);
});

test("lastScheduledSlot: count lớn hơn số lượt có thì kẹp ở lượt cuối (không đọc ngoài mảng)", () => {
  assert.equal(lastScheduledSlot({ days: DAYS, timeSlots: SLOTS, count: 99 }).iso, "2026-11-23T18:00:00");
});

test("ghép với buildScheduleDays thật: lên lịch từ ngày kế tiếp của startDate", () => {
  const days = buildScheduleDays(3, "2026-11-20"); // 21, 22, 23/11
  assert.deepEqual(days, ["11/21/2026", "11/22/2026", "11/23/2026"]);
  assert.equal(lastScheduledSlot({ days, timeSlots: ["8:00 AM", "6:00 PM"], count: 6 }).iso, "2026-11-23T18:00:00");
  assert.equal(lastScheduledSlot({ days, timeSlots: ["8:00 AM", "6:00 PM"], count: 3 }).iso, "2026-11-22T08:00:00");
});

import { channelResultEvent } from "../sheet/task-monitor.js";

test("channelResultEvent: kênh lên lịch xong kèm scheduledUntil; giá trị rác thì bỏ", () => {
  const ok = channelResultEvent("automation:schedule", { name: "K1" }, { status: "ok", message: "lên lịch 6 video", scheduledUntil: "2026-11-23T18:00:00" });
  assert.equal(ok.scheduledUntil, "2026-11-23T18:00:00");
  assert.match(ok.message, /K1 xong · lên lịch 6 video/);
  assert.equal(channelResultEvent("automation:schedule", { name: "K1" }, { status: "ok", message: "x", scheduledUntil: "rác" }).scheduledUntil, null);
  assert.equal(channelResultEvent("automation:change-thumb", { name: "K1" }, { status: "ok", message: "" }).scheduledUntil, null);
  assert.equal("scheduledUntil" in channelResultEvent("automation:schedule", { name: "K1" }, { status: "error", message: "lỗi" }), false);
});
