/**
 * Trend Research - Logic chính điều phối scrape + API + lưu trữ.
 */

import * as store from "./trend-store.js";
import * as api from "./trend-api.js";
import { scrapeHomepage, scrapeTrending } from "./trend-scraper.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ============================================================================
// PER-PROFILE SCAN LOCK
// Prevents concurrent scans of the same profile (manual + scheduled).
// ============================================================================

/** Set of profile IDs currently being scanned. */
const scanningProfiles = new Set();

/**
 * Check if a profile is currently being scanned.
 * Exported for tests/UI.
 * @param {string} profileId
 * @returns {boolean}
 */
export function isProfileScanning(profileId) {
  return scanningProfiles.has(profileId);
}

/**
 * Error class for "already scanning" condition.
 * Used to distinguish from other errors (scheduler should skip without recording attempt).
 */
export class ProfileAlreadyScanningError extends Error {
  constructor(profileId) {
    super("Profile đang được quét, vui lòng đợi");
    this.name = "ProfileAlreadyScanningError";
    this.profileId = profileId;
  }
}

/**
 * Chạy quét đầy đủ cho một profile:
 * 1. Scrape trang chủ YouTube (nếu có GPM profile)
 * 2. Gọi API lấy trending videos
 * 3. Enrich với channel info
 * 4. Tính điểm tiềm năng
 * 5. Lưu vào store
 *
 * @param {string} profileId - Profile ID trong trend-store
 * @param {object} options
 * @param {string} options.gpmHost - GPM host
 * @param {function} options.log - Log function
 * @param {function} options.onProgress - Progress callback
 * @throws {ProfileAlreadyScanningError} if profile is already being scanned
 */
export async function runScan(profileId, { gpmHost = "127.0.0.1:19995", log = console.log, onProgress } = {}) {
  // Check per-profile lock FIRST
  if (scanningProfiles.has(profileId)) {
    throw new ProfileAlreadyScanningError(profileId);
  }

  // Acquire lock
  scanningProfiles.add(profileId);

  try {
    const profile = store.getProfile(profileId);
    if (!profile) throw new Error(`Profile không tồn tại: ${profileId}`);

    const { gpmProfileId, country, apiKey } = profile;
    if (!apiKey) throw new Error("Profile chưa có YouTube API Key. Vui lòng cập nhật API Key trong cài đặt profile.");

    const allVideos = [];
    let step = 0;
    const totalSteps = gpmProfileId ? 4 : 2;

    const progress = (msg) => {
      step++;
      log(`[${step}/${totalSteps}] ${msg}`);
      onProgress?.({ step, totalSteps, message: msg });
    };

    // 1. Scrape trang chủ (nếu có GPM profile)
    if (gpmProfileId) {
      try {
        progress("Đang scrape trang chủ YouTube...");
        const homepageVideos = await scrapeHomepage({
          gpmHost,
          gpmProfileId,
          country,
          log,
        });

        for (const v of homepageVideos) {
          allVideos.push({ ...v, sourceType: "homepage" });
        }
        log(`→ Lấy được ${homepageVideos.length} video từ trang chủ`);
      } catch (err) {
        log(`⚠️ Lỗi scrape trang chủ: ${err.message}`);
      }

    // Nghỉ 2s trước khi scrape trending
    await sleep(2000);

    // 2. Scrape trending
    try {
      progress("Đang scrape trang Trending...");
      const trendingVideos = await scrapeTrending({
        gpmHost,
        gpmProfileId,
        country,
        log,
      });

      for (const v of trendingVideos) {
        allVideos.push({ ...v, sourceType: "trending_scrape" });
      }
      log(`→ Lấy được ${trendingVideos.length} video từ Trending`);
    } catch (err) {
      log(`⚠️ Lỗi scrape Trending: ${err.message}`);
    }
  }

    // 3. Gọi API lấy trending (luôn chạy)
    try {
      progress("Đang lấy video trending từ API...");
      const apiTrending = await api.getTrendingVideos(apiKey, country, null, 50);

      for (const v of apiTrending) {
        // Chỉ thêm nếu chưa có
        if (!allVideos.find((x) => x.videoId === v.videoId)) {
          allVideos.push({ ...v, sourceType: "trending_api" });
        }
      }
      log(`→ Lấy được ${apiTrending.length} video từ API Trending`);
    } catch (err) {
      log(`⚠️ Lỗi API Trending: ${err.message}`);
    }

    // 4. Enrich với channel info và tính điểm
    if (allVideos.length > 0) {
      progress("Đang lấy thông tin channel và tính điểm...");

      // Nếu video từ scrape chưa có đầy đủ info, gọi API bổ sung
      const needDetails = allVideos.filter((v) => !v.viewCount);
      if (needDetails.length > 0) {
        log(`→ Cần lấy chi tiết cho ${needDetails.length} video...`);

        // Chia thành chunks 50 video
        for (let i = 0; i < needDetails.length; i += 50) {
          const chunk = needDetails.slice(i, i + 50);
          const videoIds = chunk.map((v) => v.videoId);

          try {
            const details = await api.getVideosDetails(apiKey, videoIds);
            const detailsMap = new Map(details.map((d) => [d.videoId, d]));

            for (const v of allVideos) {
              if (detailsMap.has(v.videoId)) {
                Object.assign(v, detailsMap.get(v.videoId));
              }
            }
          } catch (err) {
            log(`⚠️ Lỗi lấy chi tiết video: ${err.message}`);
          }

          await sleep(500); // Rate limit
        }
      }

      // Enrich với channel info
      try {
        const enriched = await api.enrichVideos(apiKey, allVideos);
        allVideos.length = 0;
        allVideos.push(...enriched);
      } catch (err) {
        log(`⚠️ Lỗi enrich channel info: ${err.message}`);
      }
    }

    // 5. Lưu vào store
    if (allVideos.length > 0) {
      store.upsertVideos(profileId, allVideos);
      log(`✅ Đã lưu ${allVideos.length} video vào database`);
    }

    // 5b. Mark hot videos (inside try/catch so badge failure never fails scan)
    let hotNew = 0;
    if (allVideos.length > 0) {
      try {
        hotNew = store.markHotVideos(profileId, allVideos);
        if (hotNew > 0) {
          log(`🔥 ${hotNew} video mới có điểm tiềm năng cao`);
        }
      } catch (err) {
        log(`⚠️ Lỗi đánh dấu hot videos: ${err.message}`);
      }
    }

    // Cập nhật thời gian quét
    store.updateLastScan(profileId);

    return {
      totalVideos: allVideos.length,
      hotNew,
      bySource: {
        homepage: allVideos.filter((v) => v.sourceType === "homepage").length,
        trending_scrape: allVideos.filter((v) => v.sourceType === "trending_scrape").length,
        trending_api: allVideos.filter((v) => v.sourceType === "trending_api").length,
      },
    };
  } finally {
    // ALWAYS release per-profile lock, even on error/timeout
    scanningProfiles.delete(profileId);
  }
}

/**
 * Chạy quét cho tất cả profile đến hạn
 */
export async function runScheduledScans({ gpmHost, log = console.log }) {
  const dueProfiles = store.getProfilesDueForScan();

  if (dueProfiles.length === 0) {
    log("Không có profile nào cần quét");
    return [];
  }

  log(`Có ${dueProfiles.length} profile cần quét`);
  const results = [];

  for (const profile of dueProfiles) {
    log(`\n========== Quét profile: ${profile.name} ==========`);
    try {
      const result = await runScan(profile.id, { gpmHost, log });
      results.push({ profileId: profile.id, name: profile.name, success: true, ...result });
    } catch (err) {
      log(`❌ Lỗi quét profile ${profile.name}: ${err.message}`);
      results.push({ profileId: profile.id, name: profile.name, success: false, error: err.message });
    }

    // Nghỉ giữa các profile
    await sleep(5000);
  }

  return results;
}

/**
 * Tìm kiếm video theo từ khóa (dùng API)
 */
export async function searchByKeyword(profileId, keyword, options = {}) {
  const profile = store.getProfile(profileId);
  if (!profile?.apiKey) throw new Error("Profile chưa có API Key");

  const videos = await api.searchVideos(profile.apiKey, keyword, {
    regionCode: profile.country,
    ...options,
  });

  // Enrich
  const enriched = await api.enrichVideos(profile.apiKey, videos);

  // Lưu vào store
  store.upsertVideos(profileId, enriched);

  return enriched;
}

/**
 * Lấy dashboard data cho UI
 */
export function getDashboardData(profileId, filters = {}) {
  const videos = store.queryVideos(profileId, filters);
  const niches = store.analyzeNiches(profileId, filters);
  const stats = store.getStats(profileId);

  return {
    videos,
    niches,
    stats,
    filters,
  };
}

/**
 * Sanitize a string value for Excel export:
 * - Prefix with single quote if, after stripping leading whitespace/control chars,
 *   it starts with =, +, -, @ (formula injection prevention)
 * - Also prefix if starts with \t or \r (some Excel versions interpret these)
 * - Return empty string if null/undefined
 * - Numbers stay as-is (not touched)
 */
function sanitizeCell(value) {
  if (value == null) return "";
  // Don't touch numbers
  if (typeof value === "number") return value;
  const str = String(value);
  // Check if starts with tab or carriage return
  if (/^[\t\r]/.test(str)) return "'" + str;
  // Strip leading whitespace/control chars (chars <= 0x20) and check for formula chars
  const stripped = str.replace(/^[\x00-\x20]+/, "");
  if (/^[=+\-@]/.test(stripped)) return "'" + str;
  return str;
}

/**
 * Build export rows from videos array.
 * Returns array of row objects with exact column headers/order as specified.
 * @param {Array} videos - Array of video objects from store.queryVideos
 * @returns {Array} Array of row objects
 */
export function buildExportRows(videos) {
  return videos.map((v, i) => ({
    "#": i + 1,
    "Title": sanitizeCell(v.title),
    "Channel": sanitizeCell(v.channelTitle),
    "Views": v.viewCount ?? "",
    "Subs": v.subscriberCount ?? "",
    "Ratio": v.viewSubRatio ?? "",
    "Score": v.potentialScore ?? "",
    "Age (days)": v.ageInDays ?? "",
    "Category": sanitizeCell(v.categoryName),
    "URL": v.videoId ? `https://www.youtube.com/watch?v=${v.videoId}` : "",
  }));
}

/**
 * Export videos to Excel file
 * @param {string} profileId - Profile ID
 * @param {object} filters - Filter object (timeRange, maxSubs, etc.)
 * @param {string} outputPath - Full path to output xlsx file
 * @returns {Promise<string>} Path to saved file
 */
export async function exportToExcel(profileId, filters, outputPath) {
  // Dynamic import XLSX (only in Node.js context)
  const XLSXModule = await import("xlsx");
  const XLSX = XLSXModule.default;

  const videos = store.queryVideos(profileId, { ...filters, limit: 1000 });
  if (!videos.length) throw new Error("Không có video để xuất");

  const rows = buildExportRows(videos);

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Videos");
  XLSX.writeFile(wb, outputPath);
  return outputPath;
}

/**
 * Sanitize and validate export filters from renderer.
 * Only allows known filter keys with correct types.
 * @param {any} filters - Raw filters from IPC
 * @returns {object} Sanitized filters object (safe to pass to queryVideos)
 */
export function sanitizeExportFilters(filters) {
  // If not a plain object, return empty object
  if (!filters || typeof filters !== "object" || Array.isArray(filters)) {
    return {};
  }

  const result = {};

  // timeRange: string or null
  if (typeof filters.timeRange === "string") {
    result.timeRange = filters.timeRange;
  }

  // sortBy: string or null
  if (typeof filters.sortBy === "string") {
    result.sortBy = filters.sortBy;
  }

  // categoryId: string or null
  if (typeof filters.categoryId === "string") {
    result.categoryId = filters.categoryId;
  }

  // maxSubs: finite number or null
  if (typeof filters.maxSubs === "number" && Number.isFinite(filters.maxSubs)) {
    result.maxSubs = filters.maxSubs;
  }

  // minViews: finite number or null
  if (typeof filters.minViews === "number" && Number.isFinite(filters.minViews)) {
    result.minViews = filters.minViews;
  }

  return result;
}

/**
 * Export để dùng từ IPC handlers
 */
export {
  store,
  api,
};
