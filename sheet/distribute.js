// Rải video vào nhiều kênh (profile GPM) rồi đăng lên YouTube Studio theo lịch.
// Phần lập kế hoạch là hàm thuần (planDistribution) để xem trước và test; phần chạy dùng
// uploadAndSchedule có sẵn của app nên giữ nguyên cách upload/thumbnail/lên lịch hiện tại.

import fs from "fs";
import path from "path";
import { uploadAndSchedule } from "./yt-upload.js";
import { findThumbnailForVideo } from "./thumb-match.js";
import { splitPostTimes } from "./schedule-slots.js";
import { forEachProfile, checkCancelled } from "./youtube-automation.js";

const VIDEO_EXTS = new Set([".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"]);
const pad = (n) => String(n).padStart(2, "0");

export function listVideos(folder) {
  return fs.readdirSync(folder)
    .filter((f) => VIDEO_EXTS.has(path.extname(f).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, "vi", { numeric: true }))
    .map((f) => path.join(folder, f));
}

// Xáo trộn Fisher-Yates; rng bơm vào để test lặp lại được.
function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Chia video cho các kênh.
 *  - "sequential": theo cụm — kênh 1 nhận perChannel video đầu, kênh 2 nhận perChannel video kế... (video dư bỏ lại)
 *  - "roundrobin": xen kẽ — video 1→kênh 1, video 2→kênh 2, ... rồi quay vòng (chia đều, lệch tối đa 1)
 *  - "random": xáo trộn thứ tự video rồi chia đều như xen kẽ
 * @returns {{ channels: {profileId,name,videos:string[]}[], leftover: string[] }}
 */
export function planDistribution({ videos, profiles, mode = "roundrobin", perChannel = 1, rng = Math.random }) {
  if (!profiles?.length) throw new Error("Chưa chọn profile nào");
  if (!videos?.length) throw new Error("Thư mục không có video nào");
  const channels = profiles.map((p) => ({ profileId: p.id, name: p.name, videos: [] }));
  let leftover = [];

  if (mode === "sequential") {
    const n = Math.max(1, parseInt(perChannel, 10) || 1);
    let k = 0;
    for (const ch of channels) { ch.videos = videos.slice(k, k + n); k += n; }
    leftover = videos.slice(k);
  } else if (mode === "roundrobin" || mode === "random") {
    const order = mode === "random" ? shuffle(videos, rng) : videos;
    order.forEach((v, i) => channels[i % channels.length].videos.push(v));
  } else {
    throw new Error(`Kiểu rải không hợp lệ: ${mode}`);
  }
  return { channels, leftover };
}

/**
 * Giờ đăng cho từng video của MỘT kênh: video thứ k → ngày (k / số giờ) + 1, giờ thứ (k % số giờ).
 * Tính từ ngày kế tiếp của startDate (Date). Trả "YYYY-MM-DDTHH:MM:00" như uploadAndSchedule cần.
 */
export function slotsForChannel(count, postTimes, startDate) {
  const { times, invalid } = splitPostTimes(postTimes);
  if (invalid.length) throw new Error(`giờ đăng không đọc được: ${invalid.map((x) => `"${x}"`).join(", ")}`);
  if (!times.length) throw new Error("chưa có giờ đăng (định dạng 8:00, 18:30 hoặc 8:00 AM; 6:30 PM)");
  const out = [];
  for (let k = 0; k < count; k++) {
    const d = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    d.setDate(d.getDate() + 1 + Math.floor(k / times.length));
    const [h, m] = times[k % times.length].split(":");
    out.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${h}:${m}:00`);
  }
  return out;
}

export const stemOf = (p) => path.basename(p).replace(/\.[^.]+$/, "");

/** Kế hoạch đầy đủ để xem trước: mỗi video kèm tiêu đề, thumbnail (nếu có) và giờ đăng. */
export function buildPlan(o) {
  const { channels, leftover } = planDistribution(o);
  const thumbs = o.thumbFolder && fs.existsSync(o.thumbFolder)
    ? fs.readdirSync(o.thumbFolder).map((f) => path.join(o.thumbFolder, f)) : [];
  const start = o.startDate instanceof Date ? o.startDate : new Date();
  for (const ch of channels) {
    const own = (o.profiles || []).find((p) => p.id === ch.profileId)?.postTimes;
    const slots = slotsForChannel(ch.videos.length, own || o.postTimes, start); // ưu tiên giờ đăng của chính kênh
    ch.items = ch.videos.map((v, i) => ({
      videoPath: v, title: stemOf(v), thumbnailPath: findThumbnailForVideo(v, thumbs), scheduleISO: slots[i],
    }));
  }
  return { channels, leftover };
}

/** Chạy thật: mở từng profile, đăng lần lượt các video đã chia cho kênh đó. */
export async function runDistribute(o) {
  const log = o.onLog || console.log;
  const plan = buildPlan({ ...o, startDate: new Date() });
  const byId = new Map(plan.channels.map((c) => [c.profileId, c]));
  const profiles = plan.channels.filter((c) => c.items.length).map((c) => ({ id: c.profileId, name: c.name, rowIndex: (o.profiles || []).find((p) => p.id === c.profileId)?.rowIndex }));
  if (!profiles.length) throw new Error("Không có video nào được chia cho kênh nào");
  if (plan.leftover.length) log(`⚠️ ${plan.leftover.length} video dư, không đăng lượt này`);

  return forEachProfile({
    gpmHost: o.gpmHost, profiles, concurrency: o.concurrency, log, onResult: o.onResult,
    work: async (page, p, plog) => {
      const items = byId.get(p.id).items;
      let ok = 0;
      for (let i = 0; i < items.length; i++) {
        checkCancelled();
        const it = items[i];
        plog(`video ${i + 1}/${items.length}: ${it.title} → ${it.scheduleISO}`);
        try {
          await uploadAndSchedule({ page, ...it, log: plog });
          ok++;
        } catch (e) {
          // Đã nạp file lên YouTube rồi thì thử lại sẽ tạo bản nháp trùng — chỉ ghi lỗi, đi tiếp video sau.
          plog(`❌ ${it.title}: ${String(e.message).split("\n")[0]}`);
        }
      }
      if (ok === 0) throw new Error("không đăng được video nào");
      plog(`đã đăng ${ok}/${items.length} video`);
      return `đăng ${ok}/${items.length} video`;
    },
  });
}
