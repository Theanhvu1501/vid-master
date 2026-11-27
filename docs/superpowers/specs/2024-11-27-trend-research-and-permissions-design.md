# Design: Trend Research Enhancement & App Permissions

**Date:** 2024-11-27  
**Status:** Draft - Pending Approval

---

## 1. Intent & Why

### Phần 1: Trend Research Enhancement
Mở rộng chức năng "Nghiên cứu Trend" đã có để trở thành công cụ nghiên cứu thị trường YouTube hoàn chỉnh. Giúp user:
- Tự động thu thập video trending theo lịch (không cần chạy tay)
- Chọn GPM profile dễ dàng (giống các tab khác)
- Tìm kiếm video theo từ khóa trong ngách
- Phân tích thumbnail/title hiệu quả bằng AI
- Export dữ liệu ra Excel để phân tích thêm
- Nhận thông báo khi có video hot mới

### Phần 2: App Permissions
Triển khai phân quyền tính năng trên app Electron dựa trên role của user. Admin có thể:
- Cấu hình role nào được dùng tính năng nào trên web license-server
- Thay đổi có hiệu lực ngay mà không cần user update app
- Kiểm soát truy cập các tính năng nhạy cảm hoặc premium

---

## 2. Goals, Non-goals, Anti-goals

### Goals
- [G1] GPM profile selector component có thể tái sử dụng
- [G2] Job quét chạy background, persist across app restart
- [G3] Export Excel với format đẹp, có thể lọc/sort
- [G4] AI analysis tận dụng API key đã có (Gemini/OpenAI)
- [G5] Permission check nhanh (cache), không block UI
- [G6] Graceful degradation khi offline (dùng cache permission)

### Non-goals
- Không làm real-time notification (chỉ hiện khi mở app/tab)
- Không làm UI quản lý permission trên app (chỉ trên web admin)
- Không phân quyền đến từng action (chỉ đến level tab/feature)

### Anti-goals
- Permission check KHÔNG được làm chậm app startup
- KHÔNG lưu permission vào file có thể dễ dàng sửa (bypass)
- KHÔNG để logic permission nằm rải rác - phải tập trung

---

## 3. Constraints

- License server đã có: `role` field trong user object
- App đã có: `sessionMgr.getUser()` trả về user với role
- GPM profile list đã có sẵn trong tab Automation
- YouTube API key đã được quản lý trong trend profile
- AI key (Gemini/OpenAI) đã có sẵn trong app

---

## 4. Approaches Considered

### Approach A: Permission hardcoded trong app
```js
const ROLE_FEATURES = {
  admin: ['*'],
  pro: ['trend', 'render', 'download', 'automation'],
  basic: ['render', 'download'],
};
```
**Pros:** Đơn giản, không cần sửa server  
**Cons:** Mỗi lần thay đổi phải update app

### Approach B: Tận dụng hệ thống permissions đã có (RECOMMENDED)

License server đã có sẵn:
- Bảng `roles` và `role_permissions` 
- Function `getRolePermissions(roleName)` trả về array permissions
- Login response đã trả về `permissions` array trong `user` object
- Admin có thể quản lý permissions của role qua web UI

**Chỉ cần:**
1. Thêm APP FEATURES vào `PERMISSION_CATALOG` trên server
2. App đọc permissions từ login response và filter các `app:*` permissions

```js
// Server: thêm vào PERMISSION_CATALOG  
{ key: "app:trend", label: "App: Nghiên cứu Trend", group: "App Features" },
{ key: "app:automation", label: "App: Tự động hóa", group: "App Features" },

// App: filter permissions
const appFeatures = permissions.filter(p => p.startsWith('app:'));
```

**Pros:** Tận dụng code có sẵn, không cần API mới, admin dùng UI quen thuộc  
**Cons:** Không có

**Decision:** Approach B - tận dụng hệ thống permissions đã có trên server.

---

## 5. Detailed Design

### 5.1 Trend Research Enhancement

#### 5.1.1 GPM Profile Selector Component

Tạo component tái sử dụng `GpmProfileSelector`:

```
┌─────────────────────────────────────────────────┐
│ GPM Profile                              [🔄]   │
├─────────────────────────────────────────────────┤
│ [🔍 Tìm profile...]                             │
│ ┌─── Group: Channels ───────────────────────┐   │
│ │ ☑ Profile_US_01        [Online]           │   │
│ │ ☐ Profile_VN_02        [Offline]          │   │
│ └───────────────────────────────────────────┘   │
│ ┌─── Group: Research ───────────────────────┐   │
│ │ ☐ Research_JP          [Online]           │   │
│ └───────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

**Files:**
- `gpm-profile-selector.js` - Component logic
- CSS trong `renderer.html`

**API:** Tái sử dụng `electronAPI.sheet.gpmListProfilesFull()`

#### 5.1.2 Scheduled Scan Job

**Cơ chế:**
1. Mỗi profile có `scansPerDay` (1-12)
2. App tính interval = 24h / scansPerDay
3. Lưu `nextScanAt` vào profile
4. Background interval check mỗi 5 phút
5. Persist schedule vào file `.trend-schedule.json`

**Files:**
- `sheet/trend-scheduler.js` - Job scheduler logic
- Thêm vào `electron-main.js` - Start scheduler khi app ready

```js
// trend-scheduler.js
export function startScheduler({ onScan, interval = 5 * 60 * 1000 }) {
  setInterval(async () => {
    const due = getProfilesDueForScan();
    for (const profile of due) {
      await onScan(profile);
    }
  }, interval);
}
```

#### 5.1.3 Keyword Search

Thêm vào UI:
```
┌─────────────────────────────────────────────────┐
│ 🔍 Tìm video theo từ khóa                       │
├─────────────────────────────────────────────────┤
│ [minecraft tutorial          ] [Tìm kiếm]      │
│                                                 │
│ Publish: [7 ngày ▼]  Order: [View count ▼]     │
└─────────────────────────────────────────────────┘
```

**API:** Đã có `searchByKeyword()` trong `trend-research.js`

#### 5.1.4 AI Analysis (Thumbnail/Title)

**Mục đích:** Phân tích yếu tố thu hút trong thumbnail và title của video trending.

**Cơ chế:**
1. Chọn N video top từ dashboard
2. Gọi AI với prompt phân tích:
   - Thumbnail: màu sắc, text overlay, biểu cảm, composition
   - Title: power words, số, emoji, độ dài, hook
3. Hiển thị kết quả dạng insights

**Prompt template:**
```
Phân tích {N} video YouTube trending sau và đưa ra insights về:
1. Pattern chung trong thumbnail (màu sắc, bố cục, text)
2. Pattern chung trong title (cấu trúc, từ khóa, hook)
3. Gợi ý áp dụng cho kênh của tôi

Videos:
{video_list với title + thumbnail_url}
```

**Files:**
- `sheet/trend-ai-analysis.js` - AI analysis logic
- Tái sử dụng key từ `sheet/ai-keys.js`

#### 5.1.5 Export Excel

**Format:**
```
| # | Title | Channel | Views | Subs | Ratio | Score | Age | Category | URL |
|---|-------|---------|-------|------|-------|-------|-----|----------|-----|
```

**Files:**
- Thêm function `exportToExcel()` trong `trend-research.js`
- Dùng `xlsx` library đã có

#### 5.1.6 Notification

**Cơ chế đơn giản:**
1. Sau mỗi lần scan, so sánh với scan trước
2. Nếu có video mới với score > threshold → đánh dấu "hot"
3. Khi mở tab, hiện badge số video hot mới
4. Click vào badge → scroll đến video đó

**UI:**
```
Tab: Nghiên cứu Trend [🔴 3]  ← Badge số video hot mới
```

---

### 5.2 App Permissions

#### 5.2.1 Server Changes - Thêm App Feature Permissions

Thêm vào `PERMISSION_CATALOG` trong `server.js`:

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

Thêm vào `GRANT_ONCE` để user role có quyền mặc định:

```js
{ id: "app-features-v1", role: "user", permissions: [
  "app:channel-stats", "app:sheet-watch", "app:batches",
  "app:render", "app:download", "app:trim", "app:concat", "app:thumb"
] },
```

#### 5.2.2 App Side - Đọc permissions từ login response

Login response đã có sẵn permissions:
```js
// Từ app-auth.js dòng 167
user: { id, username, displayName, role, permissions: await getRolePermissions(user.role) }
```

App chỉ cần lưu permissions và filter:

```js
// app-session.js - Thêm vào current state
current = { token, user, machineId, verifiedAt, permissions: r.data.user.permissions };

// Khi cần check feature
const appFeatures = current.permissions.filter(p => p.startsWith('app:'));
const hasFeature = (feature) => appFeatures.includes(`app:${feature}`);
```

#### 5.2.3 UI Integration

**Map tab-id sang permission key:**

```js
// sheet/app-features.js
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

**Ẩn tab không có quyền:**

```js
// renderer.js
async function applyPermissions() {
  const permissions = await window.electronAPI.permissions.list();
  const permSet = new Set(permissions);
  
  document.querySelectorAll('.tab-button[data-tab]').forEach(btn => {
    const tabId = btn.dataset.tab;
    const perm = TAB_PERMISSIONS[tabId];
    
    if (perm && !permSet.has(perm)) {
      btn.style.display = 'none';
      document.getElementById(tabId)?.classList.add('permission-hidden');
    }
  });
}

// Gọi sau khi login thành công
```

---

## 6. File Changes Summary

### New Files (App - vid-master)
| File | Purpose |
|------|---------|
| `gpm-profile-selector.js` | Reusable GPM profile picker component |
| `sheet/trend-scheduler.js` | Background job scheduler |
| `sheet/trend-ai-analysis.js` | AI analysis for thumbnails/titles |
| `sheet/app-features.js` | Tab → permission mapping |

### Modified Files (App - vid-master)
| File | Changes |
|------|---------|
| `trend-ui.js` | Add GPM selector, keyword search, export, notification badge |
| `sheet/trend-research.js` | Add `exportToExcel()` |
| `sheet/trend-store.js` | Add `hotVideos` tracking |
| `electron-main.js` | Add scheduler startup, permission IPC handlers |
| `preload.cjs` | Add `permissions` namespace |
| `renderer.js` | Add `applyPermissions()`, tab permission check |
| `renderer.html` | Add permission-hidden CSS class |
| `app-session.js` | Lưu permissions vào session state |

### Modified Files (Server - license-server)
| File | Changes |
|------|---------|
| `server.js` | Thêm app:* permissions vào PERMISSION_CATALOG và GRANT_ONCE |

---

## 7. Implementation Order

### Phase 1: Trend Research Enhancement
1. GPM Profile Selector component (tái sử dụng code từ tab Automation)
2. Keyword search UI
3. Export Excel
4. Scheduled scan job
5. AI Analysis
6. Notification badge

### Phase 2: App Permissions  
1. Server: Thêm app:* permissions vào PERMISSION_CATALOG
2. Server: Thêm GRANT_ONCE để user role có quyền mặc định
3. App: Lưu permissions từ login response
4. App: Tạo `sheet/app-features.js` với TAB_PERMISSIONS map
5. App: Thêm `applyPermissions()` vào renderer.js
6. App: Thêm IPC handler cho permissions.list()

---

## 8. Builder's Notes

### Quyết định của tôi (builder calls):
- Tận dụng hệ thống RBAC đã có trên license-server (không cần API mới)
- Scan interval check = 5 phút (cân bằng giữa accuracy và resource)
- AI analysis giới hạn 10 video/lần (tránh token limit)
- Export Excel dùng library `xlsx` đã có sẵn
- Notification chỉ dùng badge, không dùng system notification (đơn giản hơn)
- Permissions được cache trong session, refresh mỗi lần verify (1 giờ)

### Các quyết định UX/Technical (từ builder review):

**Q1: User mất quyền tab đang xem thì sao?**
- **A:** Cho họ xem tiếp tab hiện tại, chỉ ẩn khi chuyển sang tab khác. Không force logout hay interrupt công việc đang làm. `applyPermissions()` chỉ chạy khi: (1) login thành công, (2) app khởi động, (3) session verify thành công.

**Q2: Scheduler có chạy khi app minimized không?**
- **A:** Chỉ chạy khi app active (foreground). Đơn giản cho v1, không cần worker process hay powerMonitor. Nếu user cần scan liên tục, họ để app mở.

**Q3: Schedule file bị conflict giữa nhiều máy?**
- **A:** Schedule là local cho mỗi máy. File `.trend-schedule.json` nằm trong userData của máy đó. Trend data cũng lưu local nên nhất quán. Mỗi máy có lịch quét riêng.

### Admin workflow:
1. Vào web license-server → Vai trò & quyền
2. Chọn role (VD: "user" hoặc tạo role mới "pro")
3. Tick các quyền `app:*` muốn cấp
4. Lưu → User thuộc role đó sẽ thấy/ẩn tab tương ứng khi mở app

---

## Approval

Vui lòng review và approve design này trước khi implementation.

- [ ] Approved - Proceed to implementation plan
- [ ] Need changes - See comments
