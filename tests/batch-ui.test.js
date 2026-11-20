import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

// batch-ui.js là script thường (gắn vào window). Nạp nó vào một "window" giả chỉ để lấy các hàm thuần.
function load() {
  const window = { electronAPI: {} };
  const ctx = vm.createContext({ window, document: { createElement() { throw new Error("không dùng DOM trong test này"); } }, localStorage: { getItem() { return null; }, setItem() {} }, console });
  vm.runInContext(fs.readFileSync(new URL("../batch-ui.js", import.meta.url), "utf8"), ctx);
  return window.BatchUI;
}
const { scheduleStatus, renderDue, sortChannels } = load();
const NOW = Date.parse("2026-06-15T12:00:00Z");
const at = (days) => new Date(NOW + days * 86400000).toISOString();

test("scheduleStatus: hết lịch, sắp hết theo ngưỡng của mẻ, còn nhiều, chưa có lịch", () => {
  assert.equal(scheduleStatus(at(-0.5), 1, NOW).key, "out");
  assert.equal(scheduleStatus(at(0), 1, NOW).key, "out", "đúng lúc hết cũng là hết");
  assert.equal(scheduleStatus(at(0.5), 1, NOW).key, "soon");
  assert.equal(scheduleStatus(at(1), 1, NOW).key, "soon", "đúng bằng ngưỡng thì báo");
  assert.equal(scheduleStatus(at(1.01), 1, NOW).key, "ok");
  assert.equal(scheduleStatus(at(5), 5, NOW).key, "soon", "ngưỡng 5 ngày nâng mức báo");
  assert.equal(scheduleStatus(at(5), 2, NOW).key, "ok");
  for (const bad of [null, undefined, "", "rác"]) assert.equal(scheduleStatus(bad, 1, NOW).key, "none");
});

test("scheduleStatus: ngưỡng 0 chỉ báo khi đã hết; ngưỡng rác coi như 0", () => {
  assert.equal(scheduleStatus(at(0.2), 0, NOW).key, "ok");
  assert.equal(scheduleStatus(at(0.2), "rác", NOW).key, "ok");
  assert.equal(scheduleStatus(at(-1), 0, NOW).key, "out");
});

test("scheduleStatus: nhãn có ngày còn lại làm tròn lên", () => {
  assert.match(scheduleStatus(at(2.2), 1, NOW).label, /còn 3 ngày/);
  assert.match(scheduleStatus(at(-1), 1, NOW).label, /đã hết lịch/);
  assert.equal(scheduleStatus(null, 1, NOW).label, "Chưa có lịch");
});

test("renderDue: chưa render lần nào thì null; tới hạn theo chu kỳ", () => {
  assert.equal(renderDue(null, 19, NOW), null);
  assert.equal(renderDue("rác", 19, NOW), null);
  const d = renderDue(at(-10), 19, NOW);
  assert.equal(d.daysLeft, 9); assert.equal(d.overdue, false);
  const o = renderDue(at(-20), 19, NOW);
  assert.equal(o.overdue, true); assert.ok(o.daysLeft <= 0);
  assert.equal(renderDue(at(-1), 0, NOW).daysLeft, 0, "chu kỳ 0 coi là 1 ngày, không chia ra số lạ");
});

test("sortChannels: hết lịch trước, rồi sắp hết, rồi còn nhiều, chưa có lịch sau cùng; cùng mức thì ngày ít hơn trước", () => {
  const ch = [
    { name: "D", scheduledUntil: at(9) }, { name: "B", scheduledUntil: at(0.5) }, { name: "none", scheduledUntil: null },
    { name: "A", scheduledUntil: at(-2) }, { name: "C", scheduledUntil: at(4) }, { name: "B2", scheduledUntil: at(0.2) },
  ];
  assert.deepEqual(sortChannels(ch, 1, NOW).map((x) => x.c.name), ["A", "B2", "B", "C", "D", "none"]);
});

test("sortChannels: danh sách rỗng/không phải mảng không làm hỏng; không sửa mảng gốc", () => {
  // Mảng sinh ra trong vm là của "realm" khác nên so qua JSON (nội dung), không so prototype.
  assert.equal(JSON.stringify(sortChannels(null, 1, NOW)), "[]");
  assert.equal(JSON.stringify(sortChannels([], 1, NOW)), "[]");
  const ch = [{ name: "b", scheduledUntil: at(5) }, { name: "a", scheduledUntil: at(1) }];
  const before = JSON.stringify(ch); sortChannels(ch, 1, NOW);
  assert.equal(JSON.stringify(ch), before);
});
