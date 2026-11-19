import test from "node:test";
import assert from "node:assert/strict";
import { listGpmProfilesFull, getGpmProfile, resetGpmVersionCache } from "../sheet/gpm-client.js";

const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const mk = (n) => ({ id: `p${n}`, name: `N${n}`, raw_proxy: null, browser_version: "129.0.6668.59", group_id: 1 });

// Máy v3: /api/v3/profiles phân trang theo page (từ 0) và per_page.
function v3Server(total, { failOnPage, perPageCap } = {}) {
  const all = Array.from({ length: total }, (_, i) => mk(i + 1));
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    const u = new URL(url);
    if (u.pathname === "/api/v3/profiles") {
      const page = Number(u.searchParams.get("page"));
      if (failOnPage !== undefined && page === failOnPage) return { ok: false, status: 500, json: async () => ({}) };
      const per = Math.min(Number(u.searchParams.get("per_page")), perPageCap ?? Infinity);
      return ok({ success: true, data: all.slice(page * per, page * per + per) });
    }
    if (u.pathname.startsWith("/api/v3/profiles/")) {
      const id = u.pathname.split("/").pop();
      const p = all.find((x) => x.id === id);
      return ok(p ? { success: true, data: p } : { success: false, data: null, message: "PROFILE_NOT_FOUND" });
    }
    return ok({ success: false });
  };
  return { fn, calls };
}

test("listGpmProfilesFull: đọc đủ nhiều trang, không sót", async () => {
  resetGpmVersionCache();
  const { fn } = v3Server(250);
  const list = await listGpmProfilesFull("h:1", { fetch: fn });
  assert.equal(list.length, 250);
  assert.equal(new Set(list.map((p) => p.id)).size, 250);
});

test("listGpmProfilesFull: lỗi giữa chừng thì NÉM LỖI, không trả danh sách thiếu", async () => {
  resetGpmVersionCache();
  const { fn } = v3Server(250, { failOnPage: 1 });
  await assert.rejects(listGpmProfilesFull("h:2", { fetch: fn }), /HTTP 500/);
});

test("listGpmProfilesFull: GPM bỏ qua tham số trang (luôn trả trang đầu) -> dừng, không lặp vô hạn", async () => {
  resetGpmVersionCache();
  const first = Array.from({ length: 100 }, (_, i) => mk(i + 1));
  let calls = 0;
  const fn = async (url) => { calls++; return ok({ success: true, data: first }); };
  const list = await listGpmProfilesFull("h:3", { fetch: fn });
  assert.equal(list.length, 100);
  assert.ok(calls < 10, `gọi ${calls} lần`);
});

test("listGpmProfilesFull: map đủ trường kể cả phiên bản Chrome và proxy", async () => {
  resetGpmVersionCache();
  const fn = async () => ok({ success: true, data: [{ ...mk(1), raw_proxy: "socks5://1.1.1.1:80:u:p" }] });
  const [p] = await listGpmProfilesFull("h:4", { fetch: fn });
  assert.equal(p.browserVersion, "129.0.6668.59");
  assert.equal(p.rawProxy, "socks5://1.1.1.1:80:u:p");
  assert.equal(p.groupId, 1);
});

test("getGpmProfile: v3 đọc thẳng 1 profile, không quét cả danh sách", async () => {
  resetGpmVersionCache();
  const { fn, calls } = v3Server(30);
  await listGpmProfilesFull("h:5", { fetch: fn }); // chốt version v3
  calls.length = 0;
  const p = await getGpmProfile("h:5", "p7", { fetch: fn });
  assert.equal(p.id, "p7");
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\/api\/v3\/profiles\/p7$/);
});

test("getGpmProfile: không tồn tại -> null", async () => {
  resetGpmVersionCache();
  const { fn } = v3Server(30);
  await listGpmProfilesFull("h:6", { fetch: fn });
  assert.equal(await getGpmProfile("h:6", "khong-co", { fetch: fn }), null);
});
