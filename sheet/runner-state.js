import fs from "fs";
import path from "path";

export function todayStr(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function shouldResetQuota(channelState, today) {
  if (!channelState) return true;
  return channelState.lastRunDate !== today;
}

export function computeRemaining(channelState, videosPerDay, today) {
  const n = parseInt(videosPerDay, 10) || 0;
  const count = shouldResetQuota(channelState, today) ? 0 : (channelState.countToday || 0);
  return Math.max(0, n - count);
}

/**
 * Số video đã render hôm nay của một kênh, tính từ danh sách video (nguồn: server, có bản sao trên đĩa khi mất mạng).
 * Mỗi hàng có renderedAt (ms) = lúc app báo render xong. "Hôm nay" theo giờ máy (todayStr), khớp cách runner chia ngày.
 * Hàng không có mốc (0/thiếu) không được đếm: nhập hàng loạt hoặc video chưa render không tính vào hạn mức.
 */
export function countRenderedToday(rows, today, toDay = (ms) => todayStr(new Date(ms))) {
  let n = 0;
  for (const r of Array.isArray(rows) ? rows : []) {
    const at = Number(r && r.renderedAt);
    if (Number.isFinite(at) && at > 0 && toDay(at) === today) n++;
  }
  return n;
}

/** Hạn mức còn lại từ số đã làm (thay cho computeRemaining khi nguồn là danh sách video). */
export function remainingFrom(done, videosPerDay) {
  const n = parseInt(videosPerDay, 10) || 0;
  return Math.max(0, n - Math.max(0, Math.trunc(Number(done)) || 0));
}

export function recordRendered(state, sheetName, today) {
  const cur = state[sheetName];
  if (!cur || cur.lastRunDate !== today) {
    state[sheetName] = { lastRunDate: today, countToday: 1 };
  } else {
    cur.countToday = (cur.countToday || 0) + 1;
  }
}

export function loadState(statePath) {
  try {
    if (!fs.existsSync(statePath)) return {};
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf-8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveState(statePath, state) {
  const dir = path.dirname(statePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
}
