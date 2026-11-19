import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { classifyMessage, DURATION, MAX_TOASTS } = require("../app-dialog.cjs");

test("classifyMessage: nhận biết loại thông báo theo biểu tượng đầu câu", () => {
  assert.equal(classifyMessage("❌ Không kết nối được GPM"), "error");
  assert.equal(classifyMessage("✅ Đã lưu"), "success");
  assert.equal(classifyMessage("⚠️ Không phát hiện GPU encoder"), "warning");
  assert.equal(classifyMessage("   ❌ có khoảng trắng đầu"), "error");
});

test("classifyMessage: nhận biết theo từ mở đầu tiếng Việt (có/không dấu, hoa/thường)", () => {
  assert.equal(classifyMessage("Lỗi khi chọn file: abc"), "error");
  assert.equal(classifyMessage("LỖI: Electron API chưa sẵn sàng"), "error");
  assert.equal(classifyMessage("Không tạo được cột: quota"), "error");
  assert.equal(classifyMessage("Hãy tick chọn ít nhất 1 profile"), "warning");
  assert.equal(classifyMessage("Vui lòng nhập Profile ID!"), "warning");
  assert.equal(classifyMessage("Chưa chọn thư mục"), "warning");
  assert.equal(classifyMessage("Đã lưu file mẫu:\nD:\\a.xlsx"), "success");
  assert.equal(classifyMessage("Cập nhật thành công"), "success");
});

test("classifyMessage: câu không rõ -> info; rỗng/null không ném", () => {
  assert.equal(classifyMessage("Xin chào"), "info");
  assert.equal(classifyMessage(""), "info");
  assert.equal(classifyMessage(null), "info");
  assert.equal(classifyMessage(undefined), "info");
});

test("classifyMessage: 'không thành công' không bị nhận nhầm là success", () => {
  assert.equal(classifyMessage("Không thành công: hết hạn"), "error");
});

test("thời gian hiện: lỗi ở lâu hơn thành công, mọi loại đều có và hữu hạn", () => {
  for (const k of ["success", "info", "warning", "error"]) assert.ok(DURATION[k] >= 3000 && DURATION[k] <= 15000, k);
  assert.ok(DURATION.error > DURATION.success);
  assert.ok(MAX_TOASTS >= 3);
});

// ---- ràng buộc về cách dùng trong mã nguồn ----
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

test("không còn confirm() gốc của hệ thống trong giao diện (đã chuyển sang appConfirm)", () => {
  for (const f of ["renderer.js", "composer-ui.js"]) {
    const hits = read(f).split(/\r?\n/).filter((l) => /(^|[^.\w])confirm\(/.test(l) && !/appConfirm/.test(l));
    assert.deepEqual(hits, [], `${f} còn confirm() gốc`);
  }
});

test("mọi `await appConfirm` nằm trong hàm async (nếu không là lỗi cú pháp)", () => {
  for (const f of ["renderer.js", "composer-ui.js"]) {
    const lines = read(f).split(/\r?\n/);
    lines.forEach((l, i) => {
      if (!/await (window\.)?appConfirm/.test(l)) return;
      let j = i;
      while (j > 0 && !/(async\s+function|async\s*\(|async\s+\w+\s*=>|async\s*\w*\s*\()/.test(lines[j]) && !/^\s*function\s/.test(lines[j])) j--;
      assert.ok(/async/.test(lines[j]), `${f}:${i + 1} await ngoài hàm async (gần nhất: dòng ${j + 1}: ${lines[j].trim().slice(0, 60)})`);
    });
  }
});

test("app-dialog.cjs nạp TRƯỚC renderer.js để alert() đã được thay khi renderer chạy", () => {
  const html = read("renderer.html");
  const a = html.indexOf('<script src="app-dialog.cjs"></script>');
  const b = html.indexOf('<script src="renderer.js"></script>');
  assert.ok(a >= 0 && b >= 0 && a < b);
});

test("toast chèn nội dung bằng textContent, không bằng innerHTML (tránh chèn HTML từ tên file/lỗi)", () => {
  const src = read("app-dialog.cjs");
  assert.match(src, /msg\.textContent = text/);
  assert.match(src, /body\.textContent = String\(message/);
  assert.match(src, /title\.textContent = /);
  assert.ok(!/msg\.innerHTML|body\.innerHTML|title\.innerHTML/.test(src), "không được gán innerHTML cho nội dung người dùng/lỗi");
});

test("hộp thoại có thuộc tính trợ năng: role alertdialog, aria-modal, đóng bằng Esc, focus mặc định an toàn", () => {
  const src = read("app-dialog.cjs");
  for (const needle of ['"alertdialog"', 'aria-modal', 'aria-labelledby', 'aria-describedby', 'e.key === "Escape"', "prefers-reduced-motion"]) {
    assert.ok(src.includes(needle), `thiếu ${needle}`);
  }
  assert.match(src, /\(danger \? cancel : ok\)\.focus\(\)/, "việc nguy hiểm: focus mặc định ở Huỷ");
});
