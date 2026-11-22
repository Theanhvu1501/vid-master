import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import {
  todayStr, shouldResetQuota, computeRemaining, recordRendered,
  loadState, saveState,
} from "../sheet/runner-state.js";

test("todayStr formats local date as YYYY-MM-DD", () => {
  const d = new Date(2026, 6, 7, 15, 30); // 2026-07-07 local
  assert.equal(todayStr(d), "2026-07-07");
});

test("shouldResetQuota true when no state or different day", () => {
  assert.equal(shouldResetQuota(undefined, "2026-07-07"), true);
  assert.equal(shouldResetQuota({ lastRunDate: "2026-07-06", countToday: 3 }, "2026-07-07"), true);
  assert.equal(shouldResetQuota({ lastRunDate: "2026-07-07", countToday: 3 }, "2026-07-07"), false);
});

test("computeRemaining resets on new day, clamps at 0", () => {
  assert.equal(computeRemaining(undefined, 3, "2026-07-07"), 3);
  assert.equal(computeRemaining({ lastRunDate: "2026-07-06", countToday: 5 }, 3, "2026-07-07"), 3);
  assert.equal(computeRemaining({ lastRunDate: "2026-07-07", countToday: 2 }, 3, "2026-07-07"), 1);
  assert.equal(computeRemaining({ lastRunDate: "2026-07-07", countToday: 5 }, 3, "2026-07-07"), 0);
});

test("recordRendered resets on new day then increments", () => {
  const state = { "Kênh A": { lastRunDate: "2026-07-06", countToday: 5 } };
  recordRendered(state, "Kênh A", "2026-07-07");
  assert.deepEqual(state["Kênh A"], { lastRunDate: "2026-07-07", countToday: 1 });
  recordRendered(state, "Kênh A", "2026-07-07");
  assert.equal(state["Kênh A"].countToday, 2);
  recordRendered(state, "Kênh B", "2026-07-07");
  assert.deepEqual(state["Kênh B"], { lastRunDate: "2026-07-07", countToday: 1 });
});

test("loadState returns {} when missing or corrupt, saveState round-trips", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rs-"));
  const p = path.join(dir, "runner-state.json");
  assert.deepEqual(loadState(p), {});
  fs.writeFileSync(p, "{ not json");
  assert.deepEqual(loadState(p), {});
  const state = { "Kênh A": { lastRunDate: "2026-07-07", countToday: 2 } };
  saveState(p, state);
  assert.deepEqual(loadState(p), state);
});

import { countRenderedToday, remainingFrom, todayStr as _today } from "../sheet/runner-state.js";
test("countRenderedToday: chỉ đếm video có mốc render thuộc hôm nay; không mốc/hôm qua thì không đếm", () => {
  const now = new Date(2026, 10, 22, 15, 0), today = _today(now);
  const at = (d, h) => new Date(2026, 10, d, h, 0).getTime();
  const rows = [{ renderedAt: at(22, 1) }, { renderedAt: at(22, 14) }, { renderedAt: at(21, 23) }, { renderedAt: 0 }, {}, null, { renderedAt: "x" }];
  assert.equal(countRenderedToday(rows, today), 2);
  assert.equal(countRenderedToday(null, today), 0); assert.equal(countRenderedToday([], today), 0);
});
test("countRenderedToday: ranh giới ngày theo giờ máy (00:00 tính hôm nay, 23:59 hôm trước thì không)", () => {
  const today = _today(new Date(2026, 10, 22, 12, 0));
  assert.equal(countRenderedToday([{ renderedAt: new Date(2026, 10, 22, 0, 0, 0).getTime() }], today), 1);
  assert.equal(countRenderedToday([{ renderedAt: new Date(2026, 10, 21, 23, 59, 59).getTime() }], today), 0);
});
test("remainingFrom: không âm, kẹp đầu vào rác", () => {
  assert.equal(remainingFrom(3, 7), 4); assert.equal(remainingFrom(10, 7), 0); assert.equal(remainingFrom(0, "7"), 7);
  assert.equal(remainingFrom("x", 7), 7); assert.equal(remainingFrom(-4, 7), 7); assert.equal(remainingFrom(2, "abc"), 0);
});
