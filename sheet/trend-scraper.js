/**
 * Scrape trang chủ YouTube bằng Playwright.
 * Dùng profile GPM "trắng" để lấy video YouTube đề xuất tự nhiên.
 *
 * Lưu ý về proxy: Proxy được cấu hình trực tiếp trên GPM profile, không cần truyền riêng
 * khi connect. Khi tạo trend profile, nếu user đặt proxy thì phải đặt proxy đó trên GPM
 * profile tương ứng (không có cơ chế tự động gán proxy từ trend profile sang GPM).
 */

import { connectProfile, closeProfile } from "./gpm-client.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Scrape trang chủ YouTube để lấy danh sách video được đề xuất
 * @param {object} options
 * @param {string} options.gpmHost - GPM host (127.0.0.1:19995)
 * @param {string} options.gpmProfileId - GPM profile ID
 * @param {string} options.country - Mã quốc gia (US, VN, JP...)
 * @param {function} options.log - Log function
 * @returns {Promise<Array>} Danh sách video IDs
 */
export async function scrapeHomepage({ gpmHost, gpmProfileId, country = "US", log = console.log }) {
  let conn = null;

  try {
    log(`Đang mở profile GPM: ${gpmProfileId}`);
    // connectProfile(gpmHost, profileId) trả về { browser, page }
    conn = await connectProfile(gpmHost, gpmProfileId);
    const { page } = conn;

    // Vào trang chủ YouTube với region
    const url = `https://www.youtube.com/?gl=${country}&hl=en`;
    log(`Đang mở: ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

    // Đợi load xong
    await sleep(3000);

    // Scroll để load thêm video
    log("Đang scroll để load thêm video...");
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight));
      await sleep(1500);
    }

    // Parse video từ DOM
    log("Đang parse video từ trang chủ...");
    const videos = await page.evaluate(() => {
      const results = [];

      // Selector cho video trên trang chủ
      const videoElements = document.querySelectorAll("ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer");

      for (const el of videoElements) {
        try {
          // Lấy link video
          const linkEl = el.querySelector("a#video-title-link, a#video-title, a.yt-simple-endpoint[href*='watch']");
          if (!linkEl) continue;

          const href = linkEl.getAttribute("href") || "";
          const videoIdMatch = href.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
          if (!videoIdMatch) continue;

          const videoId = videoIdMatch[1];

          // Lấy title
          const titleEl = el.querySelector("#video-title, .title");
          const title = titleEl?.textContent?.trim() || "";

          // Lấy channel name
          const channelEl = el.querySelector("#channel-name a, .ytd-channel-name a, #text.ytd-channel-name");
          const channelTitle = channelEl?.textContent?.trim() || "";

          // Lấy channel link để extract channel ID
          const channelLinkEl = el.querySelector("#channel-name a, a.yt-simple-endpoint[href*='/@'], a.yt-simple-endpoint[href*='/channel/']");
          const channelHref = channelLinkEl?.getAttribute("href") || "";

          // Lấy thumbnail
          const thumbEl = el.querySelector("img#img, img.yt-core-image");
          const thumbnail = thumbEl?.getAttribute("src") || "";

          // Lấy view count text (VD: "1.2M views")
          const metaEl = el.querySelector("#metadata-line span, .inline-metadata-item");
          const viewText = metaEl?.textContent?.trim() || "";

          results.push({
            videoId,
            title,
            channelTitle,
            channelHref,
            thumbnail: thumbnail.startsWith("http") ? thumbnail : "",
            viewText,
          });
        } catch (e) {
          // Bỏ qua element lỗi
        }
      }

      return results;
    });

    log(`Tìm thấy ${videos.length} video từ trang chủ`);

    // Dedupe by videoId
    const unique = [];
    const seen = new Set();
    for (const v of videos) {
      if (!seen.has(v.videoId)) {
        seen.add(v.videoId);
        unique.push(v);
      }
    }

    return unique;

  } finally {
    // Đóng profile: closeProfile(gpmHost, profileId, conn) yêu cầu conn chứa { browser }
    if (conn) {
      try {
        await closeProfile(gpmHost, gpmProfileId, conn);
      } catch (e) {
        log(`Lỗi đóng profile: ${e.message}`);
      }
    }
  }
}

/**
 * Scrape trang Trending
 */
export async function scrapeTrending({ gpmHost, gpmProfileId, country = "US", log = console.log }) {
  let conn = null;

  try {
    log(`Đang mở profile GPM: ${gpmProfileId}`);
    conn = await connectProfile(gpmHost, gpmProfileId);
    const { page } = conn;

    // Vào trang trending
    const url = `https://www.youtube.com/feed/trending?gl=${country}`;
    log(`Đang mở: ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

    await sleep(3000);

    // Scroll để load thêm
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight));
      await sleep(1500);
    }

    // Parse video
    log("Đang parse video từ trang Trending...");
    const videos = await page.evaluate(() => {
      const results = [];
      const videoElements = document.querySelectorAll("ytd-video-renderer");

      for (const el of videoElements) {
        try {
          const linkEl = el.querySelector("a#video-title");
          if (!linkEl) continue;

          const href = linkEl.getAttribute("href") || "";
          const videoIdMatch = href.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
          if (!videoIdMatch) continue;

          results.push({
            videoId: videoIdMatch[1],
            title: linkEl.textContent?.trim() || "",
            channelTitle: el.querySelector("#channel-name a")?.textContent?.trim() || "",
            thumbnail: el.querySelector("img#img")?.src || "",
            sourceType: "trending",
          });
        } catch (e) {}
      }

      return results;
    });

    log(`Tìm thấy ${videos.length} video trending`);

    // Dedupe
    const unique = [];
    const seen = new Set();
    for (const v of videos) {
      if (!seen.has(v.videoId)) {
        seen.add(v.videoId);
        unique.push(v);
      }
    }

    return unique;

  } finally {
    if (conn) {
      try {
        await closeProfile(gpmHost, gpmProfileId, conn);
      } catch (e) {
        log(`Lỗi đóng profile: ${e.message}`);
      }
    }
  }
}

/**
 * Scrape trang Explore (khám phá theo category)
 */
export async function scrapeExplore({ gpmHost, gpmProfileId, country = "US", category = null, log = console.log }) {
  let conn = null;

  try {
    conn = await connectProfile(gpmHost, gpmProfileId);
    const { page } = conn;

    // Các URL explore theo category
    const categoryUrls = {
      music: "/feed/trending?bp=4gINGgt5dG1hX2NoYXJ0cw%3D%3D",
      gaming: "/gaming",
      news: "/feed/trending?bp=6gQJRkVleHBsb3Jl",
      movies: "/feed/storefront?bp=ogUCKAE%3D",
    };

    const path = category && categoryUrls[category] ? categoryUrls[category] : "/feed/explore";
    const url = `https://www.youtube.com${path}?gl=${country}`;

    log(`Đang mở: ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await sleep(3000);

    // Scroll
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight));
      await sleep(1500);
    }

    // Parse
    const videos = await page.evaluate(() => {
      const results = [];
      const videoElements = document.querySelectorAll("ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer");

      for (const el of videoElements) {
        try {
          const linkEl = el.querySelector("a#video-title-link, a#video-title, a[href*='watch']");
          if (!linkEl) continue;

          const href = linkEl.getAttribute("href") || "";
          const videoIdMatch = href.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
          if (!videoIdMatch) continue;

          results.push({
            videoId: videoIdMatch[1],
            title: el.querySelector("#video-title")?.textContent?.trim() || "",
            channelTitle: el.querySelector("#channel-name a, #text.ytd-channel-name")?.textContent?.trim() || "",
            thumbnail: el.querySelector("img#img, img.yt-core-image")?.src || "",
            sourceType: "explore",
          });
        } catch (e) {}
      }

      return results;
    });

    log(`Tìm thấy ${videos.length} video từ Explore`);

    // Dedupe
    const unique = [];
    const seen = new Set();
    for (const v of videos) {
      if (!seen.has(v.videoId)) {
        seen.add(v.videoId);
        unique.push(v);
      }
    }

    return unique;

  } finally {
    if (conn) {
      try {
        await closeProfile(gpmHost, gpmProfileId, conn);
      } catch (e) {
        log(`Lỗi đóng profile: ${e.message}`);
      }
    }
  }
}
