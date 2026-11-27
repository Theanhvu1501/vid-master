# Trend Research Enhancement & App Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance Trend Research with GPM selector, scheduled scans, keyword search, AI analysis, export, and notifications; add role-based tab permissions controlled from license server.

**Architecture:** 
- Phase 1 extends existing trend-ui.js with GPM profile selector (pattern from renderer.js:6274), adds scheduler in electron-main.js, and AI analysis using existing ai-keys.js infrastructure.
- Phase 2 adds `app:*` permissions to license-server PERMISSION_CATALOG, app reads permissions from login response, and renderer.js hides tabs accordingly.

**Tech Stack:** Electron, Node.js, Playwright (GPM), xlsx (export), Gemini/OpenAI API (AI analysis)

**Spec:** `docs/superpowers/specs/2024-11-27-trend-research-and-permissions-design.md`

## Global Constraints

- Scheduler interval check: 5 minutes
- AI analysis: max 10 videos per analysis
- Export: use existing `xlsx` library
- Permissions cached in session, refreshed on verify (1 hour)
- Permission changes don't interrupt current tab viewing
- Schedule file is local per machine (no server sync)

## Review Focus

1. **Empty GPM profile list** - When GPM is not running or returns empty list, UI should show helpful message, not crash or hang
2. **API key validation failure** - Invalid YouTube API key during scan should log error and skip profile, not stop all scans
3. **Offline permission check** - When server unreachable during permission refresh, use cached permissions, don't lock user out
4. **Export with no data** - Export button with empty video list should show message, not create empty file
5. **Missing AI key** - AI analysis without configured API key should show setup prompt, not error

---

## Phase 0 (known risk): the already-built scraper is unverified

`sheet/trend-scraper.js` calls `connectProfile({gpmHost, profileId})` / `closeProfile(...)` but was written without checking their real signatures in `sheet/gpm-client.js`, and the YouTube DOM selectors were never run against a live page. Before Task 4 (scheduler), read `gpm-client.js`, fix the calls, and do one real scan with a GPM profile. Also note the app was only started, not exercised through the Trend tab UI.

## Phase 1: Trend Research Enhancement

### Task 1: GPM Profile Selector in Trend UI

**Files:**
- Modify: `D:\Code\vid-master\trend-ui.js`
- Modify: `D:\Code\vid-master\renderer.html` (CSS)

**Interfaces:**
- Consumes: `window.electronAPI.sheet.gpmListProfilesFull(gpmHost)` - returns `{ok, profiles, groups, error}`
- Produces: Selected GPM profile ID stored in trend profile, UI component renders profile list with search/filter

- [ ] **Step 1: Add GPM state variables to trend-ui.js**

Add at top of file after existing state variables:
```js
let gpmProfiles = [];
let gpmGroups = [];
let gpmHost = "127.0.0.1:19995";
```

- [ ] **Step 2: Add loadGpmProfiles function**

```js
async function loadGpmProfiles() {
  try {
    const r = await window.electronAPI.sheet.gpmListProfilesFull(gpmHost);
    if (!r.ok) throw new Error(r.error);
    gpmProfiles = r.profiles || [];
    gpmGroups = r.groups || [];
    return true;
  } catch (e) {
    console.error("Load GPM profiles error:", e);
    gpmProfiles = [];
    gpmGroups = [];
    return false;
  }
}
```

- [ ] **Step 3: Add renderGpmSelector function**

Returns HTML string for GPM profile dropdown grouped by GPM group, with search input. Pattern from `renderAutomationProfiles()` in renderer.js:6316.

- [ ] **Step 4: Update showAddProfile modal to include GPM selector**

Replace text input `profile-gpmid` with the GPM selector dropdown. Add "Làm mới" button to reload profiles.

- [ ] **Step 5: Update editProfile modal similarly**

- [ ] **Step 6: Add CSS for GPM selector**

Add to renderer.html in Trend Research UI section:
```css
.trend-gpm-selector { ... }
.trend-gpm-search { ... }
.trend-gpm-list { max-height: 200px; overflow-y: auto; ... }
.trend-gpm-group { ... }
.trend-gpm-item { ... }
```

- [ ] **Step 7: Test GPM selector manually**

Run app, go to Trend tab, click "Thêm Profile", verify GPM dropdown loads profiles from GPM.

- [ ] **Step 8: Commit**

```bash
git add trend-ui.js renderer.html
git commit -m "feat(trend): add GPM profile selector to trend research"
```

---

### Task 2: Keyword Search UI

**Files:**
- Modify: `D:\Code\vid-master\trend-ui.js`

**Interfaces:**
- Consumes: `window.electronAPI.trend.search(profileId, keyword, options)` - already exists
- Produces: Search UI section in dashboard, search results displayed in video list

- [ ] **Step 1: Add search state**

```js
let searchKeyword = "";
let searchResults = null;
let isSearching = false;
```

- [ ] **Step 2: Add renderSearchSection function**

```js
function renderSearchSection() {
  return `
    <div class="trend-section trend-search-section">
      <h4>🔍 Tìm video theo từ khóa</h4>
      <div class="trend-search-form">
        <input type="text" id="trend-search-input" placeholder="Nhập từ khóa..." value="${escapeHtml(searchKeyword)}">
        <select id="trend-search-order">
          <option value="viewCount">Nhiều view nhất</option>
          <option value="date">Mới nhất</option>
          <option value="relevance">Liên quan nhất</option>
        </select>
        <button class="btn btn-primary" onclick="TrendUI.doSearch()" ${isSearching ? 'disabled' : ''}>
          ${isSearching ? 'Đang tìm...' : 'Tìm kiếm'}
        </button>
      </div>
    </div>
  `;
}
```

- [ ] **Step 3: Add doSearch function**

```js
async function doSearch() {
  const input = document.getElementById('trend-search-input');
  const keyword = input?.value?.trim();
  if (!keyword || !currentProfileId) return;
  
  searchKeyword = keyword;
  isSearching = true;
  render();
  
  try {
    const order = document.getElementById('trend-search-order')?.value || 'viewCount';
    searchResults = await window.electronAPI.trend.search(currentProfileId, keyword, { order });
    // Reload dashboard to show new videos
    dashboardData = await window.electronAPI.trend.getDashboard(currentProfileId, filters);
  } catch (e) {
    alert('Lỗi tìm kiếm: ' + e.message);
  } finally {
    isSearching = false;
    render();
  }
}
```

- [ ] **Step 4: Integrate search section into renderDashboard**

Add `${renderSearchSection()}` after filters div in renderDashboard function.

- [ ] **Step 5: Test search manually**

Run app, select a profile with API key, enter keyword, click search, verify results appear.

- [ ] **Step 6: Commit**

```bash
git add trend-ui.js
git commit -m "feat(trend): add keyword search UI"
```

---

### Task 3: Export to Excel

**Files:**
- Modify: `D:\Code\vid-master\sheet\trend-research.js`
- Modify: `D:\Code\vid-master\electron-main.js`
- Modify: `D:\Code\vid-master\preload.cjs`
- Modify: `D:\Code\vid-master\trend-ui.js`

**Interfaces:**
- Consumes: `store.queryVideos(profileId, filters)` - returns video array
- Produces: `exportToExcel(profileId, filters, outputPath): Promise<string>` - returns saved file path

- [ ] **Step 1: Add exportToExcel function in trend-research.js**

```js
import XLSX from "xlsx";
import path from "path";

export async function exportToExcel(profileId, filters, outputPath) {
  const videos = store.queryVideos(profileId, { ...filters, limit: 1000 });
  if (!videos.length) throw new Error("Không có video để xuất");
  
  const rows = videos.map((v, i) => ({
    "#": i + 1,
    "Title": v.title,
    "Channel": v.channelTitle,
    "Views": v.viewCount,
    "Subs": v.subscriberCount,
    "Ratio": v.viewSubRatio,
    "Score": v.potentialScore,
    "Age (days)": v.ageInDays,
    "Category": v.categoryName,
    "URL": `https://youtube.com/watch?v=${v.videoId}`,
  }));
  
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Videos");
  XLSX.writeFile(wb, outputPath);
  return outputPath;
}
```

- [ ] **Step 2: Add IPC handler in electron-main.js**

```js
ipcMain.handle("trend:export", async (event, { profileId, filters }) => {
  const { dialog } = require('electron');
  const result = await dialog.showSaveDialog({
    defaultPath: `trend-videos-${new Date().toISOString().slice(0,10)}.xlsx`,
    filters: [{ name: 'Excel', extensions: ['xlsx'] }]
  });
  if (result.canceled) return { ok: false, canceled: true };
  const filePath = await exportToExcel(profileId, filters, result.filePath);
  return { ok: true, path: filePath };
});
```

- [ ] **Step 3: Add to preload.cjs**

```js
export: (profileId, filters) => ipcRenderer.invoke("trend:export", { profileId, filters }),
```

- [ ] **Step 4: Add export button to trend-ui.js dashboard**

Add in trend-dashboard-header after filters:
```js
<button class="btn btn-secondary" onclick="TrendUI.exportExcel()">
  📥 Xuất Excel
</button>
```

- [ ] **Step 5: Add exportExcel function**

```js
async function exportExcel() {
  if (!currentProfileId) return;
  try {
    const r = await window.electronAPI.trend.export(currentProfileId, filters);
    if (r.canceled) return;
    if (r.ok) alert('Đã xuất: ' + r.path);
  } catch (e) {
    alert('Lỗi xuất file: ' + e.message);
  }
}
```

- [ ] **Step 6: Test export manually**

Run app, select profile with data, click Export, verify Excel file is created with correct data.

- [ ] **Step 7: Commit**

```bash
git add sheet/trend-research.js electron-main.js preload.cjs trend-ui.js
git commit -m "feat(trend): add export to Excel"
```

---

### Task 4: Scheduled Scan Job

**Files:**
- Create: `D:\Code\vid-master\sheet\trend-scheduler.js`
- Modify: `D:\Code\vid-master\electron-main.js`
- Modify: `D:\Code\vid-master\sheet\trend-store.js`

**Interfaces:**
- Consumes: `store.getProfilesDueForScan()`, `runScan(profileId, options)`
- Produces: `startScheduler(options)`, `stopScheduler()` - manages background scan interval

- [ ] **Step 1: Create trend-scheduler.js**

```js
/**
 * Background scheduler for trend scans.
 * Checks every 5 minutes if any profile is due for scan.
 */

import { getProfilesDueForScan, updateLastScan } from "./trend-store.js";
import { runScan } from "./trend-research.js";

let intervalId = null;
const CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes

export function startScheduler({ gpmHost, log = console.log, onScanComplete } = {}) {
  if (intervalId) return; // Already running
  
  log("[Scheduler] Started, checking every 5 minutes");
  
  intervalId = setInterval(async () => {
    const due = getProfilesDueForScan();
    if (!due.length) return;
    
    log(`[Scheduler] ${due.length} profile(s) due for scan`);
    
    for (const profile of due) {
      try {
        log(`[Scheduler] Scanning: ${profile.name}`);
        const result = await runScan(profile.id, { gpmHost, log });
        onScanComplete?.(profile, result);
      } catch (e) {
        log(`[Scheduler] Error scanning ${profile.name}: ${e.message}`);
      }
    }
  }, CHECK_INTERVAL);
}

export function stopScheduler() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

export function isSchedulerRunning() {
  return intervalId !== null;
}
```

- [ ] **Step 2: Add getNextScanTime helper to trend-store.js**

Already exists, verify it calculates correctly based on `scansPerDay`.

- [ ] **Step 3: Start scheduler in electron-main.js app.whenReady**

After existing initialization:
```js
import { startScheduler } from "./sheet/trend-scheduler.js";

// In app.whenReady callback, after createWindow:
startScheduler({
  gpmHost: settings?.gpmHost || "127.0.0.1:19995",
  log: (msg) => console.log(msg),
  onScanComplete: (profile, result) => {
    // Could send event to renderer for notification badge
    mainWindow?.webContents?.send("trend:scan-complete", { profileId: profile.id, result });
  }
});
```

- [ ] **Step 4: Test scheduler**

Create a profile with scansPerDay=12 (every 2 hours), set lastScanAt to 3 hours ago, verify scan triggers within 5 minutes.

- [ ] **Step 5: Commit**

```bash
git add sheet/trend-scheduler.js electron-main.js
git commit -m "feat(trend): add background scheduled scan job"
```

---

### Task 5: AI Analysis

**Files:**
- Create: `D:\Code\vid-master\sheet\trend-ai-analysis.js`
- Modify: `D:\Code\vid-master\electron-main.js`
- Modify: `D:\Code\vid-master\preload.cjs`
- Modify: `D:\Code\vid-master\trend-ui.js`

**Interfaces:**
- Consumes: Video array, AI key from `ai-keys.js`
- Produces: `analyzeVideos(videos, apiKey): Promise<string>` - returns AI insights text

- [ ] **Step 0: Check AI plumbing before writing code**

`@google/generative-ai` is NOT in package.json, and `sheet/ai-keys.js` stores keys per channel, not a global "gemini" key. Read `sheet/ai-keys.js`, `sheet/ai-title.js` and `sheet/ai-optimize.js` first and reuse whatever HTTP client and key source they already use (no new dependency). The snippets below are illustrative; adapt `analyzeVideos` and the IPC key lookup to the real mechanism.

- [ ] **Step 1: Create trend-ai-analysis.js**

```js
/**
 * AI analysis of trending video thumbnails and titles.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";

const MAX_VIDEOS = 10;

export async function analyzeVideos(videos, apiKey) {
  if (!apiKey) throw new Error("API key không được cấu hình");
  if (!videos?.length) throw new Error("Không có video để phân tích");
  
  const selected = videos.slice(0, MAX_VIDEOS);
  
  const videoList = selected.map((v, i) => 
    `${i+1}. "${v.title}" - ${v.channelTitle} (${v.viewCount} views, ${v.subscriberCount} subs)`
  ).join("\n");
  
  const prompt = `Phân tích ${selected.length} video YouTube trending sau và đưa ra insights về:
1. Pattern chung trong title (cấu trúc, từ khóa, hook, độ dài)
2. Điểm chung của các kênh thành công (ít sub nhưng nhiều view)
3. Gợi ý cụ thể để áp dụng cho kênh mới

Videos:
${videoList}

Trả lời ngắn gọn, thực tế, có thể áp dụng ngay.`;

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
  const result = await model.generateContent(prompt);
  return result.response.text();
}
```

- [ ] **Step 2: Add IPC handler in electron-main.js**

```js
import { analyzeVideos } from "./sheet/trend-ai-analysis.js";

ipcMain.handle("trend:analyze", async (event, { profileId, videos }) => {
  // Get AI key - reuse from existing ai-keys infrastructure
  const aiKey = await channelKeyStore.get("gemini"); // or get from settings
  if (!aiKey) return { ok: false, error: "Chưa cấu hình Gemini API key" };
  
  try {
    const insights = await analyzeVideos(videos, aiKey);
    return { ok: true, insights };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
```

- [ ] **Step 3: Add to preload.cjs**

```js
analyze: (profileId, videos) => ipcRenderer.invoke("trend:analyze", { profileId, videos }),
```

- [ ] **Step 4: Add analyze button and modal to trend-ui.js**

Add button in dashboard header:
```js
<button class="btn btn-secondary" onclick="TrendUI.analyzeTop()">
  🤖 Phân tích AI
</button>
```

Add analyzeTop function and modal to show results.

- [ ] **Step 5: Test AI analysis manually**

Run app, select profile with videos, click "Phân tích AI", verify insights appear.

- [ ] **Step 6: Commit**

```bash
git add sheet/trend-ai-analysis.js electron-main.js preload.cjs trend-ui.js
git commit -m "feat(trend): add AI analysis for trending videos"
```

---

### Task 6: Notification Badge

**Files:**
- Modify: `D:\Code\vid-master\sheet\trend-store.js`
- Modify: `D:\Code\vid-master\trend-ui.js`
- Modify: `D:\Code\vid-master\renderer.js`
- Modify: `D:\Code\vid-master\renderer.html`

**Interfaces:**
- Consumes: Scan results, video scores
- Produces: `getHotCount(profileId)`, badge display on tab button

- [ ] **Step 1: Add hot video tracking to trend-store.js**

```js
const HOT_SCORE_THRESHOLD = 10;

export function markHotVideos(profileId, newVideos) {
  const hot = newVideos.filter(v => v.potentialScore >= HOT_SCORE_THRESHOLD);
  if (!hot.length) return 0;
  
  const profile = getProfile(profileId);
  const seenIds = new Set(profile.seenHotIds || []);
  const newHot = hot.filter(v => !seenIds.has(v.videoId));
  
  updateProfile(profileId, {
    hotCount: (profile.hotCount || 0) + newHot.length,
    seenHotIds: [...seenIds, ...newHot.map(v => v.videoId)].slice(-500) // Keep last 500
  });
  
  return newHot.length;
}

export function getHotCount(profileId) {
  return getProfile(profileId)?.hotCount || 0;
}

export function clearHotCount(profileId) {
  updateProfile(profileId, { hotCount: 0 });
}
```

- [ ] **Step 2: Call markHotVideos after scan in trend-research.js**

In runScan, after upsertVideos:
```js
const hotCount = store.markHotVideos(profileId, allVideos);
```

- [ ] **Step 3: Add badge to tab button in renderer.html**

```html
<button class="tab-button" data-tab="trend-research">
  ...
  <span class="tab-label">Nghiên cứu Trend</span>
  <span id="trend-badge" class="tab-badge" style="display:none">0</span>
</button>
```

- [ ] **Step 4: Add CSS for badge**

```css
.tab-badge { 
  background: var(--accent-danger); 
  color: white; 
  font-size: 11px; 
  padding: 2px 6px; 
  border-radius: 999px; 
  margin-left: 6px;
}
```

- [ ] **Step 5: Update badge in renderer.js and trend-ui.js**

Add function to update badge when tab opens or scan completes.

- [ ] **Step 6: Clear badge when user views dashboard**

In selectProfile function, call clearHotCount.

- [ ] **Step 7: Test badge manually**

Modify a video's score to be > 10, trigger scan, verify badge appears.

- [ ] **Step 8: Commit**

```bash
git add sheet/trend-store.js sheet/trend-research.js trend-ui.js renderer.js renderer.html
git commit -m "feat(trend): add notification badge for hot videos"
```

---

## Phase 2: App Permissions

### Task 7: Server - Add App Permissions to PERMISSION_CATALOG

**Files:**
- Modify: `D:\Code\license-server\server.js`

**Interfaces:**
- Produces: 17 new `app:*` permissions in PERMISSION_CATALOG, GRANT_ONCE entry for user role

- [ ] **Step 1: Add app permissions to PERMISSION_CATALOG**

Insert after existing permissions (around line 75):
```js
// App Features - Các tab trên app Electron
{ key: "app:channel-stats", label: "App: Thống kê kênh", group: "App Features" },
{ key: "app:sheet-watch", label: "App: Kênh", group: "App Features" },
{ key: "app:batches", label: "App: Mẻ", group: "App Features" },
{ key: "app:veo3-image", label: "App: Tạo ảnh Veo3", group: "App Features" },
{ key: "app:trend-research", label: "App: Nghiên cứu Trend", group: "App Features" },
{ key: "app:render", label: "App: Render Video", group: "App Features" },
{ key: "app:composer", label: "App: Bố cục", group: "App Features" },
{ key: "app:video-snow", label: "App: Tạo video từ ảnh", group: "App Features" },
{ key: "app:bg-video", label: "App: Tạo video nền", group: "App Features" },
{ key: "app:download", label: "App: Tải video", group: "App Features" },
{ key: "app:stock-download", label: "App: Pexels & Pixabay", group: "App Features" },
{ key: "app:get-url", label: "App: Lấy URL", group: "App Features" },
{ key: "app:trim", label: "App: Cắt video", group: "App Features" },
{ key: "app:cut-bg", label: "App: Cắt video nền", group: "App Features" },
{ key: "app:concat", label: "App: Ghép video", group: "App Features" },
{ key: "app:thumb", label: "App: Tạo ảnh thu nhỏ", group: "App Features" },
{ key: "app:automation", label: "App: Tự động hóa", group: "App Features" },
```

- [ ] **Step 2: Add GRANT_ONCE for user role default permissions**

```js
{ id: "app-features-v1", role: "user", permissions: [
  "app:channel-stats", "app:sheet-watch", "app:batches",
  "app:render", "app:download", "app:trim", "app:concat", "app:thumb"
] },
```

- [ ] **Step 3: Restart server and verify permissions appear in admin UI**

- [ ] **Step 4: Commit in license-server repo**

```bash
cd D:/Code/license-server
git add server.js
git commit -m "feat: add app feature permissions for Electron app tabs"
```

---

### Task 8: App - Store Permissions from Login Response

**Files:**
- Modify: `D:\Code\vid-master\app-session.js`
- Modify: `D:\Code\vid-master\electron-main.js`
- Modify: `D:\Code\vid-master\preload.cjs`

**Interfaces:**
- Consumes: Login response `user.permissions` array
- Produces: `sessionMgr.getPermissions()` returning permissions array

- [ ] **Step 1: Update app-session.js to store permissions**

In login method, after `current = { token, user, machineId, verifiedAt }`:
```js
current = { token, user, machineId, verifiedAt, permissions: r.data.user?.permissions || [] };
```

Add method:
```js
getPermissions: () => current?.permissions || [],
```

Also update `verify` method to refresh permissions from server response.

**Server prerequisite (license-server `app-auth.js`):** `POST /api/app/session` currently returns `user` WITHOUT `permissions` (line ~179), so permission changes would never reach the app after login. Add `permissions: await getRolePermissions(r.user.role)` to that `user` object, then in `app-session.js` `verify()` set `current.permissions = r.data.user.permissions` when present. Add a test in `license-server/tests` asserting `/api/app/session` returns `permissions`.

- [ ] **Step 2: Add IPC handler for permissions.list in electron-main.js**

```js
ipcMain.handle("permissions:list", () => {
  return sessionMgr.getPermissions();
});
```

- [ ] **Step 3: Add permissions namespace to preload.cjs**

```js
permissions: {
  list: () => ipcRenderer.invoke("permissions:list"),
},
```

- [ ] **Step 4: Verify permissions flow**

Login, check that permissions are returned and stored.

- [ ] **Step 5: Commit**

```bash
git add app-session.js electron-main.js preload.cjs
git commit -m "feat: store and expose permissions from login response"
```

---

### Task 9: App - Apply Permissions to Hide Tabs

**Files:**
- Create: `D:\Code\vid-master\sheet\app-features.js`
- Modify: `D:\Code\vid-master\renderer.js`
- Modify: `D:\Code\vid-master\renderer.html`

**Interfaces:**
- Consumes: `window.electronAPI.permissions.list()`
- Produces: `applyPermissions()` function that hides unauthorized tabs

- [ ] **Step 1: Create app-features.js with TAB_PERMISSIONS map**

```js
// Map tab data-tab attribute to permission key
export const TAB_PERMISSIONS = {
  'channel-stats': 'app:channel-stats',
  'sheet-watch': 'app:sheet-watch',
  'batches': 'app:batches',
  'veo3-image': 'app:veo3-image',
  'trend-research': 'app:trend-research',
  'render': 'app:render',
  'composer': 'app:composer',
  'video-snow': 'app:video-snow',
  'bg-video': 'app:bg-video',
  'download': 'app:download',
  'stock-download': 'app:stock-download',
  'get-url': 'app:get-url',
  'trim': 'app:trim',
  'cut-bg': 'app:cut-bg',
  'concat': 'app:concat',
  'thumb': 'app:thumb',
  'automation': 'app:automation',
};
```

- [ ] **Step 2: Make the map loadable from the renderer**

renderer.html loads plain `<script>` tags, so an ES `export` will not work. Follow the existing `sheet/batch-actions.cjs` pattern: name the file `sheet/app-features.cjs`, attach to `window.AppFeatures = { TAB_PERMISSIONS }`, and include it before `renderer.js`. Use this single source in `applyPermissions()` (do not duplicate the map in renderer.js).

- [ ] **Step 3: Add applyPermissions function to renderer.js**

```js
const TAB_PERMISSIONS = {
  'channel-stats': 'app:channel-stats',
  // ... full map
};

async function applyPermissions() {
  try {
    const permissions = await window.electronAPI.permissions.list();
    const permSet = new Set(permissions);
    
    document.querySelectorAll('.tab-button[data-tab]').forEach(btn => {
      const tabId = btn.dataset.tab;
      const perm = TAB_PERMISSIONS[tabId];
      
      // If no permission defined for this tab, show it (backwards compat)
      if (!perm) return;
      
      if (!permSet.has(perm)) {
        btn.style.display = 'none';
        const content = document.getElementById(tabId);
        if (content) content.classList.add('permission-hidden');
      } else {
        btn.style.display = '';
        const content = document.getElementById(tabId);
        if (content) content.classList.remove('permission-hidden');
      }
    });
  } catch (e) {
    console.error("applyPermissions error:", e);
    // On error, show all tabs (fail open for usability)
  }
}
```

- [ ] **Step 4: Add CSS for permission-hidden class**

```css
.permission-hidden { display: none !important; }
```

- [ ] **Step 5: Call applyPermissions after login and on app startup**

In DOMContentLoaded, after session restore succeeds, call `applyPermissions()`.

- [ ] **Step 6: Handle "admin" role showing all tabs**

Ensure admin permissions include all app:* or check for role === 'admin'.

- [ ] **Step 7: Test permission hiding**

Create a test user with limited permissions, login, verify only allowed tabs appear.

- [ ] **Step 8: Commit**

```bash
git add sheet/app-features.js renderer.js renderer.html
git commit -m "feat: apply role-based permissions to hide unauthorized tabs"
```

---

### Task 10: Final Integration Test

**Files:** None (manual testing)

**Interfaces:** All previous tasks

- [ ] **Step 1: Test full flow - Trend Research**

1. Create trend profile with GPM selector
2. Run manual scan
3. Verify keyword search works
4. Export to Excel
5. Run AI analysis
6. Verify scheduled scan triggers
7. Verify hot video badge appears

- [ ] **Step 2: Test full flow - Permissions**

1. Admin: assign only some app:* permissions to "user" role
2. Login as user
3. Verify hidden tabs
4. Admin: add more permissions
5. Wait for session verify (or restart app)
6. Verify new tabs appear

- [ ] **Step 3: Test offline behavior**

1. Login while online
2. Go offline
3. Verify tabs still work based on cached permissions

- [ ] **Step 4: Final commit with version bump**

```bash
git add -A
git commit -m "feat: complete trend research enhancement and app permissions"
```
