/**
 * Tests for hot video tracking in trend-store.js
 * Run: node --test tests/trend-hot.test.js
 */

import { describe, it, after, beforeEach } from "node:test";
import assert from "node:assert";
import fs from "fs";
import path from "path";
import os from "os";

// Set TREND_DATA_DIR env BEFORE importing modules to isolate test data
const testDir = path.join(os.tmpdir(), `trend-hot-test-${Date.now()}`);
process.env.TREND_DATA_DIR = testDir;

// Import after setting env
const trendStore = await import("../sheet/trend-store.js");

describe("trend-store hot video tracking", () => {
  beforeEach(() => {
    // Clean up test data before each test
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

  describe("markHotVideos", () => {
    it("first scan with 3 hot + 2 non-hot returns count 3", () => {
      // Create profile
      trendStore.addProfile({ id: "hot-test-1", name: "Hot Test 1", apiKey: "key" });

      const videos = [
        { videoId: "v1", potentialScore: 15 }, // hot (>= 10)
        { videoId: "v2", potentialScore: 12 }, // hot
        { videoId: "v3", potentialScore: 10 }, // hot (exactly 10)
        { videoId: "v4", potentialScore: 9 },  // not hot
        { videoId: "v5", potentialScore: 5 },  // not hot
      ];

      const newHotCount = trendStore.markHotVideos("hot-test-1", videos);

      assert.strictEqual(newHotCount, 3, "Should return 3 new hot videos");
      assert.strictEqual(trendStore.getHotCount("hot-test-1"), 3, "getHotCount should return 3");
    });

    it("same videos re-scanned does not re-count (stays 3)", () => {
      trendStore.addProfile({ id: "hot-test-2", name: "Hot Test 2", apiKey: "key" });

      const videos = [
        { videoId: "v1", potentialScore: 15 },
        { videoId: "v2", potentialScore: 12 },
        { videoId: "v3", potentialScore: 10 },
      ];

      // First scan
      trendStore.markHotVideos("hot-test-2", videos);
      assert.strictEqual(trendStore.getHotCount("hot-test-2"), 3);

      // Second scan with same videos
      const newHotCount = trendStore.markHotVideos("hot-test-2", videos);

      assert.strictEqual(newHotCount, 0, "Should return 0 for already-seen videos");
      assert.strictEqual(trendStore.getHotCount("hot-test-2"), 3, "Total count should stay 3");
    });

    it("one new hot video after re-scan increments count to 4", () => {
      trendStore.addProfile({ id: "hot-test-3", name: "Hot Test 3", apiKey: "key" });

      const initialVideos = [
        { videoId: "v1", potentialScore: 15 },
        { videoId: "v2", potentialScore: 12 },
        { videoId: "v3", potentialScore: 10 },
      ];

      trendStore.markHotVideos("hot-test-3", initialVideos);
      assert.strictEqual(trendStore.getHotCount("hot-test-3"), 3);

      // Second scan with one new hot video
      const newVideos = [
        ...initialVideos,
        { videoId: "v4", potentialScore: 11 }, // new hot
      ];

      const newHotCount = trendStore.markHotVideos("hot-test-3", newVideos);

      assert.strictEqual(newHotCount, 1, "Should return 1 for the new hot video");
      assert.strictEqual(trendStore.getHotCount("hot-test-3"), 4, "Total count should be 4");
    });

    it("non-numeric potentialScore never counts as hot", () => {
      trendStore.addProfile({ id: "hot-test-4", name: "Hot Test 4", apiKey: "key" });

      const videos = [
        { videoId: "v1", potentialScore: "15" },    // string, not hot
        { videoId: "v2", potentialScore: null },    // null, not hot
        { videoId: "v3", potentialScore: undefined }, // undefined, not hot
        { videoId: "v4" },                          // missing, not hot
        { videoId: "v5", potentialScore: NaN },     // NaN, not hot
        { videoId: "v6", potentialScore: 15 },      // numeric, IS hot
      ];

      const newHotCount = trendStore.markHotVideos("hot-test-4", videos);

      assert.strictEqual(newHotCount, 1, "Only numeric score >= 10 should count");
      assert.strictEqual(trendStore.getHotCount("hot-test-4"), 1);
    });

    it("missing potentialScore never counts as hot", () => {
      trendStore.addProfile({ id: "hot-test-5", name: "Hot Test 5", apiKey: "key" });

      const videos = [
        { videoId: "v1", title: "No score video" },
        { videoId: "v2", potentialScore: 10 },
      ];

      const newHotCount = trendStore.markHotVideos("hot-test-5", videos);

      assert.strictEqual(newHotCount, 1, "Only video with score should count");
    });

    it("seenHotIds is capped at 500", () => {
      trendStore.addProfile({ id: "hot-test-6", name: "Hot Test 6", apiKey: "key" });

      // Create 600 hot videos
      const videos = Array.from({ length: 600 }, (_, i) => ({
        videoId: `v${i}`,
        potentialScore: 15,
      }));

      trendStore.markHotVideos("hot-test-6", videos);

      const profile = trendStore.getProfile("hot-test-6");
      assert.ok(profile.seenHotIds, "seenHotIds should exist");
      assert.strictEqual(profile.seenHotIds.length, 500, "seenHotIds should be capped at 500");
      // Should keep the LAST 500
      assert.ok(profile.seenHotIds.includes("v599"), "Should keep the last video ID");
      assert.ok(profile.seenHotIds.includes("v100"), "Should keep v100");
      assert.ok(!profile.seenHotIds.includes("v0"), "Should have dropped v0 (oldest)");
    });

    it("unknown profileId does not throw", () => {
      // Should not throw, just return 0
      const result = trendStore.markHotVideos("nonexistent-profile", [
        { videoId: "v1", potentialScore: 15 },
      ]);

      assert.strictEqual(result, 0, "Should return 0 for unknown profile");
    });

    it("empty videos array returns 0", () => {
      trendStore.addProfile({ id: "hot-test-7", name: "Hot Test 7", apiKey: "key" });

      const result = trendStore.markHotVideos("hot-test-7", []);

      assert.strictEqual(result, 0, "Should return 0 for empty array");
      assert.strictEqual(trendStore.getHotCount("hot-test-7"), 0, "Count should be 0");
    });
  });

  describe("getHotCount", () => {
    it("returns 0 for profile with no hot count", () => {
      trendStore.addProfile({ id: "get-hot-1", name: "Get Hot 1", apiKey: "key" });

      const count = trendStore.getHotCount("get-hot-1");

      assert.strictEqual(count, 0);
    });

    it("returns 0 for unknown profile", () => {
      const count = trendStore.getHotCount("nonexistent");

      assert.strictEqual(count, 0);
    });

    it("returns correct count after markHotVideos", () => {
      trendStore.addProfile({ id: "get-hot-2", name: "Get Hot 2", apiKey: "key" });

      trendStore.markHotVideos("get-hot-2", [
        { videoId: "v1", potentialScore: 15 },
        { videoId: "v2", potentialScore: 12 },
      ]);

      assert.strictEqual(trendStore.getHotCount("get-hot-2"), 2);
    });
  });

  describe("clearHotCount", () => {
    it("resets count to 0 but KEEPS seenHotIds", () => {
      trendStore.addProfile({ id: "clear-hot-1", name: "Clear Hot 1", apiKey: "key" });

      // Add some hot videos
      trendStore.markHotVideos("clear-hot-1", [
        { videoId: "v1", potentialScore: 15 },
        { videoId: "v2", potentialScore: 12 },
      ]);

      assert.strictEqual(trendStore.getHotCount("clear-hot-1"), 2);

      // Clear the count
      trendStore.clearHotCount("clear-hot-1");

      assert.strictEqual(trendStore.getHotCount("clear-hot-1"), 0, "Count should be 0 after clear");

      // Verify seenHotIds is preserved
      const profile = trendStore.getProfile("clear-hot-1");
      assert.ok(profile.seenHotIds, "seenHotIds should still exist");
      assert.strictEqual(profile.seenHotIds.length, 2, "seenHotIds should be preserved");
      assert.ok(profile.seenHotIds.includes("v1"), "v1 should still be in seenHotIds");
      assert.ok(profile.seenHotIds.includes("v2"), "v2 should still be in seenHotIds");
    });

    it("cleared videos do not re-alert on next scan", () => {
      trendStore.addProfile({ id: "clear-hot-2", name: "Clear Hot 2", apiKey: "key" });

      // Add hot videos
      trendStore.markHotVideos("clear-hot-2", [
        { videoId: "v1", potentialScore: 15 },
        { videoId: "v2", potentialScore: 12 },
      ]);

      // Clear count
      trendStore.clearHotCount("clear-hot-2");
      assert.strictEqual(trendStore.getHotCount("clear-hot-2"), 0);

      // Re-scan with same videos
      const newHotCount = trendStore.markHotVideos("clear-hot-2", [
        { videoId: "v1", potentialScore: 15 },
        { videoId: "v2", potentialScore: 12 },
      ]);

      assert.strictEqual(newHotCount, 0, "Same videos should not count again");
      assert.strictEqual(trendStore.getHotCount("clear-hot-2"), 0, "Count should stay 0");
    });

    it("does not throw for unknown profileId", () => {
      // Should not throw
      trendStore.clearHotCount("nonexistent-profile");
      assert.ok(true, "No error thrown for unknown profile");
    });
  });

  describe("HOT_SCORE_THRESHOLD constant", () => {
    it("threshold is exactly 10", () => {
      trendStore.addProfile({ id: "threshold-test", name: "Threshold Test", apiKey: "key" });

      const videos = [
        { videoId: "v1", potentialScore: 9.9 },  // not hot (< 10)
        { videoId: "v2", potentialScore: 10 },   // hot (= 10)
        { videoId: "v3", potentialScore: 10.1 }, // hot (> 10)
      ];

      const newHotCount = trendStore.markHotVideos("threshold-test", videos);

      assert.strictEqual(newHotCount, 2, "Only scores >= 10 should count");
    });
  });

  describe("toPublicProfile", () => {
    it("strips apiKey and seenHotIds", () => {
      const full = {
        id: "pub-1",
        name: "Public Test",
        country: "US",
        apiKey: "secret-api-key-12345",
        seenHotIds: ["v1", "v2", "v3"],
        hotCount: 3,
        scansPerDay: 4,
      };

      const pub = trendStore.toPublicProfile(full);

      assert.ok(!("apiKey" in pub), "apiKey should be stripped");
      assert.ok(!("seenHotIds" in pub), "seenHotIds should be stripped");
    });

    it("sets hasApiKey true when apiKey is present", () => {
      const full = { id: "pub-2", name: "Test", apiKey: "some-key" };

      const pub = trendStore.toPublicProfile(full);

      assert.strictEqual(pub.hasApiKey, true);
    });

    it("sets hasApiKey false when apiKey is missing/empty", () => {
      const noKey = { id: "pub-3", name: "Test" };
      const emptyKey = { id: "pub-4", name: "Test", apiKey: "" };

      assert.strictEqual(trendStore.toPublicProfile(noKey).hasApiKey, false);
      assert.strictEqual(trendStore.toPublicProfile(emptyKey).hasApiKey, false);
    });

    it("keeps hotCount, name, country, scansPerDay", () => {
      const full = {
        id: "pub-5",
        name: "Keep Fields",
        country: "JP",
        apiKey: "key",
        seenHotIds: ["v1"],
        hotCount: 5,
        scansPerDay: 2,
        lastScanAt: "2024-01-01T00:00:00Z",
      };

      const pub = trendStore.toPublicProfile(full);

      assert.strictEqual(pub.id, "pub-5");
      assert.strictEqual(pub.name, "Keep Fields");
      assert.strictEqual(pub.country, "JP");
      assert.strictEqual(pub.hotCount, 5);
      assert.strictEqual(pub.scansPerDay, 2);
      assert.strictEqual(pub.lastScanAt, "2024-01-01T00:00:00Z");
    });

    it("returns null for null input", () => {
      assert.strictEqual(trendStore.toPublicProfile(null), null);
    });

    it("returns null for undefined input", () => {
      assert.strictEqual(trendStore.toPublicProfile(undefined), null);
    });

    it("does not mutate its input", () => {
      const full = {
        id: "pub-6",
        name: "Immutable",
        apiKey: "secret",
        seenHotIds: ["v1"],
        hotCount: 1,
      };

      const originalApiKey = full.apiKey;
      const originalSeenHotIds = full.seenHotIds;

      trendStore.toPublicProfile(full);

      assert.strictEqual(full.apiKey, originalApiKey, "apiKey should not be mutated");
      assert.deepStrictEqual(full.seenHotIds, originalSeenHotIds, "seenHotIds should not be mutated");
      assert.ok("apiKey" in full, "apiKey should still exist in original");
      assert.ok("seenHotIds" in full, "seenHotIds should still exist in original");
    });
  });
});
