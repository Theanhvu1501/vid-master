import test from "node:test";
import assert from "node:assert/strict";
import { runSchedule } from "../sheet/youtube-automation.js";

// runSchedule phải đổi "Giờ đăng" sang dạng ô giờ của Studio TRƯỚC khi mở bất kỳ profile nào.
// Giờ sai phải làm cả lượt dừng ngay (không mở trình duyệt, không đăng nửa chừng).

test("runSchedule: giờ không đọc được thì ném lỗi trước khi mở profile", async () => {
  await assert.rejects(
    runSchedule({ gpmHost: "127.0.0.1:1", profiles: [{ id: "a", name: "A" }], postTimes: "8:00, 25:99", numDays: 1, onLog: () => {} }),
    /giờ đăng không đọc được.*25:99/,
  );
});

test("runSchedule: không chọn kênh nào thì báo lỗi", async () => {
  await assert.rejects(runSchedule({ gpmHost: "x", profiles: [], postTimes: "8:00", onLog: () => {} }), /Chưa chọn/);
});

test("runSchedule: giờ riêng của kênh thắng giờ chung; giờ sai của một kênh cũng dừng cả lượt", async () => {
  await assert.rejects(
    runSchedule({
      gpmHost: "127.0.0.1:1", postTimes: "8:00",
      profiles: [{ id: "a", name: "A" }, { id: "b", name: "B", postTimes: "xyz" }], numDays: 1, onLog: () => {},
    }),
    /"xyz"/,
  );
});
