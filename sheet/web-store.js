// Nguồn dữ liệu của runner lấy từ WEB (thay cho Google Sheet). Đưa ra ĐÚNG 5 hàm mà runner vẫn gọi:
//   readConfigSheet / readChannelUrls / setUrlStatus / setUploadStatus / appendUrls
// nên runner, render và upload không phải sửa gì.
//
// Nguyên tắc:
//  - Web là nguồn sự thật, nhưng máy phải chạy được khi mất mạng: cấu hình và danh sách video được giữ bản sao trên đĩa
//    (xác thực bằng ETag nên không đổi thì không tải lại).
//  - Ghi trạng thái video: ghi vào bộ nhớ NGAY (runner luôn thấy trạng thái mới nhất) rồi gửi lên web theo lô. Chưa gửi được
//    thì giữ trong hàng đợi trên đĩa và gửi bù lần sau. Mỗi mục có mốc thời gian để web biết bản nào mới hơn.
//  - Bí mật không bao giờ lên web: web chỉ có scheme://host:port của proxy. Proxy đầy đủ (user/mật khẩu) nằm trong GPM
//    profile của kênh trên máy này; getProfileProxy lấy từ đó vào lúc runner cần dùng.
//
// File này không đụng Electron: fetch, đồng hồ, kho lưu và nguồn proxy của profile đều được truyền vào để test được.

const REQ_TIMEOUT = 20_000;
const MAX_BATCH = 1500;
const MAX_QUEUE = 20_000;

import { countRenderedToday } from "./runner-state.js";

export class WebStoreError extends Error {
  constructor(message, { status = 0, reason = "", offline = false, code = "" } = {}) { super(message); this.status = status; this.reason = reason; this.offline = offline; this.code = code; }
}

/**
 * @param {object} o
 * @param {typeof fetch} o.fetchImpl
 * @param {() => string|null} o.getBase        địa chỉ http(s) của server
 * @param {() => string} o.getToken            token đăng nhập của app
 * @param {{ read(name:string):any, write(name:string, data:any):void }} o.disk   kho JSON cục bộ (cache + hàng đợi)
 * @param {(profileId:string) => Promise<string|null>} [o.getProfileProxy]  proxy đầy đủ (kể cả user/mật khẩu) của GPM profile, null nếu không có/không đọc được
 * @param {() => number} [o.now]
 * @param {(e:Error)=>void} [o.onAuthLost]     server báo phiên không còn hợp lệ (gỡ máy, khóa tài khoản...)
 * @param {(m:string)=>void} [o.log]
 */
export function createWebStore({ fetchImpl = fetch, getBase, getToken, disk, getProfileProxy = async () => null, now = () => Date.now(), onAuthLost = () => {}, log = () => {} }) {
  const mem = {
    channels: null, revision: "", webIds: new Map(),   // tên kênh -> id trên web
    rows: new Map(),                                   // tên kênh -> { rev, rows: [{rowIndex,url,status,uploadStatus}] }
    queue: [],                                         // [{ id, b?, c?, at }] chưa gửi lên web
  };
  let loaded = false, flushing = null, lastOnline = null;

  // ---------------------------------------------------------------- đĩa
  function load() {
    if (loaded) return; loaded = true;
    try {
      const c = disk.read("channels");
      if (c && Array.isArray(c.channels)) { mem.channels = c.channels; mem.revision = String(c.revision || ""); for (const ch of c.channels) if (ch.webId) mem.webIds.set(ch.sheetName, ch.webId); }
      const v = disk.read("videos");
      if (v && typeof v === "object") for (const [name, e] of Object.entries(v)) if (e && Array.isArray(e.rows)) mem.rows.set(name, { rev: String(e.rev || ""), rows: e.rows });
      const q = disk.read("queue");
      if (Array.isArray(q)) mem.queue = q.filter((x) => x && Number.isInteger(x.id));
    } catch (e) { log(`Không đọc được cache: ${String(e?.message || e)}`); }
  }
  const saveChannels = () => { try { disk.write("channels", { revision: mem.revision, channels: mem.channels }); } catch { /* ignore */ } };
  const saveVideos = () => { try { disk.write("videos", Object.fromEntries([...mem.rows].map(([k, v]) => [k, v]))); } catch { /* ignore */ } };
  const saveQueue = () => { try { disk.write("queue", mem.queue); } catch { /* ignore */ } };

  // ---------------------------------------------------------------- mạng
  async function call(method, path, body, headers = {}) {
    const base = getBase(), token = getToken();
    if (!base) throw new WebStoreError("Chưa có địa chỉ máy chủ", { offline: false });
    if (!token) throw new WebStoreError("Chưa đăng nhập", { status: 401, reason: "token" });
    let res;
    try {
      res = await fetchImpl(`${base}${path}`, {
        method, headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
        body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(REQ_TIMEOUT),
      });
    } catch (e) { lastOnline = false; throw new WebStoreError("Không kết nối được máy chủ", { offline: true }); }
    if (res.status === 304) { lastOnline = true; return { status: 304, data: null }; }
    let data = null; try { data = await res.json(); } catch { /* không phải JSON */ }
    if (res.status === 401 || res.status === 403) {
      const err = new WebStoreError(data?.message || "Phiên đăng nhập không còn hợp lệ", { status: res.status, reason: data?.reason || "token" });
      try { onAuthLost(err); } catch { /* ignore */ }
      throw err;
    }
    if (res.status >= 500 || res.status === 429) { lastOnline = false; throw new WebStoreError("Máy chủ đang bận, sẽ thử lại", { status: res.status, offline: true }); }
    lastOnline = true;
    if (!res.ok) throw new WebStoreError(data?.message || `Lỗi ${res.status}`, { status: res.status, code: data?.code || "" });
    return { status: res.status, data };
  }

  // ---------------------------------------------------------------- hàng đợi ghi
  // Gộp nhiều lần ghi cùng một video: mỗi cột chỉ giữ giá trị mới nhất.
  function enqueue(id, field, value) {
    const at = now();
    let item = mem.queue.find((x) => x.id === id);
    if (!item) { if (mem.queue.length >= MAX_QUEUE) mem.queue.shift(); item = { id }; mem.queue.push(item); }
    item[field] = value; item.at = at;
    saveQueue();
  }
  async function flush() {
    load();
    if (flushing) return flushing;
    flushing = (async () => {
      let sent = 0;
      while (mem.queue.length) {
        // Chụp ảnh lô sắp gửi: trong lúc chờ mạng, runner vẫn có thể ghi đè mục trong hàng đợi.
        const batch = mem.queue.slice(0, MAX_BATCH).map((x) => ({ ...x }));
        let r;
        try { r = await call("POST", "/api/app/videos/status", { updates: batch }); }
        catch (e) { if (e.offline || e.status >= 400) break; throw e; }
        // Chỉ bỏ những mục CHƯA bị ghi đè trong lúc gửi (mốc 'at' vẫn như lúc chụp). Mục đã đổi giữ lại để gửi lần sau.
        const sentAt = new Map(batch.map((b) => [b.id, b.at]));
        mem.queue = mem.queue.filter((x) => !(sentAt.has(x.id) && sentAt.get(x.id) === x.at));
        sent += batch.length; saveQueue();
        if (r?.data?.rejected?.length) log(`Web từ chối ${r.data.rejected.length} mục trạng thái (video không còn trên web)`);
      }
      return sent;
    })().finally(() => { flushing = null; });
    return flushing;
  }
  let timer = null;
  const scheduleFlush = () => { if (timer) return; timer = setTimeout(() => { timer = null; flush().catch(() => {}); }, 1500); timer.unref?.(); };

  // ---------------------------------------------------------------- cấu hình kênh
  // Web chỉ giữ scheme://host:port. Proxy ĐẦY ĐỦ (có user/mật khẩu) nằm trong GPM profile của kênh trên máy này:
  // lấy từ đó khi runner cần dùng. GPM không chạy hoặc profile chưa có proxy thì giữ nguyên bản của web.
  async function withProfileProxy(ch) {
    const out = { ...ch, cfg: { ...(ch.cfg || {}) }, slotOverrides: { ...(ch.slotOverrides || {}) } };
    if (!out.gpmProfileId || out.videoSource === "local") return out;
    let raw = "";
    try { raw = String((await getProfileProxy(out.gpmProfileId)) || "").trim(); } catch { /* GPM không trả lời: dùng bản của web */ }
    if (raw) out.proxy = raw;
    return out;
  }

  async function readConfigSheet() {
    load();
    try {
      const r = await call("GET", "/api/app/channels", null, mem.revision ? { "If-None-Match": `"${mem.revision}"` } : {});
      if (r.status === 200 && r.data) {
        mem.channels = r.data.channels || []; mem.revision = r.data.revision || ""; mem.webIds = new Map();
        for (const ch of mem.channels) if (ch.webId) mem.webIds.set(ch.sheetName, ch.webId);
        saveChannels();
        // Web đã xóa/chuyển kênh đi: bỏ danh sách video đã lưu của kênh đó (chỉ khi web vừa trả danh sách mới, tức có bằng chứng;
        // mất mạng hoặc 304 thì giữ nguyên). Không bỏ thì kênh cũ phình dữ liệu trên đĩa mãi và có thể hiện lại nhầm khi tạo lại cùng tên.
        let pruned = false;
        for (const name of [...mem.rows.keys()]) if (!mem.webIds.has(name)) { mem.rows.delete(name); pruned = true; }
        if (pruned) saveVideos();
      }
    } catch (e) {
      if (e.offline && mem.channels) log("Mất kết nối máy chủ: dùng cấu hình kênh đã lưu trên máy");
      else throw e;
    }
    return Promise.all((mem.channels || []).map(withProfileProxy));
  }

  function webIdOf(name) {
    const id = mem.webIds.get(name);
    if (!id) throw new WebStoreError(`Kênh "${name}" chưa có trên web hoặc chưa được gán cho máy này.`, { status: 404 });
    return id;
  }

  // ---------------------------------------------------------------- video
  const overlay = (rows) => {
    if (!mem.queue.length) return rows;
    const byId = new Map(mem.queue.map((q) => [q.id, q]));
    return rows.map((r) => {
      const q = byId.get(r.rowIndex); if (!q) return r;
      const status = q.b !== undefined ? q.b : r.status;
      // 'done' còn nằm trong hàng đợi (chưa lên server): server chưa có mốc, lấy mốc của hàng đợi (lúc app thật sự render xong).
      const renderedAt = status === "done" && !(r.renderedAt > 0) && q.b === "done" ? (q.at || 0) : (status === "done" ? r.renderedAt : 0);
      return { ...r, status, uploadStatus: q.c !== undefined ? q.c : r.uploadStatus, renderedAt };
    });
  };

  async function readChannelUrls(name) {
    load();
    const id = webIdOf(name);
    const have = mem.rows.get(name);
    // Gửi bù trước khi đọc: nếu không, bản đọc về có thể cũ hơn những gì app vừa làm xong
    if (mem.queue.length) { try { await flush(); } catch { /* đọc tiếp bằng bản cục bộ */ } }
    try {
      const r = await call("GET", `/api/app/channels/${id}/videos`, null, have?.rev ? { "If-None-Match": `"${have.rev}"` } : {});
      if (r.status === 200 && r.data) { mem.rows.set(name, { rev: r.data.revision || "", rows: r.data.rows || [] }); saveVideos(); }
    } catch (e) {
      if (e.offline && have) log(`Mất kết nối máy chủ: dùng danh sách video của "${name}" đã lưu trên máy`);
      else throw e;
    }
    return overlay((mem.rows.get(name)?.rows || []).map((r) => ({ ...r })));
  }

  function patchLocal(name, rowIndex, field, value) {
    const e = mem.rows.get(name); if (!e) return;
    const row = e.rows.find((r) => r.rowIndex === rowIndex);
    if (row) { row[field] = value; saveVideos(); }
  }
  async function setUrlStatus(name, rowIndex, status) {
    load(); webIdOf(name);
    const val = String(status ?? "");
    patchLocal(name, rowIndex, "status", val);
    // Mốc render (đếm hạn mức ngày): ghi NGAY trên bản sao để mất mạng vẫn đếm đúng. Giống server: chỉ đặt ở lần đầu sang "done",
    // và bỏ mốc khi video quay về trạng thái khác (làm lại) để render lại được tính một lần mới.
    const e = mem.rows.get(name), row = e && e.rows.find((r) => r.rowIndex === rowIndex);
    if (row) {
      if (val === "done") { if (!(row.renderedAt > 0)) { row.renderedAt = now(); saveVideos(); } }
      else if (row.renderedAt) { row.renderedAt = 0; saveVideos(); }
    }
    enqueue(rowIndex, "b", String(status ?? "")); scheduleFlush();
  }
  async function setUploadStatus(name, rowIndex, status) {
    load(); webIdOf(name);
    patchLocal(name, rowIndex, "uploadStatus", String(status ?? ""));
    enqueue(rowIndex, "c", String(status ?? "")); scheduleFlush();
  }
  /** Số video đã render hôm nay của kênh, từ danh sách video (server hoặc bản sao trên đĩa). */
  function renderedToday(name, today) {
    load();
    return countRenderedToday((mem.rows.get(name) || {}).rows || [], today);
  }
  async function appendUrls(name, urls) {
    load();
    const id = webIdOf(name);
    const list = (Array.isArray(urls) ? urls : []).map((u) => String(u ?? "").trim()).filter(Boolean);
    if (!list.length) return 0;
    let added = 0;
    for (let i = 0; i < list.length; i += 5000) {
      const r = await call("POST", `/api/app/channels/${id}/videos`, { urls: list.slice(i, i + 5000) });
      added += r.data?.added || 0;
    }
    mem.rows.delete(name); // buộc lần đọc sau lấy lại danh sách đầy đủ (có id của video mới)
    return added;
  }

  // ---------------------------------------------------------------- Cấu hình kênh (màn hình Kênh trong app)
  // Đọc: lấy từ web, giữ bản sao trên đĩa; mất mạng thì trả bản đã lưu kèm offline=true (giao diện khóa nút sửa).
  // Ghi: CHỈ khi có mạng. Cố ý không xếp hàng ghi bù: sửa lúc offline rồi gộp sau dễ sinh xung đột khó giải thích với người dùng.
  async function listChannelConfigs() {
    load();
    try {
      const r = await call("GET", "/api/app/channel-configs");
      const out = { channels: r.data.channels || [], schema: r.data.schema || null, machineId: r.data.machineId };
      try { disk.write("cfg", out); } catch { /* không quan trọng */ }
      return { ok: true, offline: false, ...out };
    } catch (e) {
      if (!e.offline) throw e;
      const c = disk.read("cfg");
      if (c && Array.isArray(c.channels)) return { ok: true, offline: true, ...c };
      throw e;
    }
  }
  async function updateChannelConfig(id, body) {
    load();
    if (!Number.isInteger(id)) throw new WebStoreError("Kênh không hợp lệ", { status: 400 });
    const r = await call("PUT", `/api/app/channel-configs/${id}`, body && typeof body === "object" ? body : {});
    mem.channels = null; mem.revision = ""; // lần đọc cấu hình chạy kế tiếp phải lấy bản mới (không dựa vào ETag cũ)
    return r.data;
  }

  // ---------------------------------------------------------------- App là nơi SỬA cấu hình (kênh Auto + mẻ)
  // Server giữ dữ liệu, web chỉ xem. Mọi thao tác sửa cần có mạng: không xếp hàng ghi bù (sửa offline rồi gộp sau dễ xung đột).
  // Sau mỗi thay đổi bỏ ETag cũ để lần đọc cấu hình kế tiếp lấy bản mới.
  const afterConfigChange = () => { mem.channels = null; mem.revision = ""; };
  const needId = (id, what = "Kênh") => { const n = Number(id); if (!Number.isInteger(n) || n <= 0) throw new WebStoreError(`${what} không hợp lệ`, { status: 400 }); return n; };
  const enc = encodeURIComponent;

  async function createChannelConfig(body) {
    load();
    const r = await call("POST", "/api/app/channel-configs", body && typeof body === "object" ? body : {});
    afterConfigChange(); return r.data;
  }
  async function deleteChannelConfig(id) {
    load();
    const n = needId(id);
    const r = await call("DELETE", `/api/app/channel-configs/${n}`);
    afterConfigChange(); return r.data;
  }
  /** Nhập từ bảng Excel. Mặc định chỉ XEM TRƯỚC; { apply: true } mới ghi. removeMissing: xóa kênh không có trong file. */
  async function importChannelConfigs(rows, { apply = false, removeMissing = false, existing = "update" } = {}) {
    load();
    if (!Array.isArray(rows)) throw new WebStoreError("Dữ liệu bảng không hợp lệ", { status: 400 });
    const r = await call("POST", "/api/app/channel-configs/import", { rows, dryRun: !apply, removeMissing: !!removeMissing, existing });
    if (apply) afterConfigChange();
    return r.data;
  }

  // Mẻ: một mẻ có nhiều kênh (chọn từ GPM theo Profile ID). Mất mạng thì đọc được bản đã lưu (offline=true), không sửa được.
  async function listBatches() {
    load();
    try {
      const r = await call("GET", "/api/app/batches");
      const out = { batches: r.data.batches || [], machineId: r.data.machineId };
      try { disk.write("batches", out); } catch { /* không quan trọng */ }
      return { ok: true, offline: false, ...out };
    } catch (e) {
      if (!e.offline) throw e;
      const c = disk.read("batches");
      if (c && Array.isArray(c.batches)) return { ok: true, offline: true, ...c };
      throw e;
    }
  }
  const createBatch = async (body) => { load(); return (await call("POST", "/api/app/batches", body && typeof body === "object" ? body : {})).data; };
  const updateBatch = async (id, body) => { load(); return (await call("PUT", `/api/app/batches/${needId(id, "Mẻ")}`, body && typeof body === "object" ? body : {})).data; };
  const deleteBatch = async (id) => { load(); return (await call("DELETE", `/api/app/batches/${needId(id, "Mẻ")}`)).data; };
  const addBatchChannel = async (id, { gpmProfileId, name } = {}) => { load(); return (await call("POST", `/api/app/batches/${needId(id, "Mẻ")}/channels`, { gpmProfileId, name })).data; };
  const removeBatchChannel = async (id, gpmProfileId) => { load(); return (await call("DELETE", `/api/app/batches/${needId(id, "Mẻ")}/channels/${enc(String(gpmProfileId ?? ""))}`)).data; };
  const reportBatchAction = async (id, body) => { load(); return (await call("POST", `/api/app/batches/${needId(id, "Mẻ")}/action-run`, body && typeof body === "object" ? body : {})).data; };
  const markBatchRendered = async (id, day) => { load(); return (await call("POST", `/api/app/batches/${needId(id, "Mẻ")}/rendered`, Number.isInteger(Number(day)) && Number(day) >= 1 ? { day: Number(day) } : undefined)).data; };

  // Thống kê các kênh của máy này theo ngày (tab "Thống kê kênh"). Mất mạng thì trả bản đã lưu kèm offline=true.
  async function channelStats(days = 14, tz = 0) {
    load();
    try {
      const r = await call("GET", `/api/app/channel-stats?days=${encodeURIComponent(days)}&tz=${encodeURIComponent(tz)}`);
      try { disk.write("stats", { days, ...r.data }); } catch { /* không quan trọng */ }
      return { ok: true, offline: false, ...r.data };
    } catch (e) {
      if (!e.offline) throw e;
      const c = disk.read("stats");
      if (c && Array.isArray(c.channels)) return { ok: true, offline: true, ...c };
      throw e;
    }
  }

  // View/sub YouTube của các kênh thuộc máy này. Server dùng key YouTube CHUNG (key không bao giờ rời server).
  // Lỗi của YouTube/key (chưa có key, key bị từ chối, hết quota...) được giữ nguyên message + code để giao diện nói đúng nguyên nhân.
  async function youtubeStats() {
    load();
    const r = await call("GET", "/api/app/youtube-stats");
    return r.data;
  }
  // Lấy URL video từ kênh nguồn cho một kênh (nút "Lấy URL nguồn"): server gọi YouTube, lọc trùng và thêm vào danh sách của kênh.
  async function fetchSourceUrls(name, sortBy = "views") {
    load();
    const id = webIdOf(name);
    const r = await call("POST", `/api/app/channels/${id}/source-urls`, { sortBy: sortBy === "newest" ? "newest" : "views" });
    mem.rows.delete(name); // danh sách đã đổi trên server: lần đọc kế tiếp phải lấy bản mới, không dựa vào bản lưu
    return r.data;
  }

  // Tên kênh -> id trên web (cho chỗ khác trong app cần gọi API)
  const webId = (name) => mem.webIds.get(name) || null;

  return {
    readConfigSheet, readChannelUrls, setUrlStatus, setUploadStatus, appendUrls, renderedToday, flush, listChannelConfigs, updateChannelConfig, channelStats, youtubeStats, fetchSourceUrls,
    createChannelConfig, deleteChannelConfig, importChannelConfigs, listBatches, createBatch, updateBatch, deleteBatch, addBatchChannel, removeBatchChannel, markBatchRendered, reportBatchAction,
    webId, pending: () => { load(); return mem.queue.length; }, isOnline: () => lastOnline,
    // Dùng cho test và chẩn đoán
    _mem: mem, _disk: disk,
  };
}

// Kho JSON cục bộ trên đĩa: mỗi tên một file, ghi nguyên tử (ghi file tạm rồi đổi tên) để mất điện không làm hỏng cache.
export function createDiskStore({ dir, fs, path }) {
  const file = (name) => path.join(dir, `.web-${name}.json`);
  return {
    read(name) { try { return JSON.parse(fs.readFileSync(file(name), "utf-8")); } catch { return null; } },
    write(name, data) {
      fs.mkdirSync(dir, { recursive: true });
      const tmp = `${file(name)}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data), "utf-8");
      fs.renameSync(tmp, file(name));
    },
  };
}
