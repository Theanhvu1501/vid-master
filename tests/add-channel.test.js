import test from "node:test";
import assert from "node:assert/strict";
import {
  parseAccount, toGpmProxy, resolveChromeVersion, planAddChannels, runAddChannels, previewAddChannels,
} from "../sheet/add-channel.js";
import { createGpmProfile } from "../sheet/gpm-client.js";
import { parseConfigRows, locateConfigColumns } from "../sheet/sheets-service.js";

const P = (o) => ({ id: "id", name: "n", rawProxy: "", browserVersion: "129.0.6668.59", ...o });
const R = (o) => ({ sheetName: "K1", rowIndex: 2, proxy: "", gpmProfileId: "", account: "a@gmail.com|pw", chromeVersion: "", ...o });

test("parseAccount: đủ 4 phần, và chỉ cần gmail|mật khẩu", () => {
  assert.deepEqual(parseAccount("a@gmail.com|pw|r@x.com|ABCD"), { email: "a@gmail.com", password: "pw", recoveryEmail: "r@x.com", twoFactorSecret: "ABCD" });
  assert.equal(parseAccount(" a@gmail.com | pw ").password, "pw");
  assert.throws(() => parseAccount("khong-co-gmail|pw"), /dạng/);
  assert.throws(() => parseAccount("a@gmail.com"), /mật khẩu/);
});

test("toGpmProxy: chuẩn hoá về scheme://host:port:user:pass", () => {
  assert.equal(toGpmProxy("socks5://1.2.3.4:80:u:p"), "socks5://1.2.3.4:80:u:p");
  assert.equal(toGpmProxy("1.2.3.4:80:u:p"), "http://1.2.3.4:80:u:p");
  assert.equal(toGpmProxy("http://u:p@1.2.3.4:80"), "http://1.2.3.4:80:u:p");
  assert.equal(toGpmProxy(""), "");
  assert.throws(() => toGpmProxy("rác"), /không hợp lệ/);
});

test("resolveChromeVersion: mặc định 129, ưu tiên bản đang có trong GPM, từ chối major lạ", () => {
  assert.equal(resolveChromeVersion("", []), "129.0.6668.59");
  assert.equal(resolveChromeVersion("129", ["129.0.6668.59", "129.0.6668.100", "130.0.1.1"]), "129.0.6668.100");
  assert.equal(resolveChromeVersion("129.0.1.2", []), "129.0.1.2");
  assert.throws(() => resolveChromeVersion("140", []), /chưa biết/);
  assert.throws(() => resolveChromeVersion("abc", []), /không hợp lệ/);
  assert.equal(resolveChromeVersion("140", ["140.0.7000.5"]), "140.0.7000.5");
});

test("plan: dòng mới -> create với Chrome 129; ô tk trống -> skip", () => {
  const plan = planAddChannels({ rows: [R({}), R({ sheetName: "K2", account: "" })], profiles: [], defaultVersion: "" });
  assert.equal(plan[0].action, "create");
  assert.equal(plan[0].version, "129.0.6668.59");
  assert.equal(plan[1].action, "skip");
});

test("plan: profile cùng tên đã có trong GPM -> dùng lại, KHÔNG tạo trùng, và ghi ID", () => {
  const plan = planAddChannels({ rows: [R({})], profiles: [P({ id: "X", name: "k1" })], defaultVersion: "" });
  assert.equal(plan[0].action, "reuse");
  assert.equal(plan[0].profileId, "X");
  assert.equal(plan[0].writeId, true);
});

test("plan: GPM có 2 profile cùng tên -> lỗi, không đoán", () => {
  const plan = planAddChannels({ rows: [R({})], profiles: [P({ id: "1", name: "K1" }), P({ id: "2", name: "K1" })], defaultVersion: "" });
  assert.equal(plan[0].action, "error");
  assert.match(plan[0].note, /2 profile cùng tên/);
});

test("plan: Profile ID trong Sheet không tồn tại -> lỗi (không tạo cái mới đè lên)", () => {
  const plan = planAddChannels({ rows: [R({ gpmProfileId: "ma" })], profiles: [], defaultVersion: "" });
  assert.equal(plan[0].action, "error");
});

test("plan: profile có sẵn khác phiên bản Chrome -> lỗi, không âm thầm dùng bản sai", () => {
  const plan = planAddChannels({ rows: [R({})], profiles: [P({ name: "K1", browserVersion: "133.0.1.1" })], defaultVersion: "" });
  assert.equal(plan[0].action, "error");
  assert.match(plan[0].note, /133/);
});

test("plan: tên kênh lặp trong Sheet -> dòng thứ hai bị lỗi, không tạo 2 profile", () => {
  const plan = planAddChannels({ rows: [R({}), R({ rowIndex: 3 })], profiles: [], defaultVersion: "" });
  assert.deepEqual(plan.map((p) => p.action), ["create", "error"]);
});

test("plan: proxy của profile có sẵn khác Sheet -> giữ nguyên proxy cũ, chỉ cảnh báo", () => {
  const plan = planAddChannels({ rows: [R({ proxy: "9.9.9.9:80:u:p" })], profiles: [P({ name: "K1", rawProxy: "socks5://1.1.1.1:80:u:p" })], defaultVersion: "" });
  assert.equal(plan[0].setProxy, false);
  assert.equal(plan[0].proxyDiffers, true);
});

test("plan: cột tk sai định dạng -> lỗi cho đúng dòng đó, dòng khác vẫn chạy", () => {
  const plan = planAddChannels({ rows: [R({ account: "hỏng" }), R({ sheetName: "K2", rowIndex: 3 })], profiles: [], defaultVersion: "" });
  assert.deepEqual(plan.map((p) => p.action), ["error", "create"]);
});

// ---- runAddChannels với dep giả ----
const VALUES = [
  ["Tên kênh", "proxy", "GPM Profile ID", "tk", "Phiên bản Chrome"],
  ["K1", "socks5://1.1.1.1:80:u:p", "", "a@gmail.com|pw1|r@x.com|ABCD", ""],
  ["K2", "", "", "b@gmail.com|pw2", ""],
  ["Cũ", "", "OLD", "", ""],
];

function mkDeps(over = {}) {
  const calls = { create: [], write: [], login: [], proxy: [] };
  const deps = {
    readValues: async () => VALUES,
    listProfiles: async () => [],
    createProfile: async (a) => { calls.create.push(a); return { id: `ID-${a.name}` }; },
    updateProxy: async (id, raw) => calls.proxy.push([id, raw]),
    writeCell: async (row, col, v) => calls.write.push([row, col, v]),
    forEach: async ({ profiles, work }) => {
      let ok = 0;
      for (const p of profiles) { await work({}, p, () => {}); ok++; }
      return { total: profiles.length, ok, fail: 0, skipped: 0 };
    },
    login: async (page, acct) => calls.login.push(acct.email),
    ...over,
  };
  return { deps, calls };
}

test("run: tạo profile, ghi ID vào đúng ô Sheet, rồi đăng nhập; dòng kênh cũ không bị đụng", async () => {
  const { deps, calls } = mkDeps();
  const r = await runAddChannels({ gpmHost: "h", onLog: () => {} }, deps);
  assert.equal(r.created, 2);
  assert.deepEqual(calls.create.map((c) => c.name), ["K1", "K2"]);
  assert.equal(calls.create[0].rawProxy, "socks5://1.1.1.1:80:u:p");
  assert.equal(calls.create[0].browserVersion, "129.0.6668.59");
  assert.equal(calls.create[0].startupUrl, "https://studio.youtube.com");
  assert.deepEqual(calls.write, [[2, 2, "ID-K1"], [3, 2, "ID-K2"]]);
  assert.deepEqual(calls.login, ["a@gmail.com", "b@gmail.com"]);
});

test("run: doLogin=false thì tạo profile nhưng KHÔNG đăng nhập", async () => {
  const { deps, calls } = mkDeps();
  await runAddChannels({ gpmHost: "h", doLogin: false, onLog: () => {} }, deps);
  assert.equal(calls.login.length, 0);
  assert.equal(calls.create.length, 2);
});

test("run: tạo profile lỗi ở K1 thì K2 vẫn chạy, K1 không bị đăng nhập", async () => {
  const { deps, calls } = mkDeps({
    createProfile: async (a) => { if (a.name === "K1") throw new Error("GPM từ chối"); calls.create.push(a); return { id: "ID-K2" }; },
  });
  const r = await runAddChannels({ gpmHost: "h", onLog: () => {} }, deps);
  assert.equal(r.errors, 1);
  assert.equal(r.created, 1);
  assert.deepEqual(calls.login, ["b@gmail.com"]);
});

test("run: ghi Sheet hỏng -> DỪNG cả lượt (không tạo thêm profile mồ côi) và nói rõ ID cần điền", async () => {
  const { deps, calls } = mkDeps({ writeCell: async () => { throw new Error("quota"); } });
  await assert.rejects(runAddChannels({ gpmHost: "h", onLog: () => {} }, deps), /ID-K1.*dòng 2/s);
  assert.equal(calls.create.length, 1, "không được tạo K2 sau khi ghi K1 hỏng");
});

test("run: chạy lại sau khi lỗi -> profile đã tạo được dùng lại, không tạo trùng", async () => {
  const { deps, calls } = mkDeps({ listProfiles: async () => [P({ id: "EXIST-K1", name: "K1", rawProxy: "socks5://1.1.1.1:80:u:p" })] });
  const r = await runAddChannels({ gpmHost: "h", onLog: () => {} }, deps);
  assert.equal(r.reused, 1);
  assert.deepEqual(calls.create.map((c) => c.name), ["K2"]);
  assert.deepEqual(calls.write[0], [2, 2, "EXIST-K1"]);
});

test("run: không có dòng nào cần chạy -> báo lỗi rõ ràng", async () => {
  const { deps } = mkDeps({ readValues: async () => [VALUES[0], VALUES[3]] });
  await assert.rejects(runAddChannels({ gpmHost: "h", onLog: () => {} }, deps), /Không có dòng nào/);
});

test("run: thiếu cột tk hoặc GPM Profile ID thì từ chối ngay, nói rõ cột nào thiếu", async () => {
  await assert.rejects(runAddChannels({ onLog: () => {} }, mkDeps({ readValues: async () => [["Tên kênh", "GPM Profile ID"], ["K1", ""]] }).deps), /"tk"/);
  await assert.rejects(runAddChannels({ onLog: () => {} }, mkDeps({ readValues: async () => [["Tên kênh", "tk"], ["K1", "a@g.com|p"]] }).deps), /"GPM Profile ID"/);
});

test("run: log không bao giờ chứa mật khẩu, 2FA hay user/pass proxy", async () => {
  const logs = [];
  const { deps } = mkDeps();
  await runAddChannels({ gpmHost: "h", onLog: (m) => logs.push(m) }, deps);
  const all = logs.join("\n");
  for (const secret of ["pw1", "pw2", "ABCD", "u:p"]) assert.ok(!all.includes(secret), `lộ ${secret}`);
});

test("preview: không lộ mật khẩu hay proxy gốc", async () => {
  const { deps } = mkDeps();
  const out = await previewAddChannels({}, deps);
  const s = JSON.stringify(out);
  assert.ok(!s.includes("pw1") && !s.includes("ABCD") && !s.includes("u:p"));
  assert.equal(out[0].proxyMasked, "socks5://1.1.1.1:80");
});

// ---- createGpmProfile: tin đọc-lại, không tin "success" ----
const jsonRes = (body) => ({ ok: true, status: 200, json: async () => body });
function gpmFetch({ createBody, listAfter }) {
  const seen = [];
  const fn = async (url, init) => {
    seen.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    if (url.includes("/profiles/create")) return jsonRes(createBody);
    if (url.includes("/profiles?")) return jsonRes({ success: true, data: listAfter });
    return jsonRes({ success: true, data: [] }); // dò phiên bản
  };
  return { fn, seen };
}
const row = (o) => ({ id: "NEW", name: "K1", raw_proxy: "socks5://1.1.1.1:80:u:p", browser_version: "129.0.6668.59", group_id: 1, ...o });

test("createGpmProfile (v3): gửi proxy + trang khởi động + group, KHÔNG gửi phiên bản", async () => {
  const { fn, seen } = gpmFetch({ createBody: { success: true, data: { id: "NEW" } }, listAfter: [row()] });
  const r = await createGpmProfile("h:1", { name: "K1", rawProxy: "socks5://1.1.1.1:80:u:p", browserVersion: "129.0.6668.59" }, { fetch: fn });
  assert.equal(r.id, "NEW");
  const body = seen.find((s) => s.url.includes("/profiles/create")).body;
  assert.equal(body.profile_name, "K1");
  assert.equal(body.raw_proxy, "socks5://1.1.1.1:80:u:p");
  assert.equal(body.startup_urls, "https://studio.youtube.com");
  assert.equal(body.browser_version, undefined);
});

test("createGpmProfile: GPM tạo sai phiên bản -> ném lỗi, nêu rõ ID để người dùng xoá", async () => {
  const { fn } = gpmFetch({ createBody: { success: true, data: { id: "NEW" } }, listAfter: [row({ browser_version: "133.0.1.1" })] });
  await assert.rejects(createGpmProfile("h:1", { name: "K1", rawProxy: "", browserVersion: "129.0.6668.59" }, { fetch: fn }), /NEW.*133/s);
});

test("createGpmProfile: GPM bỏ qua proxy -> ném lỗi thay vì báo thành công", async () => {
  const { fn } = gpmFetch({ createBody: { success: true, data: { id: "NEW" } }, listAfter: [row({ raw_proxy: null })] });
  await assert.rejects(createGpmProfile("h:1", { name: "K1", rawProxy: "socks5://1.1.1.1:80:u:p", browserVersion: "129.0.6668.59" }, { fetch: fn }), /proxy chưa được gán/);
});

test("createGpmProfile: GPM báo success:false -> ném lỗi", async () => {
  const { fn } = gpmFetch({ createBody: { success: false, message: "INVALID" }, listAfter: [] });
  await assert.rejects(createGpmProfile("h:1", { name: "K1", browserVersion: "129.0.6668.59" }, { fetch: fn }), /INVALID/);
});

// ---- Sheet ----
test("Sheet: nhận cột tk và Phiên bản Chrome; parseConfigRows cũ không bị ảnh hưởng", () => {
  const vals = [["Tên kênh", "bật", "TK", "Chrome version"], ["K1", "x", "a@g.com|p", "130"]];
  const { cols } = locateConfigColumns(vals, ["account", "chromeVersion", "gpmProfileId"]);
  assert.equal(cols.account, 2);
  assert.equal(cols.chromeVersion, 3);
  assert.equal(cols.gpmProfileId, undefined);
  assert.equal(parseConfigRows(vals)[0].sheetName, "K1");
});

// ---- Body tạo profile theo từng phiên bản GPM ----
import { buildCreateBody } from "../sheet/gpm-client.js";

test("buildCreateBody v1: đúng tài liệu GPM (name, browser_type=1, raw_proxy, startup_urls)", () => {
  const b = buildCreateBody("v1", { name: "K1", rawProxy: "socks5://1.1.1.1:80:u:p", browserVersion: "129.0.6668.59", startupUrl: "https://studio.youtube.com" });
  assert.equal(b.name, "K1");
  assert.equal(b.browser_type, 1);
  assert.equal(b.browser_version, "129.0.6668.59");
  assert.equal(b.raw_proxy, "socks5://1.1.1.1:80:u:p");
  assert.equal(b.startup_urls, "https://studio.youtube.com");
  assert.equal(b.profile_name, undefined, "v1 không dùng profile_name");
});

test("buildCreateBody v3: dạng đã dò thật, KHÔNG gửi browser_version (GPM v3 lỗi nếu bản chưa cài)", () => {
  const b = buildCreateBody("v3", { name: "K1", rawProxy: "p", browserVersion: "129.0.6668.59", startupUrl: "u" });
  assert.equal(b.profile_name, "K1");
  assert.equal(b.group_name, "All");
  assert.equal(b.raw_proxy, "p");
  assert.equal(b.browser_version, undefined);
  assert.equal(b.name, undefined);
});

test("createGpmProfile trên máy v1: gửi body v1 và đọc được version dạng browser.version", async () => {
  const v1 = (o) => ({ id: "NEW", name: "K1", raw_proxy: "socks5://1.1.1.1:80:u:p", browser: { name: "chrome", version: "129.0.6668.59" }, ...o });
  const seen = [];
  const fn = async (url, init) => {
    seen.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    if (url.includes("/profiles/create")) return jsonRes({ success: true, data: { id: "NEW" } });
    if (url.includes("/api/v1/profiles/NEW")) return jsonRes({ success: true, data: v1() });
    if (url.includes("/api/v1/profiles?")) return jsonRes({ success: true, data: { data: [v1()] } });
    if (url.includes("/api/v3/")) return jsonRes({ success: false });
    return jsonRes({ success: true, data: [] });
  };
  const { resetGpmVersionCache } = await import("../sheet/gpm-client.js");
  resetGpmVersionCache();
  const r = await createGpmProfile("h:v1", { name: "K1", rawProxy: "socks5://1.1.1.1:80:u:p", browserVersion: "129.0.6668.59" }, { fetch: fn });
  assert.equal(r.id, "NEW");
  const create = seen.find((s) => s.url.includes("/profiles/create"));
  assert.match(create.url, /\/api\/v1\//);
  assert.equal(create.body.browser_type, 1);
});
