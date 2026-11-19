import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { planDistribution, slotsForChannel, listVideos, buildPlan } from "../sheet/distribute.js";

const P = (...n) => n.map((x) => ({ id: `id-${x}`, name: x }));
const V = (n) => Array.from({ length: n }, (_, i) => `v${i + 1}.mp4`);

test("xen kẽ: chia đều, lệch tối đa 1", () => {
  const { channels, leftover } = planDistribution({ videos: V(7), profiles: P("A", "B", "C"), mode: "roundrobin" });
  assert.deepEqual(channels.map((c) => c.videos), [["v1.mp4", "v4.mp4", "v7.mp4"], ["v2.mp4", "v5.mp4"], ["v3.mp4", "v6.mp4"]]);
  assert.equal(leftover.length, 0);
});

test("tuần tự: mỗi kênh một cụm liền nhau, video dư được báo lại", () => {
  const { channels, leftover } = planDistribution({ videos: V(7), profiles: P("A", "B"), mode: "sequential", perChannel: 3 });
  assert.deepEqual(channels[0].videos, ["v1.mp4", "v2.mp4", "v3.mp4"]);
  assert.deepEqual(channels[1].videos, ["v4.mp4", "v5.mp4", "v6.mp4"]);
  assert.deepEqual(leftover, ["v7.mp4"]);
});

test("tuần tự: ít video hơn chỗ -> kênh cuối nhận ít/rỗng, không lỗi", () => {
  const { channels, leftover } = planDistribution({ videos: V(2), profiles: P("A", "B", "C"), mode: "sequential", perChannel: 2 });
  assert.deepEqual(channels.map((c) => c.videos.length), [2, 0, 0]);
  assert.equal(leftover.length, 0);
});

test("ngẫu nhiên: giữ đủ mọi video, không trùng, chia đều; cùng rng ra cùng kết quả", () => {
  let s = 1; const rng = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const a = planDistribution({ videos: V(10), profiles: P("A", "B", "C"), mode: "random", rng });
  const all = a.channels.flatMap((c) => c.videos);
  assert.equal(new Set(all).size, 10);
  assert.deepEqual(a.channels.map((c) => c.videos.length).sort(), [3, 3, 4]);
  s = 1;
  const b = planDistribution({ videos: V(10), profiles: P("A", "B", "C"), mode: "random", rng });
  assert.deepEqual(a, b);
});

test("không sửa mảng video đầu vào", () => {
  const vids = V(5); const copy = [...vids];
  planDistribution({ videos: vids, profiles: P("A", "B"), mode: "random" });
  assert.deepEqual(vids, copy);
});

test("đầu vào sai bị từ chối", () => {
  assert.throws(() => planDistribution({ videos: V(2), profiles: [], mode: "roundrobin" }), /profile/);
  assert.throws(() => planDistribution({ videos: [], profiles: P("A"), mode: "roundrobin" }), /video/);
  assert.throws(() => planDistribution({ videos: V(2), profiles: P("A"), mode: "lung tung" }), /không hợp lệ/);
});

test("slotsForChannel: 3 giờ/ngày, 7 video -> 3 ngày kế tiếp, qua cuối tháng", () => {
  const s = slotsForChannel(7, "8:00, 12:00, 18:30", new Date(2026, 0, 30));
  assert.deepEqual(s, [
    "2026-01-31T08:00:00", "2026-01-31T12:00:00", "2026-01-31T18:30:00",
    "2026-02-01T08:00:00", "2026-02-01T12:00:00", "2026-02-01T18:30:00",
    "2026-02-02T08:00:00",
  ]);
});

test("slotsForChannel: giờ trống hoặc có giờ sai thì báo lỗi, không bỏ giờ sai trong im lặng", () => {
  assert.throws(() => slotsForChannel(2, "", new Date()), /chưa có giờ đăng/);
  assert.throws(() => slotsForChannel(2, "8:00, 25:99", new Date()), /không đọc được.*25:99/);
});

test("slotsForChannel: nhận giờ AM/PM, dấu ; lẫn dấu phẩy", () => {
  const s = slotsForChannel(3, "8:00 AM; 6:30 PM, 12:00 PM", new Date(2026, 5, 1));
  assert.deepEqual(s, ["2026-06-02T08:00:00", "2026-06-02T18:30:00", "2026-06-02T12:00:00"]);
});

test("listVideos chỉ lấy đuôi video, sắp theo số tự nhiên", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dist-"));
  for (const f of ["10.mp4", "2.mp4", "a.jpg", "b.txt", "1.MOV"]) fs.writeFileSync(path.join(dir, f), "x");
  assert.deepEqual(listVideos(dir).map((p) => path.basename(p)), ["1.MOV", "2.mp4", "10.mp4"]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("buildPlan: gắn tiêu đề, thumbnail trùng tên và giờ đăng", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dist-"));
  fs.writeFileSync(path.join(dir, "Tập 1.jpg"), "x");
  const plan = buildPlan({
    videos: ["D:/v/Tập 1.mp4", "D:/v/Tập 2.mp4"], profiles: P("A"), mode: "roundrobin",
    thumbFolder: dir, postTimes: "9:00", startDate: new Date(2026, 5, 1),
  });
  const [a, b] = plan.channels[0].items;
  assert.equal(a.title, "Tập 1");
  assert.ok(a.thumbnailPath.endsWith("Tập 1.jpg"));
  assert.equal(b.thumbnailPath, null);
  assert.equal(a.scheduleISO, "2026-06-02T09:00:00");
  assert.equal(b.scheduleISO, "2026-06-03T09:00:00");
  fs.rmSync(dir, { recursive: true, force: true });
});
