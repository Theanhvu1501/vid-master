import test from "node:test";
import assert from "node:assert/strict";
import { parseConfigRows } from "../sheet/sheets-service.js";
import { readChannelRows, describeTask, createMissingColumns, COLUMN_GROUPS, COLUMN_LABELS } from "../sheet/channel-sheet.js";
import { createUploadQueue } from "../sheet/upload-queue.js";
import { resolveThumbRun, resolveScheduleRun } from "../sheet/run-options.js";

const NOW = new Date(2026, 6, 8, 15, 0, 0);

// ---------- đọc cột "Kênh BKT" ----------
const HEAD = ["Tên kênh", "GPM Profile ID", "Giờ đăng", "Kênh BKT"];
const rowsWith = (v) => [HEAD, ["K1", "P1", "8:00", v]];

test("cờ Kênh BKT: chỉ BẬT khi người dùng ghi rõ; TRỐNG hoặc giá trị lạ = kênh thường (an toàn)", () => {
  for (const v of ["", "  ", "không", "no", "0", "false", "abc"]) assert.equal(parseConfigRows(rowsWith(v))[0].monetized, false, JSON.stringify(v));
  for (const v of ["có", "Có", "CÓ", "co", "yes", "Y", "1", "x", "TRUE", "bật", "✓"]) assert.equal(parseConfigRows(rowsWith(v))[0].monetized, true, v);
});

test("cờ Kênh BKT: Sheet không có cột này -> mọi kênh là kênh thường (không đổi hành vi cũ)", () => {
  const out = parseConfigRows([["Tên kênh", "GPM Profile ID", "Giờ đăng"], ["K1", "P1", "8:00"]]);
  assert.equal(out[0].monetized, false);
});

test("cột Kênh BKT nhận các tên gọi khác nhau (BKT, Bật kiếm tiền, Monetized)", () => {
  for (const h of ["Kênh BKT", "BKT", "Bật kiếm tiền", "Monetized", "kênh bkt"]) {
    assert.equal(parseConfigRows([["Tên kênh", h], ["K1", "có"]])[0].monetized, true, h);
  }
});

test("thêm cột Kênh BKT không làm vỡ các cột khác của parseConfigRows", () => {
  const out = parseConfigRows([["Tên kênh", "Bật", "Video mỗi ngày", "Kênh BKT"], ["K1", "TRUE", "3", "có"]]);
  assert.deepEqual([out[0].enabled, out[0].videosPerDay, out[0].monetized], [true, 3, true]);
});

test("readChannelRows (luồng tự động hoá) cũng đọc cờ BKT", () => {
  const { rows } = readChannelRows([["Tên kênh", "GPM Profile ID", "Kênh BKT"], ["A", "P1", "có"], ["B", "P2", ""], ["C", "P3", "xong"]]);
  assert.deepEqual(rows.map((r) => r.monetized), [true, false, false]);
});

// ---------- cột + nhóm màu + tạo cột ----------
test("cột Kênh BKT thuộc một nhóm màu và có nhãn hiển thị", () => {
  assert.equal(COLUMN_LABELS.monetized, "Kênh BKT");
  assert.ok(COLUMN_GROUPS.some((g) => g.keys.includes("monetized")));
  const cols = COLUMN_GROUPS.flatMap((g) => g.keys);
  assert.equal(new Set(cols).size, cols.length, "một cột không nằm ở 2 nhóm");
});

test("describeTask: cột Kênh BKT là tuỳ chọn, tạo giúp được, và không bắt buộc để chạy", () => {
  const d = describeTask([["Tên kênh", "GPM Profile ID"], ["K1", "P1"]], "automation");
  assert.equal(d.ready, true, "thiếu cột BKT không chặn việc chạy");
  assert.ok(d.creatable.includes("Kênh BKT"));
});

test("createMissingColumns: tạo cột Kênh BKT cùng nhóm với các cột profile", async () => {
  const written = [];
  const made = await createMissingColumns({
    readValues: async () => [["", ""], ["Tên kênh", "GPM Profile ID"], ["K1", "P1"]],
    ensureColumns: async () => {}, writeCell: async (r, c, v) => written.push(v),
  }, "automation");
  assert.ok(made.includes("Kênh BKT"));
  const i = made.indexOf("Kênh BKT"), j = made.indexOf("Tạo profile");
  assert.ok(Math.abs(i - j) < 5, "nằm gần nhóm Tạo profile");
});

// ---------- cờ đi tới runUpload (Theo dõi Sheet) ----------
function queueWith(onRun) {
  return createUploadQueue({
    readChannelUploads: async () => ({ scheduledUrls: new Set(), usedSlots: [] }),
    connect: async () => ({ page: {} }),
    runUpload: async (args) => { onRun(args); },
    now: () => NOW, listFiles: () => [],
  });
}
const job = (extra) => ({ sheetName: "K", gpmHost: "h", profileId: "p", videoPath: "/o/v.mp4", overlaysDir: "/ov", title: "v", postTimes: "8:00", sourceUrl: "http://u/1", ...extra });

test("hàng đợi upload: job có monetized=true thì runUpload nhận monetized=true", async () => {
  const seen = [];
  const q = queueWith((a) => seen.push(a.monetized));
  q.enqueue(job({ monetized: true }));
  await q.drain();
  assert.deepEqual(seen, [true]);
});

test("hàng đợi upload: job cũ KHÔNG có cờ -> runUpload nhận false (kênh thường, hành vi như trước)", async () => {
  const seen = [];
  const q = queueWith((a) => seen.push(a.monetized));
  q.enqueue(job({}));
  await q.drain();
  assert.deepEqual(seen, [false]);
});

// ---------- cờ đi qua danh sách chạy của thumb/lịch ----------
test("resolveThumbRun giữ cờ BKT từng profile (kênh BKT và kênh thường chạy chung một lượt)", () => {
  const r = resolveThumbRun({
    profiles: [{ id: "a", name: "A", monetized: true }, { id: "b", name: "B" }],
    defaultFolder: "D:/x", isDirectory: () => true, images: () => 2,
  });
  assert.deepEqual(r.profiles.map((p) => [p.id, p.monetized]), [["a", true], ["b", false]]);
});

test("resolveScheduleRun giữ cờ BKT từng profile", () => {
  const r = resolveScheduleRun({ profiles: [{ id: "a", name: "A", monetized: true }, { id: "b", name: "B" }], postTimes: "8:00", numDays: 1, today: NOW });
  assert.deepEqual(r.profiles.map((p) => [p.id, p.monetized]), [["a", true], ["b", false]]);
});
