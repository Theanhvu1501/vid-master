// Tests for sheet/app-features.cjs
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const AppFeatures = require("../sheet/app-features.cjs");

// ===== TAB_PERMISSIONS tests =====
test("TAB_PERMISSIONS: contains exactly 17 gated tabs", () => {
  const keys = Object.keys(AppFeatures.TAB_PERMISSIONS);
  assert.equal(keys.length, 17);
});

test("TAB_PERMISSIONS: maps tab IDs to app:* keys", () => {
  for (const [tabId, key] of Object.entries(AppFeatures.TAB_PERMISSIONS)) {
    assert.equal(key, `app:${tabId}`, `Key for ${tabId} should be app:${tabId}`);
  }
});

test("TAB_PERMISSIONS: includes all expected tab IDs", () => {
  const expected = [
    "channel-stats", "sheet-watch", "batches", "veo3-image", "trend-research",
    "render", "composer", "video-snow", "bg-video", "download", "stock-download",
    "get-url", "trim", "cut-bg", "concat", "thumb", "automation"
  ];
  for (const tabId of expected) {
    assert.ok(AppFeatures.TAB_PERMISSIONS[tabId], `Missing tab: ${tabId}`);
  }
});

// ===== isTabAllowed tests =====
test("isTabAllowed: returns true for undefined payload (fail open)", () => {
  assert.equal(AppFeatures.isTabAllowed("render", undefined), true);
});

test("isTabAllowed: returns true for null payload (fail open)", () => {
  assert.equal(AppFeatures.isTabAllowed("render", null), true);
});

test("isTabAllowed: returns true for empty object payload (fail open)", () => {
  assert.equal(AppFeatures.isTabAllowed("render", {}), true);
});

test("isTabAllowed: returns true for payload without appFeatures array (fail open)", () => {
  assert.equal(AppFeatures.isTabAllowed("render", { enforced: true }), true);
  assert.equal(AppFeatures.isTabAllowed("render", { enforced: true, appFeatures: "not-array" }), true);
});

test("isTabAllowed: returns true when enforced=false (fail open)", () => {
  assert.equal(AppFeatures.isTabAllowed("render", { enforced: false, appFeatures: [] }), true);
});

test("isTabAllowed: returns true for tab NOT in TAB_PERMISSIONS (ungated)", () => {
  // "normalize" is not gated
  assert.equal(AppFeatures.isTabAllowed("normalize", { enforced: true, appFeatures: [] }), true);
  assert.equal(AppFeatures.isTabAllowed("unknown-tab", { enforced: true, appFeatures: [] }), true);
});

test("isTabAllowed: returns true when enforced=true and key IS in appFeatures", () => {
  const payload = { enforced: true, appFeatures: ["app:render", "app:download"] };
  assert.equal(AppFeatures.isTabAllowed("render", payload), true);
  assert.equal(AppFeatures.isTabAllowed("download", payload), true);
});

test("isTabAllowed: returns false when enforced=true and key NOT in appFeatures", () => {
  const payload = { enforced: true, appFeatures: ["app:render"] };
  assert.equal(AppFeatures.isTabAllowed("download", payload), false);
  assert.equal(AppFeatures.isTabAllowed("automation", payload), false);
});

test("isTabAllowed: returns false for all gated tabs when enforced=true with empty appFeatures", () => {
  const payload = { enforced: true, appFeatures: [] };
  for (const tabId of Object.keys(AppFeatures.TAB_PERMISSIONS)) {
    assert.equal(AppFeatures.isTabAllowed(tabId, payload), false, `${tabId} should be hidden`);
  }
});

// ===== visibleTabs tests =====
test("visibleTabs: returns empty array for non-array input", () => {
  assert.deepEqual(AppFeatures.visibleTabs(null, {}), []);
  assert.deepEqual(AppFeatures.visibleTabs(undefined, {}), []);
  assert.deepEqual(AppFeatures.visibleTabs("not-array", {}), []);
});

test("visibleTabs: returns all tabs when payload is garbage (fail open)", () => {
  const allTabs = ["render", "download", "normalize"];
  assert.deepEqual(AppFeatures.visibleTabs(allTabs, null), allTabs);
});

test("visibleTabs: filters out disallowed gated tabs", () => {
  const allTabs = ["render", "download", "normalize"];
  const payload = { enforced: true, appFeatures: ["app:render"] };
  assert.deepEqual(AppFeatures.visibleTabs(allTabs, payload), ["render", "normalize"]);
});

test("visibleTabs: keeps all tabs when enforced=false", () => {
  const allTabs = ["render", "download"];
  const payload = { enforced: false, appFeatures: [] };
  assert.deepEqual(AppFeatures.visibleTabs(allTabs, payload), allTabs);
});

// ===== computeHidden tests =====
test("computeHidden: returns empty sets for empty input", () => {
  const result = AppFeatures.computeHidden([], {});
  assert.deepEqual([...result.hiddenTabs], []);
  assert.deepEqual([...result.hiddenGroups], []);
});

test("computeHidden: returns empty sets for garbage payload (fail open)", () => {
  const tabs = [{ tabId: "render", group: "create" }];
  const result = AppFeatures.computeHidden(tabs, null);
  assert.deepEqual([...result.hiddenTabs], []);
  assert.deepEqual([...result.hiddenGroups], []);
});

test("computeHidden: hides tabs when enforced=true and key not in appFeatures", () => {
  const tabs = [
    { tabId: "render", group: "create" },
    { tabId: "composer", group: "create" },
  ];
  const payload = { enforced: true, appFeatures: ["app:render"] };
  const result = AppFeatures.computeHidden(tabs, payload);
  assert.ok(result.hiddenTabs.has("composer"));
  assert.ok(!result.hiddenTabs.has("render"));
});

test("computeHidden: hides group when ALL its tabs are hidden", () => {
  const tabs = [
    { tabId: "render", group: "create" },
    { tabId: "composer", group: "create" },
    { tabId: "download", group: "download" },
  ];
  const payload = { enforced: true, appFeatures: ["app:download"] };
  const result = AppFeatures.computeHidden(tabs, payload);
  assert.ok(result.hiddenGroups.has("create"), "create group should be hidden");
  assert.ok(!result.hiddenGroups.has("download"), "download group should NOT be hidden");
});

test("computeHidden: does NOT hide group when SOME tabs are visible", () => {
  const tabs = [
    { tabId: "render", group: "create" },
    { tabId: "composer", group: "create" },
  ];
  const payload = { enforced: true, appFeatures: ["app:render"] };
  const result = AppFeatures.computeHidden(tabs, payload);
  assert.ok(!result.hiddenGroups.has("create"), "create group should NOT be hidden");
});

test("computeHidden: handles ungated tabs (not in TAB_PERMISSIONS)", () => {
  const tabs = [
    { tabId: "normalize", group: "process" }, // ungated
    { tabId: "trim", group: "process" },
  ];
  const payload = { enforced: true, appFeatures: [] };
  const result = AppFeatures.computeHidden(tabs, payload);
  assert.ok(!result.hiddenTabs.has("normalize"), "normalize should NOT be hidden");
  assert.ok(result.hiddenTabs.has("trim"), "trim should be hidden");
  assert.ok(!result.hiddenGroups.has("process"), "process group has visible tab");
});

// ===== sync with license-server/app-features.js =====
test("TAB_PERMISSIONS matches server APP_TABS", { skip: !existsSync(resolve(__dirname, "../../license-server/app-features.js")) }, () => {
  const serverModule = require("../../license-server/app-features.js");
  const serverTabIds = serverModule.APP_TABS.map((t) => t.tab);
  const appTabIds = Object.keys(AppFeatures.TAB_PERMISSIONS);

  // Sort for comparison
  serverTabIds.sort();
  appTabIds.sort();

  assert.deepEqual(appTabIds, serverTabIds, "Tab IDs must match server");

  // Also verify keys match
  for (const serverTab of serverModule.APP_TABS) {
    const appKey = AppFeatures.TAB_PERMISSIONS[serverTab.tab];
    assert.equal(appKey, serverTab.key, `Key for ${serverTab.tab} must match server`);
  }
});
