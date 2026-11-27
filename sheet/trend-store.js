/**
 * Lưu trữ dữ liệu trend research.
 * Dùng JSON file để đơn giản, sau có thể chuyển SQLite nếu cần.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";

// Lấy electron app nếu chạy trong main process.
// Dùng dynamic import trong function để không throw khi chạy trong plain Node (tests).
let _electronApp = null;
let _electronChecked = false;

function getElectronApp() {
  if (_electronChecked) return _electronApp;
  _electronChecked = true;
  try {
    // Chỉ kiểm tra khi chạy trong Electron (process.versions.electron tồn tại)
    if (process.versions && process.versions.electron) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      _electronApp = require("electron").app;
    }
  } catch {
    // Không phải electron environment hoặc không require được
  }
  return _electronApp;
}

// Thư mục lưu data. Env TREND_DATA_DIR override cho tests.
function getDataDir() {
  // Cho phép test override bằng env
  if (process.env.TREND_DATA_DIR) {
    const dir = process.env.TREND_DATA_DIR;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  let base = process.cwd();
  const electronApp = getElectronApp();
  if (electronApp) {
    base = electronApp.isPackaged ? electronApp.getPath("userData") : process.cwd();
  }
  const dir = path.join(base, ".trend-research");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ============================================================================
// PROFILES - Các profile dùng để research
// ============================================================================

const PROFILES_FILE = () => path.join(getDataDir(), "profiles.json");

/**
 * Profile structure:
 * {
 *   id: string,           // UUID
 *   name: string,         // Tên hiển thị
 *   gpmProfileId: string, // ID profile trong GPM
 *   country: string,      // Mã quốc gia (US, VN, JP...)
 *   proxy: string,        // Proxy (optional)
 *   apiKey: string,       // YouTube Data API v3 key (encrypted)
 *   scansPerDay: number,  // Số lần quét mỗi ngày
 *   categories: string[], // Danh mục quan tâm (optional filter)
 *   createdAt: string,
 *   lastScanAt: string,
 * }
 */

export function loadProfiles() {
  try {
    if (fs.existsSync(PROFILES_FILE())) {
      return JSON.parse(fs.readFileSync(PROFILES_FILE(), "utf8"));
    }
  } catch (e) {
    console.error("loadProfiles error:", e);
  }
  return [];
}

export function saveProfiles(profiles) {
  fs.writeFileSync(PROFILES_FILE(), JSON.stringify(profiles, null, 2));
}

export function addProfile(profile) {
  const profiles = loadProfiles();
  profiles.push({
    ...profile,
    id: profile.id || crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    lastScanAt: null,
  });
  saveProfiles(profiles);
  return profiles[profiles.length - 1];
}

export function updateProfile(id, updates) {
  const profiles = loadProfiles();
  const idx = profiles.findIndex((p) => p.id === id);
  if (idx >= 0) {
    profiles[idx] = { ...profiles[idx], ...updates };
    saveProfiles(profiles);
    return profiles[idx];
  }
  return null;
}

export function deleteProfile(id) {
  const profiles = loadProfiles();
  const filtered = profiles.filter((p) => p.id !== id);
  saveProfiles(filtered);
  // Xóa luôn data videos của profile này
  const videosFile = path.join(getDataDir(), `videos-${id}.json`);
  if (fs.existsSync(videosFile)) fs.unlinkSync(videosFile);
}

export function getProfile(id) {
  return loadProfiles().find((p) => p.id === id);
}

/**
 * Convert a profile to a "public" version safe to send to the renderer.
 * Strips apiKey and seenHotIds, adds hasApiKey boolean.
 * Returns null if input is null/undefined.
 * Does not mutate the input.
 *
 * @param {object|null} profile - Full profile object from store
 * @returns {object|null} Public profile without secrets, or null
 */
export function toPublicProfile(profile) {
  if (!profile) return null;
  const { apiKey, seenHotIds, ...rest } = profile;
  return {
    ...rest,
    hasApiKey: !!apiKey,
  };
}

// ============================================================================
// VIDEOS - Video thu thập được từ mỗi profile
// ============================================================================

/**
 * Video structure:
 * {
 *   videoId: string,
 *   title: string,
 *   channelId: string,
 *   channelTitle: string,
 *   thumbnail: string,       // URL thumbnail
 *   publishedAt: string,     // ISO date
 *   categoryId: string,
 *
 *   // Stats (từ API)
 *   viewCount: number,
 *   likeCount: number,
 *   commentCount: number,
 *   subscriberCount: number, // Của channel
 *
 *   // Computed
 *   potentialScore: number,  // Điểm tiềm năng
 *   viewSubRatio: number,    // view / sub
 *   viewsPerDay: number,     // view / số ngày từ khi đăng
 *
 *   // Metadata
 *   collectedAt: string,     // Lần đầu thu thập
 *   updatedAt: string,       // Lần cập nhật cuối
 *   sourceType: string,      // "homepage" | "trending" | "search"
 * }
 */

function getVideosFile(profileId) {
  return path.join(getDataDir(), `videos-${profileId}.json`);
}

export function loadVideos(profileId) {
  try {
    const file = getVideosFile(profileId);
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    }
  } catch (e) {
    console.error("loadVideos error:", e);
  }
  return [];
}

export function saveVideos(profileId, videos) {
  fs.writeFileSync(getVideosFile(profileId), JSON.stringify(videos, null, 2));
}

/**
 * Thêm hoặc cập nhật video. Nếu videoId đã tồn tại thì cập nhật stats.
 */
export function upsertVideos(profileId, newVideos) {
  const existing = loadVideos(profileId);
  const map = new Map(existing.map((v) => [v.videoId, v]));

  const now = new Date().toISOString();
  for (const v of newVideos) {
    const old = map.get(v.videoId);
    if (old) {
      // Cập nhật stats, giữ collectedAt cũ
      map.set(v.videoId, {
        ...old,
        ...v,
        collectedAt: old.collectedAt,
        updatedAt: now,
        // Lưu history view để tính tốc độ tăng
        viewHistory: [...(old.viewHistory || []), { at: now, views: v.viewCount }].slice(-10),
      });
    } else {
      map.set(v.videoId, {
        ...v,
        collectedAt: now,
        updatedAt: now,
        viewHistory: [{ at: now, views: v.viewCount }],
      });
    }
  }

  const all = Array.from(map.values());
  saveVideos(profileId, all);
  return all;
}

// ============================================================================
// QUERY & ANALYSIS
// ============================================================================

/**
 * Lọc video theo tiêu chí
 */
export function queryVideos(profileId, filters = {}) {
  let videos = loadVideos(profileId);

  const {
    timeRange = "7d",      // "24h" | "48h" | "7d" | "30d" | "all"
    maxSubs = null,        // Lọc kênh < X subscribers
    minViews = null,       // Lọc video >= X views
    categoryId = null,     // Lọc theo category
    sortBy = "potentialScore", // "potentialScore" | "viewSubRatio" | "viewsPerDay" | "viewCount"
    limit = 100,
  } = filters;

  const now = Date.now();
  const ranges = {
    "24h": 24 * 60 * 60 * 1000,
    "48h": 48 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
  };

  // Filter by time
  if (timeRange !== "all" && ranges[timeRange]) {
    const cutoff = now - ranges[timeRange];
    videos = videos.filter((v) => new Date(v.publishedAt).getTime() >= cutoff);
  }

  // Filter by max subscribers
  if (maxSubs !== null) {
    videos = videos.filter((v) => (v.subscriberCount || 0) <= maxSubs);
  }

  // Filter by min views
  if (minViews !== null) {
    videos = videos.filter((v) => (v.viewCount || 0) >= minViews);
  }

  // Filter by category
  if (categoryId) {
    videos = videos.filter((v) => v.categoryId === categoryId);
  }

  // Sort
  videos.sort((a, b) => (b[sortBy] || 0) - (a[sortBy] || 0));

  return videos.slice(0, limit);
}

/**
 * Phân tích ngách trending: đếm video tiềm năng theo category
 */
export function analyzeNiches(profileId, filters = {}) {
  const videos = queryVideos(profileId, { ...filters, limit: 1000 });

  const byCategory = {};
  for (const v of videos) {
    const cat = v.categoryId || "unknown";
    if (!byCategory[cat]) {
      byCategory[cat] = { categoryId: cat, categoryName: v.categoryName || cat, count: 0, totalScore: 0, videos: [] };
    }
    byCategory[cat].count++;
    byCategory[cat].totalScore += v.potentialScore || 0;
    byCategory[cat].videos.push(v);
  }

  // Sắp xếp theo số lượng video tiềm năng
  return Object.values(byCategory)
    .map((c) => ({ ...c, avgScore: c.totalScore / c.count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Lấy thống kê tổng quan
 */
export function getStats(profileId) {
  const videos = loadVideos(profileId);
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  return {
    total: videos.length,
    last24h: videos.filter((v) => now - new Date(v.collectedAt).getTime() < day).length,
    last7d: videos.filter((v) => now - new Date(v.collectedAt).getTime() < 7 * day).length,
    avgPotentialScore: videos.length ? videos.reduce((s, v) => s + (v.potentialScore || 0), 0) / videos.length : 0,
    topCategories: analyzeNiches(profileId, { limit: 500 }).slice(0, 5),
  };
}

// ============================================================================
// SCAN SCHEDULE
// ============================================================================

const SCHEDULE_FILE = () => path.join(getDataDir(), "scan-schedule.json");

export function loadSchedule() {
  try {
    if (fs.existsSync(SCHEDULE_FILE())) {
      return JSON.parse(fs.readFileSync(SCHEDULE_FILE(), "utf8"));
    }
  } catch (e) {
    console.error("loadSchedule error:", e);
  }
  return { lastRun: {}, nextRun: {} };
}

export function saveSchedule(schedule) {
  fs.writeFileSync(SCHEDULE_FILE(), JSON.stringify(schedule, null, 2));
}

export function updateLastScan(profileId) {
  const schedule = loadSchedule();
  schedule.lastRun[profileId] = new Date().toISOString();
  saveSchedule(schedule);

  // Cập nhật cả profile
  updateProfile(profileId, { lastScanAt: schedule.lastRun[profileId] });
}

/**
 * Tính thời gian quét tiếp theo cho profile
 */
export function getNextScanTime(profileId) {
  const profile = getProfile(profileId);
  if (!profile) return null;

  const schedule = loadSchedule();
  const lastRun = schedule.lastRun[profileId];
  if (!lastRun) return new Date(); // Chưa chạy lần nào -> chạy ngay

  const intervalMs = (24 * 60 * 60 * 1000) / (profile.scansPerDay || 1);
  return new Date(new Date(lastRun).getTime() + intervalMs);
}

/**
 * Lấy danh sách profile cần quét
 */
export function getProfilesDueForScan() {
  const profiles = loadProfiles();
  const now = Date.now();

  return profiles.filter((p) => {
    const next = getNextScanTime(p.id);
    return next && next.getTime() <= now;
  });
}

// ============================================================================
// HOT VIDEO TRACKING
// ============================================================================

/** Score threshold for a video to be considered "hot" */
const HOT_SCORE_THRESHOLD = 10;

/** Maximum number of seen hot video IDs to keep per profile */
const MAX_SEEN_HOT_IDS = 500;

/**
 * Mark hot videos from a scan and update the profile's hotCount and seenHotIds.
 * "New hot" = videos with potentialScore >= HOT_SCORE_THRESHOLD whose videoId
 * is not already in the profile's seenHotIds.
 *
 * @param {string} profileId - Profile ID
 * @param {Array} newVideos - Videos from the scan
 * @returns {number} Number of NEW hot videos from this scan
 */
export function markHotVideos(profileId, newVideos) {
  const profile = getProfile(profileId);
  if (!profile) return 0;
  if (!newVideos || newVideos.length === 0) return 0;

  // Filter hot videos (potentialScore must be a number >= threshold)
  const hot = newVideos.filter((v) => {
    const score = v.potentialScore;
    return typeof score === "number" && Number.isFinite(score) && score >= HOT_SCORE_THRESHOLD;
  });

  if (hot.length === 0) return 0;

  const seenIds = new Set(profile.seenHotIds || []);
  const newHot = hot.filter((v) => !seenIds.has(v.videoId));

  if (newHot.length === 0) return 0;

  // Add new hot video IDs to seen list
  for (const v of newHot) {
    seenIds.add(v.videoId);
  }

  // Cap seenHotIds at the last MAX_SEEN_HOT_IDS
  const allSeenIds = Array.from(seenIds);
  const cappedSeenIds = allSeenIds.slice(-MAX_SEEN_HOT_IDS);

  updateProfile(profileId, {
    hotCount: (profile.hotCount || 0) + newHot.length,
    seenHotIds: cappedSeenIds,
  });

  return newHot.length;
}

/**
 * Get the current hot count for a profile.
 * @param {string} profileId - Profile ID
 * @returns {number} Hot count (0 if profile not found or no hot videos)
 */
export function getHotCount(profileId) {
  const profile = getProfile(profileId);
  return profile?.hotCount || 0;
}

/**
 * Clear the hot count for a profile but KEEP seenHotIds.
 * This prevents cleared videos from re-alerting on the next scan.
 * @param {string} profileId - Profile ID
 */
export function clearHotCount(profileId) {
  const profile = getProfile(profileId);
  if (!profile) return;

  updateProfile(profileId, { hotCount: 0 });
}
