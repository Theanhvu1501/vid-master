/**
 * YouTube Data API v3 wrapper cho trend research.
 * Lấy thông tin chi tiết video và channel.
 */

import { google } from "googleapis";

// YouTube category names (phổ biến)
export const CATEGORY_NAMES = {
  "1": "Film & Animation",
  "2": "Autos & Vehicles",
  "10": "Music",
  "15": "Pets & Animals",
  "17": "Sports",
  "18": "Short Movies",
  "19": "Travel & Events",
  "20": "Gaming",
  "21": "Videoblogging",
  "22": "People & Blogs",
  "23": "Comedy",
  "24": "Entertainment",
  "25": "News & Politics",
  "26": "Howto & Style",
  "27": "Education",
  "28": "Science & Technology",
  "29": "Nonprofits & Activism",
  "30": "Movies",
  "31": "Anime/Animation",
  "32": "Action/Adventure",
  "33": "Classics",
  "34": "Comedy",
  "35": "Documentary",
  "36": "Drama",
  "37": "Family",
  "38": "Foreign",
  "39": "Horror",
  "40": "Sci-Fi/Fantasy",
  "41": "Thriller",
  "42": "Shorts",
  "43": "Shows",
  "44": "Trailers",
};

/**
 * Tạo YouTube API client
 */
function createClient(apiKey) {
  return google.youtube({ version: "v3", auth: apiKey });
}

/**
 * Lấy thông tin chi tiết của nhiều video
 * @param {string} apiKey
 * @param {string[]} videoIds - Danh sách video ID (tối đa 50)
 */
export async function getVideosDetails(apiKey, videoIds) {
  if (!videoIds.length) return [];

  const youtube = createClient(apiKey);
  const res = await youtube.videos.list({
    part: "snippet,statistics,contentDetails",
    id: videoIds.slice(0, 50).join(","),
  });

  return (res.data.items || []).map((item) => ({
    videoId: item.id,
    title: item.snippet?.title,
    description: item.snippet?.description,
    channelId: item.snippet?.channelId,
    channelTitle: item.snippet?.channelTitle,
    publishedAt: item.snippet?.publishedAt,
    thumbnail: item.snippet?.thumbnails?.high?.url || item.snippet?.thumbnails?.medium?.url,
    categoryId: item.snippet?.categoryId,
    categoryName: CATEGORY_NAMES[item.snippet?.categoryId] || item.snippet?.categoryId,
    tags: item.snippet?.tags || [],
    duration: item.contentDetails?.duration,
    viewCount: parseInt(item.statistics?.viewCount || "0", 10),
    likeCount: parseInt(item.statistics?.likeCount || "0", 10),
    commentCount: parseInt(item.statistics?.commentCount || "0", 10),
  }));
}

/**
 * Lấy thông tin channel (subscriber count)
 * @param {string} apiKey
 * @param {string[]} channelIds - Danh sách channel ID (tối đa 50)
 */
export async function getChannelsDetails(apiKey, channelIds) {
  if (!channelIds.length) return {};

  const youtube = createClient(apiKey);
  const res = await youtube.channels.list({
    part: "statistics,snippet",
    id: [...new Set(channelIds)].slice(0, 50).join(","),
  });

  const map = {};
  for (const item of res.data.items || []) {
    map[item.id] = {
      channelId: item.id,
      title: item.snippet?.title,
      subscriberCount: parseInt(item.statistics?.subscriberCount || "0", 10),
      videoCount: parseInt(item.statistics?.videoCount || "0", 10),
      viewCount: parseInt(item.statistics?.viewCount || "0", 10),
      hiddenSubscriberCount: item.statistics?.hiddenSubscriberCount || false,
    };
  }
  return map;
}

/**
 * Lấy video trending của quốc gia
 * @param {string} apiKey
 * @param {string} regionCode - Mã quốc gia (VN, US, JP...)
 * @param {string} categoryId - Category ID (optional)
 * @param {number} maxResults - Tối đa 50
 */
export async function getTrendingVideos(apiKey, regionCode = "US", categoryId = null, maxResults = 50) {
  const youtube = createClient(apiKey);

  const params = {
    part: "snippet,statistics,contentDetails",
    chart: "mostPopular",
    regionCode,
    maxResults: Math.min(maxResults, 50),
  };
  if (categoryId) params.videoCategoryId = categoryId;

  const res = await youtube.videos.list(params);

  return (res.data.items || []).map((item) => ({
    videoId: item.id,
    title: item.snippet?.title,
    channelId: item.snippet?.channelId,
    channelTitle: item.snippet?.channelTitle,
    publishedAt: item.snippet?.publishedAt,
    thumbnail: item.snippet?.thumbnails?.high?.url || item.snippet?.thumbnails?.medium?.url,
    categoryId: item.snippet?.categoryId,
    categoryName: CATEGORY_NAMES[item.snippet?.categoryId] || item.snippet?.categoryId,
    viewCount: parseInt(item.statistics?.viewCount || "0", 10),
    likeCount: parseInt(item.statistics?.likeCount || "0", 10),
    commentCount: parseInt(item.statistics?.commentCount || "0", 10),
    sourceType: "trending",
  }));
}

/**
 * Tìm kiếm video theo từ khóa
 * @param {string} apiKey
 * @param {string} query - Từ khóa tìm kiếm
 * @param {object} options
 */
export async function searchVideos(apiKey, query, options = {}) {
  const youtube = createClient(apiKey);

  const {
    regionCode = "US",
    publishedAfter = null, // ISO date string
    maxResults = 50,
    order = "viewCount", // "date" | "rating" | "relevance" | "title" | "viewCount"
    categoryId = null,
  } = options;

  const params = {
    part: "snippet",
    q: query,
    type: "video",
    regionCode,
    maxResults: Math.min(maxResults, 50),
    order,
  };
  if (publishedAfter) params.publishedAfter = publishedAfter;
  if (categoryId) params.videoCategoryId = categoryId;

  const res = await youtube.search.list(params);

  // Search API không trả statistics, cần gọi thêm videos.list
  const videoIds = (res.data.items || []).map((item) => item.id?.videoId).filter(Boolean);
  if (!videoIds.length) return [];

  const details = await getVideosDetails(apiKey, videoIds);
  return details.map((v) => ({ ...v, sourceType: "search" }));
}

/**
 * Lấy danh sách category có sẵn cho quốc gia
 */
export async function getCategories(apiKey, regionCode = "US") {
  const youtube = createClient(apiKey);

  const res = await youtube.videoCategories.list({
    part: "snippet",
    regionCode,
  });

  return (res.data.items || [])
    .filter((item) => item.snippet?.assignable)
    .map((item) => ({
      id: item.id,
      title: item.snippet?.title,
    }));
}

/**
 * Tính điểm tiềm năng cho video
 * Công thức: (viewCount / subscriberCount) * log10(viewCount) * freshnessMultiplier
 */
export function calculatePotentialScore(video, channelInfo) {
  const views = video.viewCount || 1;
  const subs = channelInfo?.subscriberCount || 1;

  // Nếu channel ẩn subscriber count, dùng giá trị mặc định cao
  if (channelInfo?.hiddenSubscriberCount) {
    return 0; // Không tính điểm cho kênh ẩn sub
  }

  // View/Sub ratio - kênh ít sub mà nhiều view = YouTube đang đẩy
  const viewSubRatio = views / Math.max(subs, 1);

  // Freshness - video mới đăng được ưu tiên
  const publishedAt = new Date(video.publishedAt);
  const ageInDays = Math.max(1, (Date.now() - publishedAt.getTime()) / (24 * 60 * 60 * 1000));
  const viewsPerDay = views / ageInDays;

  // Freshness multiplier: video < 3 ngày được nhân 2, < 7 ngày nhân 1.5
  let freshnessMultiplier = 1;
  if (ageInDays <= 1) freshnessMultiplier = 3;
  else if (ageInDays <= 3) freshnessMultiplier = 2;
  else if (ageInDays <= 7) freshnessMultiplier = 1.5;

  // Điểm cuối cùng
  // Log10 để giảm ảnh hưởng của video triệu view
  const score = viewSubRatio * Math.log10(views + 1) * freshnessMultiplier;

  return Math.round(score * 100) / 100;
}

/**
 * Enrich videos với channel info và tính điểm
 */
export async function enrichVideos(apiKey, videos) {
  if (!videos.length) return [];

  // Lấy unique channel IDs
  const channelIds = [...new Set(videos.map((v) => v.channelId).filter(Boolean))];

  // Lấy channel info
  const channelsMap = await getChannelsDetails(apiKey, channelIds);

  // Enrich từng video
  return videos.map((video) => {
    const channel = channelsMap[video.channelId] || {};
    const subscriberCount = channel.subscriberCount || 0;
    const viewSubRatio = subscriberCount > 0 ? video.viewCount / subscriberCount : 0;

    const publishedAt = new Date(video.publishedAt);
    const ageInDays = Math.max(1, (Date.now() - publishedAt.getTime()) / (24 * 60 * 60 * 1000));
    const viewsPerDay = Math.round(video.viewCount / ageInDays);

    return {
      ...video,
      subscriberCount,
      hiddenSubscriberCount: channel.hiddenSubscriberCount || false,
      viewSubRatio: Math.round(viewSubRatio * 100) / 100,
      viewsPerDay,
      ageInDays: Math.round(ageInDays * 10) / 10,
      potentialScore: calculatePotentialScore(video, channel),
    };
  });
}

/**
 * Test API key có hoạt động không
 */
export async function testApiKey(apiKey) {
  try {
    const youtube = createClient(apiKey);
    const res = await youtube.videos.list({
      part: "snippet",
      chart: "mostPopular",
      maxResults: 1,
    });
    return { ok: true, quota: "unknown" };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}
