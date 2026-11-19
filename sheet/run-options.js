// Tuỳ chọn chạy của Auto đổi Thumbnail và Auto Lên lịch (hàm thuần, có test).
//
// Mọi thứ gắn với profile ở đây đều dùng PROFILE ID, không dùng tên: tên profile trong GPM có thể
// trùng nhau, còn ID thì không bao giờ trùng và không đổi khi đổi tên.

import fs from "fs";
import { splitPostTimes, toStudioTime } from "./schedule-slots.js";
import { buildScheduleDays } from "./youtube-automation.js";

const str = (v) => String(v ?? "").trim();
const pad = (n) => String(n).padStart(2, "0");
const IMAGE_RE = /\.(jpe?g|png)$/i;

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const countImages = (dir) => { try { return fs.readdirSync(dir).filter((f) => IMAGE_RE.test(f)).length; } catch { return 0; } };

// Trống -> dùng mặc định; có nhưng sai -> báo lỗi (không âm thầm đổi thành số khác).
function parseCount(v, min, max, label, fallback) {
  const s = str(v);
  if (!s) return { value: fallback };
  if (!/^\d+$/.test(s) || Number(s) < min || Number(s) > max) {
    return { error: `${label} phải là số nguyên từ ${min} đến ${max} (đang ghi "${s}")` };
  }
  return { value: Number(s) };
}

/**
 * Ngày bắt đầu -> "YYYYMMDD" (hoặc "" = hôm nay). Nhận 2026-04-04 (ô chọn ngày), 2026_04_04, 20260404.
 * Dạng ngày/tháng/năm (04/04/2026) bị từ chối vì không biết là ngày/tháng hay tháng/ngày. Ngày không
 * có thật (30/02) và ngày đã qua đều bị từ chối thay vì để lăn sang tháng khác hoặc đặt lịch vào quá khứ.
 */
export function normalizeStartDate(v, today = new Date()) {
  const text = str(v);
  if (!text) return { value: "" };
  const m = text.match(/^(\d{4})[_\-/.]?(\d{1,2})[_\-/.]?(\d{1,2})$/);
  if (!m || (/^\d+$/.test(text) && text.length !== 8)) {
    return { error: `ngày bắt đầu không hợp lệ (đang ghi "${text}", cần dạng 2026-04-04 — năm trước)` };
  }
  const y = +m[1], mo = +m[2], d = +m[3];
  const t = new Date(y, mo - 1, d);
  if (t.getFullYear() !== y || t.getMonth() !== mo - 1 || t.getDate() !== d) {
    return { error: `ngày bắt đầu không có thật: ${y}-${mo}-${d}` };
  }
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (t < startOfToday) return { error: `ngày bắt đầu ${text} đã qua nên các ngày lên lịch sẽ rơi vào quá khứ` };
  return { value: `${y}${pad(mo)}${pad(d)}` };
}

/**
 * Chọn thư mục thumbnail cho từng profile. folders = { [profileId]: thư mục riêng }.
 * Profile không có thư mục riêng thì dùng thư mục chung. Thư mục không tồn tại hoặc không có ảnh thì
 * profile đó bị loại kèm lý do (profile khác vẫn chạy).
 * @returns {{ profiles: object[], skipped: {id,name,reason}[], error?: string }}
 */
export function resolveThumbRun({ profiles, folders, defaultFolder, numVideos, isDirectory = isDir, images = countImages }) {
  const n = parseCount(numVideos, 1, 200, "Số video", 8);
  if (n.error) return { error: n.error, profiles: [], skipped: [] };
  const own = folders && typeof folders === "object" ? folders : {};
  const common = str(defaultFolder);
  const run = [], skipped = [];
  for (const p of profiles) {
    const label = p.label || p.name;
    const skip = (reason) => skipped.push({ id: p.id, name: label, reason });
    const folder = str(Object.prototype.hasOwnProperty.call(own, p.id) ? own[p.id] : "") || common;
    if (!folder) { skip("chưa có thư mục thumbnail (không chọn thư mục riêng và chưa chọn thư mục chung)"); continue; }
    if (!isDirectory(folder)) { skip(`không thấy thư mục thumbnail: ${folder}`); continue; }
    const imageCount = images(folder);
    if (!imageCount) { skip(`thư mục không có ảnh .jpg/.jpeg/.png: ${folder}`); continue; }
    run.push({ id: p.id, name: p.name, label, thumbFolder: folder, numVideos: n.value, imageCount, ownFolder: folder !== common, monetized: !!p.monetized });
  }
  return { profiles: run, skipped };
}

/**
 * Kiểm tra giờ đăng / số ngày / ngày bắt đầu NHẬP CHUNG cho mọi profile đã chọn.
 * Lỗi nhập là lỗi của cả lượt nên trả `error` (không chạy gì) thay vì loại từng profile.
 */
export function resolveScheduleRun({ profiles, postTimes, numDays, startDate, today = new Date() }) {
  const raw = str(postTimes);
  if (!raw) return { error: "Chưa nhập giờ đăng" };
  const { times, invalid } = splitPostTimes(raw);
  if (invalid.length) return { error: `giờ đăng không đọc được: ${invalid.map((x) => `"${x}"`).join(", ")}` };
  if (!times.length) return { error: "Chưa có giờ đăng hợp lệ" };
  const d = parseCount(numDays, 1, 60, "Số ngày", 1);
  if (d.error) return { error: d.error };
  const s = normalizeStartDate(startDate, today);
  if (s.error) return { error: s.error };
  return {
    profiles: profiles.map((p) => ({ id: p.id, name: p.name, label: p.label || p.name, monetized: !!p.monetized })),
    options: { postTimes: raw, numDays: d.value, startDate: s.value || undefined },
    days: buildScheduleDays(d.value, s.value, today),
    studioTimes: times.map(toStudioTime),
    videosPerProfile: d.value * times.length,
  };
}
