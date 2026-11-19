import test from "node:test";
import assert from "node:assert/strict";
import { parseProxyParts, extractProxyAuth, cleanAuthInput, mergeAuth, lookupAuth } from "../sheet/proxy-auth.js";

test("parseProxyParts: nhận mọi dạng proxy, tách user/mật khẩu", () => {
  assert.deepEqual(parseProxyParts("socks5://113.160.166.37:36650:user1:Pw9"), { host: "113.160.166.37", port: "36650", user: "user1", pass: "Pw9" });
  assert.deepEqual(parseProxyParts("socks5://u:p@1.2.3.4:80"), { host: "1.2.3.4", port: "80", user: "u", pass: "p" });
  assert.deepEqual(parseProxyParts("1.2.3.4:80"), { host: "1.2.3.4", port: "80", user: "", pass: "" });
  assert.equal(parseProxyParts("1.2.3.4:80:u:pa:ss").pass, "pa:ss", "mật khẩu có dấu : vẫn giữ nguyên");
});

test("parseProxyParts: chuỗi sai trả null", () => {
  for (const bad of ["", "abc", "1.2.3.4", "1.2.3.4:99999", "1.2.3.4:80:chiuser", "a b:80", "x@y"]) assert.equal(parseProxyParts(bad), null, bad);
});

const TABLE = [
  ["", "NHÓM"],
  ["Tên kênh", "Bật", "Proxy tải"],
  ["A_01", "TRUE", "socks5://1.1.1.1:80:uA:pA"],
  ["B_01", "TRUE", "socks5://2.2.2.2:80"],
  ["C_01", "TRUE", ""],
  ["a_01", "TRUE", "socks5://9.9.9.9:80:x:y"],
  ["D_01", "TRUE", "rac"],
  ["E 01", "TRUE", "socks5://u:p@3.3.3.3:90"],
];

test("extractProxyAuth: lấy user/mật khẩu theo tên kênh, báo rõ dòng bị bỏ", () => {
  const r = extractProxyAuth(TABLE);
  assert.deepEqual(r.entries.map((e) => e.name), ["A_01", "E 01"]);
  assert.deepEqual(r.entries[0], { name: "A_01", user: "uA", pass: "pA", hostPort: "1.1.1.1:80" });
  const why = Object.fromEntries(r.skipped.map((s) => [s.name, s.why]));
  assert.match(why.B_01, /không có user/);
  assert.match(why.a_01, /trùng tên/);
  assert.match(why.D_01, /không đọc được/);
  assert.ok(!r.skipped.some((s) => s.name === "C_01"), "ô proxy trống thì bỏ qua im lặng");
});

test("extractProxyAuth: thiếu cột -> báo lỗi rõ ràng, không văng", () => {
  assert.match(extractProxyAuth([["a", "b"], ["1", "2"]]).error, /Tên kênh/);
  assert.match(extractProxyAuth([["Tên kênh", "Bật"], ["A", "1"]]).error, /Proxy tải/);
  assert.ok(extractProxyAuth(null).error);
  assert.deepEqual(extractProxyAuth([["Tên kênh", "Proxy tải"]]).entries, []);
});

test("extractProxyAuth: nhận tiêu đề có dấu/hoa thường khác nhau", () => {
  const r = extractProxyAuth([["TÊN KÊNH", "proxy"], ["K", "http://u:p@1.2.3.4:80"]]);
  assert.equal(r.entries.length, 1);
});

test("cleanAuthInput: bắt buộc có user; cắt khoảng trắng user, giữ nguyên mật khẩu", () => {
  assert.deepEqual(cleanAuthInput("  bob ", " p w "), { user: "bob", pass: " p w " });
  assert.ok(cleanAuthInput("", "x").error);
  assert.ok(cleanAuthInput("a\u0000", "x").error);
  assert.ok(cleanAuthInput("x".repeat(300), "x").error);
});

test("mergeAuth: ghi đè đúng kênh, giữ các kênh khác, không sửa đối tượng cũ", () => {
  const old = { A: { user: "u", pass: "p" }, B: { user: "b", pass: "b" } };
  const out = mergeAuth(old, [{ name: "A", user: "u2", pass: "p2" }, { name: "C", user: "c", pass: "c" }]);
  assert.deepEqual(out, { A: { user: "u2", pass: "p2", hostPort: "" }, B: { user: "b", pass: "b" }, C: { user: "c", pass: "c", hostPort: "" } });
  assert.equal(old.A.user, "u");
  assert.deepEqual(mergeAuth(null, [{ name: "X", user: "u", pass: "p", hostPort: "1.2.3.4:80" }]), { X: { user: "u", pass: "p", hostPort: "1.2.3.4:80" } });
});

test("lookupAuth: web đổi sang proxy khác (host:port khác) thì KHÔNG dùng mật khẩu của proxy cũ", () => {
  const s = mergeAuth(null, [{ name: "K", user: "u", pass: "p", hostPort: "1.1.1.1:80" }]);
  assert.equal(lookupAuth(s, "K", "1.1.1.1:80").user, "u");
  assert.equal(lookupAuth(s, "K", "9.9.9.9:80"), null, "proxy đã đổi: phải nhập lại mật khẩu mới");
  assert.equal(lookupAuth(s, "K").user, "u", "không biết host:port thì không so");
});

test("lookupAuth: không phân biệt hoa thường/khoảng trắng; kênh chưa có -> null", () => {
  const s = { "LINE_02": { user: "u", pass: "p" } };
  assert.equal(lookupAuth(s, " line_02 ").user, "u");
  assert.equal(lookupAuth(s, "KHAC"), null);
  assert.equal(lookupAuth(null, "x"), null);
  assert.equal(lookupAuth({ A: { user: "", pass: "x" } }, "A"), null, "thiếu user thì coi như chưa có");
});
