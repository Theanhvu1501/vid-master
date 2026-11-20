// Agent giám sát: đọc trạng thái từ Sheet/đĩa của máy này rồi gửi LÊN server qua WebSocket.
// Một chiều (app -> server): server không gửi lệnh nào xuống, nên web chỉ xem được chứ không điều khiển được.
//
// Mật khẩu proxy và tài khoản Gmail/2FA (cột tk) KHÔNG BAO GIỜ rời máy: proxy chỉ gửi dạng
// scheme://host:port + user + một mã băm ngắn để nhận dạng.

import crypto from "crypto";
import WebSocket from "ws";
import { normalizeProxy } from "./proxy.js";
import { maskProxy, parseProxy } from "./proxy-tools.js";
import { decideAction } from "./resume-plan.js";
import { ST } from "./resume-plan.js";
import { getEntry } from "./resume-state.js";
import { parseScheduledISO } from "./schedule-slots.js";
import { safeText } from "./task-monitor.js";

// ---------------------------------------------------------------------------------------------
// Dựng snapshot (hàm thuần, test được)
// ---------------------------------------------------------------------------------------------

// Mã nhận dạng proxy: băm cả chuỗi đã chuẩn hoá (gồm mật khẩu) rồi cắt ngắn. Server không thể suy ngược ra mật khẩu.
export function proxyIdentity(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  try {
    const url = normalizeProxy(s);
    const p = parseProxy(s);
    return {
      key: crypto.createHash("sha256").update(url).digest("hex").slice(0, 16),
      hostPort: maskProxy(s),
      user: p.user || "",
      raw: s,
    };
  } catch {
    return null; // proxy sai định dạng: runner sẽ báo lỗi riêng, ở đây coi như không có
  }
}

// "2026-07-09T08:00:00" (giờ máy) -> ISO UTC. Không hợp lệ -> null.
function localIsoToUtc(s) {
  const t = new Date(s).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/**
 * Tóm tắt một kênh. rows = null nghĩa là KHÔNG đọc được tab của kênh (khác với "tab rỗng"):
 * khi đó các số đếm là null để web hiện "—" và không báo hết video nhầm.
 */
export function buildChannelEntry(ch, rows, { state, resume, today, fileExists = () => false, stats } = {}) {
  const px = ch.videoSource === "local" ? null : proxyIdentity(ch.proxy);
  const cs = state?.[ch.sheetName];
  const base = {
    name: ch.sheetName,
    enabled: !!ch.enabled,
    uploadEnabled: ch.uploadEnabled !== false,
    hasGpm: !!ch.gpmProfileId,
    // Kênh có thật sự tự upload không (cần bật upload + có GPM profile + có giờ đăng). Quyết định bước cuối của tiến trình.
    autoUpload: ch.uploadEnabled !== false && !!ch.gpmProfileId && !!String(ch.postTimes || "").trim(),
    postTimes: ch.postTimes || "",
    videosPerDay: Number(ch.videosPerDay) || 0,
    renderMode: ch.renderMode || "",
    videoSource: ch.videoSource || "download",
    sourceHandle: ch.sourceHandle || "",
    channelUrl: ch.channelUrl || "",
    todayDone: cs && cs.lastRunDate === today ? cs.countToday || 0 : 0,
    proxyKey: px?.key || null,
    proxyHostPort: px?.hostPort || "",
    proxyUser: "", // chỉ gửi địa chỉ ip:port lên web, không gửi cả tên user proxy
    subscribers: stats?.hidden ? null : stats?.subscribers ?? null,
    totalViews: stats?.views ?? null,
    videoCount: stats?.videoCount ?? null,
    statsUpdatedAt: stats?.updatedAt || "",
  };
  if (!Array.isArray(rows)) {
    return { ...base, urlsTotal: null, available: null, rendered: null, failed: null, skipped: null, scheduled: null, uploadError: null, uploadWaiting: null, scheduledUntil: null };
  }

  let available = 0, rendered = 0, failed = 0, skipped = 0, scheduled = 0, uploadError = 0, uploadWaiting = 0;
  let latest = null;
  for (const r of rows) {
    const b = String(r.status ?? "").trim();
    const c = String(r.uploadStatus ?? "").trim();
    const entry = getEntry(resume, ch.sheetName, r.url);
    const action = decideAction({
      statusB: b, statusC: c,
      attempts: entry?.attempts ?? 0, uploadAttempts: entry?.uploadAttempts ?? 0,
      overlayExists: !!(entry?.filePath && fileExists(entry.filePath)),
      outputExists: !!(entry?.outputPath && fileExists(entry.outputPath)),
    });
    if (action === "full" || action === "render-only") available++;
    if (b === ST.DONE) rendered++;
    if (b.startsWith(ST.SKIP)) skipped++;
    else if (b.startsWith(ST.ERR_DL) || b.startsWith(ST.ERR_RENDER)) failed++;
    if (c.startsWith("✅")) {
      scheduled++;
      const iso = parseScheduledISO(c);
      const utc = iso && localIsoToUtc(iso);
      if (utc && (!latest || utc > latest)) latest = utc;
    } else if (c.startsWith("❌")) uploadError++;
    else if (c.startsWith(ST.WAIT_UPLOAD)) uploadWaiting++;
  }
  return { ...base, urlsTotal: rows.length, available, rendered, failed, skipped, scheduled, uploadError, uploadWaiting, scheduledUntil: latest };
}

export function buildSnapshot({ channels, urlsByChannel, statsByChannel, state, resume, today, fileExists, proxyHealth }) {
  const out = channels.map((ch) =>
    buildChannelEntry(ch, urlsByChannel.get(ch.sheetName) ?? null, { state, resume, today, fileExists, stats: statsByChannel?.get(ch.sheetName) }));
  const used = new Set(out.map((c) => c.proxyKey).filter(Boolean));
  const health = {};
  for (const [k, v] of Object.entries(proxyHealth || {})) if (used.has(k)) health[k] = v;
  return { type: "snapshot", channels: out, proxyHealth: health };
}

// Sự kiện của runner -> sự kiện gửi lên web. null = không đáng gửi (log vụn, bước trung gian).
export function sheetEventToMonitor(evt) {
  if (!evt || typeof evt !== "object") return null;
  const channel = evt.channel || null;
  switch (evt.type) {
    case "video-rendered":
      return { level: "success", kind: "render", channel: safeText(channel, 120) || null, message: safeText(`Render xong: ${evt.title || evt.sourceUrl || "video"}`, 300) };
    case "upload-status": {
      const s = String(evt.status || "");
      const t = evt.title ? ` · ${evt.title}` : "";
      const ch = safeText(channel, 120) || null;
      if (s.startsWith("✅")) return { level: "success", kind: "upload", channel: ch, message: safeText(`${s}${t}`, 300) };
      if (s.startsWith("❌")) return { level: "error", kind: "upload", channel: ch, message: safeText(`${s}${t}`, 300) };
      if (s.startsWith(ST.WAIT_UPLOAD)) return { level: "warning", kind: "upload", channel: ch, message: safeText(`${s}${t}`, 300) };
      return null; // ⏳ và các bước trung gian: quá ồn
    }
    case "error":
      return { level: "error", kind: "error", channel: safeText(channel, 120) || null, message: safeText(evt.message || "Lỗi không rõ", 300) };
    case "done":
      return { level: "info", kind: "run", channel: null, message: "Hoàn tất một lượt chạy" };
    default:
      return null;
  }
}

// Sự kiện của runner -> bước hiện tại của MỘT video (tải -> render -> upload -> thumbnail -> đặt lịch).
// Trả null nếu sự kiện không gắn với video cụ thể (vd "đủ hôm nay", log, test render).
// stage = null nghĩa là "giữ nguyên bước hiện tại" (dùng cho lỗi: lỗi xảy ra ở đúng bước đang chạy).
export function sheetEventToProgress(evt, { autoUpload = true } = {}) {
  if (!evt || typeof evt !== "object") return null;
  const channel = String(evt.channel || "").trim();
  const key = String(evt.url || evt.sourceUrl || "").trim();
  if (!channel || !key) return null;
  const base = { channel, key, title: safeText(evt.title || "", 300) };
  const s = String(evt.status || "");

  switch (evt.type) {
    case "channel-status":
      if (/^chờ \d+s trước khi tải/.test(s)) return { ...base, stage: "download", state: "waiting", detail: safeText(s, 200) };
      if (s === "đang tải") return { ...base, stage: "download", state: "active", detail: "Đang tải video nguồn" };
      if (s === "đang lấy file") return { ...base, stage: "download", state: "active", detail: "Đang lấy file từ máy" };
      if (s === "đang render") return { ...base, stage: "render", state: "active", detail: "Đang render video" };
      if (s === "thử lại upload") return { ...base, stage: "upload", state: "waiting", detail: "Chờ upload lại" };
      return null;
    case "video-rendered":
      return autoUpload
        ? { ...base, stage: "upload", state: "waiting", detail: "Đã render, chờ upload" }
        : { ...base, stage: "render", state: "done", detail: "Đã render xong", upload: false };
    case "upload-status":
      if (s.startsWith("✅")) return { ...base, stage: "done", state: "done", detail: safeText(s, 200) };
      if (s.startsWith("❌")) return { ...base, stage: null, state: "error", detail: safeText(s, 200) };
      if (s.startsWith(ST.WAIT_UPLOAD)) return { ...base, stage: "upload", state: "waiting", detail: safeText(s, 200) };
      if (s.startsWith("⏳")) return { ...base, stage: "upload", state: "active", detail: "Đang upload lên YouTube" };
      if (s.startsWith("b1")) return { ...base, stage: "upload", state: "active", detail: "Đang tải video lên YouTube" };
      if (s.startsWith("b2")) return { ...base, stage: "thumb", state: "active", detail: "Upload xong, đang thay thumbnail" };
      if (s.startsWith("b3")) return { ...base, stage: "schedule", state: "active", detail: "Đã thay thumbnail, đang đặt giờ lịch" };
      if (s.startsWith("b4")) return { ...base, stage: "schedule", state: "active", detail: "Đã đặt giờ lịch, đang hoàn tất" };
      return null;
    case "error":
      return { ...base, stage: null, state: "error", detail: safeText(evt.message || "Lỗi không rõ", 200) };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Kiểm tra sống/chết proxy (chạy nền, chỉ kiểm tra proxy đang có kênh dùng)
// ---------------------------------------------------------------------------------------------

export function createProxyHealth({ checkFn, ttlMs = 30 * 60 * 1000, concurrency = 3, now = () => Date.now() }) {
  const cache = new Map(); // key -> { ok, error, ip, ms, at, checkedMs }
  let busy = false;
  return {
    snapshot: () => Object.fromEntries([...cache].map(([k, v]) => [k, { ok: v.ok, error: v.error, ip: v.ip, ms: v.ms, at: v.at }])),
    // Không await trong luồng snapshot: kiểm tra mất tới ~15 giây mỗi proxy.
    async refresh(list) {
      if (busy) return 0;
      busy = true;
      let checked = 0;
      try {
        const due = list.filter((p) => !cache.has(p.key) || now() - cache.get(p.key).checkedMs > ttlMs);
        for (let i = 0; i < due.length; i += concurrency) {
          await Promise.all(due.slice(i, i + concurrency).map(async (p) => {
            let r;
            try { r = await checkFn(p.raw); } catch (e) { r = { ok: false, error: String(e?.message || e) }; }
            checked++;
            cache.set(p.key, { ok: !!r.ok, error: r.ok ? "" : String(r.error || "lỗi không rõ").slice(0, 200), ip: r.ip || "", ms: r.ms ?? null, at: new Date(now()).toISOString(), checkedMs: now() });
          }));
        }
        const live = new Set(list.map((p) => p.key));
        for (const k of cache.keys()) if (!live.has(k)) cache.delete(k);
        return checked;
      } finally { busy = false; }
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Kết nối WebSocket
// ---------------------------------------------------------------------------------------------

// "https://host[/path]" | "host:3000" | "wss://host" -> "wss://host/ws/agent". null nếu không hợp lệ.
export function toAgentUrl(input) {
  let s = String(input ?? "").trim();
  if (!s) return null;
  if (!/^[a-z]+:\/\//i.test(s)) s = `http://${s}`;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol === "https:" || u.protocol === "wss:") u.protocol = "wss:";
  else if (u.protocol === "http:" || u.protocol === "ws:") u.protocol = "ws:";
  else return null;
  if (!u.hostname) return null;
  return `${u.protocol}//${u.host}/ws/agent`;
}

// Mã đóng kết nối từ server:
//  4001 = quản trị viên "Đặt lại kết nối" -> app xin token mới (không phải lỗi)
//  4003/4004/4005 = sai máy / license bị thu hồi hoặc máy bị xóa / app khác đang dùng cùng token -> chờ lâu rồi thử lại
const AUTH_CLOSE = new Set([4003, 4004, 4005]);

// Địa chỉ server nằm CỐ ĐỊNH trong app (cùng server với license), người dùng không phải nhập.
// Chỉ ghi đè bằng biến môi trường khi chạy thử trên máy dev.
export const DEFAULT_SERVER_URL = "https://vidmaster.nbcuong.com";

// "https://host[/path]" | "host:3000" -> "https://host". null nếu không hợp lệ.
export function toHttpBase(input) {
  let s = String(input ?? "").trim();
  if (!s) return null;
  if (!/^[a-z]+:\/\//i.test(s)) s = `http://${s}`;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol === "wss:") u.protocol = "https:";
  else if (u.protocol === "ws:") u.protocol = "http:";
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (!u.hostname) return null;
  return `${u.protocol}//${u.host}`;
}

export function createMonitorAgent({
  getSettings, getToken = () => "", saveToken = () => {}, getServerUrl = () => DEFAULT_SERVER_URL,
  // Token đăng nhập của app (tài khoản + mã máy). Server chỉ cấp token giám sát cho app đã đăng nhập đúng máy này.
  getAppToken = () => "",
  getMachineId, appVersion = "", collectSnapshot, getState = () => ({}),
  WebSocketImpl = WebSocket, fetchImpl = globalThis.fetch, sessionId = crypto.randomUUID(),
  log = () => {}, onStatus = () => {},
  heartbeatMs = 20_000, snapshotMs = 5 * 60_000, snapshotMinMs = 120_000,
  backoffMs = [5_000, 15_000, 30_000, 60_000, 300_000], authBackoffMs = 300_000, maxBuffered = 200,
  // Cộng thêm 0..jitterMs ngẫu nhiên vào thời gian chờ nối lại: nhiều máy cùng mất kết nối (server khởi động
  // lại) sẽ không đồng loạt nối lại đúng một giây. Test đặt 0 để kết quả xác định.
  jitterMs = 1_000,
} = {}) {
  let ws = null, stopped = true;
  let hbTimer = null, snapTimer = null, retryTimer = null;
  let attempt = 0, lastSnapAt = 0, snapping = false, snapQueued = null;
  let status = { state: "off", message: "Chưa bật" };
  const buffer = [];                 // sự kiện phát sinh khi mất mạng, gửi bù khi nối lại
  const autoUpload = new Map();      // tên kênh -> có tự upload không (lấy từ snapshot gần nhất)

  const setStatus = (state, message) => { status = { state, message }; try { onStatus(status); } catch { /* ignore */ } };
  const clearTimers = () => { clearInterval(hbTimer); clearInterval(snapTimer); hbTimer = snapTimer = null; };
  const send = (obj) => { if (ws?.readyState === 1) { ws.send(JSON.stringify(obj)); return true; } return false; };
  const wait = (i) => backoffMs[Math.min(i, backoffMs.length - 1)];

  function sendStatus() {
    let s = {};
    try { s = getState() || {}; } catch { /* ignore */ }
    send({ type: "status", state: s });
  }

  async function sendSnapshot() {
    if (snapping || ws?.readyState !== 1) return;
    snapping = true;
    try {
      const snap = await collectSnapshot();
      if (snap) {
        for (const c of snap.channels || []) autoUpload.set(c.name, c.autoUpload !== false);
        send(snap);
        lastSnapAt = Date.now();
      }
    } catch (e) {
      log(`Giám sát: không dựng được snapshot: ${String(e?.message || e).slice(0, 200)}`);
    } finally { snapping = false; }
  }

  // Yêu cầu gửi snapshot sớm (vd khi xong một lượt chạy) nhưng không dồn dập.
  function requestSnapshot() {
    if (ws?.readyState !== 1 || snapQueued) return;
    const w = Math.max(0, lastSnapAt + snapshotMinMs - Date.now());
    snapQueued = setTimeout(() => { snapQueued = null; sendSnapshot(); }, w);
    snapQueued.unref?.();
  }

  function scheduleRetry(ms) {
    if (stopped) return;
    clearTimeout(retryTimer);
    retryTimer = setTimeout(connect, ms + Math.floor(Math.random() * jitterMs));
    retryTimer.unref?.();
  }

  // Xin token lần đầu: server chỉ cấp cho máy đã có license còn hiệu lực và chưa từng nhận token.
  async function claim(base) {
    try {
      const appToken = String(getAppToken() || "");
      if (!appToken) return { message: "Cần đăng nhập tài khoản để kết nối giám sát", retryMs: authBackoffMs };
      const res = await fetchImpl(`${base}/api/agent/claim`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${appToken}` },
        body: JSON.stringify({ machineId: getMachineId() }), signal: AbortSignal.timeout(10_000),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && typeof data.token === "string") return { token: data.token };
      if (res.status === 401) return { message: "Phiên đăng nhập không còn hợp lệ, hãy đăng nhập lại", retryMs: authBackoffMs };
      if (res.status === 404) return { message: "Máy này chưa được cấp license trên web", retryMs: authBackoffMs };
      if (res.status === 403) return { message: "License của máy này đã bị thu hồi", retryMs: authBackoffMs };
      if (res.status === 409) return { message: "Máy này đã từng kết nối. Nhờ quản trị viên bấm “Đặt lại kết nối” trên web", retryMs: authBackoffMs };
      if (res.status === 429) return { message: "Server từ chối vì gửi quá nhiều yêu cầu, sẽ thử lại sau", retryMs: authBackoffMs };
      return { message: `Server trả lỗi ${res.status}`, retryMs: wait(attempt++) };
    } catch {
      return { message: "Không kết nối được server", retryMs: wait(attempt++) };
    }
  }

  async function connect() {
    if (stopped) return;
    const url = toAgentUrl(getServerUrl());
    const base = toHttpBase(getServerUrl());
    if (!url || !base) return setStatus("error", "Địa chỉ server trong app không hợp lệ");

    let token = String(getToken() || "").trim();
    if (!token) {
      setStatus("connecting", "Đang đăng ký máy với server...");
      const r = await claim(base);
      if (stopped) return;
      if (!r.token) { setStatus("error", r.message); return scheduleRetry(r.retryMs); }
      token = r.token;
      try { saveToken(token); } catch (e) { log(`Không lưu được token: ${String(e?.message || e)}`); }
    }
    openSocket(url, token);
  }

  function openSocket(url, token) {
    setStatus("connecting", "Đang kết nối...");
    let sock;
    try { sock = new WebSocketImpl(url, { headers: { Authorization: `Bearer ${token}` }, handshakeTimeout: 10_000 }); }
    catch (e) { setStatus("error", String(e?.message || e)); return scheduleRetry(authBackoffMs); }
    ws = sock;
    let welcomed = false, authFailed = false, tokenGone = false;

    sock.on("unexpected-response", (_req, res) => {
      authFailed = res.statusCode === 401 || res.statusCode === 403;
      if (res.statusCode === 401) {
        // Token không còn khớp (admin đã đặt lại): bỏ token cũ để lần sau tự xin lại
        tokenGone = true;
        try { saveToken(""); } catch { /* ignore */ }
        setStatus("connecting", "Token không còn hiệu lực, đang đăng ký lại...");
      } else setStatus("error", res.statusCode === 403 ? "License của máy này đã bị thu hồi" : `Server trả lỗi ${res.statusCode}`);
      try { sock.terminate(); } catch { /* ignore */ }
    });
    sock.on("open", () => sock.send(JSON.stringify({ type: "hello", machineId: getMachineId(), appVersion, sessionId })));
    sock.on("message", (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m?.type !== "welcome" || welcomed) return;
      welcomed = true; attempt = 0;
      setStatus("connected", "Đã kết nối");
      sendStatus();
      while (buffer.length) { if (!send({ type: "event", ...buffer[0] })) break; buffer.shift(); }
      sendSnapshot();
      hbTimer = setInterval(sendStatus, Math.max(5_000, (m.heartbeatSec || 20) * 1000 || heartbeatMs));
      snapTimer = setInterval(sendSnapshot, snapshotMs);
    });
    sock.on("error", (e) => { if (!welcomed && !authFailed) setStatus("error", String(e?.message || e).slice(0, 120)); });
    sock.on("close", (code) => {
      clearTimers();
      if (ws === sock) ws = null;
      if (stopped) return;
      if (code === 4001) {
        tokenGone = true;
        try { saveToken(""); } catch { /* ignore */ }
        setStatus("connecting", "Quản trị viên đã đặt lại kết nối, đang đăng ký lại...");
      } else if (AUTH_CLOSE.has(code)) {
        setStatus("error", { 4003: "Token không thuộc máy này", 4004: "License máy đã bị thu hồi hoặc máy bị xóa", 4005: "Một ứng dụng khác đang dùng cùng kết nối này" }[code]);
      } else if (status.state !== "error") setStatus("connecting", "Mất kết nối, đang thử lại...");

      const slow = AUTH_CLOSE.has(code) || (authFailed && !tokenGone);
      scheduleRetry(slow ? authBackoffMs : wait(attempt++));
    });
  }

  return {
    start() { if (!stopped) return; stopped = false; attempt = 0; connect(); },
    stop() {
      stopped = true; clearTimers(); clearTimeout(retryTimer); clearTimeout(snapQueued); snapQueued = null;
      try { ws?.close(1000, "stop"); } catch { /* ignore */ }
      ws = null; setStatus("off", "Chưa bật");
    },
    // Áp cấu hình mới (bật/tắt) ngay lập tức.
    reconfigure() {
      const s = getSettings() || {};
      this.stop();
      if (s.monitorEnabled) this.start();
    },
    onSheetEvent(evt) {
      if (stopped) return;
      if (evt?.type === "channel-status" && evt.channel) send({ type: "channel_status", channel: evt.channel, status: String(evt.status || "") });

      const p = sheetEventToProgress(evt, { autoUpload: autoUpload.get(evt?.channel) ?? true });
      if (p) send({ type: "progress", ...p });

      const e = sheetEventToMonitor(evt);
      if (!e) { if (evt?.type === "done") requestSnapshot(); return; }
      const msg = { ...e, at: new Date().toISOString() };
      if (!send({ type: "event", ...msg })) { buffer.push(msg); if (buffer.length > maxBuffered) buffer.shift(); }
      if (evt.type === "done" || evt.type === "video-rendered" || evt.type === "upload-status") requestSnapshot();
    },
    // Tác vụ chạy tay (render, tải, đổi thumbnail, lên lịch...). Bắt đầu/đang chạy -> gửi "task"; kết thúc -> thêm một sự kiện
    // để lên chuông/Telegram. Chỉ gửi những chuỗi đã được lọc bí mật (xem task-monitor.js).
    onTaskEvent(m) {
      if (stopped || !m) return;
      send({ type: "task", ...m });
      if (m.phase === "end") {
        const level = m.outcome === "ok" ? "success" : m.outcome === "partial" ? "warning" : m.outcome === "skipped" ? "info" : "error";
        const mark = { ok: "✅", partial: "⚠️", error: "❌", skipped: "⏹" }[m.outcome] || "";
        const ev = { level, kind: "task", channel: null, message: `${mark} ${m.label}: ${m.summary}`.trim(), at: new Date().toISOString() };
        if (!send({ type: "event", ...ev })) { buffer.push(ev); if (buffer.length > maxBuffered) buffer.shift(); }
        requestSnapshot();
      }
    },
    // Kết quả của TỪNG kênh trong một tác vụ (đã là sự kiện hoàn chỉnh từ channelResultEvent)
    onTaskChannelResult(taskId, ev) {
      if (stopped || !ev) return;
      const msg = { ...ev, at: new Date().toISOString() };
      if (!send({ type: "event", ...msg })) { buffer.push(msg); if (buffer.length > maxBuffered) buffer.shift(); }
    },
    requestSnapshot,
    getStatus: () => status,
    isConnected: () => ws?.readyState === 1,
  };
}
