import test from "node:test";
import assert from "node:assert/strict";
import { parseAccount, toGpmProxy, resolveChromeVersion, planAddChannels } from "../sheet/add-channel.js";
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

test("plan: dòng mới -> create với Chrome 129; ô tk trống vẫn tạo profile nhưng không có tài khoản để đăng nhập", () => {
  const plan = planAddChannels({ rows: [R({}), R({ sheetName: "K2", account: "" })], profiles: [], defaultVersion: "" });
  assert.equal(plan[0].action, "create");
  assert.equal(plan[0].version, "129.0.6668.59");
  assert.equal(plan[0].account.email, "a@gmail.com");
  assert.equal(plan[1].action, "create");
  assert.equal(plan[1].account, null);
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
