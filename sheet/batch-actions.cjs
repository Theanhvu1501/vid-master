// Hành động của một mẻ: Render, Thay thumbnail, Lên lịch. Mỗi hành động CHẠY ĐỘC LẬP, có cài đặt riêng
// (không nối liền nhau vì giữa các bước người dùng phải upload video bằng tay lên YouTube).
// Hàm THUẦN: không đụng DOM/Electron/mạng. Dùng chung như composer-geometry.cjs: renderer (<script> thường, gắn window.BatchActions) và test.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.BatchActions = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const ACTIONS = Object.freeze([
    { id: "render", label: "Render", hint: "Render video cho ngày hiện tại của vòng, theo cấu hình render của mẻ." },
    { id: "thumb", label: "Thay thumbnail", hint: "Đổi ảnh thu nhỏ cho các video nháp (Draft) đã upload tay của từng kênh trong mẻ." },
    { id: "schedule", label: "Lên lịch", hint: "Đặt giờ đăng cho các video nháp (Draft) đã upload tay của từng kênh trong mẻ." },
  ]);
  const ACTION_IDS = Object.freeze(ACTIONS.map((a) => a.id));
  const ACTION_LABEL = Object.freeze(Object.fromEntries(ACTIONS.map((a) => [a.id, a.label])));
  // Khóa tác vụ mà app báo lên web ứng với từng hành động (khớp TASK_LABELS trong task-monitor.js)
  const TASK_KEY = Object.freeze({ render: "render.js", thumb: "automation:change-thumb", schedule: "automation:schedule" });

  const str = (v) => String(v ?? "").trim();
  const intIn = (v, lo, hi) => { const s = str(v); return /^\d+$/.test(s) && Number(s) >= lo && Number(s) <= hi ? Number(s) : null; };
  function validDate(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(s));
    if (!m) return false;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
  }

  /**
   * Kiểm tra TRƯỚC khi chạy MỘT hành động. Trả { ok, errors: string[] }.
   * settings: cài đặt riêng của hành động đó (do người dùng nhập trong khung chi tiết của mẻ).
   *  - render: thư mục nguồn/nền/đích có thể để trống = giữ như tab Render của máy này
   *  - thumb: thumbFolder (bắt buộc), numVideos
   *  - schedule: postTimes (bắt buộc), numDays, startDate
   */
  function planAction(kind, batch, settings) {
    if (!ACTION_IDS.includes(kind)) return { ok: false, errors: ["Hành động không hợp lệ"] };
    if (!batch || typeof batch !== "object") return { ok: false, errors: ["Không có mẻ để chạy"] };
    const s = settings && typeof settings === "object" ? settings : {};
    const errors = [];
    const channels = Array.isArray(batch.channels) ? batch.channels.filter((c) => c && str(c.gpmProfileId)) : [];
    if (kind !== "render" && !channels.length) errors.push("Mẻ chưa có kênh nào. Hãy thêm kênh vào mẻ trước");
    if (kind === "thumb" && channels.length) {
      if (!str(s.thumbFolder)) errors.push("Chưa chọn thư mục ảnh thumbnail");
      if (str(s.numVideos) && intIn(s.numVideos, 1, 200) === null) errors.push("Số video đổi thumbnail phải là số nguyên từ 1 đến 200");
    }
    if (kind === "schedule" && channels.length) {
      if (!str(s.postTimes)) errors.push("Chưa nhập giờ đăng");
      if (str(s.numDays) && intIn(s.numDays, 1, 60) === null) errors.push("Số ngày phải là số nguyên từ 1 đến 60");
      if (str(s.startDate) && !validDate(s.startDate)) errors.push("Ngày bắt đầu không hợp lệ (định dạng năm-tháng-ngày)");
    }
    return { ok: errors.length === 0, errors };
  }

  /**
   * Kết quả của automation.changeThumb / schedule -> { ok, message }.
   * Các hàm đó trả success=true ngay cả khi một số kênh lỗi (kèm total/ok/fail/skipped), nên phải xét thêm số kênh:
   * có kênh lỗi hoặc không kênh nào chạy được thì hành động này là THẤT BẠI để người dùng thấy ngay.
   */
  function resultFromAutomation(r) {
    if (!r || typeof r !== "object") return { ok: false, message: "Không nhận được kết quả" };
    if (r.success !== true) return { ok: false, message: str(r.error) || str(r.message) || "Có lỗi xảy ra" };
    const total = Number(r.total), fail = Number(r.fail) || 0, done = Number(r.ok) || 0, skipped = Number(r.skipped) || 0;
    if (Number.isFinite(total)) {
      if (total <= 0) return { ok: false, message: "Không có kênh nào để chạy" };
      if (fail > 0) return { ok: false, message: fail + "/" + total + " kênh lỗi" + (done ? ", " + done + " kênh xong" : "") };
      if (done === 0) return { ok: false, message: skipped ? "Cả " + skipped + " kênh bị bỏ qua" : "Không có kênh nào chạy" };
      return { ok: true, message: done + "/" + total + " kênh xong" + (skipped ? ", " + skipped + " bỏ qua" : "") };
    }
    return { ok: true, message: str(r.message) };
  }

  /** Chuẩn hóa kết quả một lần chạy thành { status, message }. status: success | failed | canceled. Thiếu/rác = failed (không bao giờ coi là thành công). */
  function normalizeOutcome(r) {
    if (r && r.canceled === true) return { status: "canceled", message: str(r.message) || "Đã dừng" };
    if (r && r.ok === true) return { status: "success", message: str(r.message) };
    return { status: "failed", message: str(r && r.message) || "Lỗi không rõ" };
  }

  /** Cài đặt mặc định của từng hành động khi mẻ mới mở lần đầu. defaults: giá trị đang có ở tab Render/Tự động hóa của máy. */
  function defaultSettings(defaults) {
    const d = defaults && typeof defaults === "object" ? defaults : {};
    return {
      render: { overlayFolder: str(d.overlayFolder), backgroundFolder: str(d.backgroundFolder), outputFolder: str(d.outputFolder) },
      thumb: { thumbFolder: str(d.thumbFolder), numVideos: str(d.numVideos) || "8" },
      schedule: { numDays: str(d.numDays) || "3", startDate: "", postTimes: str(d.postTimes) || "8:00, 12:00, 18:00" },
    };
  }

  /** Gộp cài đặt đã lưu lên mặc định: chỉ nhận đúng khóa và kiểu chuỗi, bỏ mọi thứ lạ (dữ liệu lưu cũ/hỏng không làm hỏng form). */
  function mergeSettings(saved, defaults) {
    const base = defaultSettings(defaults), s = saved && typeof saved === "object" ? saved : {};
    for (const kind of ACTION_IDS) {
      const src = s[kind] && typeof s[kind] === "object" ? s[kind] : {};
      for (const k of Object.keys(base[kind])) if (typeof src[k] === "string") base[kind][k] = src[k];
    }
    return base;
  }

  /**
   * Phán định kết quả render bằng CHÍNH VIDEO ở thư mục đích, không tin mã thoát của render.js: script này thoát mã 0 cả khi thấy thư mục
   * nền rỗng rồi bỏ đi sớm, nên "chạy xong" chưa có nghĩa là đã render ra video. before/after = { count, newest } đếm trước và sau khi chạy.
   * Không đếm được (null) thì coi là THẤT BẠI để ngày của mẻ không tăng nhầm.
   */
  function judgeRender(result, before, after) {
    if (result && result.canceled === true) return result;
    if (!result || result.ok !== true) return { ok: false, message: str(result && result.message) || "Render lỗi" };
    const valid = (x) => x && typeof x === "object" && Number.isFinite(x.count) && Number.isFinite(x.newest);
    if (!valid(before) || !valid(after)) return { ok: false, message: "Không đếm được video ở thư mục đích nên không xác nhận được render" };
    const added = Math.max(0, after.count - before.count);
    if (added > 0) return { ok: true, message: "Render xong, có " + added + " video mới" };
    if (after.newest > before.newest) return { ok: true, message: "Render xong, đã ghi đè video ở thư mục đích" };
    return { ok: false, message: "Render chạy xong nhưng thư mục đích không có video mới. Kiểm tra thư mục nguồn và thư mục nền (mỗi video nền nằm trong một thư mục con riêng)" };
  }

  return { judgeRender, ACTIONS, ACTION_IDS, ACTION_LABEL, TASK_KEY, planAction, resultFromAutomation, normalizeOutcome, defaultSettings, mergeSettings };
});
