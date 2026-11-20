import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

// url-list.js là script trình duyệt (IIFE gắn vào window): nạp trong môi trường giả để test phần logic thuần.
globalThis.window = {};
const require = createRequire(import.meta.url);
require("../url-list.js");
const { FILTERS, stateOf, summarize, filterRows, detailOf, TONE } = globalThis.window.UrlList;

const row = (url, status = "", uploadStatus = "") => ({ rowIndex: 1, url, status, uploadStatus });

test("stateOf: cùng phân loại với trang web, cột upload ưu tiên hơn cột tải/render", () => {
  assert.equal(stateOf(row("u", "", "")), "new");
  assert.equal(stateOf(row("u", "đã tải")), "downloaded");
  assert.equal(stateOf(row("u", "done")), "todo");
  assert.equal(stateOf(row("u", "done", "⏳ đang upload")), "uploading");
  assert.equal(stateOf(row("u", "done", "⏸ chờ: đăng lại thủ công")), "waiting");
  assert.equal(stateOf(row("u", "done", "✅ lên lịch 21/11 00:30")), "scheduled");
  assert.equal(stateOf(row("u", "done", "❌ upload lỗi")), "upload-error");
  assert.equal(stateOf(row("u", "lỗi tải: hết quota")), "failed");
  assert.equal(stateOf(row("u", "lỗi render: ffmpeg")), "failed");
  assert.equal(stateOf(row("u", "bỏ qua: video riêng tư")), "skipped");
  assert.equal(stateOf(row("u", "lỗi tải: x", "✅ lên lịch")), "scheduled", "đã lên lịch thì không còn tính là lỗi");
  assert.equal(stateOf(null), "new");
});

test("summarize: đếm đúng từng trạng thái, bỏ qua dòng không có URL", () => {
  const rows = [row("a"), row("b", "done"), row("c", "done", "✅ ok"), row("d", "done", "✅ ok"), row("e", "lỗi tải: x"), row("  "), row("")];
  const s = summarize(rows);
  assert.equal(s.total, 5);
  assert.deepEqual([s.new, s.todo, s.scheduled, s.failed], [1, 1, 2, 1]);
  assert.equal(Object.values(s).reduce((a, b) => a + b, 0) - s.total, s.total, "tổng các trạng thái bằng tổng số dòng");
  assert.deepEqual(summarize([]), { ...summarize(undefined) });
});

test("filterRows: lọc theo trạng thái, theo chuỗi tìm, và cả hai; không phân biệt hoa thường", () => {
  const rows = [row("https://youtu.be/AAA", "done", "✅ ok"), row("https://youtu.be/BBB"), row("https://youtu.be/aab", "done", "✅ ok")];
  assert.equal(filterRows(rows).length, 3);
  assert.equal(filterRows(rows, "scheduled").length, 2);
  assert.equal(filterRows(rows, "scheduled", "aab").length, 1);
  assert.equal(filterRows(rows, "all", "AA").length, 2);
  assert.equal(filterRows(rows, "new", "AAA").length, 0);
  assert.equal(filterRows(rows, "all", "  ").length, 3, "chuỗi tìm toàn khoảng trắng coi như không tìm");
});

test("detailOf: không lặp lại thứ nhãn đã nói; ghép cột B và C", () => {
  assert.equal(detailOf(row("u", "done", "✅ lên lịch 21/11")), "✅ lên lịch 21/11");
  assert.equal(detailOf(row("u", "lỗi tải: hết quota")), "lỗi tải: hết quota");
  assert.equal(detailOf(row("u", "lỗi render: x", "❌ y")), "lỗi render: x · ❌ y");
  assert.equal(detailOf(row("u", "đã tải")), "");
});

test("mọi bộ lọc có nhãn, và mọi trạng thái (trừ all) đều có màu khai báo", () => {
  for (const [k, label] of FILTERS) assert.ok(label, k);
  for (const [k] of FILTERS) if (k !== "all") assert.ok(Object.prototype.hasOwnProperty.call(TONE, k), "thiếu màu cho " + k);
});
