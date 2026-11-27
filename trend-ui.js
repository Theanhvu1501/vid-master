/**
 * UI cho tab Nghiên cứu Trend (Trend Research)
 */

// Country options với flag emoji
const COUNTRIES = [
  { code: "US", name: "United States", flag: "🇺🇸" },
  { code: "VN", name: "Vietnam", flag: "🇻🇳" },
  { code: "JP", name: "Japan", flag: "🇯🇵" },
  { code: "KR", name: "South Korea", flag: "🇰🇷" },
  { code: "TH", name: "Thailand", flag: "🇹🇭" },
  { code: "ID", name: "Indonesia", flag: "🇮🇩" },
  { code: "PH", name: "Philippines", flag: "🇵🇭" },
  { code: "IN", name: "India", flag: "🇮🇳" },
  { code: "GB", name: "United Kingdom", flag: "🇬🇧" },
  { code: "DE", name: "Germany", flag: "🇩🇪" },
  { code: "FR", name: "France", flag: "🇫🇷" },
  { code: "BR", name: "Brazil", flag: "🇧🇷" },
  { code: "MX", name: "Mexico", flag: "🇲🇽" },
  { code: "RU", name: "Russia", flag: "🇷🇺" },
  { code: "AU", name: "Australia", flag: "🇦🇺" },
  { code: "CA", name: "Canada", flag: "🇨🇦" },
];

// Category names
const CATEGORIES = {
  "1": "Film & Animation",
  "2": "Autos & Vehicles",
  "10": "Music",
  "15": "Pets & Animals",
  "17": "Sports",
  "20": "Gaming",
  "22": "People & Blogs",
  "23": "Comedy",
  "24": "Entertainment",
  "25": "News & Politics",
  "26": "Howto & Style",
  "27": "Education",
  "28": "Science & Technology",
};

// State
let profiles = [];
let currentProfileId = null;
let dashboardData = null;
let filters = {
  timeRange: "7d",
  maxSubs: 100000,
  categoryId: null,
  sortBy: "potentialScore",
};

// Search state
let searchKeyword = "";
let searchOrder = "viewCount";
let searchPublishWindow = "7d";
let searchResults = null;
let searchError = null;
let isSearching = false;

// GPM state
let gpmProfiles = [];
let gpmGroups = [];
let gpmHost = "127.0.0.1:19995";

// AI Analysis state
let aiKeyStatus = null; // { hasKey, keyHint } or null
let isAnalyzing = false;
let analysisResult = null; // { ok, insights } or { ok: false, error }

// Format numbers
function formatNumber(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
  if (num >= 1000) return (num / 1000).toFixed(1) + "K";
  return String(num || 0);
}

function formatDate(isoString) {
  if (!isoString) return "—";
  const d = new Date(isoString);
  const now = new Date();
  const diff = now - d;

  if (diff < 60000) return "vừa xong";
  if (diff < 3600000) return Math.floor(diff / 60000) + " phút trước";
  if (diff < 86400000) return Math.floor(diff / 3600000) + " giờ trước";
  if (diff < 604800000) return Math.floor(diff / 86400000) + " ngày trước";

  return d.toLocaleDateString("vi-VN");
}

// Convert publish window value to ISO date string for publishedAfter
function publishWindowToISO(windowValue) {
  if (!windowValue || windowValue === "all") return null;
  const now = Date.now();
  const msPerHour = 3600000;
  const msPerDay = 86400000;
  switch (windowValue) {
    case "24h": return new Date(now - 24 * msPerHour).toISOString();
    case "48h": return new Date(now - 48 * msPerHour).toISOString();
    case "7d": return new Date(now - 7 * msPerDay).toISOString();
    case "30d": return new Date(now - 30 * msPerDay).toISOString();
    default: return null;
  }
}

// Render toàn bộ UI
function render() {
  const root = document.getElementById("trend-root");
  if (!root) return;

  root.innerHTML = `
    <div class="trend-container">
      <!-- Header -->
      <div class="trend-header">
        <div class="trend-title">
          <svg class="ico" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
          </svg>
          <h2>Nghiên cứu Trend</h2>
        </div>
        <button class="btn btn-primary" onclick="TrendUI.showAddProfile()">
          <svg class="ico" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 5v14M5 12h14"/>
          </svg>
          Thêm Profile
        </button>
      </div>

      <!-- Profiles List -->
      <div class="trend-profiles">
        ${profiles.length === 0 ? `
          <div class="trend-empty">
            <p>Chưa có profile nào. Tạo profile đầu tiên để bắt đầu nghiên cứu trend!</p>
          </div>
        ` : profiles.map(renderProfileCard).join("")}
      </div>

      <!-- Dashboard (hiện khi có profile được chọn) -->
      ${currentProfileId ? renderDashboard() : ""}
    </div>

    <!-- Modal Add/Edit Profile -->
    <div id="trend-modal" class="trend-modal" style="display:none">
      <div class="trend-modal-backdrop" onclick="TrendUI.closeModal()"></div>
      <div class="trend-modal-content">
        <div class="trend-modal-header">
          <h3 id="trend-modal-title">Thêm Profile</h3>
          <button class="btn-icon" onclick="TrendUI.closeModal()">
            <svg class="ico" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
        <div class="trend-modal-body" id="trend-modal-body"></div>
      </div>
    </div>
  `;

  // Attach search button listener after DOM update
  attachSearchListener();
}

function renderProfileCard(profile) {
  const country = COUNTRIES.find((c) => c.code === profile.country) || { flag: "🌍", name: profile.country };
  const isActive = profile.id === currentProfileId;
  const hotCount = profile.hotCount || 0;

  return `
    <div class="trend-profile-card ${isActive ? "active" : ""}" data-id="${profile.id}">
      <div class="trend-profile-header">
        <div class="trend-profile-name">
          <span class="trend-profile-flag">${country.flag}</span>
          <strong>${escapeHtml(profile.name)}</strong>
          ${hotCount > 0 ? `<span class="trend-hot-badge" title="${hotCount} video mới có điểm cao">🔥 ${hotCount} mới</span>` : ""}
        </div>
        <div class="trend-profile-actions">
          <button class="btn-icon" onclick="TrendUI.editProfile('${profile.id}')" title="Sửa">
            <svg class="ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button class="btn-icon danger" onclick="TrendUI.deleteProfile('${profile.id}')" title="Xóa">
            <svg class="ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </div>
      </div>

      <div class="trend-profile-info">
        <div class="trend-info-row">
          <span class="trend-info-label">Quốc gia:</span>
          <span class="trend-info-value">${country.name}</span>
        </div>
        <div class="trend-info-row">
          <span class="trend-info-label">API Key:</span>
          <span class="trend-info-value ${profile.hasApiKey ? "text-success" : "text-warning"}">
            ${profile.hasApiKey ? "✅ Đã set" : "⚠️ Chưa có"}
          </span>
        </div>
        <div class="trend-info-row">
          <span class="trend-info-label">GPM Profile:</span>
          <span class="trend-info-value">${profile.gpmProfileId || "Không dùng"}</span>
        </div>
        <div class="trend-info-row">
          <span class="trend-info-label">Quét:</span>
          <span class="trend-info-value">${profile.scansPerDay || 1} lần/ngày</span>
        </div>
        <div class="trend-info-row">
          <span class="trend-info-label">Lần cuối:</span>
          <span class="trend-info-value">${formatDate(profile.lastScanAt)}</span>
        </div>
      </div>

      <div class="trend-profile-buttons">
        <button class="btn btn-sm btn-primary" onclick="TrendUI.runScan('${profile.id}')">
          <svg class="ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
          Quét ngay
        </button>
        <button class="btn btn-sm ${isActive ? "btn-secondary" : ""}" onclick="TrendUI.selectProfile('${profile.id}')">
          <svg class="ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>
          </svg>
          ${isActive ? "Đang xem" : "Xem Dashboard"}
        </button>
      </div>
    </div>
  `;
}

function renderSearchSection() {
  return `
    <div class="trend-section trend-search-section">
      <h4>🔍 Tìm video theo từ khóa</h4>
      <div class="trend-search-form">
        <input type="text" id="trend-search-input" placeholder="Nhập từ khóa..." value="${escapeHtml(searchKeyword)}">
        <select id="trend-search-order">
          <option value="viewCount" ${searchOrder === "viewCount" ? "selected" : ""}>Nhiều view nhất</option>
          <option value="date" ${searchOrder === "date" ? "selected" : ""}>Mới nhất</option>
          <option value="relevance" ${searchOrder === "relevance" ? "selected" : ""}>Liên quan nhất</option>
        </select>
        <select id="trend-search-publish">
          <option value="24h" ${searchPublishWindow === "24h" ? "selected" : ""}>Đăng trong 24 giờ</option>
          <option value="48h" ${searchPublishWindow === "48h" ? "selected" : ""}>Đăng trong 48 giờ</option>
          <option value="7d" ${searchPublishWindow === "7d" ? "selected" : ""}>Đăng trong 7 ngày</option>
          <option value="30d" ${searchPublishWindow === "30d" ? "selected" : ""}>Đăng trong 30 ngày</option>
          <option value="all" ${searchPublishWindow === "all" ? "selected" : ""}>Tất cả</option>
        </select>
        <button class="btn btn-primary" id="trend-search-btn" ${isSearching ? "disabled" : ""}>
          ${isSearching ? "Đang tìm..." : "Tìm kiếm"}
        </button>
      </div>
      ${searchError ? `<div class="trend-search-error">${escapeHtml(searchError)}</div>` : ""}
      ${renderSearchResults()}
    </div>
  `;
}

function renderSearchResults() {
  if (!searchResults) return "";
  if (searchResults.length === 0) {
    return `<div class="trend-empty-small">Không tìm thấy video nào</div>`;
  }
  return `
    <div class="trend-search-results">
      <h5>Kết quả tìm kiếm (${searchResults.length} video)</h5>
      <div class="trend-videos">
        ${searchResults.map((video, idx) => renderVideoRow(video, idx + 1)).join("")}
      </div>
    </div>
  `;
}

function renderDashboard() {
  if (!dashboardData) {
    return `
      <div class="trend-dashboard">
        <div class="trend-loading">Đang tải dữ liệu...</div>
      </div>
    `;
  }

  const { videos, niches, stats } = dashboardData;

  return `
    <div class="trend-dashboard">
      <div class="trend-dashboard-header">
        <h3>📊 Dashboard</h3>
        <div class="trend-filters">
          <select id="filter-time" onchange="TrendUI.updateFilter('timeRange', this.value)">
            <option value="24h" ${filters.timeRange === "24h" ? "selected" : ""}>24 giờ</option>
            <option value="48h" ${filters.timeRange === "48h" ? "selected" : ""}>48 giờ</option>
            <option value="7d" ${filters.timeRange === "7d" ? "selected" : ""}>7 ngày</option>
            <option value="30d" ${filters.timeRange === "30d" ? "selected" : ""}>30 ngày</option>
            <option value="all" ${filters.timeRange === "all" ? "selected" : ""}>Tất cả</option>
          </select>

          <select id="filter-subs" onchange="TrendUI.updateFilter('maxSubs', this.value)">
            <option value="">Tất cả kênh</option>
            <option value="1000" ${filters.maxSubs == 1000 ? "selected" : ""}>< 1K subs</option>
            <option value="10000" ${filters.maxSubs == 10000 ? "selected" : ""}>< 10K subs</option>
            <option value="100000" ${filters.maxSubs == 100000 ? "selected" : ""}>< 100K subs</option>
            <option value="1000000" ${filters.maxSubs == 1000000 ? "selected" : ""}>< 1M subs</option>
          </select>

          <select id="filter-category" onchange="TrendUI.updateFilter('categoryId', this.value)">
            <option value="">Tất cả category</option>
            ${Object.entries(CATEGORIES).map(([id, name]) => `
              <option value="${id}" ${filters.categoryId === id ? "selected" : ""}>${name}</option>
            `).join("")}
          </select>

          <select id="filter-sort" onchange="TrendUI.updateFilter('sortBy', this.value)">
            <option value="potentialScore" ${filters.sortBy === "potentialScore" ? "selected" : ""}>Điểm tiềm năng</option>
            <option value="viewSubRatio" ${filters.sortBy === "viewSubRatio" ? "selected" : ""}>View/Sub ratio</option>
            <option value="viewsPerDay" ${filters.sortBy === "viewsPerDay" ? "selected" : ""}>View/ngày</option>
            <option value="viewCount" ${filters.sortBy === "viewCount" ? "selected" : ""}>Tổng view</option>
          </select>
          <button class="btn btn-secondary" onclick="TrendUI.analyzeAI()" id="btn-analyze-ai" title="Phân tích AI các tiêu đề video trending" ${isAnalyzing ? "disabled" : ""}>${isAnalyzing ? "Đang phân tích..." : "🤖 Phân tích AI"}</button>
          <button class="btn btn-secondary" onclick="TrendUI.exportExcel()">📥 Xuất Excel</button>
        </div>
      </div>

      <!-- Search Section -->
      ${renderSearchSection()}

      <!-- Stats summary -->
      <div class="trend-stats">
        <div class="trend-stat-card">
          <div class="trend-stat-value">${formatNumber(stats.total)}</div>
          <div class="trend-stat-label">Tổng video</div>
        </div>
        <div class="trend-stat-card">
          <div class="trend-stat-value">${formatNumber(stats.last24h)}</div>
          <div class="trend-stat-label">Mới 24h</div>
        </div>
        <div class="trend-stat-card">
          <div class="trend-stat-value">${stats.avgPotentialScore.toFixed(1)}</div>
          <div class="trend-stat-label">Điểm TB</div>
        </div>
      </div>

      <!-- Trending Niches -->
      <div class="trend-section">
        <h4>📈 Ngách Trending</h4>
        <div class="trend-niches">
          ${niches.slice(0, 10).map((niche) => `
            <div class="trend-niche-tag" onclick="TrendUI.updateFilter('categoryId', '${niche.categoryId}')">
              <span class="niche-name">${escapeHtml(niche.categoryName)}</span>
              <span class="niche-count">${niche.count}</span>
            </div>
          `).join("")}
        </div>
      </div>

      <!-- Top Videos -->
      <div class="trend-section">
        <h4>🔥 Top Video Tiềm Năng</h4>
        <div class="trend-videos">
          ${videos.length === 0 ? `
            <div class="trend-empty-small">Không có video phù hợp với bộ lọc</div>
          ` : videos.slice(0, 50).map((video, idx) => renderVideoRow(video, idx + 1)).join("")}
        </div>
      </div>
    </div>
  `;
}

function renderVideoRow(video, rank) {
  const scoreClass = video.potentialScore >= 10 ? "high" : video.potentialScore >= 5 ? "medium" : "low";

  return `
    <div class="trend-video-row">
      <div class="trend-video-rank">#${rank}</div>
      <div class="trend-video-thumb">
        <img src="${video.thumbnail || ""}" alt="" loading="lazy" onerror="this.style.display='none'">
      </div>
      <div class="trend-video-info">
        <a class="trend-video-title" href="https://youtube.com/watch?v=${video.videoId}" target="_blank" title="${escapeHtml(video.title)}">
          ${escapeHtml(video.title?.slice(0, 60) || "—")}${(video.title?.length || 0) > 60 ? "..." : ""}
        </a>
        <div class="trend-video-channel">
          <span>${escapeHtml(video.channelTitle || "—")}</span>
          <span class="trend-video-subs">${formatNumber(video.subscriberCount)} subs</span>
        </div>
      </div>
      <div class="trend-video-stats">
        <div class="trend-video-stat">
          <span class="stat-value">${formatNumber(video.viewCount)}</span>
          <span class="stat-label">views</span>
        </div>
        <div class="trend-video-stat">
          <span class="stat-value">${video.viewSubRatio?.toFixed(1) || 0}x</span>
          <span class="stat-label">ratio</span>
        </div>
        <div class="trend-video-stat">
          <span class="stat-value">${formatNumber(video.viewsPerDay)}</span>
          <span class="stat-label">/ngày</span>
        </div>
      </div>
      <div class="trend-video-score ${scoreClass}">
        <span class="score-value">${video.potentialScore?.toFixed(1) || 0}</span>
        <span class="score-label">điểm</span>
      </div>
      <div class="trend-video-age">${video.ageInDays?.toFixed(0) || "?"}d</div>
    </div>
  `;
}

// Modal functions
function showModal(title, content) {
  const modal = document.getElementById("trend-modal");
  const titleEl = document.getElementById("trend-modal-title");
  const bodyEl = document.getElementById("trend-modal-body");

  if (modal && titleEl && bodyEl) {
    titleEl.textContent = title;
    bodyEl.innerHTML = content;
    modal.style.display = "flex";
  }
}

function closeModal() {
  const modal = document.getElementById("trend-modal");
  if (modal) modal.style.display = "none";
}

async function showAddProfile() {
  // Load GPM profiles first
  await loadGpmProfiles();

  const content = `
    <form id="add-profile-form" onsubmit="TrendUI.saveNewProfile(event)">
      <div class="form-group">
        <label>Tên profile *</label>
        <input type="text" id="profile-name" required placeholder="VD: Research_US">
      </div>

      <div class="form-group">
        <label>Quốc gia *</label>
        <select id="profile-country" required>
          ${COUNTRIES.map((c) => `<option value="${c.code}">${c.flag} ${c.name}</option>`).join("")}
        </select>
      </div>

      <div class="form-group">
        <label>YouTube API Key v3 *</label>
        <input type="text" id="profile-apikey" required placeholder="AIza...">
        <small>Lấy từ <a href="https://console.cloud.google.com/apis/credentials" target="_blank">Google Cloud Console</a></small>
      </div>

      <div class="form-group">
        <label>GPM Profile (optional)</label>
        ${renderGpmSelector("", "add-profile")}
        <small>Dùng để scrape trang chủ YouTube, lấy video đề xuất tự nhiên</small>
      </div>

      <div class="form-group">
        <label>Proxy (optional)</label>
        <input type="text" id="profile-proxy" placeholder="http://user:pass@ip:port">
      </div>

      <div class="form-group">
        <label>Số lần quét mỗi ngày</label>
        <select id="profile-scans">
          <option value="1">1 lần</option>
          <option value="2">2 lần</option>
          <option value="4" selected>4 lần</option>
          <option value="6">6 lần</option>
          <option value="12">12 lần</option>
        </select>
      </div>

      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="TrendUI.closeModal()">Hủy</button>
        <button type="submit" class="btn btn-primary">Tạo Profile</button>
      </div>
    </form>
  `;

  showModal("Thêm Profile Research", content);

  // Populate GPM list after modal is rendered
  setTimeout(() => populateGpmList("add-profile", ""), 0);
}

async function saveNewProfile(event) {
  event.preventDefault();

  const profile = {
    name: document.getElementById("profile-name").value.trim(),
    country: document.getElementById("profile-country").value,
    apiKey: document.getElementById("profile-apikey").value.trim(),
    gpmProfileId: document.getElementById("add-profile-gpmid").value.trim() || null,
    proxy: document.getElementById("profile-proxy").value.trim() || null,
    scansPerDay: parseInt(document.getElementById("profile-scans").value, 10),
  };

  if (!profile.name || !profile.apiKey) {
    alert("Vui lòng điền đầy đủ thông tin bắt buộc");
    return;
  }

  try {
    // Test API key
    const test = await window.electronAPI.trend.testApiKey(profile.apiKey);
    if (!test.ok) {
      alert(`API Key không hợp lệ: ${test.error}`);
      return;
    }

    // Save profile
    await window.electronAPI.trend.addProfile(profile);
    closeModal();
    await loadProfiles();
    render();
  } catch (err) {
    alert(`Lỗi: ${err.message}`);
  }
}

async function editProfile(id) {
  const profile = profiles.find((p) => p.id === id);
  if (!profile) return;

  // Load GPM profiles first
  await loadGpmProfiles();

  const content = `
    <form id="edit-profile-form" onsubmit="TrendUI.saveEditProfile(event, '${id}')">
      <div class="form-group">
        <label>Tên profile *</label>
        <input type="text" id="profile-name" required value="${escapeHtml(profile.name)}">
      </div>

      <div class="form-group">
        <label>Quốc gia *</label>
        <select id="profile-country" required>
          ${COUNTRIES.map((c) => `<option value="${c.code}" ${c.code === profile.country ? "selected" : ""}>${c.flag} ${c.name}</option>`).join("")}
        </select>
      </div>

      <div class="form-group">
        <label>YouTube API Key v3</label>
        <input type="text" id="profile-apikey" placeholder="Để trống để giữ nguyên">
        <small>Để trống nếu không muốn thay đổi</small>
      </div>

      <div class="form-group">
        <label>GPM Profile</label>
        ${renderGpmSelector(profile.gpmProfileId || "", "edit-profile")}
      </div>

      <div class="form-group">
        <label>Proxy</label>
        <input type="text" id="profile-proxy" value="${escapeHtml(profile.proxy || "")}">
      </div>

      <div class="form-group">
        <label>Số lần quét mỗi ngày</label>
        <select id="profile-scans">
          ${[1, 2, 4, 6, 12].map((n) => `<option value="${n}" ${n === profile.scansPerDay ? "selected" : ""}>${n} lần</option>`).join("")}
        </select>
      </div>

      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="TrendUI.closeModal()">Hủy</button>
        <button type="submit" class="btn btn-primary">Lưu</button>
      </div>
    </form>
  `;

  showModal("Sửa Profile", content);

  // Populate GPM list after modal is rendered
  setTimeout(() => populateGpmList("edit-profile", profile.gpmProfileId || ""), 0);
}

async function saveEditProfile(event, id) {
  event.preventDefault();

  const updates = {
    name: document.getElementById("profile-name").value.trim(),
    country: document.getElementById("profile-country").value,
    gpmProfileId: document.getElementById("edit-profile-gpmid").value.trim() || null,
    proxy: document.getElementById("profile-proxy").value.trim() || null,
    scansPerDay: parseInt(document.getElementById("profile-scans").value, 10),
  };

  const newApiKey = document.getElementById("profile-apikey").value.trim();
  if (newApiKey) {
    // Test new API key
    const test = await window.electronAPI.trend.testApiKey(newApiKey);
    if (!test.ok) {
      alert(`API Key không hợp lệ: ${test.error}`);
      return;
    }
    updates.apiKey = newApiKey;
  }

  try {
    await window.electronAPI.trend.updateProfile(id, updates);
    closeModal();
    await loadProfiles();
    render();
  } catch (err) {
    alert(`Lỗi: ${err.message}`);
  }
}

async function deleteProfile(id) {
  const profile = profiles.find((p) => p.id === id);
  if (!profile) return;

  if (!confirm(`Xác nhận xóa profile "${profile.name}"?\nTất cả dữ liệu video đã thu thập sẽ bị xóa.`)) {
    return;
  }

  try {
    await window.electronAPI.trend.deleteProfile(id);
    if (currentProfileId === id) {
      currentProfileId = null;
      dashboardData = null;
    }
    await loadProfiles();
    render();
  } catch (err) {
    alert(`Lỗi: ${err.message}`);
  }
}

async function selectProfile(id) {
  currentProfileId = id;
  dashboardData = null;
  render();

  // Load dashboard data
  try {
    dashboardData = await window.electronAPI.trend.getDashboard(id, filters);
    render();
  } catch (err) {
    console.error("Load dashboard error:", err);
  }

  // Clear hot count khi user xem dashboard của profile này VÀ tab Trend đang active
  // Nếu scan hoàn thành khi user đang xem thì count vẫn clear ở lần view tiếp theo
  const trendTab = document.querySelector('.tab-button[data-tab="trend-research"]');
  const isTrendActive = trendTab && trendTab.classList.contains("active");
  if (isTrendActive && window.electronAPI?.trend?.clearHot) {
    try {
      await window.electronAPI.trend.clearHot(id);
      // Reload profiles để cập nhật hotCount hiển thị trên card
      await loadProfiles();
      render();
      // Refresh badge sidebar
      window._trendBadge?.refresh?.();
    } catch (err) {
      console.error("clearHot error:", err);
    }
  }
}

async function updateFilter(key, value) {
  filters[key] = value === "" ? null : (key === "maxSubs" ? parseInt(value, 10) : value);

  if (currentProfileId) {
    try {
      dashboardData = await window.electronAPI.trend.getDashboard(currentProfileId, filters);
      render();
    } catch (err) {
      console.error("Update filter error:", err);
    }
  }
}

async function runScan(id) {
  const profile = profiles.find((p) => p.id === id);
  if (!profile) return;

  if (!profile.hasApiKey) {
    alert("Profile chưa có API Key");
    return;
  }

  // Show progress
  const card = document.querySelector(`.trend-profile-card[data-id="${id}"]`);
  if (card) {
    const btn = card.querySelector(".btn-primary");
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span class="spinner"></span> Đang quét...`;
    }
  }

  try {
    const result = await window.electronAPI.trend.runScan(id);
    alert(`✅ Quét xong!\nTổng: ${result.totalVideos} video${result.hotNew ? ` (🔥 ${result.hotNew} mới)` : ""}`);

    // Reload data
    await loadProfiles();
    if (currentProfileId === id) {
      dashboardData = await window.electronAPI.trend.getDashboard(id, filters);
    }
    render();
    // Refresh badge after manual scan
    window._trendBadge?.refresh?.();
  } catch (err) {
    alert(`❌ Lỗi: ${err.message}`);
    render();
  }
}

async function doSearch() {
  // Read values from DOM before render
  const input = document.getElementById("trend-search-input");
  const orderSelect = document.getElementById("trend-search-order");
  const publishSelect = document.getElementById("trend-search-publish");

  const keyword = input?.value?.trim() || "";
  const order = orderSelect?.value || "viewCount";
  const publishWindow = publishSelect?.value || "7d";

  // Save to state so it persists across render()
  searchKeyword = keyword;
  searchOrder = order;
  searchPublishWindow = publishWindow;

  // Validation
  if (!keyword) {
    return; // Empty keyword - do nothing
  }

  if (!currentProfileId) {
    searchError = "Vui lòng chọn một profile trước khi tìm kiếm";
    render();
    return;
  }

  // Clear previous error/results
  searchError = null;
  isSearching = true;
  render();

  try {
    const publishedAfter = publishWindowToISO(publishWindow);
    const options = { order };
    if (publishedAfter) {
      options.publishedAfter = publishedAfter;
    }

    searchResults = await window.electronAPI.trend.search(currentProfileId, keyword, options);

    // Refresh dashboard stats (new videos may have been saved)
    try {
      dashboardData = await window.electronAPI.trend.getDashboard(currentProfileId, filters);
    } catch (e) {
      // Ignore dashboard refresh errors
    }
  } catch (err) {
    // Parse common YouTube API errors
    const msg = err.message || String(err);
    if (msg.includes("quotaExceeded")) {
      searchError = "Đã vượt quá giới hạn API hôm nay. Vui lòng thử lại sau.";
    } else if (msg.includes("keyInvalid") || msg.includes("API key")) {
      searchError = "API Key không hợp lệ. Vui lòng kiểm tra lại trong cài đặt Profile.";
    } else {
      searchError = "Lỗi tìm kiếm: " + msg;
    }
    searchResults = null;
  } finally {
    isSearching = false;
    render();
    // Re-attach event listener after render
    attachSearchListener();
  }
}

// Load profiles từ main process
async function loadProfiles() {
  try {
    profiles = await window.electronAPI.trend.listProfiles();
  } catch (err) {
    console.error("Load profiles error:", err);
    profiles = [];
  }
}

// Load GPM profiles từ GPM API
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

// Render GPM profile selector HTML
function renderGpmSelector(selectedId, elementIdPrefix) {
  const statusId = `${elementIdPrefix}-gpm-status`;
  const searchId = `${elementIdPrefix}-gpm-search`;
  const listId = `${elementIdPrefix}-gpm-list`;
  const hiddenId = `${elementIdPrefix}-gpmid`;

  return `
    <div class="trend-gpm-selector" data-prefix="${elementIdPrefix}">
      <div class="trend-gpm-header">
        <span id="${statusId}" class="trend-gpm-status">Đang tải...</span>
        <button type="button" class="btn btn-sm btn-secondary" onclick="TrendUI.refreshGpmProfiles('${elementIdPrefix}')">Làm mới</button>
      </div>
      <input type="text" id="${searchId}" class="trend-gpm-search" placeholder="Tìm profile GPM..." oninput="TrendUI.filterGpmProfiles('${elementIdPrefix}')">
      <div id="${listId}" class="trend-gpm-list">
        <div class="trend-gpm-loading">Đang tải danh sách profile...</div>
      </div>
      <input type="hidden" id="${hiddenId}" value="${escapeHtml(selectedId || "")}">
    </div>
  `;
}

// Populate GPM list after loading
function populateGpmList(elementIdPrefix, selectedId) {
  const statusEl = document.getElementById(`${elementIdPrefix}-gpm-status`);
  const listEl = document.getElementById(`${elementIdPrefix}-gpm-list`);
  if (!listEl) return;

  if (gpmProfiles.length === 0) {
    listEl.innerHTML = `<div class="trend-gpm-empty">Không có profile GPM hoặc GPM chưa chạy</div>`;
    if (statusEl) {
      statusEl.textContent = "Không có profile";
      statusEl.className = "trend-gpm-status trend-gpm-status-warn";
    }
    return;
  }

  if (statusEl) {
    statusEl.textContent = `${gpmProfiles.length} profile`;
    statusEl.className = "trend-gpm-status trend-gpm-status-ok";
  }

  renderGpmList(elementIdPrefix, selectedId);
}

// Render GPM list with optional filtering
function renderGpmList(elementIdPrefix, selectedId) {
  const listEl = document.getElementById(`${elementIdPrefix}-gpm-list`);
  const searchEl = document.getElementById(`${elementIdPrefix}-gpm-search`);
  if (!listEl) return;

  const query = (searchEl?.value || "").toLowerCase().trim();
  const hiddenEl = document.getElementById(`${elementIdPrefix}-gpmid`);
  const currentSelected = hiddenEl?.value || selectedId || "";

  // Build group name map
  const groupName = new Map(gpmGroups.map((g) => [String(g.id), g.name || ""]));

  // Filter profiles
  const filtered = gpmProfiles.filter((p) => {
    if (!query) return true;
    const pName = (p.name || "").toLowerCase();
    const pId = String(p.id).toLowerCase();
    const gName = (groupName.get(String(p.groupId)) || "").toLowerCase();
    return pName.includes(query) || pId.includes(query) || gName.includes(query);
  });

  // Group profiles
  const byGroup = new Map();
  for (const p of filtered) {
    const gk = p.groupId === undefined || p.groupId === null || p.groupId === "" ? "__none" : String(p.groupId);
    if (!byGroup.has(gk)) byGroup.set(gk, []);
    byGroup.get(gk).push(p);
  }

  // Sort groups
  const sortedGroups = [...byGroup.entries()].sort((a, b) => {
    const na = a[0] === "__none" ? "zzz" : (groupName.get(a[0]) || a[0]).toLowerCase();
    const nb = b[0] === "__none" ? "zzz" : (groupName.get(b[0]) || b[0]).toLowerCase();
    return na.localeCompare(nb, "vi");
  });

  // Build HTML - always show "Không dùng" option first (data-id="" for empty selection)
  let html = `
    <div class="trend-gpm-item ${!currentSelected ? "selected" : ""}" data-gpm-id="" data-prefix="${escapeHtml(elementIdPrefix)}">
      <span class="trend-gpm-item-name">Không dùng (chỉ API)</span>
    </div>
  `;

  if (filtered.length === 0 && query) {
    html += `<div class="trend-gpm-empty">Không tìm thấy profile phù hợp</div>`;
  } else {
    for (const [gk, profs] of sortedGroups) {
      const gn = gk === "__none" ? "Chung" : (groupName.get(gk) || gk);
      html += `<div class="trend-gpm-group">${escapeHtml(gn)}</div>`;
      for (const p of profs) {
        const isSelected = String(p.id) === currentSelected;
        const pLabel = p.name || p.id;
        html += `
          <div class="trend-gpm-item ${isSelected ? "selected" : ""}" data-gpm-id="${escapeHtml(String(p.id))}" data-prefix="${escapeHtml(elementIdPrefix)}">
            <span class="trend-gpm-item-name">${escapeHtml(pLabel)}</span>
            ${p.hasProxy ? "" : '<span class="trend-gpm-item-warn" title="Chưa có proxy">⚠</span>'}
          </div>
        `;
      }
    }
  }

  listEl.innerHTML = html;

  // Event delegation for clicks
  listEl.querySelectorAll(".trend-gpm-item[data-gpm-id]").forEach((item) => {
    item.addEventListener("click", () => {
      const prefix = item.dataset.prefix;
      const profileId = item.dataset.gpmId;
      selectGpmProfile(prefix, profileId);
    });
  });
}

// Select a GPM profile
function selectGpmProfile(elementIdPrefix, profileId) {
  const hiddenEl = document.getElementById(`${elementIdPrefix}-gpmid`);
  if (hiddenEl) hiddenEl.value = profileId;

  // Update visual selection
  const listEl = document.getElementById(`${elementIdPrefix}-gpm-list`);
  if (listEl) {
    listEl.querySelectorAll(".trend-gpm-item").forEach((item) => {
      item.classList.toggle("selected", item.dataset.gpmId === profileId);
    });
  }
}

// Filter GPM profiles based on search
function filterGpmProfiles(elementIdPrefix) {
  renderGpmList(elementIdPrefix);
}

// Refresh GPM profiles
async function refreshGpmProfiles(elementIdPrefix) {
  const statusEl = document.getElementById(`${elementIdPrefix}-gpm-status`);
  const listEl = document.getElementById(`${elementIdPrefix}-gpm-list`);

  if (statusEl) {
    statusEl.textContent = "Đang tải...";
    statusEl.className = "trend-gpm-status";
  }
  if (listEl) {
    listEl.innerHTML = `<div class="trend-gpm-loading">Đang tải danh sách profile...</div>`;
  }

  const ok = await loadGpmProfiles();
  const hiddenEl = document.getElementById(`${elementIdPrefix}-gpmid`);
  const selectedId = hiddenEl?.value || "";

  if (!ok) {
    if (statusEl) {
      statusEl.textContent = "Lỗi kết nối GPM";
      statusEl.className = "trend-gpm-status trend-gpm-status-err";
    }
    if (listEl) {
      listEl.innerHTML = `<div class="trend-gpm-error">Không thể kết nối GPM tại ${escapeHtml(gpmHost)}. Hãy kiểm tra GPM đang chạy và thử lại.</div>`;
    }
    return;
  }

  populateGpmList(elementIdPrefix, selectedId);
}

// Escape HTML
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Attach click listener to search button (called after each render)
function attachSearchListener() {
  const btn = document.getElementById("trend-search-btn");
  if (btn) {
    // Always replace the listener since render() rebuilds DOM
    btn.onclick = doSearch;
  }
}

// Export to Excel function
async function exportExcel() {
  if (!currentProfileId) return;

  // Check if there's data to export
  if (!dashboardData || !dashboardData.videos || dashboardData.videos.length === 0) {
    alert("Không có video để xuất. Vui lòng quét dữ liệu hoặc thay đổi bộ lọc.");
    return;
  }

  try {
    const r = await window.electronAPI.trend.export(currentProfileId, filters);
    if (r.canceled) return;
    if (r.ok) {
      alert("Đã xuất: " + r.path);
    } else if (r.error) {
      alert("Lỗi xuất file: " + r.error);
    }
  } catch (e) {
    alert("Lỗi xuất file: " + e.message);
  }
}

// ============================================================================
// AI ANALYSIS
// ============================================================================

/**
 * Load AI key status from main process
 */
async function loadAiKeyStatus() {
  try {
    const r = await window.electronAPI.trend.aiKeyGet();
    if (r.ok) {
      aiKeyStatus = { hasKey: r.hasKey, keyHint: r.keyHint };
    }
  } catch (e) {
    console.error("loadAiKeyStatus error:", e);
    aiKeyStatus = null;
  }
}

/**
 * Show AI analysis modal - either key setup or analysis results
 */
async function analyzeAI() {
  if (!currentProfileId) {
    alert("Vui lòng chọn một profile trước.");
    return;
  }

  // Check if there are videos to analyze
  if (!dashboardData || !dashboardData.videos || dashboardData.videos.length === 0) {
    alert("Không có video để phân tích. Vui lòng quét dữ liệu trước.");
    return;
  }

  // Load key status first
  await loadAiKeyStatus();

  // If no key, show key setup modal
  if (!aiKeyStatus || !aiKeyStatus.hasKey) {
    showAiKeySetupModal();
    return;
  }

  // Otherwise run analysis
  await runAnalysis();
}

/**
 * Show modal for entering AI key
 */
function showAiKeySetupModal() {
  const content = `
    <div class="trend-ai-setup">
      <p>Để sử dụng phân tích AI, bạn cần cấu hình Gemini API key.</p>
      <p><small>Lấy key miễn phí tại <a href="https://aistudio.google.com/app/apikey" target="_blank">Google AI Studio</a></small></p>

      <div class="form-group">
        <label>Gemini API Key</label>
        <input type="text" id="ai-key-input" placeholder="AIza..." autocomplete="off">
      </div>

      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="TrendUI.closeModal()">Hủy</button>
        <button type="button" class="btn btn-primary" onclick="TrendUI.saveAiKey()">Lưu và Phân tích</button>
      </div>
    </div>
  `;
  showModal("Cấu hình AI", content);
}

/**
 * Save AI key and run analysis
 */
async function saveAiKey() {
  const input = document.getElementById("ai-key-input");
  const key = input?.value?.trim() || "";

  if (!key) {
    alert("Vui lòng nhập API key");
    return;
  }

  if (key.length < 8) {
    alert("API key không hợp lệ (quá ngắn)");
    return;
  }

  try {
    const r = await window.electronAPI.trend.aiKeySet(key);
    if (!r.ok) {
      alert("Lỗi lưu key: " + (r.error || "Không rõ"));
      return;
    }

    // Reload status
    await loadAiKeyStatus();
    closeModal();

    // Run analysis
    await runAnalysis();
  } catch (e) {
    alert("Lỗi: " + e.message);
  }
}

/**
 * Run the actual AI analysis
 */
async function runAnalysis() {
  if (isAnalyzing) return;

  isAnalyzing = true;
  analysisResult = null;

  // Update button in DOM without re-rendering (to not wipe modal)
  updateAnalyzeButton();

  // Show loading modal
  showModal("Phân tích AI", `
    <div class="trend-ai-loading">
      <div class="spinner-large"></div>
      <p>Đang phân tích video trending...</p>
      <p><small>Quá trình này có thể mất 10-30 giây</small></p>
    </div>
  `);

  try {
    const r = await window.electronAPI.trend.analyze(currentProfileId);
    analysisResult = r;

    if (r.ok) {
      showAnalysisResultModal(r.insights);
    } else {
      // Check if it's a key error - offer to reconfigure
      if (r.code === "bad-key" || r.code === "no-key") {
        showModal("Lỗi API Key", `
          <div class="trend-ai-error">
            <p>${escapeHtml(r.error)}</p>
            <div class="form-actions">
              <button type="button" class="btn btn-secondary" onclick="TrendUI.closeModal()">Đóng</button>
              <button type="button" class="btn btn-primary" onclick="TrendUI.clearAiKeyAndSetup()">Nhập lại key</button>
            </div>
          </div>
        `);
      } else {
        showModal("Lỗi phân tích", `
          <div class="trend-ai-error">
            <p>${escapeHtml(r.error)}</p>
            <div class="form-actions">
              <button type="button" class="btn btn-secondary" onclick="TrendUI.closeModal()">Đóng</button>
              <button type="button" class="btn btn-primary" onclick="TrendUI.runAnalysis()">Thử lại</button>
            </div>
          </div>
        `);
      }
    }
  } catch (e) {
    showModal("Lỗi", `
      <div class="trend-ai-error">
        <p>Lỗi không xác định: ${escapeHtml(e.message)}</p>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="TrendUI.closeModal()">Đóng</button>
        </div>
      </div>
    `);
  } finally {
    isAnalyzing = false;
    updateAnalyzeButton();
  }
}

/**
 * Update the analyze button's disabled state and text without re-rendering the whole page
 */
function updateAnalyzeButton() {
  const btn = document.getElementById("btn-analyze-ai");
  if (btn) {
    btn.disabled = isAnalyzing;
    btn.textContent = isAnalyzing ? "Đang phân tích..." : "🤖 Phân tích AI";
  }
}

/**
 * Show analysis results modal
 * Uses textContent for the insights to prevent XSS from AI output
 */
function showAnalysisResultModal(insights) {
  // Create the modal structure first without the insights
  showModal("Kết quả phân tích AI", `
    <div class="trend-ai-result">
      <div class="trend-ai-key-status">
        <small>Đang dùng key: ${aiKeyStatus?.keyHint ? escapeHtml(aiKeyStatus.keyHint) : "***"}</small>
        <button type="button" class="btn btn-sm btn-link" onclick="TrendUI.clearAiKeyAndSetup()">Đổi key</button>
      </div>
      <div class="trend-ai-insights" id="ai-insights-content"></div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="TrendUI.closeModal()">Đóng</button>
        <button type="button" class="btn btn-primary" onclick="TrendUI.runAnalysis()">Phân tích lại</button>
      </div>
    </div>
  `);

  // Set insights as textContent (safe from XSS) with preserved line breaks
  const insightsEl = document.getElementById("ai-insights-content");
  if (insightsEl) {
    // Clear children using loop (not innerHTML = "")
    while (insightsEl.firstChild) {
      insightsEl.removeChild(insightsEl.firstChild);
    }
    // Split by lines, create text nodes and <br> elements
    const lines = insights.split("\n");
    lines.forEach((line, i) => {
      insightsEl.appendChild(document.createTextNode(line));
      if (i < lines.length - 1) {
        insightsEl.appendChild(document.createElement("br"));
      }
    });
  }
}

/**
 * Clear current AI key and show setup modal
 */
async function clearAiKeyAndSetup() {
  try {
    await window.electronAPI.trend.aiKeyClear();
    aiKeyStatus = null;
    showAiKeySetupModal();
  } catch (e) {
    alert("Lỗi xóa key: " + e.message);
  }
}

// Mount function
async function mount(root) {
  await loadProfiles();
  render();
  attachSearchListener();

  return {
    reload: async () => {
      await loadProfiles();
      if (currentProfileId) {
        try {
          dashboardData = await window.electronAPI.trend.getDashboard(currentProfileId, filters);
        } catch (e) {}
      }
      render();
      attachSearchListener();
    },
  };
}

// Export
window.TrendUI = {
  mount,
  render,
  showAddProfile,
  saveNewProfile,
  editProfile,
  saveEditProfile,
  deleteProfile,
  selectProfile,
  updateFilter,
  runScan,
  closeModal,
  doSearch,
  exportExcel,
  // GPM selector functions
  refreshGpmProfiles,
  filterGpmProfiles,
  selectGpmProfile,
  // AI Analysis functions
  analyzeAI,
  saveAiKey,
  runAnalysis,
  clearAiKeyAndSetup,
};
