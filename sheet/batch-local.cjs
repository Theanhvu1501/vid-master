// Đường dẫn thư mục của các hành động trong mẻ: LƯU TẠI MÁY, không bao giờ gửi lên server.
// Lý do: đường dẫn chỉ có nghĩa trên máy đó, thường chứa tên tài khoản Windows, và web không cần để theo dõi.
// Các thiết lập còn lại (số ngày, ngày bắt đầu, giờ đăng, số video đổi thumbnail) vẫn lên server.
// Hàm THUẦN (không đụng đĩa/mạng) để test; electron-main.js lo việc đọc/ghi file.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.BatchLocal = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const LOCAL_FIELDS = Object.freeze({
    render: ["overlayFolder", "backgroundFolder", "outputFolder"],
    thumb: ["thumbFolder"],
    schedule: [],
  });
  const MAX = 1000;
  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);

  /** Làm sạch dữ liệu cục bộ của MỘT mẻ: chỉ khóa đường dẫn, chỉ chuỗi, cắt độ dài. */
  function cleanLocal(input) {
    const out = {};
    if (!isObj(input)) return out;
    for (const kind of Object.keys(LOCAL_FIELDS)) {
      const src = input[kind];
      if (!isObj(src)) continue;
      const o = {};
      for (const k of LOCAL_FIELDS[kind]) if (typeof src[k] === "string") o[k] = src[k].trim().slice(0, MAX);
      if (Object.keys(o).length) out[kind] = o;
    }
    return out;
  }

  /** Tách cài đặt hành động thành { local: đường dẫn ở lại máy, remote: phần gửi lên server }. */
  function splitSettings(settings) {
    const local = {}, remote = {};
    if (!isObj(settings)) return { local, remote };
    for (const kind of Object.keys(LOCAL_FIELDS)) {
      const src = settings[kind];
      if (!isObj(src)) continue;
      const l = {}, r = {};
      for (const [k, v] of Object.entries(src)) (LOCAL_FIELDS[kind].includes(k) ? l : r)[k] = v;
      if (Object.keys(l).length) local[kind] = l;
      if (Object.keys(r).length) remote[kind] = r;
    }
    return { local, remote };
  }

  /** Ghép cài đặt từ server với đường dẫn cục bộ. Đường dẫn do server trả về (dữ liệu cũ) bị bỏ, chỉ nhận từ máy. */
  function joinSettings(remote, local) {
    const out = {}, r = isObj(remote) ? remote : {}, l = cleanLocal(local);
    for (const kind of Object.keys(LOCAL_FIELDS)) {
      const fromServer = {};
      if (isObj(r[kind])) for (const [k, v] of Object.entries(r[kind])) if (!LOCAL_FIELDS[kind].includes(k)) fromServer[k] = v;
      const merged = { ...fromServer, ...(l[kind] || {}) };
      if (Object.keys(merged).length) out[kind] = merged;
    }
    return out;
  }

  /** Bỏ dữ liệu cục bộ của mẻ đã bị xóa. Không biết danh sách mẻ (lỗi mạng) thì giữ nguyên để khỏi mất dữ liệu. */
  function pruneLocal(all, liveIds) {
    if (!isObj(all)) return {};
    if (!Array.isArray(liveIds)) return all;
    const keep = new Set(liveIds.map((x) => String(x))), out = {};
    for (const [id, v] of Object.entries(all)) if (keep.has(id)) out[id] = v;
    return out;
  }

  /**
   * Quyết định cho MỘT lần cập nhật mẻ: phần nào lưu tại máy, phần nào gửi server.
   *  - saveLocal: null = KHÔNG đụng tới đường dẫn đã lưu (body không có đường dẫn nào). Chỉ khi body có khóa đường dẫn mới ghi (kể cả chuỗi rỗng = xóa).
   *  - remoteBody: body đã bỏ mọi đường dẫn; callServer=false nếu không còn gì để gửi.
   */
  function planUpdate(body) {
    if (!isObj(body)) return { saveLocal: null, remoteBody: {}, callServer: false };
    const { local, remote } = splitSettings(body.actions);
    const remoteBody = { ...body };
    if (Object.keys(remote).length) remoteBody.actions = remote; else delete remoteBody.actions;
    return { saveLocal: Object.keys(local).length ? local : null, remoteBody, callServer: Object.keys(remoteBody).length > 0 };
  }

  return { LOCAL_FIELDS, cleanLocal, splitSettings, joinSettings, pruneLocal, planUpdate };
});
