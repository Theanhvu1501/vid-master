// Theo dõi các TÁC VỤ chạy tay (render, tải video, đổi thumbnail, lên lịch, ...) để báo lên web giám sát.
// Khác luồng Sheet (theo từng video): tác vụ tay chạy theo KÊNH / theo cả lượt, nên chỉ báo đúng những gì app biết thật:
// tác vụ nào đang chạy, bao lâu, kết quả từng kênh, xong hay lỗi. Không đoán tiến độ từng video.
//
// File này chỉ chứa phần THUẦN (không đụng Electron/mạng) để test được kỹ.

const MAX_TEXT = 220;

// Tên hiển thị tiếng Việt của từng tác vụ. Khóa là tên kênh IPC (guardedHandler) hoặc tên script (run-script).
export const TASK_LABELS = {
  "automation:change-thumb": "Đổi thumbnail",
  "automation:schedule": "Lên lịch đăng",
  "automation:distribute": "Rải video cho kênh",
  "automation:proxy-check": "Kiểm tra proxy",
  "render.js": "Render video",
  "test-render.js": "Test render",
  "download.js": "Tải video",
  "stockDownloader.js": "Tải Pexels/Pixabay",
  "get-url.js": "Lấy URL",
  "trim-videos.js": "Cắt video",
  "cut-bg.js": "Cắt video nền",
  "concat-video.js": "Ghép video",
  "thumb.js": "Tạo ảnh thu nhỏ",
  "convertNormalize.js": "Sửa tên ảnh",
  "createVideoSnow.js": "Tạo video từ ảnh",
  "createVideoBackgrounds.js": "Tạo video nền",
};

// CHÍNH SÁCH: chỉ những tác vụ nằm trong TASK_LABELS mới được báo lên web (danh sách CHO PHÉP, không phải danh sách chặn).
// Thêm tác vụ mới vào app mà không đăng ký ở đây thì mặc định KHÔNG bị gửi đi, nên không thể vô tình lộ.
//
// Cố ý KHÔNG theo dõi (làm trực tiếp trong app, đụng tới tài khoản/mật khẩu nên không để lọt lên web):
//   automation:login          đăng nhập kênh (dùng Gmail, mật khẩu, 2FA)
//   automation:create-channel tạo channel (dùng tài khoản đăng nhập)
//   sheet-auto:run            tự tạo profile + channel theo Sheet (đọc cột tk, proxy kèm mật khẩu)
export const UNTRACKED_TASKS = Object.freeze(["automation:login", "automation:create-channel", "sheet-auto:run"]);
export const isTrackedTask = (key) => Object.prototype.hasOwnProperty.call(TASK_LABELS, key);

/**
 * Lọc MỌI chuỗi văn bản do app tự sinh trước khi gửi lên web (lỗi của yt-dlp/ffmpeg/GPM/YouTube có thể chứa
 * proxy kèm mật khẩu, email, đường dẫn máy). Dùng chung cho luồng Sheet và tác vụ tay.
 * Giữ nguyên các dấu hiệu trạng thái ở đầu chuỗi (✅ ❌ ⏸...) vì phía web dựa vào đó.
 */
export const safeText = (v, max) => scrubText(v, max);

export const taskLabel = (key) => TASK_LABELS[key] || String(key || "Tác vụ").replace(/\.js$/, "");

/**
 * Làm sạch một chuỗi trước khi gửi lên web. Lỗi từ script/yt-dlp/GPM có thể chứa:
 *   - proxy kèm user:pass  (http://user:pass@1.2.3.4:80, hoặc ip:port:user:pass)
 *   - đường dẫn tuyệt đối trên máy (lộ tên người dùng Windows, cấu trúc thư mục)
 *   - email, mã token
 * Thà thừa còn hơn lộ: chỉ giữ phần giúp người xem hiểu chuyện gì xảy ra.
 */
// Một "từ" đứng sau chữ "mật khẩu"/"password" có phải là bí mật không? Chuỗi chữ thường thuần (sai, incorrect, quota) thì không.
const looksSecret = (v) =>
  /\d/.test(v) ||                                        // có chữ số
  /[^\p{L}\p{N}]/u.test(v) ||                            // có ký hiệu
  (/[A-Z]/.test(v) && /[a-z]/.test(v) && !/^[A-Z][a-z]+$/.test(v)) || // hoa-thường lẫn lộn (không phải chỉ viết hoa chữ đầu)
  /^[A-Z]{8,}$/.test(v);                                 // base32 dài (mã 2FA)

export function scrubText(input, max = MAX_TEXT) {
  let s = String(input ?? "");
  s = s.replace(/\u001b\[[0-9;]*[A-Za-z]/g, ""); // mã màu terminal
  s = s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ");
  // scheme://user:pass@host -> scheme://***@host
  s = s.replace(/\b([a-z][a-z0-9+.-]*):\/\/[^\s/@]+@/gi, "$1://***@");
  // ip:port:user:pass hoặc host:port:user:pass (định dạng proxy kiểu GPM)
  s = s.replace(/\b((?:\d{1,3}\.){3}\d{1,3}|[a-z0-9-]+(?:\.[a-z0-9-]+)+):(\d{2,5}):[^\s:]+:[^\s:]+/gi, "$1:$2:***:***");
  // email
  s = s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "***@***");
  // Token/key có dạng NHẬN DIỆN ĐƯỢC. Không dùng quy tắc "chuỗi dài liền mạch": nó xóa nhầm tên file, tên hàm, UUID
  // và làm lỗi trên web khó đọc, trong khi bí mật thật đều có tiền tố hoặc cấu trúc riêng.
  s = s.replace(/\b\d{6,}:[A-Za-z0-9_-]{25,}\b/g, "***");                          // token bot Telegram
  s = s.replace(/\bvmt_[A-Za-z0-9]{20,}\b/g, "***");                                // token máy VidMaster
  s = s.replace(/\bAIza[0-9A-Za-z_-]{30,}\b/g, "***");                              // Google API key
  s = s.replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "***"); // JWT
  s = s.replace(/\b(?:gh[pousr]_|sk-|xox[abprs]-)[A-Za-z0-9_-]{16,}\b/g, "***");      // GitHub/OpenAI/Slack
  s = s.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi, "$1 ***");          // header Authorization
  // (a) Có dấu phân cách rõ ràng (=, :, hoặc JSON "k":"v"): che MỌI giá trị theo sau.
  s = s.replace(/\b(password|passwd|pass|pwd|mật khẩu|mat khau|secret|token|api[_-]?key|apikey|2fa|totp|otp)(["']?\s*[=:]\s*["']?)[^\s"',;}]{2,}/gi, "$1$2***");
  // (b) Cờ dòng lệnh: --password X, --proxy-password X, --user X
  s = s.replace(/(--(?:proxy-)?(?:password|passwd|pass|token|secret|api-key|username|user)\s+)\S+/gi, "$1***");
  // (c) Chỉ cách bằng khoảng trắng ("mật khẩu Hunter2xyz", "mã 2FA JBSW..."): chỉ che khi giá trị TRÔNG như bí mật
  //     (có chữ số, ký hiệu, hoa-thường lẫn lộn, hoặc chuỗi base32 dài). Không che "mật khẩu sai" hay "secret key".
  s = s.replace(/\b(password|passwd|pwd|mật khẩu|mat khau|secret|api[_-]?key|2fa|totp|otp)(\s+(?:is\s+|là\s+)?)([^\s"',;]{4,})/gi,
    (m, k, sep, v) => (looksSecret(v) ? `${k}${sep}***` : m));
  // đường dẫn Windows tuyệt đối: giữ tên file cuối
  s = s.replace(/\b[A-Za-z]:\\(?:[^\\\/:*?"<>|\r\n]+\\)*([^\\\/:*?"<>|\r\n\s]*)/g, "…\\$1");
  // đường dẫn Unix tuyệt đối dài (>= 2 cấp)
  s = s.replace(/(^|[\s"'(])\/(?:[^\s/"')]+\/){2,}([^\s/"')]*)/g, "$1…/$2");
  s = s.replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

// Dòng cuối có nghĩa của stderr: thường là câu giải thích lỗi thật (các dòng trên là stack trace).
export function lastMeaningfulLine(text) {
  const lines = String(text ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^at\s/.test(lines[i]) || /^\^+$/.test(lines[i]) || /^node:internal/.test(lines[i]) || /^Node\.js v/i.test(lines[i])) continue;
    return lines[i];
  }
  return "";
}

/**
 * Chuyển kết quả của một lượt chạy thành đối tượng gửi lên web. Hàm thuần.
 * @param raw  kết quả thô: { success, ok, fail, skipped, total, message, error, code, output }
 * @returns { outcome: "ok"|"partial"|"error"|"skipped", summary, counts? }
 */
export function summarizeResult(raw, { stopped = false } = {}) {
  const r = raw && typeof raw === "object" ? raw : {};
  const hasCounts = Number.isFinite(r.total) && (Number.isFinite(r.ok) || Number.isFinite(r.fail));
  const counts = hasCounts ? { total: r.total, ok: r.ok || 0, fail: r.fail || 0, skipped: r.skipped || 0 } : null;

  if (stopped) return { outcome: "skipped", summary: "Đã dừng theo yêu cầu", counts };
  if (r.success === false || r.error) {
    const why = scrubText(r.error ? lastMeaningfulLine(r.error) || r.error : "Lỗi không rõ");
    return { outcome: "error", summary: why || "Lỗi không rõ", counts };
  }
  if (counts) {
    if (counts.fail > 0 && counts.ok === 0) return { outcome: "error", summary: `${counts.fail}/${counts.total} kênh lỗi`, counts };
    if (counts.fail > 0) return { outcome: "partial", summary: `${counts.ok}/${counts.total} thành công, ${counts.fail} lỗi${counts.skipped ? `, ${counts.skipped} bỏ qua` : ""}`, counts };
    return { outcome: "ok", summary: `${counts.ok}/${counts.total} kênh thành công${counts.skipped ? `, ${counts.skipped} bỏ qua` : ""}`, counts };
  }
  return { outcome: "ok", summary: scrubText(r.message || "Hoàn tất") };
}

/** Một kết quả của TỪNG kênh (onResult) -> mục sự kiện. Không bao giờ chứa bí mật. */
export function channelResultEvent(task, profile, r) {
  const name = scrubText(profile?.name || profile?.id || "kênh", 80);
  const label = taskLabel(task);
  const msgText = typeof r?.message === "string" ? r.message : "";
  // Chỉ nhận mốc ISO hợp lệ (Auto lên lịch báo "kênh này đã lên lịch tới đâu"); giá trị lạ thì bỏ
  const scheduledUntil = Number.isFinite(Date.parse(r?.scheduledUntil)) ? String(r.scheduledUntil) : null;
  const profileId = profile?.id ? scrubText(String(profile.id), 80) : null; // ID profile GPM: để server ghép kênh chắc chắn hơn ghép theo tên
  if (r?.status === "ok") return { level: "success", kind: "task", channel: name, profileId, message: `${label}: ${name} xong${msgText ? ` · ${scrubText(msgText, 120)}` : ""}`, scheduledUntil };
  if (r?.status === "skip") return { level: "info", kind: "task", channel: name, profileId, message: `${label}: ${name} bỏ qua${msgText ? ` (${scrubText(msgText, 80)})` : ""}` };
  return { level: "error", kind: "task", channel: name, profileId, message: `${label}: ${name} lỗi · ${scrubText(msgText || "không rõ", 160)}` };
}

/** Các mẻ chứa ít nhất một profile của tác vụ (theo GPM Profile ID), không lặp, giữ thứ tự gặp. Đầu vào rác trả mảng rỗng. */
export function batchesOfProfiles(batches, profiles) {
  if (!Array.isArray(batches) || !Array.isArray(profiles)) return [];
  const ids = new Set(profiles.map((p) => (p && p.id != null ? String(p.id) : "")).filter(Boolean));
  if (!ids.size) return [];
  const out = [];
  for (const p of profiles) {
    const id = p && p.id != null ? String(p.id) : "";
    const b = id ? batches.find((x) => x && Array.isArray(x.channels) && x.channels.some((c) => c && String(c.gpmProfileId) === id)) : null;
    if (b && !out.includes(b)) out.push(b);
  }
  return out;
}

/** Nhãn tác vụ kèm tên mẻ để web biết mẻ nào đang chạy. Server giới hạn nhãn 60 ký tự nên cắt ở đây. */
export function batchTaskLabel(label, batches) {
  const names = (Array.isArray(batches) ? batches : []).map((b) => String(b?.name ?? "").replace(/\s+/g, " ").trim()).filter(Boolean).map((n) => (n.length > 24 ? n.slice(0, 23) + "…" : n));
  if (!names.length) return label;
  const shown = names.slice(0, 3).join(", ") + (names.length > 3 ? ` +${names.length - 3} mẻ` : "");
  const full = `${label} · ${shown}`;
  return full.length > 60 ? full.slice(0, 59) + "…" : full;
}

/**
 * Bộ theo dõi các tác vụ đang chạy. Một máy có thể chạy nhiều tác vụ cùng lúc (render thủ công + tải video...),
 * nên giữ một danh sách; mỗi tác vụ có id riêng.
 */
export function createTaskTracker({ emit, now = () => Date.now(), maxFinished = 10 } = {}) {
  const active = new Map(); // id -> { id, key, label, startedAt, done, total, currentChannel }
  let seq = 0;
  const send = (m) => { try { emit?.(m); } catch { /* không bao giờ được làm hỏng tác vụ thật */ } };

  const snapshot = () => [...active.values()].map((t) => ({ id: t.id, key: t.key, label: t.label, startedAt: t.startedAt, done: t.done, total: t.total, channel: t.channel || null }));

  return {
    start(key, { total = null, label = null } = {}) {
      const id = `${key}#${++seq}`;
      const t = { id, key, label: label ? String(label).slice(0, 60) : taskLabel(key), startedAt: now(), done: 0, total: Number.isFinite(total) ? total : null, channel: null };
      active.set(id, t);
      send({ type: "task", phase: "start", id, key, label: t.label, startedAt: t.startedAt, total: t.total });
      return id;
    },
    // Một kênh vừa xong: cập nhật tiến độ "đã xong bao nhiêu / tổng"
    progress(id, { channel = null } = {}) {
      const t = active.get(id); if (!t) return;
      t.done++; t.channel = channel || t.channel;
      send({ type: "task", phase: "progress", id, key: t.key, label: t.label, done: t.done, total: t.total, channel: t.channel });
    },
    finish(id, raw, opts) {
      const t = active.get(id); if (!t) return null;
      active.delete(id);
      const s = summarizeResult(raw, opts);
      const msg = { type: "task", phase: "end", id, key: t.key, label: t.label, startedAt: t.startedAt, endedAt: now(), ...s };
      send(msg);
      return msg;
    },
    list: snapshot,
    isBusy: () => active.size > 0,
    // Tắt app / ngắt kết nối: mọi tác vụ đang dở coi như bị gián đoạn
    abortAll() { for (const id of [...active.keys()]) this.finish(id, { success: false, error: "Ứng dụng đã đóng" }); },
  };
}
