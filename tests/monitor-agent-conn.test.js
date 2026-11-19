import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  buildChannelEntry, sheetEventToProgress, toAgentUrl, toHttpBase, createMonitorAgent, DEFAULT_SERVER_URL,
} from "../sheet/monitor-agent.js";

const TODAY = "2026-06-15";
const U = "https://youtu.be/aaaaaaaaaaa";
const ch = (o = {}) => ({ sheetName: "k1", enabled: true, uploadEnabled: true, gpmProfileId: "p1", postTimes: "8:00", videosPerDay: 2, renderMode: "topTransparent", videoSource: "download", proxy: "", ...o });

test("toHttpBase: gốc HTTP(S) của server, bỏ đường dẫn; ws/wss đổi sang http/https", () => {
  assert.equal(toHttpBase("https://vidmaster.nbcuong.com/api/x"), "https://vidmaster.nbcuong.com");
  assert.equal(toHttpBase("wss://a.b/ws/agent"), "https://a.b");
  assert.equal(toHttpBase("localhost:3000"), "http://localhost:3000");
  assert.equal(toHttpBase("ftp://x"), null);
  assert.equal(toHttpBase(""), null);
  assert.equal(toAgentUrl(DEFAULT_SERVER_URL), "wss://vidmaster.nbcuong.com/ws/agent");
});

test("buildChannelEntry: autoUpload chỉ true khi bật upload + có GPM profile + có giờ đăng", () => {
  assert.equal(buildChannelEntry(ch(), [], { today: TODAY }).autoUpload, true);
  assert.equal(buildChannelEntry(ch({ gpmProfileId: "" }), [], { today: TODAY }).autoUpload, false);
  assert.equal(buildChannelEntry(ch({ postTimes: "  " }), [], { today: TODAY }).autoUpload, false);
  assert.equal(buildChannelEntry(ch({ uploadEnabled: false }), [], { today: TODAY }).autoUpload, false);
});

// ---------- Tiến trình từng video ----------
test("sheetEventToProgress: đi đúng các bước tải -> render -> upload -> thumbnail -> lịch -> xong", () => {
  const p = (evt, o) => sheetEventToProgress({ channel: "k", url: U, ...evt }, o);
  const dl = p({ type: "channel-status", status: "đang tải" });
  assert.deepEqual([dl.stage, dl.state], ["download", "active"]);
  const wt = p({ type: "channel-status", status: "chờ 75s trước khi tải" });
  assert.deepEqual([wt.stage, wt.state], ["download", "waiting"]);
  assert.equal(p({ type: "channel-status", status: "đang render" }).stage, "render");
  const rd = p({ type: "video-rendered", title: "T" });
  assert.deepEqual([rd.stage, rd.state], ["upload", "waiting"]);
  assert.equal(p({ type: "upload-status", status: "⏳ đang upload" }).stage, "upload");
  assert.equal(p({ type: "upload-status", status: "b1: đã tải file video" }).stage, "upload");
  assert.equal(p({ type: "upload-status", status: "b2: upload xong" }).stage, "thumb");
  assert.equal(p({ type: "upload-status", status: "b3: đã thay thumbnail" }).stage, "schedule");
  assert.equal(p({ type: "upload-status", status: "b4: đã đặt giờ lịch" }).stage, "schedule");
  const done = p({ type: "upload-status", status: "✅ lên lịch 16/06/2026 08:00" });
  assert.deepEqual([done.stage, done.state], ["done", "done"]);
});

test("sheetEventToProgress: lỗi giữ NGUYÊN bước đang chạy (stage=null) để web biết hỏng ở bước nào", () => {
  const e = sheetEventToProgress({ type: "error", channel: "k", url: U, message: "ffmpeg chết" });
  assert.deepEqual([e.stage, e.state, e.detail], [null, "error", "ffmpeg chết"]);
  assert.equal(sheetEventToProgress({ type: "upload-status", channel: "k", url: U, status: "❌ lỗi: hết quota" }).state, "error");
  assert.equal(sheetEventToProgress({ type: "upload-status", channel: "k", url: U, status: "⏸ chờ: hết slot ngày mai" }).state, "waiting");
});

test("sheetEventToProgress: kênh không tự upload thì render xong là KẾT THÚC (không treo ở bước upload)", () => {
  const r = sheetEventToProgress({ type: "video-rendered", channel: "k", sourceUrl: U }, { autoUpload: false });
  assert.deepEqual([r.stage, r.state, r.upload], ["render", "done", false]);
});

test("sheetEventToProgress: bỏ qua sự kiện không gắn với video (log, 'đủ hôm nay', thiếu url/kênh, test render)", () => {
  assert.equal(sheetEventToProgress({ type: "log", message: "x" }), null);
  assert.equal(sheetEventToProgress({ type: "channel-status", channel: "k", status: "đủ hôm nay" }), null);
  assert.equal(sheetEventToProgress({ type: "channel-status", channel: "k", status: "test: đang render", url: U }), null);
  assert.equal(sheetEventToProgress({ type: "channel-status", status: "đang tải", url: U }), null);
  assert.equal(sheetEventToProgress({ type: "error", channel: "k", message: "không gắn video" }), null);
  assert.equal(sheetEventToProgress(null), null);
});

// ---------- WebSocket + fetch giả ----------
class FakeWS extends EventEmitter {
  static instances = [];
  constructor(url, opts) { super(); this.url = url; this.opts = opts; this.readyState = 0; this.sent = []; FakeWS.instances.push(this); }
  send(d) { this.sent.push(JSON.parse(d)); }
  close(code) { this.readyState = 3; this.emit("close", code ?? 1000, Buffer.from("")); }
  terminate() { this.readyState = 3; this.emit("close", 1006, Buffer.from("")); }
  open() { this.readyState = 1; this.emit("open"); }
  recv(o) { this.emit("message", Buffer.from(JSON.stringify(o))); }
}

const ISSUED = "vmt_issued_by_server_0123456789abcdef";
const OLD = "vmt_old_token_0123456789abcdefgh";

function mkAgent(over = {}) {
  FakeWS.instances = [];
  const store = { token: over.token ?? "", saved: [] };
  const claimCalls = [];
  const claimRes = over.claim ?? { status: 200, body: { token: ISSUED } };
  const fetchImpl = async (url, init) => {
    claimCalls.push({ url, body: JSON.parse(init.body) });
    const r = typeof claimRes === "function" ? claimRes() : claimRes;
    if (r.throw) throw new Error("ECONNREFUSED");
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body ?? {} };
  };
  const settings = { monitorEnabled: true, ...over.settings };
  const agent = createMonitorAgent({
    getSettings: () => settings,
    getToken: () => store.token,
    saveToken: (t) => { store.token = t; store.saved.push(t); },
    getServerUrl: () => over.serverUrl ?? "http://localhost:3000",
    getMachineId: () => "MID1", appVersion: "9.9.9", sessionId: "SESS-1",
    collectSnapshot: over.collectSnapshot || (async () => ({ type: "snapshot", channels: [{ name: "kauto", autoUpload: true }, { name: "kmanual", autoUpload: false }] })),
    getState: () => ({ running: true }), WebSocketImpl: FakeWS, fetchImpl,
    backoffMs: [10], authBackoffMs: 10, snapshotMinMs: 0, jitterMs: 0, ...over.opts,
  });
  return { agent, settings, store, claimCalls };
}
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const last = () => FakeWS.instances.at(-1);
const welcomeOn = async (s) => { s.open(); s.recv({ type: "welcome", heartbeatSec: 20 }); await tick(); };
const TOK = "vmt_t_0123456789abcdefghij";

test("agent: đã có token -> KHÔNG gọi claim, kết nối thẳng; token nằm trong header, không nằm trong URL", async () => {
  const { agent, claimCalls } = mkAgent({ token: TOK });
  agent.start(); await tick();
  assert.equal(claimCalls.length, 0);
  const s = last();
  assert.equal(s.url, "ws://localhost:3000/ws/agent");
  assert.equal(s.opts.headers.Authorization, `Bearer ${TOK}`);
  assert.equal(s.url.includes("vmt_"), false, "token không được nằm trong URL (sẽ lộ ở log)");
  s.open();
  assert.deepEqual(s.sent[0], { type: "hello", machineId: "MID1", appVersion: "9.9.9", sessionId: "SESS-1" });
  assert.equal(s.sent.length, 1, "chưa welcome thì chưa gửi gì khác");
  s.recv({ type: "welcome", heartbeatSec: 20 }); await tick();
  assert.deepEqual(s.sent.map((m) => m.type), ["hello", "status", "snapshot"]);
  agent.stop();
});

test("agent: chưa có token -> tự xin server (gửi machineId), lưu token nhận được rồi mới kết nối", async () => {
  const { agent, claimCalls, store } = mkAgent();
  agent.start(); await tick(40);
  assert.equal(claimCalls.length, 1);
  assert.equal(claimCalls[0].url, "http://localhost:3000/api/agent/claim");
  assert.deepEqual(claimCalls[0].body, { machineId: "MID1" });
  assert.deepEqual(store.saved, [ISSUED]);
  assert.equal(last().opts.headers.Authorization, `Bearer ${ISSUED}`);
  agent.stop();
});

test("agent: claim bị từ chối -> báo lý do dễ hiểu bằng tiếng Việt, KHÔNG mở socket", async () => {
  for (const [status, re] of [[404, /chưa được cấp license/], [403, /thu hồi/], [409, /Đặt lại kết nối/], [429, /quá nhiều/]]) {
    const { agent } = mkAgent({ claim: { status, body: {} } });
    agent.start(); await tick(40);
    assert.equal(FakeWS.instances.length, 0, `status ${status}: không được mở socket`);
    assert.equal(agent.getStatus().state, "error");
    assert.match(agent.getStatus().message, re);
    agent.stop();
  }
});

test("agent: server tắt/lỗi mạng lúc claim -> thử lại với backoff, lên lại là tự nối được", async () => {
  let n = 0;
  const { agent } = mkAgent({ claim: () => (++n < 3 ? { throw: true } : { status: 200, body: { token: "vmt_late_token_0123456789abcdef" } }) });
  agent.start(); await tick(150);
  assert.ok(n >= 3, "phải thử lại cho tới khi được");
  assert.equal(last().opts.headers.Authorization, "Bearer vmt_late_token_0123456789abcdef");
  agent.stop();
});

test("agent: server báo 401 (token không còn khớp) -> xóa token cũ và tự xin lại token mới", async () => {
  const { agent, store, claimCalls } = mkAgent({ token: OLD });
  agent.start(); await tick();
  last().emit("unexpected-response", {}, { statusCode: 401 }); await tick(80);
  assert.ok(store.saved.includes(""), "token cũ phải bị xóa");
  assert.equal(claimCalls.length, 1);
  assert.equal(store.token, ISSUED);
  agent.stop();
});

test("agent: đóng với mã 4001 (admin đặt lại kết nối) -> xin token mới, không coi là lỗi", async () => {
  const { agent, store, claimCalls } = mkAgent({ token: OLD });
  agent.start(); await tick(); await welcomeOn(last());
  last().close(4001); await tick(80);
  assert.equal(claimCalls.length, 1);
  assert.equal(store.token, ISSUED);
  agent.stop();
});

test("agent: 403 khi upgrade -> 'License bị thu hồi'; đóng 4003/4004/4005 -> báo lý do và thử lại thưa", async () => {
  let m = mkAgent({ token: TOK }); m.agent.start(); await tick();
  last().emit("unexpected-response", {}, { statusCode: 403 });
  assert.match(m.agent.getStatus().message, /License/); m.agent.stop();
  for (const [code, re] of [[4003, /không thuộc máy/], [4004, /license|xóa/i], [4005, /ứng dụng khác/]]) {
    m = mkAgent({ token: TOK }); m.agent.start(); await tick(); await welcomeOn(last());
    last().close(code);
    assert.equal(m.agent.getStatus().state, "error");
    assert.match(m.agent.getStatus().message, re);
    m.agent.stop();
  }
});

test("agent: mất kết nối -> tự nối lại; sự kiện phát sinh lúc mất mạng được gửi bù đúng thứ tự", async () => {
  const { agent } = mkAgent({ token: TOK });
  agent.start(); await tick(); const a = last(); await welcomeOn(a);
  a.close(1006);
  agent.onSheetEvent({ type: "upload-status", channel: "k", status: "✅ lên lịch 16/06/2026 08:00", title: "A" });
  agent.onSheetEvent({ type: "error", channel: "k", message: "B" });
  await tick(50);
  const b = last(); assert.notEqual(b, a, "phải mở kết nối mới");
  await welcomeOn(b);
  assert.deepEqual(b.sent.filter((m) => m.type === "event").map((e) => e.level), ["success", "error"]);
  agent.stop();
});

test("agent: bộ đệm sự kiện có giới hạn, bỏ cái cũ nhất", async () => {
  const { agent } = mkAgent({ token: TOK, opts: { maxBuffered: 3 } });
  agent.start(); await tick();
  for (let i = 0; i < 6; i++) agent.onSheetEvent({ type: "error", channel: "k", message: `m${i}` });
  await welcomeOn(last());
  assert.deepEqual(last().sent.filter((m) => m.type === "event").map((e) => e.message), ["m3", "m4", "m5"]);
  agent.stop();
});

test("agent: gửi tiến trình từng video; kênh thủ công (autoUpload=false) kết thúc ngay sau render", async () => {
  const { agent } = mkAgent({ token: TOK });
  agent.start(); await tick(); await welcomeOn(last());
  const prog = () => last().sent.filter((m) => m.type === "progress");
  agent.onSheetEvent({ type: "channel-status", channel: "kauto", status: "đang render", url: U });
  agent.onSheetEvent({ type: "video-rendered", channel: "kauto", sourceUrl: U, title: "V1" });
  agent.onSheetEvent({ type: "video-rendered", channel: "kmanual", sourceUrl: U, title: "V2" });
  agent.onSheetEvent({ type: "log", message: "ồn" });
  assert.deepEqual(prog().map((p) => [p.channel, p.stage, p.state]), [["kauto", "render", "active"], ["kauto", "upload", "waiting"], ["kmanual", "render", "done"]]);
  agent.stop();
});

test("agent: stop() đóng kết nối và không tự nối lại; reconfigure() theo cờ bật/tắt", async () => {
  const m = mkAgent({ token: TOK });
  m.agent.start(); await tick(); await welcomeOn(last());
  m.agent.stop(); const n = FakeWS.instances.length; await tick(40);
  assert.equal(FakeWS.instances.length, n);
  assert.equal(m.agent.getStatus().state, "off");
  m.settings.monitorEnabled = false; m.agent.reconfigure(); await tick(); assert.equal(FakeWS.instances.length, n);
  m.settings.monitorEnabled = true; m.agent.reconfigure(); await tick(); assert.equal(FakeWS.instances.length, n + 1);
  m.agent.stop();
});

test("agent: xong lượt/render/upload thì gửi snapshot sớm; sự kiện vụn thì không", async () => {
  let snaps = 0;
  const { agent } = mkAgent({ token: TOK, collectSnapshot: async () => { snaps++; return { type: "snapshot", channels: [] }; } });
  agent.start(); await tick(); await welcomeOn(last());
  assert.equal(snaps, 1);
  agent.onSheetEvent({ type: "log", message: "ồn" }); await tick();
  assert.equal(snaps, 1);
  agent.onSheetEvent({ type: "done" }); await tick(30);
  assert.equal(snaps, 2);
  agent.stop();
});

test("agent: collectSnapshot ném lỗi -> chỉ ghi log, kết nối vẫn sống", async () => {
  const logs = [];
  const { agent } = mkAgent({ token: TOK, collectSnapshot: async () => { throw new Error("Sheet hỏng"); }, opts: { log: (m) => logs.push(m) } });
  agent.start(); await tick(); await welcomeOn(last());
  assert.equal(agent.isConnected(), true);
  assert.ok(logs.some((l) => l.includes("Sheet hỏng")));
  agent.stop();
});

// ---------- Tác vụ chạy tay ----------
test("agent: tác vụ tay gửi 'task' lên; kết thúc thêm một sự kiện đúng mức (ok=success, partial=warning, error=error)", async () => {
  const { agent } = mkAgent({ token: TOK });
  agent.start(); await tick(); await welcomeOn(last());
  const sent = () => last().sent;
  agent.onTaskEvent({ type: "task", phase: "start", id: "render.js#1", key: "render.js", label: "Render video", startedAt: 1 });
  assert.deepEqual(sent().at(-1), { type: "task", phase: "start", id: "render.js#1", key: "render.js", label: "Render video", startedAt: 1 });
  assert.equal(sent().filter((m) => m.type === "event").length, 0, "bắt đầu thì chưa có sự kiện");
  for (const [outcome, level] of [["ok", "success"], ["partial", "warning"], ["error", "error"], ["skipped", "info"]]) {
    agent.onTaskEvent({ type: "task", phase: "end", id: "x", label: "Đổi thumbnail", outcome, summary: "tóm tắt" });
    const ev = sent().filter((m) => m.type === "event").at(-1);
    assert.equal(ev.level, level, outcome);
    assert.equal(ev.kind, "task");
    assert.match(ev.message, /Đổi thumbnail: tóm tắt/);
  }
  agent.stop();
});

test("agent: kết quả từng kênh của tác vụ tay thành sự kiện; mất mạng thì giữ lại gửi bù", async () => {
  const { agent } = mkAgent({ token: TOK });
  agent.start(); await tick(); const a = last(); await welcomeOn(a);
  agent.onTaskChannelResult("t", { level: "success", kind: "task", channel: "K1", message: "Đổi thumbnail: K1 xong" });
  assert.equal(a.sent.at(-1).message, "Đổi thumbnail: K1 xong");
  a.close(1006);
  agent.onTaskChannelResult("t", { level: "error", kind: "task", channel: "K2", message: "Đổi thumbnail: K2 lỗi · hết slot" });
  await tick(50); await welcomeOn(last());
  assert.ok(last().sent.some((m) => m.type === "event" && /K2 lỗi/.test(m.message)), "sự kiện lúc mất mạng được gửi bù");
  agent.stop();
});

test("agent: chưa bật/đã dừng thì bỏ qua sự kiện tác vụ, không ném lỗi; dữ liệu rỗng cũng vậy", async () => {
  const { agent } = mkAgent({ token: TOK });
  assert.doesNotThrow(() => { agent.onTaskEvent({ phase: "start", id: "a" }); agent.onTaskChannelResult("t", { message: "x" }); });
  agent.start(); await tick(); await welcomeOn(last());
  assert.doesNotThrow(() => { agent.onTaskEvent(null); agent.onTaskChannelResult("t", null); });
  const n = last().sent.length;
  agent.onTaskEvent(null); agent.onTaskChannelResult("t", null);
  assert.equal(last().sent.length, n);
  agent.stop();
});

test("agent: heartbeat mang theo danh sách tác vụ đang chạy (để web biết cái nào còn sống)", async () => {
  const { agent } = mkAgent({ token: TOK, opts: { getState: () => ({ running: false, tasks: [{ id: "render.js#1" }] }) } });
  agent.start(); await tick(); await welcomeOn(last());
  const st = last().sent.find((m) => m.type === "status");
  assert.deepEqual(st.state.tasks, [{ id: "render.js#1" }]);
  agent.stop();
});
