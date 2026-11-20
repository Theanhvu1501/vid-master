import test from "node:test";
import assert from "node:assert/strict";
import { createWebStore, WebStoreError } from "../sheet/web-store.js";

// Cấu hình kênh Auto và mẻ do APP sửa, lưu ở server (không còn sửa ở web). Máy chủ giả ghi lại từng yêu cầu.
function fake({ status = 200, body = {}, offline = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    calls.push({ method: init.method, path: u.pathname, body: init.body ? JSON.parse(init.body) : null, auth: init.headers?.Authorization });
    if (offline) throw new Error("ECONNREFUSED");
    return { status, ok: status >= 200 && status < 300, json: async () => body };
  };
  const disk = { m: new Map(), read(n) { return this.m.get(n) ?? null; }, write(n, d) { this.m.set(n, d); } };
  const store = createWebStore({ fetchImpl, getBase: () => "http://x", getToken: () => "TOK", disk });
  return { store, calls };
}

test("createChannelConfig: gửi POST /api/app/channel-configs kèm token, trả bản ghi mới", async () => {
  const { store, calls } = fake({ status: 201, body: { id: 7, name: "K" } });
  const r = await store.createChannelConfig({ name: "K", videosPerDay: 2 });
  assert.equal(r.id, 7);
  assert.equal(calls[0].method, "POST"); assert.equal(calls[0].path, "/api/app/channel-configs");
  assert.equal(calls[0].auth, "Bearer TOK"); assert.deepEqual(calls[0].body, { name: "K", videosPerDay: 2 });
});

test("createChannelConfig: lỗi server (trùng tên/GPM) giữ nguyên thông báo và mã để giao diện hiện đúng", async () => {
  const { store } = fake({ status: 409, body: { message: "GPM profile này đang ở mẻ “M1”", code: "gpm-taken" } });
  await assert.rejects(() => store.createChannelConfig({ name: "K" }), (e) => e instanceof WebStoreError && e.status === 409 && e.code === "gpm-taken" && /M1/.test(e.message));
});

test("deleteChannelConfig: DELETE đúng id; id rác bị chặn trước khi gọi mạng", async () => {
  const { store, calls } = fake();
  await store.deleteChannelConfig(12);
  assert.equal(calls[0].method, "DELETE"); assert.equal(calls[0].path, "/api/app/channel-configs/12");
  await assert.rejects(() => store.deleteChannelConfig("abc"), (e) => e.status === 400);
  assert.equal(calls.length, 1, "id rác không được gọi mạng");
});

test("importChannelConfigs: mặc định xem trước (dryRun), dryRun:false mới áp dụng", async () => {
  const { store, calls } = fake({ body: { dryRun: true, summary: { create: 1 } } });
  const rows = [["Tên kênh"], ["A"]];
  await store.importChannelConfigs(rows);
  assert.equal(calls[0].path, "/api/app/channel-configs/import"); assert.equal(calls[0].body.dryRun, true); assert.deepEqual(calls[0].body.rows, rows);
  await store.importChannelConfigs(rows, { apply: true, removeMissing: true });
  assert.equal(calls[1].body.dryRun, false); assert.equal(calls[1].body.removeMissing, true);
});

test("importChannelConfigs: không cho gửi bảng không phải mảng", async () => {
  const { store, calls } = fake();
  await assert.rejects(() => store.importChannelConfigs("rác"), (e) => e.status === 400);
  assert.equal(calls.length, 0);
});

test("listBatches: lấy từ server, giữ bản sao khi mất mạng và đánh dấu offline", async () => {
  const on = fake({ body: { batches: [{ id: 1, name: "M1", channels: [] }], machineId: "MID" } });
  const r1 = await on.store.listBatches();
  assert.equal(r1.offline, false); assert.equal(r1.batches[0].name, "M1");
  // cùng kho đĩa nhưng mất mạng: trả bản đã lưu
  const off = createWebStore({ fetchImpl: async () => { throw new Error("ECONNREFUSED"); }, getBase: () => "http://x", getToken: () => "TOK", disk: on.store._disk });
  const r2 = await off.listBatches();
  assert.equal(r2.offline, true); assert.equal(r2.batches[0].name, "M1");
});

test("listBatches: mất mạng mà chưa có bản lưu thì báo lỗi, không trả danh sách rỗng giả", async () => {
  const { store } = fake({ offline: true });
  await assert.rejects(() => store.listBatches(), (e) => e.offline === true);
});

test("tạo/sửa/xóa mẻ gọi đúng đường dẫn và phương thức", async () => {
  const { store, calls } = fake({ status: 200, body: { id: 3 } });
  await store.createBatch({ name: "M", totalDays: 19 });
  await store.updateBatch(3, { warnDays: 2 });
  await store.deleteBatch(3);
  assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), ["POST /api/app/batches", "PUT /api/app/batches/3", "DELETE /api/app/batches/3"]);
  assert.deepEqual(calls[1].body, { warnDays: 2 });
});

test("addBatchChannel / removeBatchChannel: gửi Profile ID; Profile ID có ký tự lạ được mã hóa trong đường dẫn", async () => {
  const { store, calls } = fake({ status: 200, body: {} });
  await store.addBatchChannel(3, { gpmProfileId: "PROFILE-01", name: "K" });
  await store.removeBatchChannel(3, "a/b c");
  assert.equal(calls[0].method, "POST"); assert.equal(calls[0].path, "/api/app/batches/3/channels"); assert.equal(calls[0].body.gpmProfileId, "PROFILE-01");
  assert.equal(calls[1].method, "DELETE"); assert.equal(calls[1].path, "/api/app/batches/3/channels/a%2Fb%20c");
});

test("markBatchRendered: POST đúng mẻ", async () => {
  const { store, calls } = fake({ body: { id: 3 } });
  await store.markBatchRendered(3);
  assert.equal(calls[0].method, "POST"); assert.equal(calls[0].path, "/api/app/batches/3/rendered");
});

test("mất mạng khi sửa: báo offline, không xếp hàng ghi bù (tránh xung đột khó giải thích)", async () => {
  const { store } = fake({ offline: true });
  await assert.rejects(() => store.createBatch({ name: "M" }), (e) => e.offline === true);
  await assert.rejects(() => store.deleteChannelConfig(1), (e) => e.offline === true);
});
