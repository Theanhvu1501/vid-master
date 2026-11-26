import test from "node:test";
import assert from "node:assert/strict";
import { describeDownloadError } from "../sheet/download-error.js";

test("lấy dòng ERROR của yt-dlp từ stderr, bỏ tiền tố ERROR:", () => {
  const e = { message: "Command failed with exit code 1", stderr: "WARNING: something\nERROR: [youtube] abc: Video unavailable\n" };
  assert.equal(describeDownloadError(e), "[youtube] abc: Video unavailable");
});

test("stderr không có dòng ERROR -> lấy toàn bộ (đã rút gọn)", () => {
  const e = { stderr: "Sign in to confirm you're not a bot" };
  assert.equal(describeDownloadError(e), "Sign in to confirm you're not a bot");
});

test("không có stderr nhưng có stdout -> dùng stdout", () => {
  const e = { message: "", stdout: "ERROR: HTTP Error 403: Forbidden" };
  assert.equal(describeDownloadError(e), "HTTP Error 403: Forbidden");
});

test("chỉ có message 'Command failed' vô nghĩa, không stderr -> vẫn trả message (hơn Unknown)", () => {
  const e = { message: "Command failed with exit code 1" };
  assert.equal(describeDownloadError(e), "Command failed with exit code 1");
});

test("message thật (không phải Command failed) được giữ", () => {
  assert.equal(describeDownloadError(new Error("Không tìm thấy file tải về cho URL: x")), "Không tìm thấy file tải về cho URL: x");
});

test("lỗi là chuỗi / null -> không bao giờ rỗng", () => {
  assert.equal(describeDownloadError("proxy connection refused"), "proxy connection refused");
  assert.equal(describeDownloadError(null), "Lỗi không rõ");
  assert.equal(describeDownloadError({}), "Lỗi không rõ");
});

test("rút gọn khoảng trắng và cắt độ dài", () => {
  const long = "ERROR: " + "x".repeat(500);
  const out = describeDownloadError({ stderr: long });
  assert.ok(out.length <= 300);
  assert.ok(!out.includes("\n"));
});
