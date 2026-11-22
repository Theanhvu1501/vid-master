import test from "node:test";
import assert from "node:assert/strict";
import { parseCookieText, toCdpCookies, summarize, importCookiesIntoBrowser } from "../sheet/veo3/cookies-import.js";

const J = [
  { domain: ".google.com", name: "SID", value: "FAKE-SID-1", path: "/", secure: true, httpOnly: false, expirationDate: 1900000000, sameSite: "no_restriction" },
  { domain: ".google.com", name: "__Secure-1PSID", value: "FAKE-PSID", path: "/", secure: true, httpOnly: true },
  { domain: "flow.google.com", name: "x", value: "y", path: "/" },
  { domain: ".facebook.com", name: "c_user", value: "NOPE", path: "/" },
];

test("parse: JSON mảng, JSON {cookies}, Netscape; rác thì báo lỗi KHÔNG chứa giá trị cookie", () => {
  assert.equal(parseCookieText(JSON.stringify(J)).length, 4);
  assert.equal(parseCookieText(JSON.stringify({ cookies: J })).length, 4);
  const ns = ["# Netscape HTTP Cookie File", ".google.com\tTRUE\t/\tTRUE\t1900000000\tSID\tFAKE-SID-1", "#HttpOnly_.google.com\tTRUE\t/\tTRUE\t0\t__Secure-1PSID\tFAKE-PSID"].join("\n");
  const n = parseCookieText(ns); assert.equal(n.length, 2); assert.equal(n[1].httpOnly, true); assert.equal(n[0].value, "FAKE-SID-1");
  for (const bad of ["", "   ", "hello world", "{bad json FAKE-SECRET"]) assert.throws(() => parseCookieText(bad), (e) => !String(e.message).includes("FAKE-SECRET"));
});

test("toCdpCookies: chỉ giữ cookie Google/YouTube, chuẩn hóa secure/sameSite/expires, bỏ cookie sai", () => {
  const c = toCdpCookies(J);
  assert.deepEqual(c.map((x) => x.name), ["SID", "__Secure-1PSID", "x"], "facebook bị loại");
  assert.equal(c[0].sameSite, "None"); assert.equal(c[0].expires, 1900000000); assert.equal(c[1].secure, true); assert.equal(c[1].httpOnly, true);
  assert.deepEqual(toCdpCookies([null, { name: "a" }, { name: "b", value: 1, domain: ".google.com" }]), []);
});

test("summarize: không lộ giá trị, biết có cookie phiên hay không", () => {
  const s = summarize(toCdpCookies(J));
  assert.equal(s.count, 3); assert.equal(s.hasSession, true); assert.ok(!JSON.stringify(s).includes("FAKE"));
  assert.equal(summarize(toCdpCookies([{ domain: ".google.com", name: "NID", value: "z" }])).hasSession, false);
});

function fakeBrowser({ url = "https://flow.google.com/", cdpSuccess = true } = {}) {
  const log = [];
  const page = { createCDPSession: async () => ({ send: async (m, p) => { log.push([m, p.cookies.length]); return { success: cdpSuccess }; } }), goto: async () => {}, url: () => url, close: async () => log.push("close") };
  return { log, browser: { newPage: async () => page } };
}
test("importCookiesIntoBrowser: nạp cookie, mở Flow, báo đã đăng nhập; luôn đóng tab tạm", async () => {
  const f = fakeBrowser();
  const r = await importCookiesIntoBrowser({ browser: f.browser, text: JSON.stringify(J) });
  assert.deepEqual({ ok: r.ok, count: r.count, loggedIn: r.loggedIn }, { ok: true, count: 3, loggedIn: true });
  assert.deepEqual(f.log, [["Network.setCookies", 3], "close"]); assert.ok(!JSON.stringify(r).includes("FAKE"));
});
test("importCookiesIntoBrowser: bị chuyển sang trang đăng nhập thì loggedIn=false; thiếu cookie phiên / không có cookie Google / Chrome từ chối đều báo lỗi rõ", async () => {
  assert.equal((await importCookiesIntoBrowser({ browser: fakeBrowser({ url: "https://accounts.google.com/signin" }).browser, text: JSON.stringify(J) })).loggedIn, false);
  const noSess = await importCookiesIntoBrowser({ browser: fakeBrowser().browser, text: JSON.stringify([{ domain: ".google.com", name: "NID", value: "z" }]) });
  assert.equal(noSess.ok, false); assert.match(noSess.error, /phiên đăng nhập/);
  assert.match((await importCookiesIntoBrowser({ browser: fakeBrowser().browser, text: JSON.stringify([{ domain: ".facebook.com", name: "a", value: "b" }]) })).error, /Google/);
  assert.equal((await importCookiesIntoBrowser({ browser: fakeBrowser({ cdpSuccess: false }).browser, text: JSON.stringify(J) })).ok, false);
  assert.equal((await importCookiesIntoBrowser({ browser: fakeBrowser().browser, text: "" })).ok, false);
});
