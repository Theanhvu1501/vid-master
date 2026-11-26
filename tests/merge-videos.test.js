import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  CONCAT_WAIT, CONCAT_DONE_SUFFIX,
  isConcatWaiting, concatWaitText, concatDoneText,
  processConcatQueue,
} from "../sheet/merge-videos.js";

describe("video-concat helpers", () => {
  test("isConcatWaiting nhận diện đúng trạng thái chờ nối", () => {
    assert.equal(isConcatWaiting("⏳ chờ nối 1/3"), true);
    assert.equal(isConcatWaiting("⏳ chờ nối 2/3"), true);
    assert.equal(isConcatWaiting("⏳ chờ nối"), true);
    assert.equal(isConcatWaiting("done"), false);
    assert.equal(isConcatWaiting(""), false);
    assert.equal(isConcatWaiting(null), false);
    assert.equal(isConcatWaiting(undefined), false);
    assert.equal(isConcatWaiting("✅ 2025-01-15 10:30"), false);
  });

  test("concatWaitText tạo đúng text", () => {
    assert.equal(concatWaitText(1, 3), "⏳ chờ nối 1/3");
    assert.equal(concatWaitText(2, 3), "⏳ chờ nối 2/3");
    assert.equal(concatWaitText(1, 5), "⏳ chờ nối 1/5");
  });

  test("concatDoneText thêm suffix đúng", () => {
    assert.equal(concatDoneText("✅ 2025-01-15 10:30"), "✅ 2025-01-15 10:30 · đã nối");
    assert.equal(concatDoneText(""), "· đã nối");
    assert.equal(concatDoneText(null), "· đã nối");
    // Không thêm trùng
    assert.equal(concatDoneText("✅ 2025-01-15 · đã nối"), "✅ 2025-01-15 · đã nối");
  });
});

describe("processConcatQueue", () => {
  test("trả về rỗng nếu concatCount <= 1", async () => {
    const result = await processConcatQueue({
      sheetName: "test",
      concatCount: 1,
      pendingVideos: [{ url: "a", rowIndex: 1, outputPath: "/a.mp4", title: "A" }],
      outputDir: "/out",
    });
    assert.deepEqual(result, { concatenated: [], stillWaiting: [] });
  });

  test("trả về rỗng nếu không có video", async () => {
    const result = await processConcatQueue({
      sheetName: "test",
      concatCount: 3,
      pendingVideos: [],
      outputDir: "/out",
    });
    assert.deepEqual(result, { concatenated: [], stillWaiting: [] });
  });

  test("chưa đủ nhóm thì tất cả đều stillWaiting", async () => {
    const result = await processConcatQueue({
      sheetName: "test",
      concatCount: 3,
      pendingVideos: [
        { url: "a", rowIndex: 1, outputPath: "/a.mp4", title: "A" },
        { url: "b", rowIndex: 2, outputPath: "/b.mp4", title: "B" },
      ],
      outputDir: "/out",
      log: () => {},
    });
    assert.equal(result.concatenated.length, 0);
    assert.equal(result.stillWaiting.length, 2);
    assert.deepEqual(result.stillWaiting, [
      { url: "a", rowIndex: 1, waitIndex: 1 },
      { url: "b", rowIndex: 2, waitIndex: 2 },
    ]);
  });

  // Test nối thực tế cần file thật + ffmpeg, bỏ qua trong unit test
});
