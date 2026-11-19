import test from "node:test";
import assert from "node:assert/strict";
import { clickNextUntil, maxNextClicks, walkError } from "../sheet/studio-wizard.js";

// Hộp thoại giả: danh sách tên bước; mỗi lần bấm Next thì sang bước kế. `lockedAt` = chỉ số bước mà Next bị khoá.
function wizard(stepNames, { lockedAt = -1, lockedForPolls = Infinity, noNextAt = -1 } = {}) {
  let i = 0, polls = 0, clicks = 0;
  const io = {
    click: async () => { clicks++; i = Math.min(i + 1, stepNames.length - 1); polls = 0; },
    visible: async () => i !== noNextAt && i < stepNames.length - 1,
    enabled: async () => { if (i !== lockedAt) return true; polls++; return polls > lockedForPolls; },
    step: async () => stepNames[i],
    wait: async () => {},
  };
  return { io, at: () => stepNames[i], get clicks() { return clicks; } };
}
const NORMAL = ["Chi tiết", "Yếu tố video", "Kiểm tra", "Chế độ hiển thị"];
const BKT = ["Chi tiết", "Kiếm tiền", "Yếu tố video", "Kiểm tra", "Chế độ hiển thị"];
const toVisibility = (w) => async () => w.at() === "Chế độ hiển thị";

test("kênh thường: tới Chế độ hiển thị sau đúng 3 lần Next", async () => {
  const w = wizard(NORMAL);
  const r = await clickNextUntil(w.io, { isTarget: toVisibility(w), maxSteps: maxNextClicks({ monetized: false }) });
  assert.equal(r.reached, true);
  assert.equal(r.clicks, 3);
  assert.deepEqual(r.steps, ["Chi tiết", "Yếu tố video", "Kiểm tra"]);
});

test("kênh BKT có thêm bước Kiếm tiền: vẫn tới được, tốn 4 lần Next (cùng logic, không đếm cứng)", async () => {
  const w = wizard(BKT);
  const r = await clickNextUntil(w.io, { isTarget: toVisibility(w), maxSteps: maxNextClicks({ monetized: true }) });
  assert.equal(r.reached, true);
  assert.equal(r.clicks, 4);
  assert.deepEqual(r.steps, ["Chi tiết", "Kiếm tiền", "Yếu tố video", "Kiểm tra"]);
});

test("lỗi cũ tái hiện: bấm CỨNG 3 lần Next trên kênh BKT thì KẸT ở bước Kiếm tiền/Yếu tố, không tới được đích", () => {
  const steps = BKT; let i = 0;
  for (let n = 0; n < 3; n++) i = Math.min(i + 1, steps.length - 1);
  assert.notEqual(steps[i], "Chế độ hiển thị", "đây chính là lỗi người dùng gặp");
});

test("đã ở sẵn bước đích thì không bấm gì", async () => {
  const w = wizard(NORMAL);
  const r = await clickNextUntil(w.io, { isTarget: async () => true });
  assert.deepEqual([r.reached, r.clicks], [true, 0]);
  assert.equal(w.clicks, 0);
});

test("trần số lần bấm: kênh thường không bấm quá 5, và báo rõ các bước đã qua (không lặp vô hạn)", async () => {
  const w = wizard(Array.from({ length: 30 }, (_, k) => `Bước ${k}`));
  const logs = [];
  const r = await clickNextUntil(w.io, { isTarget: async () => false, maxSteps: maxNextClicks({ monetized: false }), log: (m) => logs.push(m), label: "đích" });
  assert.deepEqual([r.reached, r.clicks, r.reason], [false, 5, "max"]);
  assert.match(logs.join("\n"), /đã bấm Next 5 lần/);
  assert.match(logs.join("\n"), /Bước 0 → Bước 1/);
});

test("kênh BKT được phép nhiều bước hơn kênh thường", () => {
  assert.ok(maxNextClicks({ monetized: true }) > maxNextClicks({ monetized: false }));
});

test("Next bị khoá ở bước Kiếm tiền: dừng với lý do 'disabled', không treo", async () => {
  const w = wizard(BKT, { lockedAt: 1 });
  const r = await clickNextUntil(w.io, { isTarget: toVisibility(w), maxSteps: 8, enableTries: 3 });
  assert.deepEqual([r.reached, r.reason], [false, "disabled"]);
  assert.deepEqual(r.steps, ["Chi tiết"], "dừng đúng ở bước đang bị khoá, không bấm nữa");
  assert.equal(w.at(), "Kiếm tiền");
});

test("Next khoá ngắn lúc bước vừa tải rồi mở: chờ rồi đi tiếp, không báo nhầm là bị khoá", async () => {
  const w = wizard(BKT, { lockedAt: 1, lockedForPolls: 2 });
  const r = await clickNextUntil(w.io, { isTarget: toVisibility(w), maxSteps: 8, enableTries: 5 });
  assert.equal(r.reached, true);
});

test("hết nút Next trước khi tới đích: dừng với lý do 'no-next'", async () => {
  const w = wizard(NORMAL, { noNextAt: 1 });
  const r = await clickNextUntil(w.io, { isTarget: async () => false, maxSteps: 8 });
  assert.deepEqual([r.reached, r.reason], [false, "no-next"]);
});

test("không đọc được tên bước thì vẫn đi tiếp và ghi 'bước N'", async () => {
  const w = wizard(NORMAL);
  w.io.step = async () => { throw new Error("không đọc được"); };
  const r = await clickNextUntil(w.io, { isTarget: toVisibility(w), maxSteps: 8 });
  assert.equal(r.reached, true);
  assert.deepEqual(r.steps, ["bước 1", "bước 2", "bước 3"]);
});

test("walkError: nội dung hướng dẫn khác nhau giữa kênh thường và kênh BKT", () => {
  const res = { reached: false, clicks: 2, steps: ["Chi tiết", "Kiếm tiền"], reason: "disabled" };
  const bkt = walkError(res, "bước Hiển thị", { monetized: true });
  const normal = walkError(res, "bước Hiển thị", { monetized: false });
  assert.match(bkt, /Kiếm tiền/);
  assert.match(bkt, /bảng đánh giá/);
  assert.match(normal, /Kênh BKT/, "kênh thường bị khoá thì gợi ý bật cờ Kênh BKT trong Sheet");
  assert.match(walkError({ ...res, reason: "max" }, "nút Xong", { monetized: false }), /bật "Kênh BKT"/);
  assert.match(walkError({ ...res, reason: "no-next" }, "nút Xong", { monetized: true }), /hết nút Next/);
});
