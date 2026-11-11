import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyUploadStatus, listPendingUploads } from "../sheet/pending-uploads.js";

test("classify: tiền tố cột C -> kind", () => {
  assert.equal(classifyUploadStatus(""), "rendered");
  assert.equal(classifyUploadStatus("⏳ đang upload"), "maybe-uploaded");
  assert.equal(classifyUploadStatus("b1: đã tải file video"), "maybe-uploaded");
  assert.equal(classifyUploadStatus("b4: đã đặt giờ lịch"), "maybe-uploaded");
  assert.equal(classifyUploadStatus("⏸ chờ: chưa kết nối được GPM"), "waiting");
  assert.equal(classifyUploadStatus("❌ lỗi: click timeout"), "failed");
  assert.equal(classifyUploadStatus("bỏ qua: lỗi (đã thử 3 lần)"), "gave-up");
  assert.equal(classifyUploadStatus("✅ lên lịch 09/07/2026 08:00"), null);
  assert.equal(classifyUploadStatus("chuỗi lạ"), "failed");
});

test("listPendingUploads: chỉ lấy B=done, có file, C chưa ✅", () => {
  const rows = [
    { rowIndex: 2, url: "u1", status: "done", uploadStatus: "bỏ qua: lỗi (đã thử 3 lần)" },
    { rowIndex: 3, url: "u2", status: "done", uploadStatus: "✅ lên lịch 09/07/2026 08:00" },
    { rowIndex: 4, url: "u3", status: "đã tải", uploadStatus: "❌ lỗi: x" },
    { rowIndex: 5, url: "u4", status: "done", uploadStatus: "" },
    { rowIndex: 6, url: "u5", status: "done", uploadStatus: "❌ lỗi: mất file" },
  ];
  const entries = {
    u1: { outputPath: "/out/a.mp4", title: "A", uploadAttempts: 3 },
    u2: { outputPath: "/out/b.mp4", title: "B" },
    u3: { outputPath: "/out/c.mp4", title: "C" },
    u4: { outputPath: "/out/d.mp4", title: "D" },
    u5: { outputPath: "/out/e.mp4", title: "E" },
  };
  const out = listPendingUploads({
    rows,
    resolveEntry: (u) => entries[u] ?? null,
    fileExists: (p) => p !== "/out/e.mp4",
  });
  assert.deepEqual(out.map((v) => v.url), ["u1", "u4"]);
  assert.equal(out[0].kind, "gave-up");
  assert.equal(out[0].title, "A");
  assert.equal(out[0].rowIndex, 2);
  assert.equal(out[0].uploadAttempts, 3);
  assert.equal(out[1].kind, "rendered");
});

test("listPendingUploads: title dự phòng từ tên file khi entry không có title", () => {
  const out = listPendingUploads({
    rows: [{ rowIndex: 2, url: "u1", status: "done", uploadStatus: "❌ lỗi: x" }],
    resolveEntry: () => ({ outputPath: "/out/tiêu đề.mp4" }),
    fileExists: () => true,
  });
  assert.equal(out[0].title, "tiêu đề");
  assert.equal(out[0].uploadAttempts, 0);
});

test("listPendingUploads: thứ tự maybe-uploaded trước", () => {
  const rows = [
    { rowIndex: 2, url: "u1", status: "done", uploadStatus: "bỏ qua: x (đã thử 3 lần)" },
    { rowIndex: 3, url: "u2", status: "done", uploadStatus: "⏳ đang upload" },
    { rowIndex: 4, url: "u3", status: "done", uploadStatus: "❌ lỗi: y" },
  ];
  const out = listPendingUploads({
    rows,
    resolveEntry: (u) => ({ outputPath: `/out/${u}.mp4`, title: u }),
    fileExists: () => true,
  });
  assert.deepEqual(out.map((v) => v.kind), ["maybe-uploaded", "failed", "gave-up"]);
});

test("listPendingUploads: bỏ qua dòng không có entry hoặc outputPath rỗng", () => {
  const rows = [
    { rowIndex: 2, url: "u1", status: "done", uploadStatus: "❌ lỗi: x" },
    { rowIndex: 3, url: "u2", status: "done", uploadStatus: "❌ lỗi: y" },
    { rowIndex: 4, url: "u3", status: "done", uploadStatus: "❌ lỗi: z" },
  ];
  const out = listPendingUploads({
    rows,
    resolveEntry: (u) => (u === "u1" ? null : { outputPath: u === "u2" ? "" : "/out/z.mp4", title: u }),
    fileExists: () => true,
  });
  assert.deepEqual(out.map((v) => v.url), ["u3"]);
});
