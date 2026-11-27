import test from "node:test";
import assert from "node:assert/strict";
import { createSessionManager, jwtExpiryMs, reasonText, OFFLINE_GRACE_MS, normalizeAppFeatures, appFeaturesChanged } from "../app-session.js";

const DAY = 86_400_000;
const mkJwt = (expSec) => `h.${Buffer.from(JSON.stringify({ exp: expSec })).toString("base64url")}.s`;

function mk(over = {}) {
  let t = over.t0 ?? 1_700_000_000_000;
  const calls = [];
  const disk = { value: over.saved ?? null, saves: 0, clears: 0 };
  const respond = over.respond ?? (() => ({ status: 200, body: {} }));
  const fetchImpl = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : {};
    calls.push({ url, body, auth: init.headers?.Authorization });
    const r = await respond(url, body, init);
    if (r.throw) throw new Error("ECONNREFUSED");
    return { status: r.status, json: async () => r.body ?? {}, headers: { get: (h) => (h.toLowerCase() === "retry-after" ? r.retryAfter ?? null : null) } };
  };
  const store = {
    load: () => (over.loadThrows ? (() => { throw new Error("boom"); })() : disk.value),
    save: (v) => { if (over.saveThrows) throw new Error("no safeStorage"); disk.value = JSON.parse(JSON.stringify(v)); disk.saves++; },
    clear: () => { disk.value = null; disk.clears++; },
  };
  const mgr = createSessionManager({ fetchImpl, getBase: () => "http://srv", getMachineId: () => over.machineId ?? "MACHINE-1234", getHostname: () => over.hostname ?? "PC-VĂN-PHÒNG", store, now: () => t });
  return { mgr, calls, disk, advance: (ms) => { t += ms; }, now: () => t };
}
const OK_LOGIN = { status: 200, body: { token: mkJwt(Math.floor(Date.now() / 1000) + 30 * 86400), user: { id: 1, username: "bob", role: "user" } } };

// ---------------- đăng nhập ----------------
test("login: đúng -> gửi tài khoản + mật khẩu + MÃ MÁY + TÊN MÁY (tự động, người dùng không nhập); lưu phiên; trả user", async () => {
  const { mgr, calls, disk } = mk({ respond: () => OK_LOGIN });
  const r = await mgr.login("  bob ", "pw123");
  assert.equal(r.ok, true);
  assert.deepEqual(calls[0].body, { username: "bob", password: "pw123", machineId: "MACHINE-1234", hostname: "PC-VĂN-PHÒNG" });
  assert.equal(calls[0].url, "http://srv/api/app/login");
  assert.equal(mgr.isLoggedIn(), true);
  assert.equal(mgr.getToken(), OK_LOGIN.body.token);
  assert.equal(disk.saves, 1);
});

test("login: MẬT KHẨU KHÔNG BAO GIỜ được lưu xuống kho", async () => {
  const { mgr, disk } = mk({ respond: () => OK_LOGIN });
  await mgr.login("bob", "Sup3rSecretPw");
  assert.ok(!JSON.stringify(disk.value).includes("Sup3rSecretPw"), "phiên đã lưu chứa mật khẩu");
  assert.ok(!JSON.stringify(disk.value).includes("password"));
});

test("login: sai thông tin / máy không được gán -> invalid, KHÔNG có phiên, KHÔNG lưu gì", async () => {
  const { mgr, disk } = mk({ respond: () => ({ status: 401, body: { message: "Tài khoản, mật khẩu hoặc mã máy không đúng" } }) });
  const r = await mgr.login("bob", "x");
  assert.deepEqual([r.ok, r.kind], [false, "invalid"]);
  assert.equal(mgr.isLoggedIn(), false);
  assert.equal(disk.saves, 0);
});

test("login: bị khóa tạm (429) -> kind rate kèm số giây chờ từ header Retry-After", async () => {
  const { mgr } = mk({ respond: () => ({ status: 429, retryAfter: "840", body: { message: "Đăng nhập sai quá nhiều lần." } }) });
  const r = await mgr.login("bob", "x");
  assert.deepEqual([r.ok, r.kind, r.retryAfter], [false, "rate", 840]);
});

test("login: tài khoản bị khóa / license thu hồi (403) -> denied, hiện đúng lời server", async () => {
  const { mgr } = mk({ respond: () => ({ status: 403, body: { message: "License của máy này đã bị thu hồi." } }) });
  const r = await mgr.login("bob", "x");
  assert.deepEqual([r.ok, r.kind, r.message], [false, "denied", "License của máy này đã bị thu hồi."]);
});

test("login: mất mạng / server lỗi 500 -> báo rõ, không có phiên", async () => {
  assert.equal((await mk({ respond: () => ({ throw: true }) }).mgr.login("bob", "x")).kind, "network");
  assert.equal((await mk({ respond: () => ({ status: 500 }) }).mgr.login("bob", "x")).kind, "server");
});

test("login: thiếu input hoặc không lấy được mã máy -> chặn từ phía app, không gọi mạng", async () => {
  const a = mk({ respond: () => OK_LOGIN });
  assert.equal((await a.mgr.login("", "x")).kind, "input");
  assert.equal((await a.mgr.login("bob", "")).kind, "input");
  assert.equal(a.calls.length, 0);
  const b = mk({ machineId: "ERROR", respond: () => OK_LOGIN });
  assert.equal((await b.mgr.login("bob", "x")).kind, "machine");
  assert.equal(b.calls.length, 0);
});

test("login: không lưu được phiên (không có safeStorage) vẫn đăng nhập được trong lần chạy này", async () => {
  const { mgr } = mk({ respond: () => OK_LOGIN, saveThrows: true });
  assert.equal((await mgr.login("bob", "x")).ok, true);
  assert.equal(mgr.isLoggedIn(), true);
});

// ---------------- khôi phục khi mở app ----------------
const SAVED = (extra = {}) => ({ token: mkJwt(Math.floor(Date.now() / 1000) + 20 * 86400), user: { id: 1, username: "bob" }, machineId: "MACHINE-1234", verifiedAt: 1_700_000_000_000, ...extra });

test("restore: có phiên lưu + server nói hợp lệ -> vào thẳng, gửi token trong header", async () => {
  const { mgr, calls } = mk({ saved: SAVED(), respond: () => ({ status: 200, body: { valid: true, user: { id: 1, username: "bob" } } }) });
  const r = await mgr.restore();
  assert.equal(r.state, "valid");
  assert.equal(calls[0].url, "http://srv/api/app/session");
  assert.match(calls[0].auth, /^Bearer /);
});

test("restore: không có phiên lưu -> none (hiện màn đăng nhập)", async () => {
  const { mgr, calls } = mk({ saved: null });
  assert.equal((await mgr.restore()).state, "none");
  assert.equal(calls.length, 0);
});

test("restore: phiên được lưu cho MÁY KHÁC (copy thư mục sang máy khác) -> bỏ, đăng nhập lại", async () => {
  const { mgr, disk } = mk({ saved: SAVED({ machineId: "MAY-KHAC-99999" }), respond: () => ({ status: 200, body: { valid: true } }) });
  assert.equal((await mgr.restore()).state, "none");
  assert.equal(mgr.isLoggedIn(), false);
  assert.equal(disk.clears, 1);
});

test("restore: file phiên hỏng/đọc lỗi -> none, không văng lỗi", async () => {
  assert.equal((await mk({ loadThrows: true }).mgr.restore()).state, "none");
  assert.equal((await mk({ saved: { token: 123 } }).mgr.restore()).state, "none");
});

// ---------------- server thu hồi ----------------
for (const [reason, re] of [["machine-unassigned", /không còn được gán/], ["license-revoked", /thu hồi/], ["disabled", /bị khóa/], ["password-changed", /đổi/], ["no-user", /không còn tồn tại/]]) {
  test(`verify: server báo "${reason}" -> ĐĂNG XUẤT NGAY, xóa phiên đã lưu, lý do đọc được`, async () => {
    const { mgr, disk } = mk({ saved: SAVED(), respond: () => ({ status: reason === "machine-unassigned" || reason === "license-revoked" || reason === "disabled" ? 403 : 401, body: { valid: false, reason } }) });
    const r = await mgr.restore();
    assert.equal(r.state, "invalid");
    assert.equal(r.reason, reason);
    assert.match(r.message, re);
    assert.equal(mgr.isLoggedIn(), false);
    assert.equal(disk.value, null, "phiên phải bị xóa khỏi ổ đĩa");
  });
}

// ---------------- mất mạng: không đăng xuất oan ----------------
test("verify: mất mạng, phiên mới xác minh gần đây -> cho dùng offline, GIỮ phiên", async () => {
  const { mgr, disk } = mk({ saved: SAVED(), t0: 1_700_000_000_000 + 2 * DAY, respond: () => ({ throw: true }) });
  const r = await mgr.restore();
  assert.equal(r.state, "offline");
  assert.equal(r.ageDays, 2);
  assert.equal(mgr.isLoggedIn(), true);
  assert.equal(disk.clears, 0);
});

test("verify: server lỗi 500/502/429 -> coi như offline, KHÔNG đăng xuất oan", async () => {
  for (const status of [500, 502, 503, 429]) {
    const { mgr } = mk({ saved: SAVED(), t0: 1_700_000_000_000 + DAY, respond: () => ({ status, body: {} }) });
    assert.equal((await mgr.restore()).state, "offline", String(status));
    assert.equal(mgr.isLoggedIn(), true);
  }
});

test("verify: offline quá 7 ngày kể từ lần xác minh cuối -> yêu cầu kết nối mạng (nhưng chưa xóa phiên)", async () => {
  const { mgr, disk } = mk({ saved: SAVED(), t0: 1_700_000_000_000 + OFFLINE_GRACE_MS + 1000, respond: () => ({ throw: true }) });
  const r = await mgr.restore();
  assert.equal(r.state, "need-online");
  assert.equal(disk.clears, 0, "có mạng lại là dùng tiếp được");
});

test("verify: offline và token đã quá hạn thật -> đăng xuất", async () => {
  const expired = mkJwt(Math.floor((1_700_000_000_000 - DAY) / 1000));
  const { mgr } = mk({ saved: SAVED({ token: expired }), respond: () => ({ throw: true }) });
  const r = await mgr.restore();
  assert.equal(r.state, "invalid");
  assert.equal(mgr.isLoggedIn(), false);
});

test("verify: xác minh thành công thì cập nhật mốc thời gian (offline sau đó tính từ mốc mới)", async () => {
  const { mgr, disk, advance } = mk({ saved: SAVED(), t0: 1_700_000_000_000 + 6 * DAY, respond: () => ({ status: 200, body: { valid: true } }) });
  await mgr.restore();
  assert.equal(disk.value.verifiedAt, 1_700_000_000_000 + 6 * DAY);
  advance(3 * DAY); // offline 3 ngày kể từ mốc mới: vẫn được
  const m2 = mk({ saved: disk.value, t0: 1_700_000_000_000 + 9 * DAY, respond: () => ({ throw: true }) });
  assert.equal((await m2.mgr.restore()).state, "offline");
});

// ---------------- đăng xuất ----------------
test("logout: xóa phiên trong bộ nhớ và trên ổ đĩa; verify sau đó là none", async () => {
  const { mgr, disk } = mk({ respond: () => OK_LOGIN });
  await mgr.login("bob", "x");
  mgr.logout();
  assert.equal(mgr.isLoggedIn(), false);
  assert.equal(mgr.getToken(), "");
  assert.equal(disk.value, null);
  assert.equal((await mgr.verify()).state, "none");
});

// ---------------- tiện ích ----------------
test("jwtExpiryMs: đọc hạn từ JWT; chuỗi rác -> null", () => {
  assert.equal(jwtExpiryMs(mkJwt(2000000000)), 2000000000 * 1000);
  assert.equal(jwtExpiryMs("rac"), null);
  assert.equal(jwtExpiryMs(undefined), null);
  assert.equal(jwtExpiryMs("a.%%%.c"), null);
});

test("reasonText: lý do lạ vẫn có câu tiếng Việt, không để trống", () => {
  assert.ok(reasonText("khong-biet").length > 10);
  assert.ok(reasonText(undefined).length > 10);
});

// ---------------- Mô hình "số máy được phép" ----------------
test("login: hết chỗ (403 machine-limit) -> kind limit, giữ nguyên lời server, KHÔNG có phiên, KHÔNG lưu", async () => {
  const msg = "Tài khoản đã dùng hết số máy được phép (1/1). Liên hệ quản trị viên để gỡ máy cũ.";
  const { mgr, disk } = mk({ respond: () => ({ status: 403, body: { message: msg, code: "machine-limit", used: 1, max: 1 } }) });
  const r = await mgr.login("bob", "x");
  assert.deepEqual([r.ok, r.kind, r.message], [false, "limit", msg]);
  assert.equal(mgr.isLoggedIn(), false);
  assert.equal(disk.saves, 0);
});

test("login: 403 khác (khóa / thu hồi / máy của tài khoản khác) vẫn là denied, không lẫn với hết chỗ", async () => {
  const { mgr } = mk({ respond: () => ({ status: 403, body: { message: "Máy này đang được đăng ký cho tài khoản khác." } }) });
  assert.equal((await mgr.login("bob", "x")).kind, "denied");
});

test("login: tên máy dài/rỗng được xử lý: cắt 80 ký tự, thiếu thì gửi chuỗi rỗng, không làm hỏng đăng nhập", async () => {
  const long = mk({ hostname: "x".repeat(500), respond: () => OK_LOGIN });
  await long.mgr.login("bob", "x");
  assert.equal(long.calls[0].body.hostname.length, 80);
  const none = mk({ hostname: "", respond: () => OK_LOGIN });
  assert.equal((await none.mgr.login("bob", "x")).ok, true);
  assert.equal(none.calls[0].body.hostname, "");
});

test("login: sai thông tin vẫn là thông báo chung (không nhắc tới mã máy nữa)", async () => {
  const { mgr } = mk({ respond: () => ({ status: 401, body: {} }) });
  const r = await mgr.login("bob", "x");
  assert.equal(r.kind, "invalid");
  assert.doesNotMatch(r.message, /mã máy/i);
});

// ---------------- appFeatures ----------------
const OK_LOGIN_WITH_FEATURES = { status: 200, body: { token: mkJwt(Math.floor(Date.now() / 1000) + 30 * 86400), user: { id: 1, username: "bob", role: "user", appFeatures: ["app:render", "app:download"] } } };
const OK_LOGIN_NO_FEATURES = { status: 200, body: { token: mkJwt(Math.floor(Date.now() / 1000) + 30 * 86400), user: { id: 1, username: "bob", role: "user" } } };
const SAVED_WITH_FEATURES = (extra = {}) => ({ token: mkJwt(Math.floor(Date.now() / 1000) + 20 * 86400), user: { id: 1, username: "bob", appFeatures: ["app:trend", "app:automation"] }, machineId: "MACHINE-1234", verifiedAt: 1_700_000_000_000, ...extra });

test("login: server gửi appFeatures mảng -> lưu và getAppFeatures() trả mảng đã chuẩn hóa", async () => {
  const { mgr, disk } = mk({ respond: () => OK_LOGIN_WITH_FEATURES });
  const r = await mgr.login("bob", "x");
  assert.equal(r.ok, true);
  assert.deepEqual(mgr.getAppFeatures(), ["app:render", "app:download"]);
  assert.deepEqual(disk.value.user.appFeatures, ["app:render", "app:download"]);
});

test("login: server không gửi appFeatures (old server) -> getAppFeatures() null", async () => {
  const { mgr } = mk({ respond: () => OK_LOGIN_NO_FEATURES });
  await mgr.login("bob", "x");
  assert.equal(mgr.getAppFeatures(), null);
});

test("verify: server gửi appFeatures mới (kể cả []) -> cập nhật", async () => {
  const { mgr, disk } = mk({
    saved: SAVED_WITH_FEATURES(),
    respond: () => ({ status: 200, body: { valid: true, user: { id: 1, username: "bob", appFeatures: [] } } }),
  });
  await mgr.restore();
  assert.deepEqual(mgr.getAppFeatures(), []);
  assert.deepEqual(disk.value.user.appFeatures, []);
});

test("verify: server không gửi appFeatures -> giữ nguyên danh sách cũ", async () => {
  const { mgr, disk } = mk({
    saved: SAVED_WITH_FEATURES(),
    respond: () => ({ status: 200, body: { valid: true, user: { id: 1, username: "bob" } } }),
  });
  await mgr.restore();
  assert.deepEqual(mgr.getAppFeatures(), ["app:trend", "app:automation"]);
  assert.deepEqual(disk.value.user.appFeatures, ["app:trend", "app:automation"]);
});

test("verify: server gửi appFeatures rác (string thay vì array, array chứa non-string, không có prefix app:, trùng) -> chuẩn hóa/null", async () => {
  // Chuỗi thay vì mảng -> null, giữ nguyên cũ
  const m1 = mk({ saved: SAVED_WITH_FEATURES(), respond: () => ({ status: 200, body: { valid: true, user: { appFeatures: "app:render" } } }) });
  await m1.mgr.restore();
  assert.deepEqual(m1.mgr.getAppFeatures(), ["app:trend", "app:automation"]);

  // Mảng chứa non-string -> bỏ qua phần tử lỗi, giữ phần tử hợp lệ
  const m2 = mk({ saved: SAVED_WITH_FEATURES(), respond: () => ({ status: 200, body: { valid: true, user: { appFeatures: [123, "app:new", null, "app:new", "nope"] } } }) });
  await m2.mgr.restore();
  assert.deepEqual(m2.mgr.getAppFeatures(), ["app:new"]);

  // Mảng rỗng là hợp lệ
  const m3 = mk({ saved: SAVED_WITH_FEATURES(), respond: () => ({ status: 200, body: { valid: true, user: { appFeatures: [] } } }) });
  await m3.mgr.restore();
  assert.deepEqual(m3.mgr.getAppFeatures(), []);
});

test("restore: phiên đã lưu có appFeatures -> getAppFeatures() trả danh sách đã lưu", async () => {
  const { mgr } = mk({
    saved: SAVED_WITH_FEATURES(),
    respond: () => ({ status: 200, body: { valid: true, user: { id: 1, username: "bob" } } }),
  });
  await mgr.restore();
  assert.deepEqual(mgr.getAppFeatures(), ["app:trend", "app:automation"]);
});

test("offline verify: giữ nguyên appFeatures đã có", async () => {
  const { mgr } = mk({ saved: SAVED_WITH_FEATURES(), t0: 1_700_000_000_000 + DAY, respond: () => ({ throw: true }) });
  await mgr.restore();
  assert.deepEqual(mgr.getAppFeatures(), ["app:trend", "app:automation"]);
});

// ---------------- normalizeAppFeatures unit tests ----------------
test("normalizeAppFeatures: mảng hợp lệ -> mảng các string app:* duy nhất", () => {
  assert.deepEqual(normalizeAppFeatures(["app:a", "app:b"]), ["app:a", "app:b"]);
});

test("normalizeAppFeatures: mảng có trùng -> loại trùng", () => {
  assert.deepEqual(normalizeAppFeatures(["app:a", "app:a", "app:b"]), ["app:a", "app:b"]);
});

test("normalizeAppFeatures: mảng có phần tử không phải string hoặc không prefix app: -> bỏ qua", () => {
  assert.deepEqual(normalizeAppFeatures(["app:ok", 123, null, "nope", "app:yes"]), ["app:ok", "app:yes"]);
});

test("normalizeAppFeatures: string dài quá 64 ký tự -> cắt rồi lọc prefix", () => {
  const long = "app:" + "x".repeat(100);
  assert.equal(normalizeAppFeatures([long])[0].length, 64);
});

test("normalizeAppFeatures: quá 100 phần tử hợp lệ -> chỉ lấy 100 đầu", () => {
  const big = Array.from({ length: 150 }, (_, i) => `app:f${i}`);
  assert.equal(normalizeAppFeatures(big).length, 100);
});

test("normalizeAppFeatures: không phải mảng -> null", () => {
  assert.equal(normalizeAppFeatures("app:x"), null);
  assert.equal(normalizeAppFeatures(undefined), null);
  assert.equal(normalizeAppFeatures(null), null);
  assert.equal(normalizeAppFeatures({}), null);
});

test("normalizeAppFeatures: mảng rỗng -> mảng rỗng (không phải null)", () => {
  assert.deepEqual(normalizeAppFeatures([]), []);
});

// ---------------- appFeaturesChanged unit tests ----------------
test("appFeaturesChanged: cả hai null -> false (không đổi)", () => {
  assert.equal(appFeaturesChanged(null, null), false);
});

test("appFeaturesChanged: một bên null -> true (đổi)", () => {
  assert.equal(appFeaturesChanged(null, []), true);
  assert.equal(appFeaturesChanged([], null), true);
  assert.equal(appFeaturesChanged(null, ["app:x"]), true);
});

test("appFeaturesChanged: cùng nội dung khác thứ tự -> false", () => {
  assert.equal(appFeaturesChanged(["app:a", "app:b"], ["app:b", "app:a"]), false);
});

test("appFeaturesChanged: khác nội dung -> true", () => {
  assert.equal(appFeaturesChanged(["app:a"], ["app:b"]), true);
  assert.equal(appFeaturesChanged(["app:a", "app:b"], ["app:a"]), true);
  assert.equal(appFeaturesChanged([], ["app:x"]), true);
});

test("appFeaturesChanged: cùng nội dung cùng thứ tự -> false", () => {
  assert.equal(appFeaturesChanged(["app:a", "app:b"], ["app:a", "app:b"]), false);
  assert.equal(appFeaturesChanged([], []), false);
});

// ---------------- hạn sử dụng tài khoản ----------------
test("reasonText: lý do 'expired' có câu riêng, nhắc gia hạn (không rơi vào câu chung)", () => {
  const msg = reasonText("expired");
  assert.match(msg, /hết hạn/i);
  assert.match(msg, /gia hạn|quản trị viên/i);
  assert.notEqual(msg, reasonText("lý-do-lạ-không-có"), "phải khác câu mặc định");
});

test("verify: server báo tài khoản hết hạn (403 expired) -> ĐĂNG XUẤT NGAY, xóa phiên, lý do đọc được", async () => {
  const { mgr, disk } = mk({ respond: (url) => (/login/.test(url) ? OK_LOGIN : { status: 403, body: { valid: false, reason: "expired" } }) });
  await mgr.login("bob", "pw");
  const r = await mgr.verify();
  assert.equal(r.state, "invalid");
  assert.equal(r.reason, "expired");
  assert.match(r.message, /hết hạn/i);
  assert.equal(mgr.isLoggedIn(), false);
  assert.equal(disk.value, null, "phiên đã lưu bị xóa");
});

test("login: tài khoản hết hạn (403 account-expired) -> denied, giữ nguyên lời server, KHÔNG có phiên", async () => {
  const { mgr, disk } = mk({ respond: () => ({ status: 403, body: { message: "Tài khoản đã hết hạn. Liên hệ quản trị viên để gia hạn.", code: "account-expired" } }) });
  const r = await mgr.login("bob", "pw");
  assert.equal(r.ok, false);
  assert.equal(r.kind, "denied");
  assert.match(r.message, /hết hạn/);
  assert.equal(mgr.isLoggedIn(), false);
  assert.equal(disk.value, null);
});

test("login/verify: expiresAt + daysLeft từ server được giữ trong user để app hiển thị 'còn N ngày'", async () => {
  const login = { status: 200, body: { token: mkJwt(Math.floor(Date.now() / 1000) + 30 * 86400), user: { id: 1, username: "bob", role: "user", expiresAt: "2026-12-27", daysLeft: 20 } } };
  const { mgr } = mk({ respond: (url) => (/login/.test(url) ? login : { status: 200, body: { valid: true, user: { id: 1, username: "bob", role: "user", expiresAt: "2026-12-27", daysLeft: 19 } } }) });
  await mgr.login("bob", "pw");
  assert.equal(mgr.getUser().expiresAt, "2026-12-27");
  assert.equal(mgr.getUser().daysLeft, 20);
  await mgr.verify();
  assert.equal(mgr.getUser().daysLeft, 19, "verify cập nhật số ngày còn lại");
});

test("verify: server gia hạn xong gỡ hạn (expiresAt null) thì app cập nhật theo, không giữ hạn cũ", async () => {
  const login = { status: 200, body: { token: mkJwt(Math.floor(Date.now() / 1000) + 30 * 86400), user: { id: 1, username: "bob", role: "user", expiresAt: "2026-12-27", daysLeft: 5 } } };
  const { mgr } = mk({ respond: (url) => (/login/.test(url) ? login : { status: 200, body: { valid: true, user: { id: 1, username: "bob", role: "user", expiresAt: null, daysLeft: null } } }) });
  await mgr.login("bob", "pw");
  await mgr.verify();
  assert.equal(mgr.getUser().expiresAt, null);
  assert.equal(mgr.getUser().daysLeft, null);
});
