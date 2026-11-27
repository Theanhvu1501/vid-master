/**
 * Tests cho trend-research.js exportToExcel và buildExportRows
 * Chạy: node --test tests/trend-export.test.js
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert";
import fs from "fs";
import path from "path";
import os from "os";

// Set TREND_DATA_DIR env TRƯỚC khi import trend-store để không đụng real data
const testDir = path.join(os.tmpdir(), `trend-export-test-${Date.now()}`);
process.env.TREND_DATA_DIR = testDir;

// Import sau khi set env
const { buildExportRows, exportToExcel, sanitizeExportFilters } = await import("../sheet/trend-research.js");
const trendStore = await import("../sheet/trend-store.js");
const XLSXModule = await import("xlsx");
const XLSX = XLSXModule.default;

// Temp directory for Excel output
const tempDir = path.join(os.tmpdir(), `trend-excel-test-${Date.now()}`);

describe("trend-export", () => {
  const profileId = "test-export-profile";

  before(() => {
    // Create temp dirs
    if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    // Create test profile
    trendStore.addProfile({ id: profileId, name: "Test Export", country: "US", apiKey: "test-key" });
  });

  beforeEach(() => {
    // Clear videos from store before each test
    // We do this by directly deleting the videos file
    const videosFile = path.join(testDir, `videos-${profileId}.json`);
    if (fs.existsSync(videosFile)) {
      fs.unlinkSync(videosFile);
    }
  });

  after(() => {
    // Cleanup
    try {
      if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true });
      if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true });
    } catch { /* ignore */ }
  });

  describe("buildExportRows", () => {
    it("returns correct column headers and order", () => {
      const videos = [{ videoId: "abc123", title: "Test Video", channelTitle: "Test Channel", viewCount: 1000, subscriberCount: 500, viewSubRatio: 2, potentialScore: 10, ageInDays: 3, categoryName: "Gaming" }];
      const rows = buildExportRows(videos);

      assert.strictEqual(rows.length, 1);
      const keys = Object.keys(rows[0]);
      // Exact column headers/order as specified in the brief
      assert.deepStrictEqual(keys, ["#", "Title", "Channel", "Views", "Subs", "Ratio", "Score", "Age (days)", "Category", "URL"]);
    });

    it("generates URL in youtube.com/watch?v= format", () => {
      const videos = [{ videoId: "abc123", title: "Test", publishedAt: new Date().toISOString() }];
      const rows = buildExportRows(videos);

      assert.strictEqual(rows[0]["URL"], "https://www.youtube.com/watch?v=abc123");
    });

    it("produces empty cells for missing fields (null subscriberCount)", () => {
      const videos = [{ videoId: "v1", title: "Test", subscriberCount: null, categoryName: null }];
      const rows = buildExportRows(videos);

      assert.strictEqual(rows[0]["Subs"], "", "null subscriberCount should produce empty string");
      assert.strictEqual(rows[0]["Category"], "", "null categoryName should produce empty string");
    });

    it("produces empty cells for undefined fields", () => {
      const videos = [{ videoId: "v1", title: "Test" }]; // no viewCount, subscriberCount, etc.
      const rows = buildExportRows(videos);

      assert.strictEqual(rows[0]["Views"], "", "undefined viewCount should produce empty string");
      assert.strictEqual(rows[0]["Subs"], "", "undefined subscriberCount should produce empty string");
      assert.strictEqual(rows[0]["Ratio"], "", "undefined viewSubRatio should produce empty string");
      assert.strictEqual(rows[0]["Score"], "", "undefined potentialScore should produce empty string");
      assert.strictEqual(rows[0]["Age (days)"], "", "undefined ageInDays should produce empty string");
    });

    it("sanitizes formula injection: prefixes =, +, -, @ with single quote", () => {
      const videos = [
        { videoId: "v1", title: "=SUM(A1:A10)", channelTitle: "+dangerous", categoryName: "-cmd|calc" },
        { videoId: "v2", title: "@user", channelTitle: "Normal Channel", categoryName: "Safe" },
      ];
      const rows = buildExportRows(videos);

      assert.strictEqual(rows[0]["Title"], "'=SUM(A1:A10)", "= should be prefixed with quote");
      assert.strictEqual(rows[0]["Channel"], "'+dangerous", "+ should be prefixed with quote");
      assert.strictEqual(rows[0]["Category"], "'-cmd|calc", "- should be prefixed with quote");
      assert.strictEqual(rows[1]["Title"], "'@user", "@ should be prefixed with quote");
      assert.strictEqual(rows[1]["Channel"], "Normal Channel", "Normal text should not be modified");
      assert.strictEqual(rows[1]["Category"], "Safe", "Normal text should not be modified");
    });

    it("sanitizes formula injection with leading whitespace: ' =1+1'", () => {
      const videos = [{ videoId: "v1", title: " =1+1", channelTitle: "  @user" }];
      const rows = buildExportRows(videos);

      assert.strictEqual(rows[0]["Title"], "' =1+1", "space + = should be prefixed with quote");
      assert.strictEqual(rows[0]["Channel"], "'  @user", "spaces + @ should be prefixed with quote");
    });

    it("sanitizes formula injection with tab: '\\t=1+1'", () => {
      const videos = [{ videoId: "v1", title: "\t=1+1" }];
      const rows = buildExportRows(videos);

      assert.strictEqual(rows[0]["Title"], "'\t=1+1", "tab + = should be prefixed with quote");
    });

    it("sanitizes formula injection with carriage return: '\\r@x'", () => {
      const videos = [{ videoId: "v1", title: "\r@x" }];
      const rows = buildExportRows(videos);

      assert.strictEqual(rows[0]["Title"], "'\r@x", "\\r + @ should be prefixed with quote");
    });

    it("does not modify plain text", () => {
      const videos = [{ videoId: "v1", title: "Normal Video Title", channelTitle: "My Channel" }];
      const rows = buildExportRows(videos);

      assert.strictEqual(rows[0]["Title"], "Normal Video Title");
      assert.strictEqual(rows[0]["Channel"], "My Channel");
    });

    it("prefixes '-5 tips' (accepted trade-off for security)", () => {
      const videos = [{ videoId: "v1", title: "-5 tips for success" }];
      const rows = buildExportRows(videos);

      assert.strictEqual(rows[0]["Title"], "'-5 tips for success", "- at start should be prefixed with quote");
    });

    it("row numbering starts at 1", () => {
      const videos = [
        { videoId: "v1", title: "First" },
        { videoId: "v2", title: "Second" },
        { videoId: "v3", title: "Third" },
      ];
      const rows = buildExportRows(videos);

      assert.strictEqual(rows[0]["#"], 1);
      assert.strictEqual(rows[1]["#"], 2);
      assert.strictEqual(rows[2]["#"], 3);
    });
  });

  describe("sanitizeExportFilters", () => {
    it("returns empty object for null/undefined/non-object input", () => {
      assert.deepStrictEqual(sanitizeExportFilters(null), {});
      assert.deepStrictEqual(sanitizeExportFilters(undefined), {});
      assert.deepStrictEqual(sanitizeExportFilters("string"), {});
      assert.deepStrictEqual(sanitizeExportFilters(123), {});
      assert.deepStrictEqual(sanitizeExportFilters([1, 2, 3]), {});
    });

    it("only allows known filter keys", () => {
      const input = {
        timeRange: "7d",
        sortBy: "viewCount",
        categoryId: "20",
        maxSubs: 100000,
        minViews: 1000,
        unknownKey: "malicious",
        anotherBadKey: 123,
      };
      const result = sanitizeExportFilters(input);

      assert.strictEqual(result.timeRange, "7d");
      assert.strictEqual(result.sortBy, "viewCount");
      assert.strictEqual(result.categoryId, "20");
      assert.strictEqual(result.maxSubs, 100000);
      assert.strictEqual(result.minViews, 1000);
      assert.strictEqual(result.unknownKey, undefined);
      assert.strictEqual(result.anotherBadKey, undefined);
    });

    it("validates types: strings must be strings", () => {
      const input = {
        timeRange: 123, // should be string
        sortBy: { obj: true }, // should be string
        categoryId: ["array"], // should be string
      };
      const result = sanitizeExportFilters(input);

      assert.strictEqual(result.timeRange, undefined);
      assert.strictEqual(result.sortBy, undefined);
      assert.strictEqual(result.categoryId, undefined);
    });

    it("validates types: numbers must be finite numbers", () => {
      const input = {
        maxSubs: "100000", // should be number
        minViews: Infinity, // should be finite
      };
      const result = sanitizeExportFilters(input);

      assert.strictEqual(result.maxSubs, undefined);
      assert.strictEqual(result.minViews, undefined);
    });

    it("allows valid filters through", () => {
      const input = {
        timeRange: "24h",
        sortBy: "potentialScore",
        categoryId: "10",
        maxSubs: 50000,
        minViews: 500,
      };
      const result = sanitizeExportFilters(input);

      assert.deepStrictEqual(result, input);
    });

    it("handles empty object", () => {
      assert.deepStrictEqual(sanitizeExportFilters({}), {});
    });
  });

  describe("exportToExcel", () => {
    it("throws error with Vietnamese message when no videos", async () => {
      // No videos inserted
      await assert.rejects(
        async () => await exportToExcel(profileId, { timeRange: "all" }, path.join(tempDir, "empty.xlsx")),
        { message: "Không có video để xuất" }
      );
    });

    it("creates valid xlsx file with correct data", async () => {
      // Insert test videos
      const videos = [
        { videoId: "vid1", title: "Video One", channelTitle: "Channel A", viewCount: 10000, subscriberCount: 1000, viewSubRatio: 10, potentialScore: 15.5, ageInDays: 2, categoryName: "Gaming", publishedAt: new Date().toISOString() },
        { videoId: "vid2", title: "Video Two", channelTitle: "Channel B", viewCount: 5000, subscriberCount: null, viewSubRatio: null, potentialScore: 8, ageInDays: 5, categoryName: null, publishedAt: new Date().toISOString() },
      ];
      trendStore.upsertVideos(profileId, videos);

      const outputPath = path.join(tempDir, "test-export.xlsx");
      const result = await exportToExcel(profileId, { timeRange: "all" }, outputPath);

      assert.strictEqual(result, outputPath, "Should return the output path");
      assert.ok(fs.existsSync(outputPath), "File should exist");

      // Read and verify content
      const wb = XLSX.readFile(outputPath);
      assert.ok(wb.SheetNames.includes("Videos"), "Should have Videos sheet");

      const ws = wb.Sheets["Videos"];
      const data = XLSX.utils.sheet_to_json(ws);

      assert.strictEqual(data.length, 2, "Should have 2 rows");

      // Check first row
      assert.strictEqual(data[0]["#"], 1);
      assert.strictEqual(data[0]["Title"], "Video One");
      assert.strictEqual(data[0]["Channel"], "Channel A");
      assert.strictEqual(data[0]["Views"], 10000);
      assert.strictEqual(data[0]["Subs"], 1000);
      assert.strictEqual(data[0]["URL"], "https://www.youtube.com/watch?v=vid1");

      // Check second row - null fields produce empty strings
      assert.strictEqual(data[1]["#"], 2);
      assert.strictEqual(data[1]["Title"], "Video Two");
      // XLSX reads empty cells as undefined or empty string depending on version
      assert.ok(data[1]["Subs"] === undefined || data[1]["Subs"] === "", "null subscriberCount should result in empty cell");
      assert.ok(data[1]["Category"] === undefined || data[1]["Category"] === "", "null categoryName should result in empty cell");

      // Cleanup
      fs.unlinkSync(outputPath);
    });

    it("sanitizes formula injection in exported file", async () => {
      const videos = [{ videoId: "v1", title: "=HYPERLINK(\"http://evil.com\")", channelTitle: "@mention", categoryName: "+positive", publishedAt: new Date().toISOString() }];
      trendStore.upsertVideos(profileId, videos);

      const outputPath = path.join(tempDir, "test-sanitize.xlsx");
      await exportToExcel(profileId, { timeRange: "all" }, outputPath);

      const wb = XLSX.readFile(outputPath);
      const ws = wb.Sheets["Videos"];
      const data = XLSX.utils.sheet_to_json(ws);

      assert.strictEqual(data[0]["Title"], "'=HYPERLINK(\"http://evil.com\")", "= formula should be prefixed with quote");
      assert.strictEqual(data[0]["Channel"], "'@mention", "@ should be prefixed with quote");
      assert.strictEqual(data[0]["Category"], "'+positive", "+ should be prefixed with quote");

      fs.unlinkSync(outputPath);
    });

    it("sanitizes whitespace variants in exported file", async () => {
      const videos = [{ videoId: "v1", title: " =1+1", channelTitle: "\t@evil", categoryName: "\r-bad", publishedAt: new Date().toISOString() }];
      trendStore.upsertVideos(profileId, videos);

      const outputPath = path.join(tempDir, "test-whitespace.xlsx");
      await exportToExcel(profileId, { timeRange: "all" }, outputPath);

      const wb = XLSX.readFile(outputPath);
      const ws = wb.Sheets["Videos"];
      const data = XLSX.utils.sheet_to_json(ws);

      assert.strictEqual(data[0]["Title"], "' =1+1", "space + = should be prefixed");
      assert.strictEqual(data[0]["Channel"], "'\t@evil", "tab + @ should be prefixed");
      assert.strictEqual(data[0]["Category"], "'\r-bad", "\\r + - should be prefixed");

      fs.unlinkSync(outputPath);
    });
  });
});
