import test from "node:test";
import assert from "node:assert/strict";
import { addrOfProxy, planProxySync } from "../sheet/proxy-sync.js";

test("addrOfProxy: cắt user/mật khẩu, giữ scheme://host:port", () => {
  assert.equal(addrOfProxy("socks5://1.2.3.4:80:bob:p@ss"), "socks5://1.2.3.4:80");
  assert.equal(addrOfProxy("http://bob:pw@1.2.3.4:8080"), "http://1.2.3.4:8080");
  assert.equal(addrOfProxy("1.2.3.4:80"), "http://1.2.3.4:80");
});

test("addrOfProxy: mật khẩu có ký tự lạ (@ : /) vẫn lấy đúng địa chỉ, mật khẩu không lọt ra", () => {
  assert.equal(addrOfProxy("socks5://1.2.3.4:80:bob:p@ss:w/rd"), "socks5://1.2.3.4:80");
  assert.equal(addrOfProxy("http://bob:p%40ss@1.2.3.4:8080"), "http://1.2.3.4:8080");
  assert.ok(!addrOfProxy("socks5://1.2.3.4:80:bob:SECRET").includes("SECRET"));
});

test("addrOfProxy: rỗng -> '' (không dùng proxy); rác -> null (không đoán)", () => {
  assert.equal(addrOfProxy(""), "");
  assert.equal(addrOfProxy("   "), "");
  assert.equal(addrOfProxy("không phải proxy"), null);
});

const CH = (id, gpmProfileId, proxy = "", version = 1) => ({ id, version, gpmProfileId, proxy });

test("planProxySync: profile có proxy khác web -> gửi địa chỉ mới, KHÔNG kèm user/mật khẩu", () => {
  const plan = planProxySync([CH(1, "P1", "")], new Map([["P1", "socks5://9.9.9.9:80:bob:SECRET"]]));
  assert.deepEqual(plan, [{ id: 1, version: 1, proxy: "socks5://9.9.9.9:80" }]);
  assert.ok(!JSON.stringify(plan).includes("SECRET") && !JSON.stringify(plan).includes("bob"));
});

test("planProxySync: đã khớp thì không gửi gì", () => {
  assert.deepEqual(planProxySync([CH(1, "P1", "socks5://9.9.9.9:80")], new Map([["P1", "socks5://9.9.9.9:80:u:p"]])), []);
});

test("planProxySync: profile không dùng proxy mà web đang có -> xóa (kênh không còn hạn)", () => {
  assert.deepEqual(planProxySync([CH(1, "P1", "socks5://1.1.1.1:80", 4)], new Map([["P1", ""]])), [{ id: 1, version: 4, proxy: "" }]);
});

test("planProxySync: kênh chưa gắn profile, hoặc profile không còn trong GPM -> giữ nguyên proxy trên web", () => {
  const plan = planProxySync([CH(1, "", "socks5://1.1.1.1:80"), CH(2, "GONE", "socks5://2.2.2.2:80")], new Map([["P1", "socks5://9.9.9.9:80"]]));
  assert.deepEqual(plan, []);
});

test("planProxySync: proxy trong GPM không đọc được -> bỏ qua, không xóa proxy trên web", () => {
  assert.deepEqual(planProxySync([CH(1, "P1", "socks5://1.1.1.1:80")], new Map([["P1", "rác"]])), []);
});
