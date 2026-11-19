// Tính giờ lên lịch đăng cho video — mô hình "cửa sổ 1 ngày".
// - Slot giờ lấy từ cột postTimes trong Sheet ⚙config (vd "8:00, 18:00").
// - MỖI LẦN XUẤT HIỆN là một chỗ: "8:00, 8:00, 8:00" = 3 video cùng đăng 8h.
//   Muốn dồn cả ngày vào một giờ thì lặp giờ đó đúng bằng số video.
// - Mỗi lần chỉ cấp slot TRỐNG của NGÀY MAI; video dư thì KHÔNG cấp (chờ lượt sau).
//   → tại mọi thời điểm chỉ có lịch tối đa 1 ngày tới, dễ kiểm soát, không mất video.
// - Hàm thuần, không phụ thuộc DOM/thời gian thực (bơm `now` để test).

function pad(n) {
  return String(n).padStart(2, "0");
}

// "8:00" | "08:00" -> "08:00"; không hợp lệ -> null
function normalizeTime(t) {
  const m = String(t ?? "").trim().match(/^(\d{1,2}):(\d{2})(?:\s*([AaPp][Mm]))?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59) return null;
  if (m[3]) {
    if (h < 1 || h > 12) return null; // 12 giờ: chỉ 1..12
    h = (h % 12) + (/p/i.test(m[3]) ? 12 : 0);
  } else if (h > 23) {
    return null;
  }
  return `${pad(h)}:${pad(min)}`;
}

// "2026-07-09T08:00:00" -> "09/07/2026 08:00" (để hiển thị/thông báo).
export function formatSchedule(iso) {
  const m = String(iso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return String(iso ?? "");
  return `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}`;
}

// Date -> "09/07/2026 14:32" (dấu thời gian cho cột "Cập nhật lúc").
export function formatStamp(d) {
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Trích giờ lịch ISO từ chuỗi trạng thái cột C ("✅ lên lịch 09/07/2026 08:00" -> "2026-07-09T08:00:00").
export function parseScheduledISO(statusText) {
  const m = String(statusText ?? "").match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:00`;
}

// Tách ô "Giờ đăng": nhận "8:00, 18:30" hoặc "8:00 AM; 6:30 PM". Trả cả giờ hợp lệ lẫn các mục
// KHÔNG đọc được, để chỗ gọi báo lỗi thay vì im lặng bỏ giờ sai.
export function splitPostTimes(raw) {
  const tokens = Array.isArray(raw)
    ? raw.map((x) => String(x ?? "").trim())
    : String(raw ?? "").split(/[,;]/).map((x) => x.trim());
  const times = [], invalid = [];
  for (const t of tokens.filter(Boolean)) {
    const n = normalizeTime(t);
    if (n) times.push(n); else invalid.push(t);
  }
  return { times, invalid };
}

export function parsePostTimes(raw) {
  return splitPostTimes(raw).times;
}

// "08:00" -> "8:00 AM", "18:30" -> "6:30 PM" (dạng ô giờ của YouTube Studio bản tiếng Anh).
export function toStudioTime(hhmm) {
  const [h, m] = String(hhmm).split(":").map(Number);
  return `${h % 12 || 12}:${pad(m)} ${h >= 12 ? "PM" : "AM"}`;
}

// "YYYY-MM-DDTHH:MM:00" theo giờ local
function fmt(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}

function startOfTomorrow(now) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  d.setDate(d.getDate() + 1);
  return d;
}

function atTime(dateOnly, hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(dateOnly.getFullYear(), dateOnly.getMonth(), dateOnly.getDate(), h, m, 0, 0);
}

/**
 * Cấp các slot giờ TRỐNG của NGÀY MAI để gán cho video (cửa sổ 1 ngày).
 * @param {string[]|string} postTimes - giờ trong ngày, vd "8:00, 18:00"; lặp giờ = thêm chỗ.
 * @param {string[]} usedSlots - các slot ISO đã đặt; ĐẾM theo lượt (giữ nguyên bản trùng),
 *   mỗi ISO đã đặt trừ đi đúng một chỗ của giờ tương ứng.
 * @param {Date} now - hiện tại (bơm để test).
 * @param {number} wantCount - số video đang chờ muốn lấy slot.
 * @returns {string[]} - tối đa wantCount slot ISO trống của ngày mai (theo thứ tự giờ);
 *   rỗng nếu hết slot / không có postTimes → video chờ lượt sau.
 */
export function assignTomorrowSlots(postTimes, usedSlots, now, wantCount) {
  const times = parsePostTimes(postTimes);
  const want = Number(wantCount) || 0;
  if (!times.length || want <= 0) return [];

  const tomorrow = startOfTomorrow(now);
  // Đếm lượt, không phải tập hợp: mỗi lần một giờ xuất hiện trong postTimes là MỘT chỗ
  // cho một video. "8:00, 8:00" = hai video cùng 8h. usedSlots (đọc từ cột C) cũng giữ
  // nguyên bản trùng, nên mỗi ISO đã đặt chỉ trừ đi đúng một chỗ.
  const usedCount = new Map();
  for (const iso of usedSlots || []) usedCount.set(iso, (usedCount.get(iso) ?? 0) + 1);

  const free = [];
  for (const t of times) {
    const iso = fmt(atTime(tomorrow, t));
    const left = usedCount.get(iso) ?? 0;
    if (left > 0) { usedCount.set(iso, left - 1); continue; } // chỗ này đã có video cũ
    free.push(iso);
    if (free.length >= want) break;
  }
  return free;
}
