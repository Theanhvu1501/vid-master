import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  proxyIdentity, buildChannelEntry, buildSnapshot, sheetEventToMonitor, sheetEventToProgress, createProxyHealth, toAgentUrl, toHttpBase, createMonitorAgent, DEFAULT_SERVER_URL,
} from "../sheet/monitor-agent.js";

const TODAY = "2026-06-15";
const ch = (o = {}) => ({ sheetName: "k1", enabled: true, uploadEnabled: true, gpmProfileId: "p1", postTimes: "8:00", videosPerDay: 2, renderMode: "topTransparent", videoSource: "download", proxy: "", sourceHandle: "@src", channelUrl: "", ...o });
const row = (n, b, c) => ({ rowIndex: n + 1, url: `https://youtu.be/vid${String(n).padStart(8, "0")}`, status: b, uploadStatus: c });

test("proxyIdentity: không lộ mật khẩu; cùng proxy -> cùng key; khác mật khẩu -> khác key", () => {
  const a = proxyIdentity("socks5://1.2.3.4:1080:bob:SECRETPASS");
  assert.equal(a.hostPort, "socks5://1.2.3.4:1080");
  assert.equal(a.user, "bob");
  assert.equal(JSON.stringify({ k: a.key, h: a.hostPort, u: a.user }).includes("SECRETPASS"), false);
  assert.equal(proxyIdentity("socks5://1.2.3.4:1080:bob:SECRETPASS").key, a.key);
  assert.notEqual(proxyIdentity("socks5://1.2.3.4:1080:bob:OTHER").key, a.key);
  assert.equal(proxyIdentity(""), null);
  assert.equal(proxyIdentity("rác"), null);
});

test("buildChannelEntry: kênh local không có proxy tải dù ô proxy có giá trị", () => {
  assert.equal(buildChannelEntry(ch({ videoSource: "local", proxy: "1.2.3.4:80" }), [], { today: TODAY }).proxyKey, null);
});

test("buildChannelEntry: đếm video theo trạng thái; 'available' = video còn phải làm", () => {
  const rows = [
    row(1, "", ""),                                   // chưa làm -> available
    row(2, "đã tải", ""),                             // đã tải, chưa render -> available (full vì không có overlay)
    row(3, "done", "✅ lên lịch 16/06/2026 08:00"),   // xong
    row(4, "done", "❌ lỗi: x"),                      // upload lỗi (file render không còn -> vẫn đếm lỗi)
    row(5, "done", "⏸ chờ: hết slot ngày mai"),       // chờ upload
    row(6, "lỗi tải: boom", ""),                      // lỗi tải -> full -> available
    row(7, "bỏ qua: hỏng (đã thử 3 lần)", ""),       // bỏ qua
  ];
  const e = buildChannelEntry(ch(), rows, { state: {}, resume: {}, today: TODAY });
  assert.equal(e.urlsTotal, 7);
  assert.equal(e.available, 3);
  assert.equal(e.rendered, 3);
  assert.equal(e.failed, 1);
  assert.equal(e.skipped, 1);
  assert.equal(e.scheduled, 1);
  assert.equal(e.uploadError, 1);
  assert.equal(e.uploadWaiting, 1);
});

test("buildChannelEntry: scheduledUntil là lịch XA NHẤT, đổi sang UTC", () => {
  const rows = [row(1, "done", "✅ lên lịch 16/06/2026 08:00"), row(2, "done", "✅ lên lịch 17/06/2026 18:30"), row(3, "done", "✅ lên lịch 15/06/2026 08:00")];
  const e = buildChannelEntry(ch(), rows, { today: TODAY });
  assert.equal(e.scheduledUntil, new Date(2026, 5, 17, 18, 30).toISOString());
});

test("buildChannelEntry: không đọc được tab (rows=null) -> số đếm là null chứ KHÔNG phải 0 (để khỏi báo hết video nhầm)", () => {
  const e = buildChannelEntry(ch(), null, { today: TODAY });
  assert.equal(e.urlsTotal, null);
  assert.equal(e.available, null);
  assert.equal(e.scheduledUntil, null);
  assert.equal(buildChannelEntry(ch(), [], { today: TODAY }).available, 0); // tab rỗng thật = 0
});

test("buildChannelEntry: quota hôm nay chỉ tính khi lastRunDate là hôm nay", () => {
  assert.equal(buildChannelEntry(ch(), [], { state: { k1: { lastRunDate: TODAY, countToday: 2 } }, today: TODAY }).todayDone, 2);
  assert.equal(buildChannelEntry(ch(), [], { state: { k1: { lastRunDate: "2026-06-14", countToday: 2 } }, today: TODAY }).todayDone, 0);
});

test("buildChannelEntry: đưa số liệu YouTube; kênh ẩn sub -> null", () => {
  const e = buildChannelEntry(ch(), [], { today: TODAY, stats: { subscribers: 10, views: 99, videoCount: 3, updatedAt: "x" } });
  assert.deepEqual([e.subscribers, e.totalViews, e.videoCount], [10, 99, 3]);
  assert.equal(buildChannelEntry(ch(), [], { today: TODAY, stats: { hidden: true, subscribers: 10 } }).subscribers, null);
});

test("buildSnapshot: chỉ giữ sức khỏe của proxy còn dùng; tuyệt đối không có mật khẩu trong payload", () => {
  const raw = "socks5://9.9.9.9:1080:user1:TOPSECRET";
  const id = proxyIdentity(raw);
  const snap = buildSnapshot({
    channels: [ch({ proxy: raw })], urlsByChannel: new Map([["k1", [row(1, "", "")]]]), today: TODAY,
    proxyHealth: { [id.key]: { ok: true, ip: "1.1.1.1" }, stale: { ok: false } },
  });
  assert.equal(snap.type, "snapshot");
  assert.deepEqual(Object.keys(snap.proxyHealth), [id.key]);
  assert.equal(JSON.stringify(snap).includes("TOPSECRET"), false);
});

test("buildSnapshot: không chứa cột tk (Gmail/2FA) dù kênh có dữ liệu đó", () => {
  const snap = buildSnapshot({ channels: [ch({ account: "a@gmail.com|pw123|r@x.com|JBSWY3DP" })], urlsByChannel: new Map(), today: TODAY });
  const s = JSON.stringify(snap);
  assert.equal(s.includes("pw123") || s.includes("JBSWY3DP") || s.includes("a@gmail.com"), false);
});

test("sheetEventToMonitor: giữ kết quả quan trọng, bỏ bước trung gian", () => {
  assert.deepEqual(sheetEventToMonitor({ type: "upload-status", channel: "k", status: "✅ lên lịch 16/06/2026 08:00", title: "T" }), { level: "success", kind: "upload", channel: "k", message: "✅ lên lịch 16/06/2026 08:00 · T" });
  assert.equal(sheetEventToMonitor({ type: "upload-status", channel: "k", status: "❌ lỗi: x" }).level, "error");
  assert.equal(sheetEventToMonitor({ type: "upload-status", channel: "k", status: "⏸ chờ: hết slot ngày mai" }).level, "warning");
  assert.equal(sheetEventToMonitor({ type: "upload-status", channel: "k", status: "⏳ đang upload" }), null);
  assert.equal(sheetEventToMonitor({ type: "video-rendered", channel: "k", title: "V" }), null, "render từng video không còn là thông báo: chỉ báo một lần khi cả kênh xong");
  assert.equal(sheetEventToMonitor({ type: "error", channel: "k", message: "boom" }).level, "error");
  assert.equal(sheetEventToMonitor({ type: "log", message: "x" }), null);
  assert.equal(sheetEventToMonitor({ type: "channel-status", channel: "k", status: "đang tải" }), null);
  assert.equal(sheetEventToMonitor(null), null);
});

test("toAgentUrl: chuẩn hoá địa chỉ server; sai thì null", () => {
  assert.equal(toAgentUrl("https://vidmaster.nbcuong.com/"), "wss://vidmaster.nbcuong.com/ws/agent");
  assert.equal(toAgentUrl("http://localhost:3000"), "ws://localhost:3000/ws/agent");
  assert.equal(toAgentUrl("localhost:3000"), "ws://localhost:3000/ws/agent");
  assert.equal(toAgentUrl("wss://a.b/x/y"), "wss://a.b/ws/agent");
  assert.equal(toAgentUrl(""), null);
  assert.equal(toAgentUrl("ftp://a.b"), null);
  assert.equal(toAgentUrl("http://"), null);
});

test("createProxyHealth: kiểm tra một lần trong thời hạn TTL, kiểm tra lại khi hết hạn, xóa proxy không còn dùng", async () => {
  let t = 1_000_000, calls = 0;
  const h = createProxyHealth({ checkFn: async (raw) => { calls++; return raw.includes("bad") ? { ok: false, error: "timeout" } : { ok: true, ip: "1.1.1.1", ms: 10 }; }, ttlMs: 60_000, now: () => t });
  const list = [{ key: "a", raw: "good" }, { key: "b", raw: "bad" }];
  await h.refresh(list); await h.refresh(list);
  assert.equal(calls, 2);
  assert.equal(h.snapshot().a.ok, true);
  assert.deepEqual([h.snapshot().b.ok, h.snapshot().b.error], [false, "timeout"]);
  t += 61_000; await h.refresh(list); assert.equal(calls, 4);
  await h.refresh([list[0]]); assert.equal(h.snapshot().b, undefined);
});

test("createProxyHealth: checkFn ném lỗi -> ghi là chết, không làm hỏng cả lượt", async () => {
  const h = createProxyHealth({ checkFn: async () => { throw new Error("curl chết"); } });
  await h.refresh([{ key: "a", raw: "x" }]);
  assert.deepEqual([h.snapshot().a.ok, h.snapshot().a.error], [false, "curl chết"]);
});


test("channel-summary: một thông báo mỗi kênh với số video thành công / lỗi upload / lỗi tải-render / chờ đăng", () => {
  const e = (o) => sheetEventToMonitor({ type: "channel-summary", channel: "K1", ok: 0, uploadErr: 0, waiting: 0, failed: 0, ...o });
  const good = e({ ok: 3 });
  assert.deepEqual([good.level, good.kind, good.channel], ["success", "channel", "K1"]);
  assert.equal(good.message, "✅ 3 video thành công");

  const mixed = e({ ok: 2, uploadErr: 1, failed: 2 });
  assert.equal(mixed.level, "error");
  assert.equal(mixed.message, "✅ 2 video thành công · ❌ 1 lỗi upload · ⚠️ 2 lỗi tải/render");

  const waiting = e({ ok: 1, waiting: 2 });
  assert.equal(waiting.level, "warning", "chỉ chờ đăng (chưa lỗi) là cảnh báo nhẹ, không đỏ");
  assert.equal(waiting.message, "✅ 1 video thành công · ⏸ 2 chờ đăng");

  assert.equal(e({ failed: 4 }).message, "✅ 0 video thành công · ⚠️ 4 lỗi tải/render", "kênh chỉ có lỗi vẫn báo, ghi rõ 0 thành công");
  assert.equal(e({}), null, "không có gì để báo thì không gửi");
  assert.equal(e({ ok: -5, uploadErr: "abc" }), null, "số liệu rác không thành thông báo sai");
  assert.equal(sheetEventToMonitor({ type: "channel-summary", ok: 1 }).channel, null, "thiếu tên kênh không làm hỏng");
});

test("buildChannelEntry: todayDone đếm theo mốc renderedAt của từng video khi nguồn có mốc (không phụ thuộc runner-state)", () => {
  const now = new Date(); const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 1, 0).getTime();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const rows = [{ url: "a", status: "done", uploadStatus: "", renderedAt: t0 }, { url: "b", status: "done", uploadStatus: "", renderedAt: t0 - 3 * 86400000 }, { url: "c", status: "", uploadStatus: "", renderedAt: 0 }];
  assert.equal(buildChannelEntry(ch(), rows, { state: { k1: { lastRunDate: today, countToday: 99 } }, today }).todayDone, 1);
});
