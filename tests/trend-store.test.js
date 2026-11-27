/**
 * Tests cho trend-store.js và trend-api.js
 * Chạy: node --test tests/trend-store.test.js
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert";
import fs from "fs";
import path from "path";
import os from "os";

// Set TREND_DATA_DIR env TRƯỚC khi import trend-store để không đụng real data
const testDir = path.join(os.tmpdir(), `trend-test-${Date.now()}`);
process.env.TREND_DATA_DIR = testDir;

// Import sau khi set env
const trendStore = await import("../sheet/trend-store.js");
const trendApi = await import("../sheet/trend-api.js");

describe("trend-store", () => {
  beforeEach(() => {
    // Xóa sạch data trước mỗi test
    if (fs.existsSync(testDir)) {
      for (const f of fs.readdirSync(testDir)) {
        fs.unlinkSync(path.join(testDir, f));
      }
    }
  });

  after(() => {
    // Cleanup test dir
    try {
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true });
      }
    } catch { /* ignore */ }
  });

  describe("queryVideos", () => {
    const profileId = "test-profile";

    before(() => {
      // Tạo profile test
      trendStore.addProfile({ id: profileId, name: "Test", country: "US", apiKey: "test-key" });
    });

    it("lọc theo timeRange 24h", () => {
      const now = Date.now();
      const videos = [
        { videoId: "v1", publishedAt: new Date(now - 12 * 60 * 60 * 1000).toISOString(), viewCount: 1000 }, // 12h trước
        { videoId: "v2", publishedAt: new Date(now - 48 * 60 * 60 * 1000).toISOString(), viewCount: 2000 }, // 2 ngày trước
        { videoId: "v3", publishedAt: new Date(now - 1 * 60 * 60 * 1000).toISOString(), viewCount: 500 }, // 1h trước
      ];
      trendStore.upsertVideos(profileId, videos);

      const result = trendStore.queryVideos(profileId, { timeRange: "24h" });
      assert.strictEqual(result.length, 2, "Chỉ có 2 video trong 24h");
      assert.ok(result.some((v) => v.videoId === "v1"));
      assert.ok(result.some((v) => v.videoId === "v3"));
      assert.ok(!result.some((v) => v.videoId === "v2"), "v2 cũ hơn 24h phải bị loại");
    });

    it("lọc theo timeRange 7d", () => {
      const now = Date.now();
      const videos = [
        { videoId: "v1", publishedAt: new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString() }, // 3 ngày
        { videoId: "v2", publishedAt: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString() }, // 10 ngày
      ];
      trendStore.upsertVideos(profileId, videos);

      const result = trendStore.queryVideos(profileId, { timeRange: "7d" });
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].videoId, "v1");
    });

    it("lọc theo maxSubs", () => {
      const videos = [
        { videoId: "v1", publishedAt: new Date().toISOString(), subscriberCount: 500 },
        { videoId: "v2", publishedAt: new Date().toISOString(), subscriberCount: 5000 },
        { videoId: "v3", publishedAt: new Date().toISOString(), subscriberCount: 50000 },
      ];
      trendStore.upsertVideos(profileId, videos);

      const result = trendStore.queryVideos(profileId, { timeRange: "all", maxSubs: 10000 });
      assert.strictEqual(result.length, 2);
      assert.ok(result.every((v) => v.subscriberCount <= 10000));
    });

    it("sắp xếp theo potentialScore", () => {
      const videos = [
        { videoId: "v1", publishedAt: new Date().toISOString(), potentialScore: 5 },
        { videoId: "v2", publishedAt: new Date().toISOString(), potentialScore: 15 },
        { videoId: "v3", publishedAt: new Date().toISOString(), potentialScore: 10 },
      ];
      trendStore.upsertVideos(profileId, videos);

      const result = trendStore.queryVideos(profileId, { timeRange: "all", sortBy: "potentialScore" });
      assert.strictEqual(result[0].videoId, "v2", "Video có score cao nhất phải đứng đầu");
      assert.strictEqual(result[1].videoId, "v3");
      assert.strictEqual(result[2].videoId, "v1");
    });

    it("sắp xếp theo viewCount", () => {
      const videos = [
        { videoId: "v1", publishedAt: new Date().toISOString(), viewCount: 1000 },
        { videoId: "v2", publishedAt: new Date().toISOString(), viewCount: 5000 },
        { videoId: "v3", publishedAt: new Date().toISOString(), viewCount: 2000 },
      ];
      trendStore.upsertVideos(profileId, videos);

      const result = trendStore.queryVideos(profileId, { timeRange: "all", sortBy: "viewCount" });
      assert.strictEqual(result[0].videoId, "v2");
      assert.strictEqual(result[1].videoId, "v3");
      assert.strictEqual(result[2].videoId, "v1");
    });

    it("giới hạn kết quả với limit", () => {
      const videos = Array.from({ length: 10 }, (_, i) => ({
        videoId: `v${i}`,
        publishedAt: new Date().toISOString(),
        potentialScore: i,
      }));
      trendStore.upsertVideos(profileId, videos);

      const result = trendStore.queryVideos(profileId, { timeRange: "all", limit: 3 });
      assert.strictEqual(result.length, 3);
    });
  });

  describe("analyzeNiches", () => {
    const profileId = "test-profile-2";

    before(() => {
      trendStore.addProfile({ id: profileId, name: "Test2", country: "US", apiKey: "test-key" });
    });

    it("nhóm video theo categoryId và sắp xếp theo số lượng", () => {
      const videos = [
        { videoId: "v1", publishedAt: new Date().toISOString(), categoryId: "20", categoryName: "Gaming", potentialScore: 10 },
        { videoId: "v2", publishedAt: new Date().toISOString(), categoryId: "20", categoryName: "Gaming", potentialScore: 15 },
        { videoId: "v3", publishedAt: new Date().toISOString(), categoryId: "24", categoryName: "Entertainment", potentialScore: 8 },
        { videoId: "v4", publishedAt: new Date().toISOString(), categoryId: "20", categoryName: "Gaming", potentialScore: 12 },
      ];
      trendStore.upsertVideos(profileId, videos);

      const niches = trendStore.analyzeNiches(profileId, { timeRange: "all" });

      assert.ok(niches.length >= 2);
      // Gaming có 3 video nên phải đứng đầu
      assert.strictEqual(niches[0].categoryId, "20");
      assert.strictEqual(niches[0].count, 3);
      assert.strictEqual(niches[0].categoryName, "Gaming");

      // Entertainment có 1 video
      const entertainment = niches.find((n) => n.categoryId === "24");
      assert.ok(entertainment);
      assert.strictEqual(entertainment.count, 1);
    });

    it("tính avgScore chính xác", () => {
      const videos = [
        { videoId: "v1", publishedAt: new Date().toISOString(), categoryId: "10", categoryName: "Music", potentialScore: 10 },
        { videoId: "v2", publishedAt: new Date().toISOString(), categoryId: "10", categoryName: "Music", potentialScore: 20 },
      ];
      trendStore.upsertVideos(profileId, videos);

      const niches = trendStore.analyzeNiches(profileId, { timeRange: "all" });
      const music = niches.find((n) => n.categoryId === "10");
      assert.ok(music);
      assert.strictEqual(music.avgScore, 15); // (10+20)/2
    });
  });
});

describe("trend-api calculatePotentialScore", () => {
  it("trả về 0 cho kênh ẩn subscriber count", () => {
    const video = { viewCount: 100000, publishedAt: new Date().toISOString() };
    const channel = { subscriberCount: 10000, hiddenSubscriberCount: true };

    const score = trendApi.calculatePotentialScore(video, channel);
    assert.strictEqual(score, 0, "Kênh ẩn sub phải có score = 0");
  });

  it("video mới hơn có score cao hơn video cũ cùng stats", () => {
    const channel = { subscriberCount: 10000, hiddenSubscriberCount: false };
    const now = Date.now();

    // Video mới (1 ngày)
    const newVideo = { viewCount: 50000, publishedAt: new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString() };
    // Video cũ (10 ngày) với cùng stats
    const oldVideo = { viewCount: 50000, publishedAt: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString() };

    const newScore = trendApi.calculatePotentialScore(newVideo, channel);
    const oldScore = trendApi.calculatePotentialScore(oldVideo, channel);

    assert.ok(newScore > oldScore, `Video mới (${newScore}) phải có score cao hơn video cũ (${oldScore})`);
  });

  it("video trong 24h có freshness multiplier cao nhất", () => {
    const channel = { subscriberCount: 1000, hiddenSubscriberCount: false };
    const now = Date.now();

    // Video 12h trước
    const video12h = { viewCount: 10000, publishedAt: new Date(now - 12 * 60 * 60 * 1000).toISOString() };
    // Video 2 ngày trước
    const video2d = { viewCount: 10000, publishedAt: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString() };
    // Video 5 ngày trước
    const video5d = { viewCount: 10000, publishedAt: new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString() };
    // Video 10 ngày trước
    const video10d = { viewCount: 10000, publishedAt: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString() };

    const score12h = trendApi.calculatePotentialScore(video12h, channel);
    const score2d = trendApi.calculatePotentialScore(video2d, channel);
    const score5d = trendApi.calculatePotentialScore(video5d, channel);
    const score10d = trendApi.calculatePotentialScore(video10d, channel);

    assert.ok(score12h > score2d, "12h phải cao hơn 2d");
    assert.ok(score2d > score5d, "2d phải cao hơn 5d");
    assert.ok(score5d > score10d, "5d phải cao hơn 10d");
  });

  it("kênh không có subscriberCount (null/undefined) xử lý được", () => {
    const video = { viewCount: 10000, publishedAt: new Date().toISOString() };
    const channel = { subscriberCount: null, hiddenSubscriberCount: false };

    // Không throw error
    const score = trendApi.calculatePotentialScore(video, channel);
    assert.ok(typeof score === "number");
  });

  it("kênh 0 subscriber xử lý đúng (không chia cho 0)", () => {
    const video = { viewCount: 10000, publishedAt: new Date().toISOString() };
    const channel = { subscriberCount: 0, hiddenSubscriberCount: false };

    const score = trendApi.calculatePotentialScore(video, channel);
    assert.ok(typeof score === "number");
    assert.ok(Number.isFinite(score), "Score phải là số hữu hạn, không phải Infinity");
  });
});
