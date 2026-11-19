import test from "node:test";
import assert from "node:assert/strict";
import { createSessionManager, jwtExpiryMs, reasonText, OFFLINE_GRACE_MS } from "../app-session.js";

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
  const mgr = createSessionManager({ fetchImpl, getBase: () => "http://srv", getMachineId: () => over.machineId ?? "MACHINE-1234", store, now: () => t });
  return { mgr, calls, disk, advance: (ms) => { t += ms; }, now: () => t };
}
const OK_LOGIN = { status: 200, body: { token: mkJwt(Math.floor(Date.now() / 1000) + 30 * 86400), user: { id: 1, username: "bob", role: "user" } } };

// ---------------- đăng nhập ----------------
test("login: đúng -> gửi tài khoản + mật khẩu + MÃ MÁY; lưu phiên; trả user", async () => {
  const { mgr, calls, disk } = mk({ respond: () => OK_LOGIN });
  const r = await mgr.login("  bob ", "pw123");
  assert.equal(r.ok, true);
  assert.deepEqual(calls[0].body, { username: "bob", password: "pw123", machineId: "MACHINE-1234" });
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
