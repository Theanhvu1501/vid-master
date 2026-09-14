import { test } from "node:test";
import assert from "node:assert/strict";
import { planCleanup, CLEAN_EXTS } from "../sheet/cleanup-output.js";

const NOW = new Date(2026, 6, 7, 10, 0, 0); // 2026-07-07 10:00 local
const at = (d, h = 12) => new Date(2026, 6, d, h, 0, 0).getTime();

// Danh sách file như listFilesWithStat trả về.
const f = (p, mtimeMs, size = 1000) => ({ path: p, mtimeMs, size });

const paths = (victims) => victims.map((v) => v.path);

test("keepDays=1: xoá file cũ hơn 00:00 hôm nay, giữ file của hôm nay", () => {
  const files = [
    f("/out/hom-kia.mp4", at(5)),
    f("/out/hom-qua.mp4", at(6)),
    f("/out/hom-nay.mp4", at(7, 8)),
  ];
  const v = planCleanup({ files, keepPaths: [], now: NOW, keepDays: 1, exts: CLEAN_EXTS.output });
  assert.deepEqual(paths(v), ["/out/hom-kia.mp4", "/out/hom-qua.mp4"]);
});

test("keepDays=2: giữ thêm nguyên ngày hôm qua", () => {
  const files = [f("/out/hom-kia.mp4", at(5)), f("/out/hom-qua.mp4", at(6)), f("/out/hom-nay.mp4", at(7, 8))];
  const v = planCleanup({ files, keepPaths: [], now: NOW, keepDays: 2, exts: CLEAN_EXTS.output });
  assert.deepEqual(paths(v), ["/out/hom-kia.mp4"]);
});

test("keepDays=0: xoá cả file của hôm nay (miễn không nằm trong keepPaths)", () => {
  const files = [f("/out/hom-nay.mp4", at(7, 8)), f("/out/inflight.mp4", at(7, 9))];
  const v = planCleanup({
    files, keepPaths: ["/out/inflight.mp4"], now: NOW, keepDays: 0, exts: CLEAN_EXTS.output,
  });
  assert.deepEqual(paths(v), ["/out/hom-nay.mp4"]);
});

// Lá chắn quan trọng nhất: còn entry trong resume-state = còn việc phải làm với file
// (chờ upload, upload lỗi, GPM chết qua đêm). Xoá nhầm là mất vĩnh viễn vì cột B đã
// "done" nên không render lại, mà decideAction lại trả "skip" khi không còn output.
test("không bao giờ xoá file nằm trong keepPaths, dù cũ đến đâu", () => {
  const files = [f("/out/cho-upload.mp4", at(1)), f("/out/xong-roi.mp4", at(1))];
  const v = planCleanup({
    files, keepPaths: ["/out/cho-upload.mp4"], now: NOW, keepDays: 1, exts: CLEAN_EXTS.output,
  });
  assert.deepEqual(paths(v), ["/out/xong-roi.mp4"]);
});

test("keepPaths khớp bất kể hoa/thường và kiểu dấu gạch (đường dẫn Windows)", () => {
  const files = [f("D:\\Vid\\Kênh A\\output\\A.mp4", at(1))];
  const v = planCleanup({
    files, keepPaths: ["d:/vid/Kênh A/output/a.mp4"], now: NOW, keepDays: 1, exts: CLEAN_EXTS.output,
  });
  assert.deepEqual(paths(v), []);
});

test("chỉ đụng đúng phần mở rộng được phép", () => {
  const files = [
    f("/ov/mo-coi.mp4", at(1)),
    f("/ov/dang-tai.mp4.part", at(1)),
    f("/ov/thumb.jpg", at(1)),
    f("/ov/note.txt", at(1)),
  ];
  // overlays: dọn .mp4 mồ côi + .part dở dang; .jpg là thumbnail cho upload lại nên giữ.
  const v = planCleanup({ files, keepPaths: [], now: NOW, keepDays: 1, exts: CLEAN_EXTS.overlays });
  assert.deepEqual(paths(v), ["/ov/mo-coi.mp4", "/ov/dang-tai.mp4.part"]);
});

test("phần mở rộng so khớp không phân biệt hoa/thường", () => {
  const files = [f("/out/A.MP4", at(1))];
  const v = planCleanup({ files, keepPaths: [], now: NOW, keepDays: 1, exts: CLEAN_EXTS.output });
  assert.deepEqual(paths(v), ["/out/A.MP4"]);
});

test("keepDays sai kiểu/âm -> lùi về 1 ngày (mặc định an toàn)", () => {
  const files = [f("/out/hom-qua.mp4", at(6)), f("/out/hom-nay.mp4", at(7, 8))];
  // null/"" là "chưa cấu hình" chứ không phải 0 — Number() ép cả hai về 0, mà 0 lại là
  // một giá trị HỢP LỆ (xoá cả hôm nay). Nhầm chỗ này là ô UI bỏ trống hoá ra xoá sạch.
  for (const bad of [undefined, null, "", "abc", -5, NaN]) {
    const v = planCleanup({ files, keepPaths: [], now: NOW, keepDays: bad, exts: CLEAN_EXTS.output });
    assert.deepEqual(paths(v), ["/out/hom-qua.mp4"], `keepDays=${String(bad)}`);
  }
});

test("file mtime ở tương lai thì giữ, danh sách rỗng thì trả rỗng", () => {
  assert.deepEqual(planCleanup({ files: [], keepPaths: [], now: NOW, keepDays: 1, exts: CLEAN_EXTS.output }), []);
  const v = planCleanup({
    files: [f("/out/tuong-lai.mp4", at(9))], keepPaths: [], now: NOW, keepDays: 1, exts: CLEAN_EXTS.output,
  });
  assert.deepEqual(paths(v), []);
});

test("mốc cắt là 00:00 chứ không phải 24h trước: file 23:59 hôm qua vẫn bị xoá", () => {
  const files = [f("/out/23h59-hom-qua.mp4", new Date(2026, 6, 6, 23, 59).getTime())];
  const v = planCleanup({ files, keepPaths: [], now: NOW, keepDays: 1, exts: CLEAN_EXTS.output });
  assert.deepEqual(paths(v), ["/out/23h59-hom-qua.mp4"]);
});

test("giữ nguyên size để bên gọi cộng ra dung lượng giải phóng", () => {
  const files = [f("/out/a.mp4", at(1), 4096), f("/out/b.mp4", at(1), 1024)];
  const v = planCleanup({ files, keepPaths: [], now: NOW, keepDays: 1, exts: CLEAN_EXTS.output });
  assert.equal(v.reduce((s, x) => s + x.size, 0), 5120);
});
