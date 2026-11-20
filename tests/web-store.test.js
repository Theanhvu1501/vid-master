import test from "node:test";
import assert from "node:assert/strict";
import { createWebStore, WebStoreError } from "../sheet/web-store.js";

const CH = (name, id, over = {}) => ({ sheetName: name, webId: id, enabled: true, uploadEnabled: true, videosPerDay: 3, renderMode: "crop", cfg: {}, proxy: "", gpmProfileId: "", postTimes: "", slotOverrides: {}, ...over });

// Máy chủ giả: có thể tắt (offline), đếm yêu cầu, ghi lại thân gửi lên.
function fake(over = {}) {
  const st = {
    online: true, calls: [], revision: "r1", channels: over.channels ?? [CH("K1", 11), CH("K2", 12)],
    rows: over.rows ?? { 11: [{ rowIndex: 101, url: "u1", status: "", uploadStatus: "" }, { rowIndex: 102, url: "u2", status: "done", uploadStatus: "" }], 12: [] },
    statuses: [], appended: [], failStatus: null, authLost: null,
  };
  const fetchImpl = async (url, init) => {
    const u = new URL(url), path = u.pathname, h = init.headers || {};
    st.calls.push({ method: init.method, path, headers: h, body: init.body ? JSON.parse(init.body) : null });
    if (!st.online) throw new Error("ECONNREFUSED");
    if (st.authLost) return { status: st.authLost, ok: false, json: async () => ({ message: "x", reason: "machine-unassigned" }) };
    const json = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
    if (path === "/api/app/channels") {
      if (h["If-None-Match"] === `"${st.revision}"`) return json(304, null);
      return json(200, { revision: st.revision, channels: st.channels });
    }
    let m = path.match(/^\/api\/app\/channels\/(\d+)\/videos$/);
    if (m && init.method === "GET") {
      const rev = "v" + (st.rows[m[1]] || []).length + ":" + (st.statuses.length);
      if (h["If-None-Match"] === `"${rev}"`) return json(304, null);
      return json(200, { revision: rev, rows: st.rows[m[1]] || [] });
    }
    if (m && init.method === "POST") { const body = JSON.parse(init.body); st.appended.push(...body.urls); return json(200, { added: body.urls.length }); }
    if (path === "/api/app/channel-configs" && init.method === "GET") return json(200, { machineId: "MID1", channels: st.channels.map((c) => ({ id: c.webId, name: c.sheetName, videosPerDay: c.videosPerDay, version: 3 })), schema: { modes: [], fields: [] } });
    if (path.startsWith("/api/app/channel-configs/") && init.method === "PUT") {
      const body = JSON.parse(init.body); st.edits = st.edits || []; st.edits.push({ path, body });
      if (st.editStatus) return json(st.editStatus, { message: "x", code: st.editStatus === 409 ? "version" : undefined });
      return json(200, { id: Number(path.split("/").pop()), ...body });
    }
    if (path === "/api/app/videos/status") {
      if (st.failStatus) return json(st.failStatus, { message: "bận" });
      const body = JSON.parse(init.body); st.statuses.push(...body.updates); return json(200, { applied: body.updates.length, stale: 0, rejected: [] });
    }
    return json(404, {});
  };
  return { st, fetchImpl };
}
function disk() {
  const m = new Map();
  return { read: (n) => (m.has(n) ? JSON.parse(m.get(n)) : null), write: (n, d) => m.set(n, JSON.stringify(d)), _m: m };
}
function mk(over = {}) {
  const f = fake(over), d = over.disk || disk();
  let t = 1000;
  const store = createWebStore({ fetchImpl: f.fetchImpl, getBase: () => "http://srv", getToken: () => over.token ?? "APPTOK", disk: d, now: () => (t += 10), getProxyAuth: over.getProxyAuth, onAuthLost: over.onAuthLost });
  return { store, f, d };
}

test("readConfigSheet: lấy cấu hình từ web, gửi token trong header, lưu cache xuống đĩa", async () => {
  const { store, f, d } = mk();
  const ch = await store.readConfigSheet();
  assert.deepEqual(ch.map((c) => c.sheetName), ["K1", "K2"]);
  assert.equal(f.st.calls[0].headers.Authorization, "Bearer APPTOK");
  assert.equal(d.read("channels").channels.length, 2);
});

test("readConfigSheet: revision không đổi -> 304, vẫn trả cấu hình đã có (không tải lại)", async () => {
  const { store, f } = mk();
  await store.readConfigSheet();
  const ch = await store.readConfigSheet();
  assert.equal(ch.length, 2);
  assert.equal(f.st.calls[1].headers["If-None-Match"], '"r1"');
});

test("readConfigSheet: mất mạng thì dùng cấu hình đã lưu; khởi động lại app vẫn dùng được", async () => {
  const dk = disk();
  const a = mk({ disk: dk });
  await a.store.readConfigSheet();
  // "khởi động lại": store mới, cùng đĩa, server tắt
  const b = mk({ disk: dk }); b.f.st.online = false;
  const ch = await b.store.readConfigSheet();
  assert.deepEqual(ch.map((c) => c.sheetName), ["K1", "K2"]);
});

test("readConfigSheet: mất mạng và CHƯA có cache -> ném lỗi rõ ràng (không chạy với cấu hình rỗng)", async () => {
  const { store, f } = mk(); f.st.online = false;
  await assert.rejects(() => store.readConfigSheet(), (e) => e instanceof WebStoreError && e.offline);
});

test("phiên bị thu hồi (403): ném lỗi có reason và gọi onAuthLost; KHÔNG dùng cache", async () => {
  let lost = null;
  const { store, f } = mk({ onAuthLost: (e) => (lost = e) });
  await store.readConfigSheet();
  f.st.authLost = 403; f.st.revision = "r2";
  await assert.rejects(() => store.readConfigSheet(), (e) => e.status === 403 && e.reason === "machine-unassigned");
  assert.equal(lost.reason, "machine-unassigned");
});

test("chưa đăng nhập (không có token): lỗi 401, không gọi mạng", async () => {
  const { store, f } = mk({ token: "" });
  await assert.rejects(() => store.readConfigSheet(), (e) => e.status === 401);
  assert.equal(f.st.calls.length, 0);
});

// ---------------- mật khẩu proxy ----------------
test("proxy: truyền host:port hiện tại cho kho mật khẩu; kho từ chối (proxy đã đổi) thì giữ nguyên scheme://host:port", async () => {
  const seen = [];
  const { store } = mk({ channels: [CH("K1", 11, { proxy: "socks5://5.5.5.5:99" })], getProxyAuth: (n, hp) => { seen.push([n, hp]); return hp === "1.1.1.1:80" ? { user: "u", pass: "p" } : null; } });
  const [c] = await store.readConfigSheet();
  assert.deepEqual(seen[0], ["K1", "5.5.5.5:99"]);
  assert.equal(c.proxy, "socks5://5.5.5.5:99");
});

test("proxy: ghép user/mật khẩu cục bộ vào scheme://host:port; web không bao giờ nhận lại mật khẩu", async () => {
  const { store, f } = mk({ channels: [CH("K1", 11, { proxy: "socks5://1.2.3.4:80" })], getProxyAuth: (n) => (n === "K1" ? { user: "bob", pass: "p@ss:w/rd" } : null) });
  const [c] = await store.readConfigSheet();
  assert.equal(c.proxy, "socks5://bob:p%40ss%3Aw%2Frd@1.2.3.4:80");
  assert.ok(!JSON.stringify(f.st.calls).includes("p@ss"), "mật khẩu không được đi qua mạng");
});

test("listChannelConfigs: lấy từ web, lưu bản sao; mất mạng trả bản đã lưu kèm offline=true", async () => {
  const dk = disk();
  const a = mk({ disk: dk });
  const r1 = await a.store.listChannelConfigs();
  assert.equal(r1.offline, false); assert.deepEqual(r1.channels.map((c) => c.name), ["K1", "K2"]); assert.ok(r1.schema);
  const b = mk({ disk: dk }); b.f.st.online = false;
  const r2 = await b.store.listChannelConfigs();
  assert.equal(r2.offline, true, "mất mạng: dùng bản đã lưu và báo offline để giao diện khóa nút sửa");
  assert.equal(r2.channels.length, 2);
});

test("listChannelConfigs: mất mạng và CHƯA có bản lưu -> ném lỗi (không giả vờ rỗng)", async () => {
  const { store, f } = mk(); f.st.online = false;
  await assert.rejects(() => store.listChannelConfigs(), (e) => e.offline === true);
});

test("updateChannelConfig: gửi PUT lên web, kèm phiên bản; sau đó lần đọc cấu hình chạy kế tiếp KHÔNG dùng ETag cũ", async () => {
  const { store, f } = mk(); await store.readConfigSheet();
  const r = await store.updateChannelConfig(11, { videosPerDay: 5, version: 3 });
  assert.equal(r.videosPerDay, 5);
  const put = f.st.edits[0];
  assert.equal(put.path, "/api/app/channel-configs/11"); assert.deepEqual(put.body, { videosPerDay: 5, version: 3 });
  await store.readConfigSheet();
  const last = f.st.calls.filter((c) => c.path === "/api/app/channels").at(-1);
  assert.equal(last.headers["If-None-Match"], undefined, "đã sửa nên phải lấy lại bản mới");
});

test("updateChannelConfig: mất mạng -> báo lỗi offline (KHÔNG xếp hàng ghi bù); 409 phiên bản -> báo lỗi có status", async () => {
  const a = mk(); await a.store.readConfigSheet(); a.f.st.online = false;
  await assert.rejects(() => a.store.updateChannelConfig(11, { videosPerDay: 1 }), (e) => e.offline === true);
  assert.equal(a.store.pending(), 0, "không có gì bị xếp hàng để ghi bù");
  const b = mk(); await b.store.readConfigSheet(); b.f.st.editStatus = 409;
  await assert.rejects(() => b.store.updateChannelConfig(11, { videosPerDay: 1 }), (e) => e.status === 409);
  await assert.rejects(() => b.store.updateChannelConfig("abc", {}), (e) => e.status === 400);
});

test("proxy: web đã giao sẵn user/mật khẩu (user:pass@host:port) thì dùng NGUYÊN, không ghép thêm từ kho cục bộ", async () => {
  const seen = [];
  const { store } = mk({ channels: [CH("K1", 11, { proxy: "socks5://web:webpw@1.2.3.4:80" })], getProxyAuth: (n, hp) => { seen.push([n, hp]); return { user: "may", pass: "maypw" }; } });
  const [c] = await store.readConfigSheet();
  assert.equal(c.proxy, "socks5://web:webpw@1.2.3.4:80");
  assert.equal(seen.length, 0, "không cần hỏi kho cục bộ");
});

test("proxy: chưa nhập user/mật khẩu trong app -> giữ nguyên scheme://host:port; kênh không proxy không đổi", async () => {
  const { store } = mk({ channels: [CH("K1", 11, { proxy: "socks5://1.2.3.4:80" }), CH("K2", 12)] });
  const [a, b] = await store.readConfigSheet();
  assert.equal(a.proxy, "socks5://1.2.3.4:80");
  assert.equal(b.proxy, "");
});

test("proxy: không sửa đối tượng đã cache (ghép mật khẩu chỉ trên bản sao)", async () => {
  const { store, d } = mk({ channels: [CH("K1", 11, { proxy: "socks5://1.2.3.4:80" })], getProxyAuth: () => ({ user: "u", pass: "p" }) });
  await store.readConfigSheet();
  assert.equal(d.read("channels").channels[0].proxy, "socks5://1.2.3.4:80", "bản lưu trên đĩa không chứa mật khẩu");
});

// ---------------- video ----------------
test("readChannelUrls: trả đúng dạng runner cần (rowIndex, url, status, uploadStatus)", async () => {
  const { store } = mk(); await store.readConfigSheet();
  const rows = await store.readChannelUrls("K1");
  assert.deepEqual(rows[1], { rowIndex: 102, url: "u2", status: "done", uploadStatus: "" });
});

test("readChannelUrls: kênh không có trên web/máy này -> lỗi rõ ràng", async () => {
  const { store } = mk(); await store.readConfigSheet();
  await assert.rejects(() => store.readChannelUrls("KHONGCO"), (e) => e.status === 404 && /chưa có trên web/.test(e.message));
});

test("setUrlStatus: runner thấy NGAY trạng thái mới dù chưa gửi được lên web", async () => {
  const { store, f } = mk(); await store.readConfigSheet(); await store.readChannelUrls("K1");
  f.st.online = false;
  await store.setUrlStatus("K1", 101, "done");
  const rows = await store.readChannelUrls("K1"); // đọc lại trong lúc offline
  assert.equal(rows.find((r) => r.rowIndex === 101).status, "done");
  assert.equal(store.pending(), 1);
});

test("hàng đợi: mất mạng thì giữ, có mạng thì gửi bù đúng thứ tự; gộp nhiều lần ghi một video", async () => {
  const { store, f } = mk(); await store.readConfigSheet(); await store.readChannelUrls("K1");
  f.st.online = false;
  await store.setUrlStatus("K1", 101, "đã tải");
  await store.setUrlStatus("K1", 101, "done");
  await store.setUploadStatus("K1", 101, "⏳ đang upload");
  await store.setUploadStatus("K1", 102, "✅ lên lịch 01/02/2026 08:00");
  assert.equal(store.pending(), 2, "hai video, mỗi video một mục (đã gộp)");
  f.st.online = true;
  const sent = await store.flush();
  assert.equal(sent, 2);
  assert.equal(store.pending(), 0);
  const u101 = f.st.statuses.find((x) => x.id === 101);
  assert.deepEqual([u101.b, u101.c], ["done", "⏳ đang upload"]);
  assert.ok(Number.isFinite(u101.at), "mỗi mục có mốc thời gian");
});

test("hàng đợi: lưu xuống đĩa nên khởi động lại app vẫn còn và gửi bù được", async () => {
  const dk = disk();
  const a = mk({ disk: dk }); await a.store.readConfigSheet(); await a.store.readChannelUrls("K1");
  a.f.st.online = false;
  await a.store.setUrlStatus("K1", 101, "done");
  const b = mk({ disk: dk });
  assert.equal(b.store.pending(), 1);
  await b.store.readConfigSheet();
  assert.equal(await b.store.flush(), 1);
  assert.equal(b.f.st.statuses[0].b, "done");
});

test("hàng đợi: server lỗi 500 -> giữ nguyên để thử lại, không mất mục nào", async () => {
  const { store, f } = mk(); await store.readConfigSheet(); await store.readChannelUrls("K1");
  f.st.failStatus = 500;
  await store.setUrlStatus("K1", 101, "done");
  await store.flush();
  assert.equal(store.pending(), 1);
  f.st.failStatus = null;
  await store.flush();
  assert.equal(store.pending(), 0);
});

test("hàng đợi: ghi đè trong lúc đang gửi thì mục mới KHÔNG bị mất", async () => {
  const { store, f } = mk(); await store.readConfigSheet(); await store.readChannelUrls("K1");
  // làm chậm lần gửi đầu để ghi chen vào giữa
  const orig = f.fetchImpl; let hold = null;
  const slow = createWebStore({
    fetchImpl: async (u, i) => { if (u.endsWith("/videos/status") && !hold) { hold = new Promise((r) => setTimeout(r, 30)); await hold; } return orig(u, i); },
    getBase: () => "http://srv", getToken: () => "T", disk: disk(), now: (() => { let t = 0; return () => ++t; })(),
  });
  await slow.readConfigSheet(); await slow.readChannelUrls("K1");
  await slow.setUrlStatus("K1", 101, "A");
  const p = slow.flush();
  await new Promise((r) => setTimeout(r, 5));
  await slow.setUrlStatus("K1", 101, "B"); // ghi đè khi lô "A" đang bay
  await p;
  // Lô "A" đang bay khi B được ghi: vòng gửi phải nhận ra B còn mới hơn và gửi tiếp, thứ tự A rồi B, không mất mục nào.
  assert.equal(slow.pending(), 0);
  const bs = f.st.statuses.filter((x) => x.id === 101).map((x) => x.b);
  assert.deepEqual(bs, ["A", "B"]);
});

test("readChannelUrls: gửi bù hàng đợi TRƯỚC khi đọc để không đọc về trạng thái cũ", async () => {
  const { store, f } = mk(); await store.readConfigSheet(); await store.readChannelUrls("K1");
  await store.setUrlStatus("K1", 101, "done");
  await store.readChannelUrls("K1");
  assert.equal(f.st.statuses.length, 1);
  const iStatus = f.st.calls.findIndex((c) => c.path === "/api/app/videos/status");
  const iRead = f.st.calls.map((c) => c.path).lastIndexOf("/api/app/channels/11/videos");
  assert.ok(iStatus < iRead, "gửi trước, đọc sau");
});

test("readChannelUrls: mất mạng thì dùng danh sách đã lưu cộng các thay đổi chưa gửi", async () => {
  const { store, f } = mk(); await store.readConfigSheet(); await store.readChannelUrls("K1");
  f.st.online = false;
  await store.setUploadStatus("K1", 102, "✅ x");
  const rows = await store.readChannelUrls("K1");
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.rowIndex === 102).uploadStatus, "✅ x");
});

test("appendUrls: gửi lên web và buộc lần đọc sau lấy lại danh sách đầy đủ", async () => {
  const { store, f } = mk(); await store.readConfigSheet(); await store.readChannelUrls("K2");
  const n = await store.appendUrls("K2", ["a.mp4", " ", "b.mp4"]);
  assert.equal(n, 2);
  assert.deepEqual(f.st.appended, ["a.mp4", "b.mp4"]);
  f.st.rows[12] = [{ rowIndex: 201, url: "a.mp4", status: "", uploadStatus: "" }, { rowIndex: 202, url: "b.mp4", status: "", uploadStatus: "" }];
  assert.equal((await store.readChannelUrls("K2")).length, 2);
  assert.equal(await store.appendUrls("K2", []), 0);
});

test("setUrlStatus: kênh không có trên web -> ném lỗi (không âm thầm nuốt trạng thái)", async () => {
  const { store } = mk(); await store.readConfigSheet();
  await assert.rejects(() => store.setUrlStatus("KHONGCO", 1, "done"), (e) => e.status === 404);
});

test("không gửi gì lên web ngoài trạng thái/URL: mật khẩu proxy không lọt vào thân yêu cầu", async () => {
  const { store, f } = mk({ channels: [CH("K1", 11, { proxy: "socks5://1.2.3.4:80" })], getProxyAuth: () => ({ user: "u", pass: "SecretPw" }) });
  await store.readConfigSheet(); await store.readChannelUrls("K1");
  await store.setUrlStatus("K1", 101, "done"); await store.flush();
  assert.ok(!JSON.stringify(f.st.calls).includes("SecretPw"));
});
