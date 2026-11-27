// Helper to check if electronAPI is available
function checkElectronAPI() {
  if (!window.electronAPI) {
    alert("Lỗi: Electron API chưa sẵn sàng. Vui lòng khởi động lại ứng dụng.");
    return false;
  }
  return true;
}

// Icons SVG (giống web)
const ICONS = {
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  film: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18"/><path d="M3 7.5h4"/><path d="M3 12h18"/><path d="M3 16.5h4"/><path d="M17 3v18"/><path d="M17 7.5h4"/><path d="M17 16.5h4"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  plug: '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
};
function icon(name, cls = "") {
  return `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ""}</svg>`;
}

// ============================================================================
// PERMISSION-BASED TAB BLOCKING: capture-phase listener chặn click trước mọi handler khác
// ============================================================================
// Module-scope variable để capture listener và các handler khác cùng truy cập
let latestPermPayload = null;

// Capture-phase click listener: chạy TRƯỚC target-phase listeners (composer-ui, automation, etc.)
// Phải đăng ký sớm (trước các script khác) để đảm bảo capture luôn chạy đầu tiên.
document.addEventListener("click", function blockDisallowedTabClick(e) {
  const btn = e.target.closest(".tab-button[data-tab]");
  if (!btn) return; // Không phải tab button

  const tabId = btn.getAttribute("data-tab");
  if (!tabId) return;

  // Fail open: không có AppFeatures hoặc không có payload → cho phép
  const AppFeatures = window.AppFeatures;
  if (!AppFeatures || !latestPermPayload) return;

  // Kiểm tra quyền
  if (!AppFeatures.isTabAllowed(tabId, latestPermPayload)) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }
}, true); // true = capture phase

// Settings Menu Functions
function toggleSettingsMenu() {
  const dropdown = document.getElementById("settings-dropdown");
  const btn = document.getElementById("settings-btn");
  if (dropdown && btn) {
    const isActive = dropdown.classList.contains("active");
    if (isActive) {
      closeSettingsMenu();
    } else {
      // Tính toán vị trí dropdown
      const rect = btn.getBoundingClientRect();
      const dropdownWidth = 220; // min-width của dropdown
      const estimatedHeight = 250; // Ước tính chiều cao dropdown

      // Reset styles
      dropdown.style.maxHeight = "";
      dropdown.style.overflowY = "";

      // Tính vị trí right - căn chỉnh với cạnh phải của button
      const rightEdge = window.innerWidth - rect.right;
      dropdown.style.right = rightEdge + "px";
      dropdown.style.left = "auto";

      // Kiểm tra và điều chỉnh nếu dropdown bị tràn ra ngoài
      const leftEdge = rect.right - dropdownWidth;
      if (leftEdge < 20) {
        // Nếu không đủ chỗ bên trái, đặt cách lề phải 20px
        dropdown.style.right = "20px";
      }

      // Tính vị trí top/bottom
      const spaceAbove = rect.top;
      const spaceBelow = window.innerHeight - rect.bottom;

      if (spaceAbove >= estimatedHeight + 20) {
        // Có đủ chỗ ở trên, hiển thị ở trên
        dropdown.style.top = rect.top - estimatedHeight - 8 + "px";
        dropdown.style.bottom = "auto";
      } else if (spaceBelow >= estimatedHeight + 20) {
        // Có đủ chỗ ở dưới, hiển thị ở dưới
        dropdown.style.top = rect.bottom + 8 + "px";
        dropdown.style.bottom = "auto";
      } else {
        // Không đủ chỗ, hiển thị ở trên với scroll
        dropdown.style.top =
          Math.max(20, rect.top - estimatedHeight - 8) + "px";
        dropdown.style.bottom = "auto";
        dropdown.style.maxHeight = window.innerHeight - 40 + "px";
        dropdown.style.overflowY = "auto";
      }

      dropdown.style.zIndex = "99999";
      dropdown.style.position = "fixed";

      dropdown.classList.add("active");
      btn.classList.add("active");
    }
  }
}

function closeSettingsMenu() {
  const dropdown = document.getElementById("settings-dropdown");
  const btn = document.getElementById("settings-btn");
  if (dropdown && btn) {
    dropdown.classList.remove("active");
    btn.classList.remove("active");
  }
}

// Đóng settings menu khi click bên ngoài
document.addEventListener("click", function (event) {
  const settingsWrapper = document.querySelector(".settings-menu-wrapper");
  const dropdown = document.getElementById("settings-dropdown");
  if (settingsWrapper && dropdown && !settingsWrapper.contains(event.target)) {
    closeSettingsMenu();
  }
});

// Settings Menu Functions
function toggleSettingsMenu() {
  const dropdown = document.getElementById("settings-dropdown");
  const btn = document.getElementById("settings-btn");
  if (dropdown && btn) {
    const isActive = dropdown.classList.contains("active");
    if (isActive) {
      closeSettingsMenu();
    } else {
      dropdown.classList.add("active");
      btn.classList.add("active");
    }
  }
}

function closeSettingsMenu() {
  const dropdown = document.getElementById("settings-dropdown");
  const btn = document.getElementById("settings-btn");
  if (dropdown && btn) {
    dropdown.classList.remove("active");
    btn.classList.remove("active");
  }
}

// Đóng settings menu khi click bên ngoài
if (typeof document !== "undefined") {
  document.addEventListener("click", function (event) {
    const settingsWrapper = document.querySelector(".settings-menu-wrapper");
    const dropdown = document.getElementById("settings-dropdown");
    if (
      settingsWrapper &&
      dropdown &&
      !settingsWrapper.contains(event.target)
    ) {
      closeSettingsMenu();
    }
  });
}

// Mở cửa sổ mới để chạy job đồng thời
async function openNewWindow() {
  if (!checkElectronAPI()) return;

  try {
    await window.electronAPI.openNewWindow();
    // Có thể thêm thông báo nếu muốn
  } catch (error) {
    alert(`Lỗi khi mở cửa sổ mới: ${getErrorMessage(error)}`);
  }
}

// Kiểm tra cập nhật ứng dụng (thủ công)
// Tài khoản đăng nhập trên máy này (hiện trong menu cài đặt) + đăng xuất.
async function loadAccountMenu() {
  try {
    const a = await window.electronAPI?.sheet?.accountGet?.();
    const nameEl = document.getElementById("user-name");
    const avatarEl = document.getElementById("user-avatar");
    const dropdownName = document.getElementById("user-dropdown-name");
    const dropdownRole = document.getElementById("user-dropdown-role");
    const logoutBtn = document.getElementById("logout-menu-item");
    if (a?.loggedIn) {
      const name = a.displayName || a.username || "Tài khoản";
      if (nameEl) nameEl.textContent = name;
      if (avatarEl) avatarEl.textContent = name.charAt(0).toUpperCase();
      if (dropdownName) dropdownName.textContent = name;
      if (dropdownRole) dropdownRole.textContent = a.role || "";
      if (logoutBtn) logoutBtn.style.display = "";
    } else {
      if (nameEl) nameEl.textContent = "Chưa đăng nhập";
      if (avatarEl) avatarEl.textContent = "?";
      if (dropdownName) dropdownName.textContent = "Chưa đăng nhập";
      if (dropdownRole) dropdownRole.textContent = "";
      if (logoutBtn) logoutBtn.style.display = "none";
    }
  } catch { /* không quan trọng */ }
}

function toggleUserMenu() {
  const dropdown = document.getElementById("user-dropdown");
  const settingsDropdown = document.getElementById("settings-dropdown");
  if (settingsDropdown) settingsDropdown.classList.remove("active");
  if (dropdown) dropdown.classList.toggle("active");
}
function closeUserMenu() {
  const dropdown = document.getElementById("user-dropdown");
  if (dropdown) dropdown.classList.remove("active");
}

function showLogoutDialog() {
  const dialog = document.getElementById("logoutDialog");
  if (dialog) dialog.classList.add("active");
}
function closeLogoutDialog() {
  const dialog = document.getElementById("logoutDialog");
  if (dialog) dialog.classList.remove("active");
}
async function confirmLogout() {
  closeLogoutDialog();
  try { await window.electronAPI?.sheet?.accountLogout?.(); } catch { /* ignore */ }
}

// Close user menu when clicking outside
document.addEventListener("click", (e) => {
  const userWrapper = document.querySelector(".user-menu-wrapper");
  if (userWrapper && !userWrapper.contains(e.target)) {
    closeUserMenu();
  }
});

window.addEventListener("DOMContentLoaded", loadAccountMenu);

async function checkForAppUpdate() {
  if (!checkElectronAPI()) return;

  // Đánh dấu là check thủ công để hiển thị dialog khi không có update
  window.updateCheckManual = true;

  // Hiển thị notification nhỏ khi đang check (không phải dialog)
  const statusMsg = document.createElement("div");
  statusMsg.id = "update-checking-notification";
  statusMsg.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: linear-gradient(135deg, #fa6e03 0%, #e85d04 100%);
    color: white;
    padding: 16px 24px;
    border-radius: 12px;
    box-shadow: 0 8px 24px rgba(250, 110, 3, 0.4);
    z-index: 10000;
    font-size: 14px;
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 10px;
    animation: slideInRight 0.3s ease-out;
  `;
  statusMsg.innerHTML =
    '<span style="font-size: 20px;">🔄</span> <span>Đang kiểm tra cập nhật...</span>';
  document.body.appendChild(statusMsg);

  try {
    const result = await window.electronAPI.checkForUpdates();

    // Xóa notification sau 1 giây (để user thấy đã check xong)
    setTimeout(() => {
      if (statusMsg.parentNode) {
        statusMsg.style.animation = "slideOutRight 0.3s ease-out";
        setTimeout(() => {
          if (statusMsg.parentNode) {
            statusMsg.parentNode.removeChild(statusMsg);
          }
        }, 300);
      }
    }, 1000);

    if (!result.success) {
      // Nếu có lỗi, hiển thị dialog error
      showUpdateDialog("error", {
        message: result.message || "Lỗi khi kiểm tra cập nhật",
      });
    }
    // Nếu success, dialog sẽ được hiển thị từ event listeners (available/not-available)
  } catch (error) {
    // Xóa notification nếu có lỗi
    if (statusMsg.parentNode) {
      statusMsg.parentNode.removeChild(statusMsg);
    }
    // Hiển thị dialog error
    showUpdateDialog("error", {
      message: "Lỗi: " + getErrorMessage(error),
    });
  }
}

// Update Dialog Management
let currentUpdateVersion = null;

function showUpdateDialog(type, data) {
  const dialog = document.getElementById("update-dialog");
  const icon = document.getElementById("update-dialog-icon");
  const title = document.getElementById("update-dialog-title");
  const message = document.getElementById("update-message");
  const releaseNotes = document.getElementById("update-release-notes");
  const progressContainer = document.getElementById(
    "update-progress-container",
  );
  const progressFill = document.getElementById("update-progress-fill");
  const progressText = document.getElementById("update-progress-text");
  const actions = document.getElementById("update-actions");
  const btnPrimary = document.getElementById("update-btn-primary");
  const btnSecondary = document.getElementById("update-btn-secondary");

  // Reset btnSecondary về hiển thị mặc định
  btnSecondary.style.display = "block";

  if (type === "available") {
    currentUpdateVersion = data.version;
    icon.textContent = "🔄";
    icon.style.display = "block";
    title.textContent = "Cập nhật có sẵn";
    message.innerHTML = `<strong>Phiên bản mới ${
      data.version
    } đã có sẵn!</strong>${
      data.releaseNotes ? "\n\n" + data.releaseNotes : ""
    }`;

    if (data.releaseNotes) {
      releaseNotes.textContent = data.releaseNotes;
      releaseNotes.style.display = "block";
    } else {
      releaseNotes.style.display = "none";
    }

    progressContainer.classList.remove("active");
    btnPrimary.textContent = "Tải về ngay";
    btnPrimary.onclick = () => {
      btnPrimary.disabled = true;
      btnSecondary.disabled = true;
      progressContainer.classList.add("active");
      if (checkElectronAPI() && window.electronAPI) {
        window.electronAPI.downloadUpdate();
      }
    };
    btnSecondary.textContent = "Để sau";
    btnSecondary.onclick = () => {
      dialog.classList.remove("active");
    };
    btnPrimary.disabled = false;
    btnSecondary.disabled = false;
    dialog.classList.add("active");
  } else if (type === "downloaded") {
    icon.textContent = "✅";
    title.textContent = "Cập nhật đã sẵn sàng";
    message.innerHTML = `<strong>Phiên bản ${data.version} đã được tải về thành công!</strong>\n\nỨng dụng sẽ khởi động lại để cài đặt cập nhật.`;
    releaseNotes.style.display = "none";
    progressContainer.classList.remove("active");
    btnPrimary.textContent = "Khởi động lại ngay";
    btnPrimary.onclick = () => {
      if (checkElectronAPI() && window.electronAPI) {
        window.electronAPI.installUpdate();
      }
    };
    btnSecondary.textContent = "Để sau";
    btnSecondary.onclick = () => {
      dialog.classList.remove("active");
    };
    btnPrimary.disabled = false;
    btnSecondary.disabled = false;
    dialog.classList.add("active");
  } else if (type === "update-success") {
    icon.textContent = "🎉";
    title.textContent = "Cập nhật thành công!";
    message.innerHTML = `<strong>Đã cập nhật lên phiên bản ${data.version}</strong>\n\nỨng dụng đã được cập nhật thành công.`;
    releaseNotes.style.display = "none";
    progressContainer.classList.remove("active");
    btnPrimary.textContent = "Tuyệt vời!";
    btnPrimary.onclick = () => {
      dialog.classList.remove("active");
    };
    btnSecondary.style.display = "none";
    btnPrimary.disabled = false;
    dialog.classList.add("active");
  } else if (type === "not-available") {
    icon.textContent = "✅";
    icon.style.display = "block";
    title.textContent = "Đã là phiên bản mới nhất";
    const currentVersion = data.version || "N/A";
    message.innerHTML = `<strong>Bạn đang sử dụng phiên bản mới nhất!</strong><br><br>Phiên bản hiện tại: <span style="color: #fa6e03; font-weight: 600;">${currentVersion}</span>`;
    releaseNotes.style.display = "none";
    progressContainer.classList.remove("active");
    btnPrimary.textContent = "Tuyệt vời!";
    btnPrimary.onclick = () => {
      dialog.classList.remove("active");
    };
    btnSecondary.style.display = "none";
    btnPrimary.disabled = false;
    dialog.classList.add("active");
  } else if (type === "error") {
    icon.textContent = "❌";
    icon.style.display = "block";
    title.textContent = "Lỗi cập nhật";
    message.innerHTML = `<strong>Đã xảy ra lỗi khi cập nhật</strong><br><br><span style="color: #dc3545;">${
      data.message || "Lỗi không xác định"
    }</span>`;
    releaseNotes.style.display = "none";
    progressContainer.classList.remove("active");
    btnPrimary.textContent = "Đóng";
    btnPrimary.onclick = () => {
      dialog.classList.remove("active");
    };
    btnSecondary.style.display = "none";
    btnPrimary.disabled = false;
    dialog.classList.add("active");
  }
}

function updateProgress(percent, transferred, total) {
  const progressFill = document.getElementById("update-progress-fill");
  const progressText = document.getElementById("update-progress-text");

  progressFill.style.width = `${percent}%`;
  progressFill.textContent = `${percent}%`;

  const transferredMB = (transferred / 1024 / 1024).toFixed(1);
  const totalMB = (total / 1024 / 1024).toFixed(1);
  progressText.textContent = `Đang tải: ${transferredMB} MB / ${totalMB} MB (${percent}%)`;
}

// Setup listeners cho update status - sẽ được gọi trong DOMContentLoaded
function setupUpdateListeners() {
  console.log("🔧 Setting up update listeners...");

  if (
    typeof window !== "undefined" &&
    window.electronAPI &&
    window.electronAPI.onUpdateStatus
  ) {
    console.log("✅ ElectronAPI available, setting up listeners");

    // Listen for update status
    window.electronAPI.onUpdateStatus((data) => {
      console.log("📨 Update status received:", data);

      // Hiển thị custom dialog đẹp thay vì alert
      if (data.status === "available") {
        console.log("✅ Update available, showing dialog");
        showUpdateDialog("available", data);
      } else if (data.status === "downloaded") {
        console.log("✅ Update downloaded, showing dialog");
        showUpdateDialog("downloaded", data);
      } else if (data.status === "update-success") {
        console.log("🎉 Update success, showing dialog");
        showUpdateDialog("update-success", data);
      } else if (data.status === "not-available") {
        console.log("ℹ️ No update available");
        // Chỉ hiển thị dialog khi check thủ công, không hiển thị khi auto check
        if (window.updateCheckManual) {
          showUpdateDialog("not-available", data);
          window.updateCheckManual = false;
        }
      } else if (data.status === "error") {
        console.error("❌ Update error:", data.message);
        showUpdateDialog("error", data);
      } else if (data.status === "checking") {
        console.log("🔍 Checking for updates...");
      }
    });

    // Listen for update progress
    if (window.electronAPI.onUpdateProgress) {
      window.electronAPI.onUpdateProgress((data) => {
        console.log(`📥 Update progress: ${data.percent}%`);
        updateProgress(data.percent, data.transferred || 0, data.total || 0);
      });
    }
  } else {
    console.warn("⚠️ ElectronAPI not available for update listeners");
  }
}

// Setup listeners ngay khi script load (trước DOMContentLoaded)
// Để đảm bảo listeners sẵn sàng khi electron-main gửi messages
if (typeof window !== "undefined") {
  // Thử setup ngay nếu electronAPI đã sẵn
  if (window.electronAPI) {
    setupUpdateListeners();
  } else {
    // Nếu chưa sẵn, đợi một chút rồi thử lại
    setTimeout(() => {
      if (window.electronAPI) {
        setupUpdateListeners();
      }
    }, 500);
  }
}

// Helper to extract error message from error object
function getErrorMessage(error) {
  if (!error) return "Lỗi không xác định";
  if (typeof error === "string") return error;
  if (error.error) return String(error.error);
  if (error.message) return String(error.message);
  if (error.toString) return error.toString();
  return String(error);
}

// Hàm xử lý khi bật/tắt GPU - tự động phát hiện codec
async function handleGpuToggle() {
  const useGpuCheckbox = document.getElementById("render-use-gpu");
  const gpuCodecInput = document.getElementById("render-gpu-codec");
  const gpuCodecGroup = document.getElementById("render-gpu-codec-group");
  
  if (!useGpuCheckbox || !gpuCodecInput) return;
  
  // Hiển thị/ẩn field GPU codec
  if (gpuCodecGroup) {
    gpuCodecGroup.style.display = useGpuCheckbox.checked ? "block" : "none";
  }
  
  if (useGpuCheckbox.checked) {
    // Khi bật GPU, tự động phát hiện codec
    if (checkElectronAPI() && window.electronAPI) {
      try {
        gpuCodecInput.value = "Đang phát hiện...";
        const result = await window.electronAPI.detectGpuCodec();
        if (result.success && result.codec) {
          gpuCodecInput.value = result.codec;
          console.log(`✅ Đã tự động phát hiện GPU codec: ${result.codec}`);
          saveSettings();
        } else {
          // Nếu không phát hiện được GPU, tắt checkbox và cảnh báo
          useGpuCheckbox.checked = false;
          if (gpuCodecGroup) {
            gpuCodecGroup.style.display = "none";
          }
          alert("⚠️ Không phát hiện GPU encoder nào trên hệ thống. Vui lòng kiểm tra driver GPU hoặc sử dụng CPU.");
          saveSettings();
        }
      } catch (error) {
        console.error("Lỗi khi phát hiện GPU codec:", error);
        // Nếu có lỗi, vẫn giữ giá trị mặc định
        if (!gpuCodecInput.value || gpuCodecInput.value === "Đang phát hiện...") {
          gpuCodecInput.value = "h264_nvenc";
        }
      }
    }
  } else {
    // Khi tắt GPU, xóa giá trị codec
    gpuCodecInput.value = "";
  }
}

// Settings management
async function saveSettings() {
  const settings = {
    // Render settings
    render: {
      day: document.getElementById("render-day")?.value || "1",
      videos: document.getElementById("render-videos")?.value || "1",
      videoSpeed: document.getElementById("render-video-speed")?.value || "0.95",
      renderMode:
        document.querySelector('input[name="render-mode"]:checked')?.value ||
        "topTransparent",
      opacity: document.getElementById("render-opacity")?.value || "0.7",
      chromaKeyMode:
        document.querySelector('input[name="chromakey-mode"]:checked')?.value ||
        "color",
      chromaKeyColor:
        document.getElementById("render-chromakey-color")?.value || "D4F9D7",
      chromaKeySimilarity:
        document.getElementById("render-chromakey-similarity")?.value || "0.3",
      keepColorColors:
        document.getElementById("render-keepcolor-colors")?.value || "FBFF02",
      keepColorCrop:
        document.getElementById("render-keepcolor-crop")?.checked || false,
      keepColorHeight:
        document.getElementById("render-keepcolor-height")?.value || "220",
      keepColorYOffset:
        document.getElementById("render-keepcolor-y-offset")?.value || "490",
      keepColorAddDarkLayer:
        document.getElementById("render-keepcolor-add-dark-layer")?.checked || false,
      useGPU: document.getElementById("render-use-gpu")?.checked || false,
      maxConcurrentProcesses:
        document.getElementById("render-max-concurrent")?.value || "2",
      gpuVideoCodec:
        document.getElementById("render-gpu-codec")?.value || "h264_nvenc",
      height: document.getElementById("render-height")?.value || "220",
      y_offset: document.getElementById("render-y-offset")?.value || "490",
      personEnabled:
        document.getElementById("render-person-enabled")?.checked || false,
      personPath: selectedRenderPersonPath,
      personPos: document.getElementById("render-person-pos")?.value || "center",
      personScale:
        document.getElementById("render-person-scale")?.value || "0.9",
      bgBlurEnabled:
        document.getElementById("render-bf-blur-enabled")?.checked || false,
      bgBlur: document.getElementById("render-bf-blur")?.value || "20",
      mainScale: document.getElementById("render-bf-main-scale")?.value || "0.85",
      mainOpacity:
        document.getElementById("render-bf-main-opacity")?.value || "0.85",
      frameEnabled:
        document.getElementById("render-bf-frame-enabled")?.checked || false,
      framePath: selectedRenderFramePath,
      frameScale: document.getElementById("render-bf-frame-scale")?.value || "1",
      effectEnabled:
        document.getElementById("render-bf-effect-enabled")?.checked || false,
      effectPath: selectedRenderEffectPath,
      effectOpacity:
        document.getElementById("render-bf-effect-opacity")?.value || "0.15",
      effectBlend:
        document.getElementById("render-bf-effect-blend")?.value || "normal",
      effectKeyThreshold:
        document.getElementById("render-bf-effect-key-threshold")?.value ||
        "0.15",
      dualFrameBgPath: selectedRenderDualFrameBgPath,
      dualFrameMainX: document.getElementById("render-df-main-x")?.value || "40",
      dualFrameMainY: document.getElementById("render-df-main-y")?.value || "40",
      dualFrameMainWidth:
        document.getElementById("render-df-main-width")?.value || "960",
      dualFrameMainHeight:
        document.getElementById("render-df-main-height")?.value || "560",
      dualFrameMainOpacity:
        document.getElementById("render-df-main-opacity")?.value || "1",
      dualFrameSmallX: document.getElementById("render-df-small-x")?.value || "1000",
      dualFrameSmallY: document.getElementById("render-df-small-y")?.value || "520",
      dualFrameSmallWidth:
        document.getElementById("render-df-small-width")?.value || "240",
      dualFrameSmallHeight:
        document.getElementById("render-df-small-height")?.value || "160",
      dualFrameSmallOpacity:
        document.getElementById("render-df-small-opacity")?.value || "1",
      dualFrameSmallRadius:
        document.getElementById("render-df-small-radius")?.value || "0",
      dualFrameFrameEnabled:
        document.getElementById("render-df-frame-enabled")?.checked || false,
      dualFrameFramePath: selectedRenderDualFrameFramePath,
      dualFrameFrameScale:
        document.getElementById("render-df-frame-scale")?.value || "1",
      overlayFolder: selectedRenderOverlayFolder,
      backgroundFolder: selectedRenderBackgroundFolder,
      outputFolder: selectedRenderOutputFolder,
      chromaKeyFile: selectedRenderChromaKeyFile,
      cycleDays: document.getElementById("render-cycle-days")?.value || "1",
    },
    // Download settings
    download: {
      urlsFile: selectedUrlsFile,
      outputFolder: selectedDownloadOutputFolder,
      descFolder: selectedDownloadDescFolder,
      overlayImagesFolder: selectedDownloadOverlayImagesFolder,
      thumbsFolder: selectedDownloadThumbsFolder,
      cookiesFile: selectedDownloadCookiesFile,
      cookiesFolder: selectedDownloadCookiesFolder,
      batchSize: document.getElementById("download-batch-size")?.value ?? "30",
      batchBreakSeconds: document.getElementById("download-batch-break")?.value ?? "120",
      maxConcurrent: document.getElementById("download-max-concurrent")?.value || "2",
      proxy: (() => {
        const proxyInput = document.getElementById("download-proxy");
        const proxyValue = proxyInput?.value?.trim();
        // Nếu input field có giá trị, dùng giá trị đó (ưu tiên nhất)
        if (proxyValue) {
          return proxyValue;
        }
        // Nếu input field trống, trả về null (để xóa proxy khỏi config)
        return null;
      })(),
      downloadDrive: selectedDownloadDrive || false,
      driveLanguage: selectedDriveLanguage || "jp",
    },
    // Stock Download (Pexels & Pixabay) settings
    stockDownload: {
      usePexels: document.getElementById("stock-use-pexels")?.checked ?? false,
      usePixabay: document.getElementById("stock-use-pixabay")?.checked ?? false,
      pexelsApiKey: document.getElementById("stock-pexels-api-key")?.value?.trim() || "",
      pixabayApiKey: document.getElementById("stock-pixabay-api-key")?.value?.trim() || "",
      searchQuery: document.getElementById("stock-search-query")?.value?.trim() || "",
      maxVideos: document.getElementById("stock-max-videos")?.value || "30",
      outputFolder: selectedStockOutputFolder || "",
      orientation: document.getElementById("stock-orientation")?.value || "landscape",
      convert720: document.getElementById("stock-convert-720")?.checked ?? true,
      removeAudio: document.getElementById("stock-remove-audio")?.checked ?? true,
      cut: document.getElementById("stock-cut")?.checked ?? false,
      trimSeconds: document.getElementById("stock-trim-seconds")?.value || "3",
    },
    // Video Snow settings
    videoSnow: {
      inputFolder: selectedVideoSnowInputFolder,
      outputFolder: selectedVideoSnowOutputFolder,
      snowFile: selectedVideoSnowSnowFile,
      maxConcurrent:
        document.getElementById("video-snow-max-concurrent")?.value || "3",
      segmentMin:
        document.getElementById("video-snow-segment-min")?.value || "10",
      segmentMax:
        document.getElementById("video-snow-segment-max")?.value || "15",
    },
    // Background Video settings
    bgVideo: {
      count: document.getElementById("bg-count")?.value || "3",
      inputFolder: selectedBgInputFolder,
      outputFolder: selectedBgOutputFolder,
      targetDuration:
        document.getElementById("bg-target-duration")?.value || "3600",
      sourceCount: document.getElementById("bg-source-count")?.value || "10",
      avgClipDuration:
        document.getElementById("bg-avg-clip-duration")?.value || "12",
    },
    // Trim settings
    trim: {
      inputFolder: selectedTrimInputFolder,
      outputFolder: selectedTrimOutputFolder,
      startTime: document.getElementById("trim-start-time")?.value || "0",
      duration: document.getElementById("trim-duration")?.value || "30",
    },
    // Cut BG settings
    cutBg: {
      inputFolder: selectedCutBgInputFolder,
      outputFolder: selectedCutBgOutputFolder,
      darken: document.getElementById("cut-bg-darken")?.value || "",
      blur: document.getElementById("cut-bg-blur")?.value || "",
      useGPU: document.getElementById("cut-bg-use-gpu")?.checked || false,
      maxConcurrent:
        document.getElementById("cut-bg-max-concurrent")?.value || "2",
    },
    // Thumb settings
    thumb: {
      inputFolder: selectedThumbInputFolder,
      overlayFolder: selectedThumbOverlayFolder,
      outputFolder: selectedThumbOutputFolder,
    },
    // Get URL settings
    getUrl: {
      handle: document.getElementById("channel-handle")?.value || "",
      outputFolder: selectedGetUrlOutputFolder,
      apiKey: document.getElementById("get-url-api-key")?.value?.trim() || "",
    },
    // Normalize settings
    normalize: {
      inputFolder: selectedNormalizeInputFolder,
    },
    // Concat settings
    concat: {
      chunkSize: document.getElementById("concat-chunk-size")?.value || "2",
      useThumbs: document.getElementById("concat-use-thumbs")?.checked ?? true,
      thumbDuration:
        document.getElementById("concat-thumb-duration")?.value || "3",
      inputFolder: selectedConcatInputFolder,
      thumbsFolder: selectedConcatThumbsFolder,
      outputFolder: selectedConcatOutputFolder,
    },
    // Test Render settings
    testRender: {
      outputFolder: selectedTestRenderOutputFolder,
    },
  };

  // Lưu vào localStorage (backup)
  localStorage.setItem("cutVideoAppSettings", JSON.stringify(settings));

  // Luôn lưu vào project config (mặc định là "default")
  const projectToSave = currentProjectName || "default";
  if (checkElectronAPI() && window.electronAPI) {
    try {
      await window.electronAPI.saveProjectConfig(projectToSave, settings);
      console.log(`Đã lưu settings vào project: ${projectToSave}`);
    } catch (error) {
      console.error("Error saving project config:", error);
    }
  }

  // Không còn lưu render config vào file riêng lẻ nữa
  // Tất cả config đã được lưu trong project JSON ở trên
}

async function loadSettings() {
  try {
    // Luôn load từ project config (mặc định là "default")
    let settings = {};
    // Đảm bảo có project được chọn (mặc định là "default")
    const projectToLoad = currentProjectName || "default";
    
    if (checkElectronAPI() && window.electronAPI) {
      try {
        const result =
          await window.electronAPI.loadProjectConfig(projectToLoad);
        if (result.success && result.config) {
          settings = result.config;
          console.log(
            `Loaded settings from project: ${projectToLoad}`,
            settings,
          );
        }
      } catch (error) {
        console.error("Error loading project config:", error);
      }
    }

    // Fallback: Nếu không có config từ project, đọc từ localStorage (tạm thời giữ lại để tương thích)
    if (Object.keys(settings).length === 0) {
      const saved = localStorage.getItem("cutVideoAppSettings");
      if (saved) {
        try {
          settings = JSON.parse(saved);
          console.log("Loaded settings from localStorage (fallback)");
          // Lưu settings từ localStorage vào project "default"
          if (checkElectronAPI() && window.electronAPI && projectToLoad === "default") {
            await window.electronAPI.saveProjectConfig("default", settings);
            localStorage.removeItem("cutVideoAppSettings"); // Xóa sau khi migrate
          }
        } catch (e) {
          console.error("Error parsing localStorage settings:", e);
        }
      }
    }

    // Không còn dùng file config riêng lẻ nữa - tất cả đều trong project JSON

    // Load Render settings
    if (settings.render) {
      if (settings.render.day)
        document.getElementById("render-day").value = settings.render.day;
      if (settings.render.videos)
        document.getElementById("render-videos").value = settings.render.videos;
      if (settings.render.videoSpeed)
        document.getElementById("render-video-speed").value = settings.render.videoSpeed;
      if (settings.render.cycleDays != null)
        document.getElementById("render-cycle-days").value = settings.render.cycleDays;
   
      if (settings.render.renderMode) {
        // Map renderMode value to actual radio button ID (HTML uses kebab-case)
        const modeIdMap = {
          topTransparent: "render-mode-top-transparent",
          chromaKey: "render-mode-chromakey",
          crop: "render-mode-crop",
          keepColor: "render-mode-keepcolor",
          blurFrame: "render-mode-blurframe",
          dualFrame: "render-mode-dualframe",
        };
        const modeId =
          modeIdMap[settings.render.renderMode] ||
          `render-mode-${settings.render.renderMode}`;
        const modeRadio = document.getElementById(modeId);
        if (modeRadio) {
          modeRadio.checked = true;
          toggleRenderMode();
        } else {
          // Fallback: try to find by value attribute
          const radioByValue = document.querySelector(
            `input[name="render-mode"][value="${settings.render.renderMode}"]`,
          );
          if (radioByValue) {
            radioByValue.checked = true;
            toggleRenderMode();
          }
        }
      }
      if (settings.render.opacity)
        document.getElementById("render-opacity").value =
          settings.render.opacity;
      // Nền mờ + Khung: nạp giá trị trước, rồi mới đồng bộ hiện/ẩn theo công tắc
      if (settings.render.bgBlurEnabled !== undefined)
        document.getElementById("render-bf-blur-enabled").checked =
          settings.render.bgBlurEnabled;
      if (settings.render.bgBlur)
        document.getElementById("render-bf-blur").value = settings.render.bgBlur;
      if (settings.render.mainScale)
        document.getElementById("render-bf-main-scale").value =
          settings.render.mainScale;
      if (settings.render.mainOpacity)
        document.getElementById("render-bf-main-opacity").value =
          settings.render.mainOpacity;
      if (settings.render.frameEnabled !== undefined)
        document.getElementById("render-bf-frame-enabled").checked =
          settings.render.frameEnabled;
      if (settings.render.framePath) {
        selectedRenderFramePath = settings.render.framePath;
        document.getElementById("render-bf-frame-path").value =
          settings.render.framePath;
      }
      if (settings.render.frameScale)
        document.getElementById("render-bf-frame-scale").value =
          settings.render.frameScale;
      if (settings.render.effectEnabled !== undefined)
        document.getElementById("render-bf-effect-enabled").checked =
          settings.render.effectEnabled;
      if (settings.render.effectPath) {
        selectedRenderEffectPath = settings.render.effectPath;
        document.getElementById("render-bf-effect-path").value =
          settings.render.effectPath;
      }
      if (settings.render.effectOpacity)
        document.getElementById("render-bf-effect-opacity").value =
          settings.render.effectOpacity;
      if (settings.render.effectBlend)
        document.getElementById("render-bf-effect-blend").value =
          settings.render.effectBlend;
      if (settings.render.effectKeyThreshold)
        document.getElementById("render-bf-effect-key-threshold").value =
          settings.render.effectKeyThreshold;
      toggleBlurFrameLayers();
      // Khung đôi (dualFrame): nạp giá trị trước, rồi mới đồng bộ hiện/ẩn theo công tắc
      if (settings.render.dualFrameBgPath) {
        selectedRenderDualFrameBgPath = settings.render.dualFrameBgPath;
        document.getElementById("render-df-bg-path").value =
          settings.render.dualFrameBgPath;
      }
      if (settings.render.dualFrameMainX)
        document.getElementById("render-df-main-x").value = settings.render.dualFrameMainX;
      if (settings.render.dualFrameMainY)
        document.getElementById("render-df-main-y").value = settings.render.dualFrameMainY;
      if (settings.render.dualFrameMainWidth)
        document.getElementById("render-df-main-width").value =
          settings.render.dualFrameMainWidth;
      if (settings.render.dualFrameMainHeight)
        document.getElementById("render-df-main-height").value =
          settings.render.dualFrameMainHeight;
      if (settings.render.dualFrameMainOpacity)
        document.getElementById("render-df-main-opacity").value =
          settings.render.dualFrameMainOpacity;
      if (settings.render.dualFrameSmallX)
        document.getElementById("render-df-small-x").value = settings.render.dualFrameSmallX;
      if (settings.render.dualFrameSmallY)
        document.getElementById("render-df-small-y").value = settings.render.dualFrameSmallY;
      if (settings.render.dualFrameSmallWidth)
        document.getElementById("render-df-small-width").value =
          settings.render.dualFrameSmallWidth;
      if (settings.render.dualFrameSmallHeight)
        document.getElementById("render-df-small-height").value =
          settings.render.dualFrameSmallHeight;
      if (settings.render.dualFrameSmallOpacity)
        document.getElementById("render-df-small-opacity").value =
          settings.render.dualFrameSmallOpacity;
      if (settings.render.dualFrameSmallRadius !== undefined)
        document.getElementById("render-df-small-radius").value =
          settings.render.dualFrameSmallRadius;
      if (settings.render.dualFrameFrameEnabled !== undefined)
        document.getElementById("render-df-frame-enabled").checked =
          settings.render.dualFrameFrameEnabled;
      if (settings.render.dualFrameFramePath) {
        selectedRenderDualFrameFramePath = settings.render.dualFrameFramePath;
        document.getElementById("render-df-frame-path").value =
          settings.render.dualFrameFramePath;
      }
      if (settings.render.dualFrameFrameScale)
        document.getElementById("render-df-frame-scale").value =
          settings.render.dualFrameFrameScale;
      toggleDualFrameLayers();
      if (settings.render.chromaKeyMode) {
        document.getElementById(
          settings.render.chromaKeyMode === "color"
            ? "chromakey-color"
            : "chromakey-file",
        ).checked = true;
        toggleChromaKeyMode();
      }
      if (settings.render.chromaKeyColor)
        document.getElementById("render-chromakey-color").value =
          settings.render.chromaKeyColor;
      if (settings.render.chromaKeySimilarity)
        document.getElementById("render-chromakey-similarity").value =
          settings.render.chromaKeySimilarity;
      if (settings.render.keepColorColors)
        document.getElementById("render-keepcolor-colors").value =
          settings.render.keepColorColors;
      if (settings.render.keepColorCrop !== undefined) {
        document.getElementById("render-keepcolor-crop").checked =
          settings.render.keepColorCrop;
        toggleKeepColorCrop();
      }
      if (settings.render.keepColorHeight)
        document.getElementById("render-keepcolor-height").value =
          settings.render.keepColorHeight;
      if (settings.render.keepColorYOffset)
        document.getElementById("render-keepcolor-y-offset").value =
          settings.render.keepColorYOffset;
      if (settings.render.keepColorAddDarkLayer !== undefined) {
        document.getElementById("render-keepcolor-add-dark-layer").checked =
          settings.render.keepColorAddDarkLayer;
      }
      if (settings.render.useGPU !== undefined) {
        document.getElementById("render-use-gpu").checked =
          settings.render.useGPU;
        // Cập nhật hiển thị field GPU codec
        const gpuCodecGroup = document.getElementById("render-gpu-codec-group");
        if (gpuCodecGroup) {
          gpuCodecGroup.style.display = settings.render.useGPU ? "block" : "none";
        }
      }
      if (settings.render.maxConcurrentProcesses)
        document.getElementById("render-max-concurrent").value =
          settings.render.maxConcurrentProcesses;
      if (settings.render.gpuVideoCodec)
        document.getElementById("render-gpu-codec").value =
          settings.render.gpuVideoCodec;
      if (settings.render.height)
        document.getElementById("render-height").value = settings.render.height;
      if (settings.render.y_offset)
        document.getElementById("render-y-offset").value =
          settings.render.y_offset;

      if (settings.render.personEnabled !== undefined)
        document.getElementById("render-person-enabled").checked =
          settings.render.personEnabled;
      if (settings.render.personPath) {
        selectedRenderPersonPath = settings.render.personPath;
        document.getElementById("render-person-path").value =
          settings.render.personPath;
      }
      if (settings.render.personPos)
        document.getElementById("render-person-pos").value =
          settings.render.personPos;
      if (settings.render.personScale)
        document.getElementById("render-person-scale").value =
          settings.render.personScale;
      updatePersonGroupVisibility();

      if (settings.render.overlayFolder) {
        selectedRenderOverlayFolder = settings.render.overlayFolder;
        document.getElementById("render-overlay-folder").value =
          settings.render.overlayFolder;
        // Removed folder path display
      }
      if (settings.render.backgroundFolder) {
        selectedRenderBackgroundFolder = settings.render.backgroundFolder;
        document.getElementById("render-background-folder").value =
          settings.render.backgroundFolder;
        // Removed folder path display
      }
      if (settings.render.outputFolder) {
        selectedRenderOutputFolder = settings.render.outputFolder;
        document.getElementById("render-output-folder").value =
          settings.render.outputFolder;
        // Removed folder path display
      }
      if (settings.render.chromaKeyFile) {
        selectedRenderChromaKeyFile = settings.render.chromaKeyFile;
        document.getElementById("render-chromakey-file").value =
          settings.render.chromaKeyFile;
        // Removed folder path display
      }
    }

    // Load Download settings
    if (settings.download) {
      if (settings.download.urlsFile) {
        selectedUrlsFile = settings.download.urlsFile;
        document.getElementById("download-urls-file").value =
          settings.download.urlsFile;
        // Removed folder path display
      }
      if (settings.download.outputFolder) {
        selectedDownloadOutputFolder = settings.download.outputFolder;
        document.getElementById("download-output-folder").value =
          settings.download.outputFolder;
        // Removed folder path display
      }
      if (settings.download.descFolder) {
        selectedDownloadDescFolder = settings.download.descFolder;
        const el = document.getElementById("download-desc-folder");
        if (el) el.value = settings.download.descFolder;
      }
      if (settings.download.overlayImagesFolder) {
        selectedDownloadOverlayImagesFolder =
          settings.download.overlayImagesFolder;
        document.getElementById("download-overlay-images-folder").value =
          settings.download.overlayImagesFolder;
        // Removed folder path display
      }
      if (settings.download.thumbsFolder) {
        selectedDownloadThumbsFolder = settings.download.thumbsFolder;
        document.getElementById("download-thumbs-folder").value =
          settings.download.thumbsFolder;
        // Removed folder path display
      }
      // Ô chọn 1 file cookie đã bỏ khỏi UI (chỉ còn thư mục cookie), nhưng giá trị
      // cũ vẫn giữ nguyên trong biến và được ghi lại khi lưu: người đang chạy bằng
      // 1 file cookie không mất gì, app vẫn dùng file đó khi chưa chọn thư mục.
      if (settings.download.cookiesFile) {
        selectedDownloadCookiesFile = settings.download.cookiesFile;
      }
      if (settings.download.cookiesFolder) {
        selectedDownloadCookiesFolder = settings.download.cookiesFolder;
        const el = document.getElementById("download-cookies-folder");
        if (el) el.value = settings.download.cookiesFolder;
      }
      // != null chứ không phải truthy: 0 là lựa chọn cố ý (tắt chia lô / không nghỉ),
      // dùng truthy thì 0 bị coi như "chưa cấu hình" và bị nhét lại mặc định 30/120.
      if (settings.download.batchSize != null) {
        const el = document.getElementById("download-batch-size");
        if (el) el.value = settings.download.batchSize;
      }
      if (settings.download.batchBreakSeconds != null) {
        const el = document.getElementById("download-batch-break");
        if (el) el.value = settings.download.batchBreakSeconds;
      }
      if (settings.download.maxConcurrent) {
        document.getElementById("download-max-concurrent").value =
          settings.download.maxConcurrent;
      }
      // Chỉ restore proxy nếu có giá trị hợp lệ (không phải null, undefined, hoặc empty string)
      if (settings.download.proxy !== undefined && settings.download.proxy !== null) {
        const proxyValue = settings.download.proxy.toString().trim();
        if (proxyValue) {
          selectedDownloadProxy = proxyValue;
          const proxyInput = document.getElementById("download-proxy");
          if (proxyInput) {
            proxyInput.value = proxyValue;
          }
        } else {
          // Nếu proxy là empty string, clear nó
          selectedDownloadProxy = null;
          const proxyInput = document.getElementById("download-proxy");
          if (proxyInput) {
            proxyInput.value = "";
          }
        }
      } else {
        // Nếu proxy là null hoặc undefined, clear nó
        selectedDownloadProxy = null;
        const proxyInput = document.getElementById("download-proxy");
        if (proxyInput) {
          proxyInput.value = "";
        }
      }
      if (settings.download.downloadDrive !== undefined) {
        selectedDownloadDrive = settings.download.downloadDrive;
        const driveCheckbox = document.getElementById("download-drive");
        if (driveCheckbox) {
          driveCheckbox.checked = settings.download.downloadDrive;
          // Hiển thị/ẩn dropdown ngôn ngữ
          const languageGroup = document.getElementById("drive-language-group");
          if (languageGroup) {
            languageGroup.style.display = settings.download.downloadDrive
              ? "block"
              : "none";
          }
        }
      }
      if (settings.download.driveLanguage !== undefined) {
        selectedDriveLanguage = settings.download.driveLanguage;
        const languageSelect = document.getElementById("drive-language");
        if (languageSelect) {
          languageSelect.value = settings.download.driveLanguage;
        }
      }
    }

    // Load Stock Download (Pexels & Pixabay) settings
    if (settings.stockDownload) {
      const sd = settings.stockDownload;
      if (sd.usePexels !== undefined) {
        const cb = document.getElementById("stock-use-pexels");
        if (cb) {
          cb.checked = sd.usePexels;
          toggleStockPexels();
        }
      }
      if (sd.usePixabay !== undefined) {
        const cb = document.getElementById("stock-use-pixabay");
        if (cb) {
          cb.checked = sd.usePixabay;
          toggleStockPixabay();
        }
      }
      if (sd.pexelsApiKey !== undefined) {
        const input = document.getElementById("stock-pexels-api-key");
        if (input) input.value = sd.pexelsApiKey;
      }
      if (sd.pixabayApiKey !== undefined) {
        const input = document.getElementById("stock-pixabay-api-key");
        if (input) input.value = sd.pixabayApiKey;
      }
      if (sd.searchQuery !== undefined) {
        const input = document.getElementById("stock-search-query");
        if (input) input.value = sd.searchQuery;
      }
      if (sd.maxVideos !== undefined) {
        const input = document.getElementById("stock-max-videos");
        if (input) input.value = sd.maxVideos;
      }
      if (sd.outputFolder) {
        selectedStockOutputFolder = sd.outputFolder;
        const input = document.getElementById("stock-output-folder");
        if (input) input.value = sd.outputFolder;
      }
      if (sd.orientation !== undefined) {
        const sel = document.getElementById("stock-orientation");
        if (sel) sel.value = sd.orientation;
      }
      if (sd.convert720 !== undefined) {
        const el = document.getElementById("stock-convert-720");
        if (el) el.checked = sd.convert720;
      }
      if (sd.removeAudio !== undefined) {
        const el = document.getElementById("stock-remove-audio");
        if (el) el.checked = sd.removeAudio;
      }
      if (sd.cut !== undefined) {
        const el = document.getElementById("stock-cut");
        if (el) {
          el.checked = sd.cut;
          toggleStockCut();
        }
      }
      if (sd.trimSeconds !== undefined) {
        const el = document.getElementById("stock-trim-seconds");
        if (el) el.value = sd.trimSeconds;
      }
    }

    // Load Video Snow settings
    if (settings.videoSnow) {
      if (settings.videoSnow.inputFolder) {
        selectedVideoSnowInputFolder = settings.videoSnow.inputFolder;
        document.getElementById("video-snow-input-folder").value =
          settings.videoSnow.inputFolder;
        // Removed folder path display
      }
      if (settings.videoSnow.outputFolder) {
        selectedVideoSnowOutputFolder = settings.videoSnow.outputFolder;
        document.getElementById("video-snow-output-folder").value =
          settings.videoSnow.outputFolder;
        // Removed folder path display
      }
      if (settings.videoSnow.snowFile) {
        selectedVideoSnowSnowFile = settings.videoSnow.snowFile;
        document.getElementById("video-snow-snow-file").value =
          settings.videoSnow.snowFile;
        // Removed folder path display
      }
      if (settings.videoSnow.maxConcurrent) {
        document.getElementById("video-snow-max-concurrent").value =
          settings.videoSnow.maxConcurrent;
      }
      if (settings.videoSnow.segmentMin) {
        document.getElementById("video-snow-segment-min").value =
          settings.videoSnow.segmentMin;
      }
      if (settings.videoSnow.segmentMax) {
        document.getElementById("video-snow-segment-max").value =
          settings.videoSnow.segmentMax;
      }
    }

    // Load Background Video settings
    if (settings.bgVideo) {
      if (settings.bgVideo.count)
        document.getElementById("bg-count").value = settings.bgVideo.count;
      if (settings.bgVideo.inputFolder) {
        selectedBgInputFolder = settings.bgVideo.inputFolder;
        document.getElementById("bg-input-folder").value =
          settings.bgVideo.inputFolder;
        // Removed folder path display
      }
      if (settings.bgVideo.outputFolder) {
        selectedBgOutputFolder = settings.bgVideo.outputFolder;
        document.getElementById("bg-output-folder").value =
          settings.bgVideo.outputFolder;
        // Removed folder path display
      }
      if (settings.bgVideo.targetDuration) {
        document.getElementById("bg-target-duration").value =
          settings.bgVideo.targetDuration;
      }
      if (settings.bgVideo.sourceCount) {
        document.getElementById("bg-source-count").value =
          settings.bgVideo.sourceCount;
      }
      if (settings.bgVideo.avgClipDuration) {
        document.getElementById("bg-avg-clip-duration").value =
          settings.bgVideo.avgClipDuration;
      }
    }

    // Load Trim settings
    if (settings.trim) {
      if (settings.trim.inputFolder) {
        selectedTrimInputFolder = settings.trim.inputFolder;
        document.getElementById("trim-input-folder").value =
          settings.trim.inputFolder;
        // Removed folder path display
      }
      if (settings.trim.outputFolder) {
        selectedTrimOutputFolder = settings.trim.outputFolder;
        document.getElementById("trim-output-folder").value =
          settings.trim.outputFolder;
        // Removed folder path display
      }
      if (settings.trim.startTime)
        document.getElementById("trim-start-time").value =
          settings.trim.startTime;
      if (settings.trim.duration)
        document.getElementById("trim-duration").value = settings.trim.duration;
    }

    // Load Cut BG settings
    if (settings.cutBg) {
      if (settings.cutBg.inputFolder) {
        selectedCutBgInputFolder = settings.cutBg.inputFolder;
        document.getElementById("cut-bg-input-folder").value =
          settings.cutBg.inputFolder;
        // Removed folder path display
      }
      if (settings.cutBg.outputFolder) {
        selectedCutBgOutputFolder = settings.cutBg.outputFolder;
        document.getElementById("cut-bg-output-folder").value =
          settings.cutBg.outputFolder;
        // Removed folder path display
      }
      if (settings.cutBg.darken !== undefined) {
        document.getElementById("cut-bg-darken").value = settings.cutBg.darken;
      }
      if (settings.cutBg.blur !== undefined) {
        document.getElementById("cut-bg-blur").value = settings.cutBg.blur;
      }
      if (settings.cutBg.useGPU !== undefined) {
        document.getElementById("cut-bg-use-gpu").checked =
          !!settings.cutBg.useGPU;
      }
      if (settings.cutBg.maxConcurrent !== undefined) {
        document.getElementById("cut-bg-max-concurrent").value =
          settings.cutBg.maxConcurrent;
      }
    }

    // Load Thumb settings
    if (settings.thumb) {
      if (settings.thumb.inputFolder) {
        selectedThumbInputFolder = settings.thumb.inputFolder;
        document.getElementById("thumb-input-folder").value =
          settings.thumb.inputFolder;
        // Removed folder path display
      }
      if (settings.thumb.overlayFolder) {
        selectedThumbOverlayFolder = settings.thumb.overlayFolder;
        document.getElementById("thumb-overlay-folder").value =
          settings.thumb.overlayFolder;
        // Removed folder path display
      }
      if (settings.thumb.outputFolder) {
        selectedThumbOutputFolder = settings.thumb.outputFolder;
        document.getElementById("thumb-output-folder").value =
          settings.thumb.outputFolder;
        // Removed folder path display
      }
    }

    // Load Get URL settings
    if (settings.getUrl) {
      if (settings.getUrl.handle)
        document.getElementById("channel-handle").value =
          settings.getUrl.handle;
      if (settings.getUrl.outputFolder) {
        selectedGetUrlOutputFolder = settings.getUrl.outputFolder;
        document.getElementById("get-url-output-folder").value =
          settings.getUrl.outputFolder;
        // Removed folder path display
      }
      if (settings.getUrl.apiKey) {
        document.getElementById("get-url-api-key").value = settings.getUrl.apiKey;
      }
    }

    // Load Normalize settings
    if (settings.normalize) {
      if (settings.normalize.inputFolder) {
        selectedNormalizeInputFolder = settings.normalize.inputFolder;
        document.getElementById("normalize-input-folder").value =
          settings.normalize.inputFolder;
        // Removed folder path display
      }
    }

    // Load Concat settings
    if (settings.concat) {
      if (settings.concat.chunkSize)
        document.getElementById("concat-chunk-size").value =
          settings.concat.chunkSize;
      if (settings.concat.useThumbs !== undefined) {
        document.getElementById("concat-use-thumbs").checked =
          settings.concat.useThumbs;
        toggleConcatThumbs();
      }
      if (settings.concat.thumbDuration)
        document.getElementById("concat-thumb-duration").value =
          settings.concat.thumbDuration;
      if (settings.concat.inputFolder) {
        selectedConcatInputFolder = settings.concat.inputFolder;
        document.getElementById("concat-input-folder").value =
          settings.concat.inputFolder;
        // Removed folder path display
      }
      if (settings.concat.thumbsFolder) {
        selectedConcatThumbsFolder = settings.concat.thumbsFolder;
        document.getElementById("concat-thumbs-folder").value =
          settings.concat.thumbsFolder;
        // Removed folder path display
      }
      if (settings.concat.outputFolder) {
        selectedConcatOutputFolder = settings.concat.outputFolder;
        document.getElementById("concat-output-folder").value =
          settings.concat.outputFolder;
        // Removed folder path display
      }
    }

    // Load Test Render settings
    if (settings.testRender) {
      if (settings.testRender.outputFolder) {
        selectedTestRenderOutputFolder = settings.testRender.outputFolder;
        document.getElementById("test-render-output-folder").value =
          settings.testRender.outputFolder;
      }
    }
  } catch (error) {
    console.error("Error loading settings:", error);
  }
}

// Project management
let currentProjectName = null;
// Dự án đang mở: nơi lưu cấu hình render của máy này (file projects/<tên>.json). Không còn ô chọn/thêm/xóa dự án:
// việc theo mẻ làm ở menu "Mẻ". Chưa có dự án nào thì dùng "default".
async function loadProjects() {
  if (!checkElectronAPI()) return;
  try {
    const currentResult = await window.electronAPI.getCurrentProject();
    if (currentResult.success && currentResult.projectName) currentProjectName = currentResult.projectName;
    if (!currentProjectName) currentProjectName = "default";
  } catch (error) {
    console.error("Error loading current project:", error);
  }
}

// Hiển thị thông báo ngắn cho project
function showProjectNotification(message, type = "info") {
  // Tạo notification element nếu chưa có
  let notification = document.getElementById("project-notification");
  if (!notification) {
    notification = document.createElement("div");
    notification.id = "project-notification";
    notification.style.cssText = `
      position: fixed;
      top: 100px;
      right: 20px;
      padding: 12px 20px;
      border-radius: 8px;
      color: white;
      font-size: 13px;
      font-weight: 600;
      z-index: 10000;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      opacity: 0;
      transform: translateX(100px);
      transition: all 0.3s ease;
      pointer-events: none;
    `;
    document.body.appendChild(notification);
  }

  // Set màu theo type
  const colors = {
    success: "linear-gradient(135deg, #4caf50 0%, #45a049 100%)",
    info: "linear-gradient(135deg, #2196f3 0%, #1976d2 100%)",
    error: "linear-gradient(135deg, #f44336 0%, #d32f2f 100%)",
  };
  notification.style.background = colors[type] || colors.info;
  notification.textContent = message;

  // Hiển thị
  setTimeout(() => {
    notification.style.opacity = "1";
    notification.style.transform = "translateX(0)";
  }, 10);

  // Ẩn sau 3 giây
  setTimeout(() => {
    notification.style.opacity = "0";
    notification.style.transform = "translateX(100px)";
  }, 3000);
}

// ========== Dashboard (màn hình mặc định) ==========
function formatProjectDate(isoStr) {
  if (!isoStr) return "—";
  try {
    const d = new Date(isoStr);
    return d.toLocaleDateString("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch (e) {
    return "—";
  }
}

function escapeHtml(s) {
  if (s == null) return "";
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

// Lưu settings của project hiện tại
async function saveCurrentProjectSettings() {
  // Luôn lưu vào project (mặc định là "default")
  const projectToSave = currentProjectName || "default";

  if (!checkElectronAPI()) return;

  try {
    // Lấy tất cả settings hiện tại (sử dụng logic từ saveSettings)
    const settings = {
      // Render settings
      render: {
        day: document.getElementById("render-day")?.value || "1",
        videos: document.getElementById("render-videos")?.value || "1",
        videoSpeed: document.getElementById("render-video-speed")?.value || "0.95",
        renderMode:
          document.querySelector('input[name="render-mode"]:checked')?.value ||
          "topTransparent",
        opacity: document.getElementById("render-opacity")?.value || "0.7",
        chromaKeyMode:
          document.querySelector('input[name="chromakey-mode"]:checked')
            ?.value || "color",
        chromaKeyColor:
          document.getElementById("render-chromakey-color")?.value || "D4F9D7",
        keepColorColors:
          document.getElementById("render-keepcolor-colors")?.value || "FBFF02",
        keepColorCrop:
          document.getElementById("render-keepcolor-crop")?.checked || false,
        keepColorHeight:
          document.getElementById("render-keepcolor-height")?.value || "220",
        keepColorYOffset:
          document.getElementById("render-keepcolor-y-offset")?.value || "490",
        keepColorAddDarkLayer:
          document.getElementById("render-keepcolor-add-dark-layer")?.checked || false,
        useGPU: document.getElementById("render-use-gpu")?.checked || false,
        maxConcurrentProcesses:
          document.getElementById("render-max-concurrent")?.value || "2",
        gpuVideoCodec:
          document.getElementById("render-gpu-codec")?.value || "h264_nvenc",
        height: document.getElementById("render-height")?.value || "220",
        y_offset: document.getElementById("render-y-offset")?.value || "490",
        personEnabled:
          document.getElementById("render-person-enabled")?.checked || false,
        personPath: selectedRenderPersonPath,
        personPos:
          document.getElementById("render-person-pos")?.value || "center",
        personScale:
          document.getElementById("render-person-scale")?.value || "0.9",
        bgBlurEnabled:
          document.getElementById("render-bf-blur-enabled")?.checked || false,
        bgBlur: document.getElementById("render-bf-blur")?.value || "20",
        mainScale:
          document.getElementById("render-bf-main-scale")?.value || "0.85",
        mainOpacity:
          document.getElementById("render-bf-main-opacity")?.value || "0.85",
        frameEnabled:
          document.getElementById("render-bf-frame-enabled")?.checked || false,
        framePath: selectedRenderFramePath,
        frameScale:
          document.getElementById("render-bf-frame-scale")?.value || "1",
        effectEnabled:
          document.getElementById("render-bf-effect-enabled")?.checked || false,
        effectPath: selectedRenderEffectPath,
        effectOpacity:
          document.getElementById("render-bf-effect-opacity")?.value || "0.15",
        effectBlend:
          document.getElementById("render-bf-effect-blend")?.value || "normal",
        effectKeyThreshold:
          document.getElementById("render-bf-effect-key-threshold")?.value ||
          "0.15",
        overlayFolder: selectedRenderOverlayFolder,
        backgroundFolder: selectedRenderBackgroundFolder,
        outputFolder: selectedRenderOutputFolder,
        chromaKeyFile: selectedRenderChromaKeyFile,
        cycleDays: document.getElementById("render-cycle-days")?.value || "1",
      },
      // Download settings
      download: {
        urlsFile: selectedUrlsFile,
        outputFolder: selectedDownloadOutputFolder,
        descFolder: selectedDownloadDescFolder,
        overlayImagesFolder: selectedDownloadOverlayImagesFolder,
        thumbsFolder: selectedDownloadThumbsFolder,
        cookiesFile: selectedDownloadCookiesFile,
        cookiesFolder: selectedDownloadCookiesFolder,
        batchSize: document.getElementById("download-batch-size")?.value ?? "30",
        batchBreakSeconds: document.getElementById("download-batch-break")?.value ?? "120",
        maxConcurrent: document.getElementById("download-max-concurrent")?.value || "2",
        proxy: (() => {
          const proxyInput = document.getElementById("download-proxy");
          const proxyValue = proxyInput?.value?.trim();
          // Nếu input field có giá trị, dùng giá trị đó (ưu tiên nhất)
          if (proxyValue) {
            return proxyValue;
          }
          // Nếu input field trống, trả về null (để xóa proxy khỏi config)
          return null;
        })(),
        downloadDrive: selectedDownloadDrive || false,
        driveLanguage: selectedDriveLanguage || "auto",
      },
      // Stock Download (Pexels & Pixabay) settings
      stockDownload: {
        usePexels: document.getElementById("stock-use-pexels")?.checked ?? false,
        usePixabay: document.getElementById("stock-use-pixabay")?.checked ?? false,
        pexelsApiKey: document.getElementById("stock-pexels-api-key")?.value?.trim() || "",
        pixabayApiKey: document.getElementById("stock-pixabay-api-key")?.value?.trim() || "",
        searchQuery: document.getElementById("stock-search-query")?.value?.trim() || "",
        maxVideos: document.getElementById("stock-max-videos")?.value || "30",
        outputFolder: selectedStockOutputFolder || "",
        orientation: document.getElementById("stock-orientation")?.value || "landscape",
        convert720: document.getElementById("stock-convert-720")?.checked ?? true,
        removeAudio: document.getElementById("stock-remove-audio")?.checked ?? true,
        cut: document.getElementById("stock-cut")?.checked ?? false,
        trimSeconds: document.getElementById("stock-trim-seconds")?.value || "3",
      },
      // Video Snow settings
      videoSnow: {
        inputFolder: selectedVideoSnowInputFolder,
        outputFolder: selectedVideoSnowOutputFolder,
        snowFile: selectedVideoSnowSnowFile,
        maxConcurrent:
          document.getElementById("video-snow-max-concurrent")?.value || "3",
        segmentMin:
          document.getElementById("video-snow-segment-min")?.value || "10",
        segmentMax:
          document.getElementById("video-snow-segment-max")?.value || "15",
      },
      // Background Video settings
      bgVideo: {
        count: document.getElementById("bg-count")?.value || "3",
        inputFolder: selectedBgInputFolder,
        outputFolder: selectedBgOutputFolder,
        targetDuration:
          document.getElementById("bg-target-duration")?.value || "3600",
        sourceCount: document.getElementById("bg-source-count")?.value || "10",
        avgClipDuration:
          document.getElementById("bg-avg-clip-duration")?.value || "12",
      },
      // Trim settings
      trim: {
        inputFolder: selectedTrimInputFolder,
        outputFolder: selectedTrimOutputFolder,
        startTime: document.getElementById("trim-start-time")?.value || "0",
        duration: document.getElementById("trim-duration")?.value || "30",
      },
      // Cut BG settings
      cutBg: {
        inputFolder: selectedCutBgInputFolder,
        outputFolder: selectedCutBgOutputFolder,
      },
      // Thumb settings
      thumb: {
        inputFolder: selectedThumbInputFolder,
        overlayFolder: selectedThumbOverlayFolder,
        outputFolder: selectedThumbOutputFolder,
      },
      // Get URL settings
      getUrl: {
        handle: document.getElementById("channel-handle")?.value || "",
        outputFolder: selectedGetUrlOutputFolder,
      },
      // Normalize settings
      normalize: {
        inputFolder: selectedNormalizeInputFolder,
      },
      // Concat settings
      concat: {
        chunkSize: document.getElementById("concat-chunk-size")?.value || "2",
        useThumbs:
          document.getElementById("concat-use-thumbs")?.checked ?? true,
        thumbDuration:
          document.getElementById("concat-thumb-duration")?.value || "3",
        inputFolder: selectedConcatInputFolder,
        thumbsFolder: selectedConcatThumbsFolder,
        outputFolder: selectedConcatOutputFolder,
      },
    };

    await window.electronAPI.saveProjectConfig(projectToSave, settings);
  } catch (error) {
    console.error("Error saving project settings:", error);
  }
}

// Cài đặt yt-dlp DÙNG CHUNG toàn app (ytdlp-settings.json trong thư mục config), KHÔNG
// thuộc dự án nào — nên nạp/lưu riêng, không đi qua luồng lưu project. YouTube đổi cơ chế
// thì người dùng sửa ngay ở đây thay vì phải chờ bản build mới.
async function initYtdlpExtractorArgs() {
  const input = document.getElementById("ytdlp-extractor-args");
  if (!input || !window.electronAPI || !window.electronAPI.ytdlp) return;
  const status = document.getElementById("ytdlp-extractor-args-status");

  try {
    const s = await window.electronAPI.ytdlp.getSettings();
    input.value = s?.extractorArgs ?? "";
  } catch (error) {
    console.error("Không nạp được cài đặt yt-dlp:", error);
  }

  // Lưu khi rời ô: người dùng gõ xong là xong, không cần bấm nút nào.
  input.addEventListener("change", async () => {
    try {
      await window.electronAPI.ytdlp.saveSettings({ extractorArgs: input.value });
      if (status) {
        status.textContent = "✅ đã lưu";
        setTimeout(() => {
          status.textContent = "";
        }, 2000);
      }
    } catch (error) {
      if (status) status.textContent = `❌ lỗi lưu: ${error?.message || error}`;
    }
  });
}

// Tab switching
document.addEventListener("DOMContentLoaded", async () => {
  setupUpdateListeners();

  await loadProjects();
  await loadSettings();
  await initYtdlpExtractorArgs();

  // Tab "Tạo ảnh Veo3": dựng một lần, các lần sau nạp lại cài đặt
  let veo3View = null;
  function openVeo3Image() {
    const root = document.getElementById("veo3-root");
    if (!root || !window.Veo3UI) return;
    if (!veo3View) veo3View = window.Veo3UI.mount(root);
    else veo3View.reload();
  }

  // Tab "Mẻ": dựng một lần khi mở lần đầu, các lần sau nạp lại
  let batchView = null;
  function openBatches() {
    const root = document.getElementById("bt-root");
    if (!root || !window.BatchUI) return;
    if (!batchView) batchView = window.BatchUI.mount(root);
    else batchView.reload();
  }

  // Tab "Thống kê kênh": dựng một lần khi mở lần đầu, các lần sau nạp lại số liệu
  let channelStatsView = null;
  function openChannelStats() {
    const root = document.getElementById("cd-root");
    if (!root || !window.ChannelDashboard) return;
    if (!channelStatsView) channelStatsView = window.ChannelDashboard.mount(root);
    else channelStatsView.reload();
  }
  // Web hoặc app đổi cấu hình/trạng thái kênh: biểu đồ đang mở thì nạp lại ngay (tab ẩn sẽ nạp khi mở)
  window.electronAPI?.sheet?.onChannelsChanged?.(() => { try { channelStatsView?.reload(); } catch { /* ignore */ } });

  // Tab "Nghiên cứu Trend": dựng một lần, các lần sau reload
  let trendView = null;
  function openTrendResearch() {
    const root = document.getElementById("trend-root");
    if (!root || !window.TrendUI) return;
    if (!trendView) trendView = window.TrendUI.mount(root);
    else trendView.reload();
  }

  // ============================================================================
  // PERMISSION-BASED TAB HIDING: ẩn tab/group dựa trên quyền của user
  // ============================================================================
  // latestPermPayload đã khai báo ở module scope (đầu file) để capture listener truy cập được
  let permUnsubscribe = null;   // Unsubscribe từ onChanged

  /**
   * Áp dụng quyền để ẩn/hiện tab và group.
   * @param {object} payload - { enforced: boolean, appFeatures: string[] }
   * @param {{ initial?: boolean }} options - initial=true: startup/login, chuyển sang tab đầu tiên được phép nếu active bị ẩn
   */
  function applyPermissions(payload, options = {}) {
    // CẬP NHẬT PAYLOAD TRƯỚC để capture listener và các guard khác thấy giá trị mới
    latestPermPayload = payload;

    const AppFeatures = window.AppFeatures;
    if (!AppFeatures) return; // Fallback: không có module thì show all

    // Thu thập thông tin tab từ DOM
    const tabButtons = [...document.querySelectorAll(".tab-button[data-tab]")];
    const tabDescriptions = tabButtons.map((btn) => ({
      tabId: btn.getAttribute("data-tab"),
      group: btn.closest(".tab-group[data-group]")?.getAttribute("data-group") || "",
    }));

    // Tính toán ẩn/hiện qua pure function
    const { hiddenTabs, hiddenGroups } = AppFeatures.computeHidden(tabDescriptions, payload);

    // Áp dụng vào DOM: tab buttons và tab content panels
    for (const btn of tabButtons) {
      const tabId = btn.getAttribute("data-tab");
      const isHidden = hiddenTabs.has(tabId);
      btn.classList.toggle("permission-hidden", isHidden);
      btn.toggleAttribute("hidden", isHidden);
      // Accessibility: disabled + aria-hidden + tabindex khi ẩn, gỡ khi hiện (reversible)
      if (isHidden) {
        btn.setAttribute("disabled", "");
        btn.setAttribute("aria-hidden", "true");
        btn.setAttribute("tabindex", "-1");
      } else {
        btn.removeAttribute("disabled");
        btn.removeAttribute("aria-hidden");
        btn.removeAttribute("tabindex");
      }
      // Panel content
      const panel = document.getElementById(tabId);
      if (panel) {
        panel.classList.toggle("permission-hidden", isHidden);
      }
    }

    // Áp dụng vào group headers
    for (const group of document.querySelectorAll(".tab-group[data-group]")) {
      const groupId = group.getAttribute("data-group");
      const isHidden = hiddenGroups.has(groupId);
      group.classList.toggle("permission-hidden", isHidden);
      group.toggleAttribute("hidden", isHidden);
    }

    // Nếu là initial (startup/login) và tab đang active bị ẩn: chuyển sang tab đầu tiên được phép
    // LƯU Ý: latestPermPayload đã được cập nhật TRƯỚC khi tính hiddenTabs, nên firstVisible.click()
    // sẽ được capture listener cho qua (vì tab đó ĐƯỢC PHÉP).
    if (options.initial) {
      const activeBtn = document.querySelector(".tab-button.active");
      const activeTabId = activeBtn?.getAttribute("data-tab");
      if (activeTabId && hiddenTabs.has(activeTabId)) {
        // Tìm tab đầu tiên được phép
        const firstVisible = tabButtons.find((btn) => !hiddenTabs.has(btn.getAttribute("data-tab")));
        if (firstVisible) {
          firstVisible.click(); // Trigger tab switching - capture listener cho qua vì tab này allowed
        }
      }
    }
    // Nếu không phải initial (permissions thay đổi mid-session): không yank user khỏi tab hiện tại
    // Chỉ ẩn buttons/groups, để tab switch tiếp theo đi đến tab được phép
  }

  document.querySelectorAll(".tab-button").forEach((button) => {
    button.addEventListener("click", () => {
      const tabId = button.getAttribute("data-tab");

      // Guard: không cho chuyển sang tab bị ẩn theo permission
      if (window.AppFeatures && latestPermPayload && !window.AppFeatures.isTabAllowed(tabId, latestPermPayload)) {
        return;
      }

      document
        .querySelectorAll(".tab-button")
        .forEach((btn) => btn.classList.remove("active"));
      document
        .querySelectorAll(".tab-content")
        .forEach((content) => content.classList.remove("active"));

      button.classList.add("active");
      const tabEl = document.getElementById(tabId);
      if (tabEl) tabEl.classList.add("active");
      if (tabId === "channel-stats") openChannelStats();
      if (tabId === "batches") openBatches();
      if (tabId === "veo3-image") openVeo3Image();
      if (tabId === "trend-research") openTrendResearch();
    });
  });

  // ============================================================================
  // TREND TAB BADGE: đếm video hot mới từ tất cả profile
  // ============================================================================

  /**
   * Cập nhật badge "số video hot" trên nút tab Nghiên cứu Trend.
   * @param {number} count - Tổng số video hot mới (0 để ẩn)
   */
  function updateTrendBadge(count) {
    const badge = document.getElementById("trend-badge");
    if (!badge) return;
    if (count <= 0) {
      badge.style.display = "none";
      badge.textContent = "0";
    } else {
      badge.style.display = "";
      badge.textContent = count > 99 ? "99+" : String(count);
    }
  }

  /**
   * Tải tổng hotCount từ tất cả profile và cập nhật badge.
   */
  async function refreshTrendBadge() {
    try {
      // Skip nếu user không có quyền xem tab Trend (không cần tải badge)
      if (window.AppFeatures && latestPermPayload && !window.AppFeatures.isTabAllowed("trend-research", latestPermPayload)) {
        return;
      }
      if (!window.electronAPI?.trend?.listProfiles) return;
      const profiles = await window.electronAPI.trend.listProfiles();
      const total = profiles.reduce((sum, p) => sum + (p.hotCount || 0), 0);
      updateTrendBadge(total);
    } catch (err) {
      console.error("refreshTrendBadge error:", err);
    }
  }

  // Khởi tạo badge khi app start (guarded, không throw nếu API chưa sẵn sàng)
  refreshTrendBadge();

  // Lắng nghe scan completion từ scheduler để cập nhật badge
  if (window.electronAPI?.trend?.onScanComplete) {
    window.electronAPI.trend.onScanComplete((data) => {
      if (data.success) {
        // Reload badge từ profiles (tổng hợp từ tất cả profile)
        refreshTrendBadge();
      }
    });
  }

  // Export để trend-ui.js có thể gọi
  window._trendBadge = { update: updateTrendBadge, refresh: refreshTrendBadge };

  // ============================================================================
  // PERMISSIONS STARTUP: Lấy quyền từ main process và áp dụng
  // ============================================================================
  (async function initPermissions() {
    try {
      // Chỉ chạy nếu API sẵn sàng
      if (!window.electronAPI?.permissions?.get) return;

      // Lấy quyền lần đầu
      const payload = await window.electronAPI.permissions.get();
      applyPermissions(payload, { initial: true });

      // Đăng ký lắng nghe thay đổi (chỉ 1 lần)
      if (!permUnsubscribe && window.electronAPI.permissions.onChanged) {
        permUnsubscribe = window.electronAPI.permissions.onChanged((newPayload) => {
          applyPermissions(newPayload, { initial: false });
        });
      }
    } catch (err) {
      // Lỗi → fail open: show all tabs
      console.error("initPermissions error:", err);
    }
  })();

  // Mở tab mặc định khi app khởi động: Thống kê kênh
  openChannelStats();
  // Bỏ focus khỏi input (tránh browser tự focus vào ô đầu tiên như "Video mỗi ngày")
  document.activeElement?.blur?.();

  // Add event listeners to save settings on change
  const inputsToWatch = [
    "render-day",
    "render-videos",
    "render-cycle-days",
    "render-opacity",
    "render-chromakey-color",
    "render-keepcolor-colors",
    "render-keepcolor-height",
    "render-keepcolor-y-offset",
    "render-height",
    "render-y-offset",
    "render-person-pos",
    "render-person-scale",
    "render-max-concurrent",
    "render-gpu-codec",
    "bg-count",
    "bg-target-duration",
    "bg-source-count",
    "bg-avg-clip-duration",
    "channel-handle",
    "video-snow-max-concurrent",
    "video-snow-segment-min",
    "video-snow-segment-max",
    "concat-chunk-size",
    "concat-thumb-duration",
    "trim-start-time",
    "trim-duration",
    "download-proxy", // Thêm proxy input để tự động lưu khi thay đổi
    "download-max-concurrent",
    "render-video-speed",
    "stock-search-query",
    "stock-max-videos",
    "stock-orientation",
    "stock-pexels-api-key",
    "stock-pixabay-api-key",
    "stock-trim-seconds",
  ];

  inputsToWatch.forEach((id) => {
    const element = document.getElementById(id);
    if (element) {
      element.addEventListener("change", saveSettings);
      element.addEventListener("input", saveSettings);
    }
  });

  // Watch checkboxes
  const checkboxesToWatch = [
    "render-use-gpu",
    "render-keepcolor-crop",
    "render-keepcolor-add-dark-layer",
    "concat-use-thumbs",
    "stock-use-pexels",
    "stock-use-pixabay",
    "stock-convert-720",
    "stock-remove-audio",
    "stock-cut",
  ];

  checkboxesToWatch.forEach((id) => {
    const element = document.getElementById(id);
    if (element) {
      element.addEventListener("change", () => {
        saveSettings();
        if (id === "render-keepcolor-crop") toggleKeepColorCrop();
        if (id === "concat-use-thumbs") toggleConcatThumbs();
        if (id === "render-use-gpu") {
          handleGpuToggle();
        }
        if (id === "stock-use-pexels") toggleStockPexels();
        if (id === "stock-use-pixabay") toggleStockPixabay();
        if (id === "stock-cut") toggleStockCut();
      });
    }
  });

  // Watch radio buttons for render mode
  document.querySelectorAll('input[name="render-mode"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      saveSettings();
      toggleRenderMode();
    });
  });

  // Watch radio buttons for chromakey mode
  document.querySelectorAll('input[name="chromakey-mode"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      saveSettings();
      toggleChromaKeyMode();
    });
  });
});

// Helper function to show output
function showOutput(tabId, message) {
  const outputDiv = document.getElementById(`${tabId}-output`);
  if (outputDiv) {
    outputDiv.style.display = "block";
    outputDiv.textContent += message;
    outputDiv.scrollTop = outputDiv.scrollHeight;
  }
}

function clearOutput(tabId) {
  const outputDiv = document.getElementById(`${tabId}-output`);
  if (outputDiv) {
    outputDiv.textContent = "";
    outputDiv.style.display = "none";
  }
}

// Render Video - Selected folders
let selectedRenderOverlayFolder = null;
let selectedRenderBackgroundFolder = null;
let selectedRenderOutputFolder = null;
let selectedRenderChromaKeyFile = null;
let selectedRenderFramePath = null;
let selectedRenderEffectPath = null;
let selectedRenderPersonPath = null;
let selectedRenderDualFrameBgPath = null;
let selectedRenderDualFrameFramePath = null;

// Toggle functions for render options
// Segmented control: tick radio tương ứng rồi chạy logic hiện/ẩn cũ.
function selectRenderMode(mode) {
  const radio = document.querySelector(
    `input[name="render-mode"][value="${mode}"]`
  );
  if (radio) radio.checked = true;

  document
    .querySelectorAll("#render-mode-segmented .segmented-btn")
    .forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-mode") === mode);
    });

  toggleRenderMode();
}

function toggleRenderMode() {
  const mode =
    document.querySelector('input[name="render-mode"]:checked')?.value ||
    "topTransparent";

  // Đồng bộ nút segmented khi mode đổi từ nơi khác (ví dụ load config dự án).
  document
    .querySelectorAll("#render-mode-segmented .segmented-btn")
    .forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-mode") === mode);
    });

  // Hide all option groups
  document.getElementById("render-opacity-group").style.display = "none";
  document.getElementById("render-chromakey-group").style.display = "none";
  document.getElementById("render-crop-group").style.display = "none";
  document.getElementById("render-keepcolor-group").style.display = "none";
  document.getElementById("render-blurframe-group").style.display = "none";
  document.getElementById("render-dualframe-group").style.display = "none";

  // Show relevant option group based on mode
  if (mode === "topTransparent") {
    document.getElementById("render-opacity-group").style.display = "block";
  } else if (mode === "chromaKey") {
    document.getElementById("render-chromakey-group").style.display = "block";
  } else if (mode === "crop") {
    document.getElementById("render-crop-group").style.display = "block";
  } else if (mode === "keepColor") {
    document.getElementById("render-keepcolor-group").style.display = "block";
    toggleKeepColorCrop();
  } else if (mode === "blurFrame") {
    document.getElementById("render-blurframe-group").style.display = "block";
    toggleBlurFrameLayers();
  } else if (mode === "dualFrame") {
    document.getElementById("render-dualframe-group").style.display = "block";
    toggleDualFrameLayers();
  }
}

// Công tắc khung viền: tắt chỉ ẩn tham số, không xoá đường dẫn đã chọn.
function toggleDualFrameLayers() {
  const on = document.getElementById("render-df-frame-enabled")?.checked || false;
  const group = document.getElementById("render-df-frame-group");
  if (group) group.style.display = on ? "block" : "none";
}

// 3 công tắc của mode Nền mờ + Khung: tắt chỉ ẩn tham số, không xoá đường dẫn
// đã chọn, nên bỏ tick rồi tick lại là chạy tiếp được ngay.
function toggleBlurFrameLayers() {
  const show = (checkboxId, groupId) => {
    const on = document.getElementById(checkboxId)?.checked || false;
    const group = document.getElementById(groupId);
    if (group) group.style.display = on ? "block" : "none";
  };
  show("render-bf-blur-enabled", "render-bf-blur-group");
  show("render-bf-frame-enabled", "render-bf-frame-group");
  show("render-bf-effect-enabled", "render-bf-effect-group");
  // Ngưỡng chỉ có nghĩa với cách ghép khử nền tối
  const keyGroup = document.getElementById("render-bf-effect-key-group");
  if (keyGroup) {
    const blend = document.getElementById("render-bf-effect-blend")?.value;
    keyGroup.style.display = blend === "lumakey" ? "block" : "none";
  }
}

function toggleChromaKeyMode() {
  const mode =
    document.querySelector('input[name="chromakey-mode"]:checked')?.value ||
    "color";
  document.getElementById("chromakey-color-input").style.display =
    mode === "color" ? "block" : "none";
  document.getElementById("chromakey-file-input").style.display =
    mode === "file" ? "block" : "none";
}

function toggleKeepColorCrop() {
  const checked =
    document.getElementById("render-keepcolor-crop")?.checked || false;
  document.getElementById("render-keepcolor-crop-group").style.display = checked
    ? "block"
    : "none";
}

async function selectRenderChromaKeyFile() {
  if (!checkElectronAPI()) return;
  try {
    const filePath = await window.electronAPI.selectFile({
      filters: [
        { name: "Text Files", extensions: ["txt"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });
    if (filePath) {
      selectedRenderChromaKeyFile = filePath;
      document.getElementById("render-chromakey-file").value = filePath;
      saveSettings();
    }
  } catch (error) {
    console.error("Error selecting file:", error);
    alert("Lỗi khi chọn file: " + error.message);
  }
}

function clearRenderChromaKeyFile() {
  selectedRenderChromaKeyFile = null;
  const input = document.getElementById("render-chromakey-file");
  if (input) input.value = "";
  saveSettings();
}

// ===== Nền mờ + Khung: chọn ảnh khung và video hiệu ứng =====
// Cả hai đều nhận file lẻ hoặc thư mục: trỏ vào thư mục thì mỗi video render ra
// sẽ bốc ngẫu nhiên một file trong đó.
async function selectRenderFrameFile() {
  if (!checkElectronAPI()) return;
  try {
    const filePath = await window.electronAPI.selectFile({
      filters: [
        { name: "Ảnh khung", extensions: ["png", "webp"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });
    if (filePath) setRenderFramePath(filePath);
  } catch (error) {
    console.error("Error selecting frame file:", error);
    alert("Lỗi khi chọn ảnh khung: " + error.message);
  }
}

async function selectRenderFrameFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) setRenderFramePath(folder);
}

function setRenderFramePath(value) {
  selectedRenderFramePath = value;
  const input = document.getElementById("render-bf-frame-path");
  if (input) input.value = value;
  saveSettings();
}

function clearRenderFramePath() {
  selectedRenderFramePath = null;
  const input = document.getElementById("render-bf-frame-path");
  if (input) input.value = "";
  saveSettings();
}

// ===== Khung đôi (dualFrame): ảnh/video nền và ảnh khung viền =====
// Cả hai đều nhận file lẻ hoặc thư mục: trỏ vào thư mục thì mỗi video render ra
// sẽ bốc ngẫu nhiên một file trong đó.
async function selectRenderDualFrameBgFile() {
  if (!checkElectronAPI()) return;
  try {
    const filePath = await window.electronAPI.selectFile({
      filters: [
        // Nền nhận cả ảnh tĩnh lẫn video — render-core tự nạp theo đuôi file (isVideoAsset).
        { name: "Ảnh/video nền", extensions: ["png", "webp", "mp4", "mov", "webm", "mkv"] },
        { name: "Ảnh", extensions: ["png", "webp"] },
        { name: "Video", extensions: ["mp4", "mov", "webm", "mkv"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });
    if (filePath) setRenderDualFrameBgPath(filePath);
  } catch (error) {
    console.error("Error selecting dualFrame bg file:", error);
    alert("Lỗi khi chọn ảnh/video nền: " + error.message);
  }
}

async function selectRenderDualFrameBgFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) setRenderDualFrameBgPath(folder);
}

function setRenderDualFrameBgPath(value) {
  selectedRenderDualFrameBgPath = value;
  const input = document.getElementById("render-df-bg-path");
  if (input) input.value = value;
  saveSettings();
}

function clearRenderDualFrameBgPath() {
  selectedRenderDualFrameBgPath = null;
  const input = document.getElementById("render-df-bg-path");
  if (input) input.value = "";
  saveSettings();
}

async function selectRenderDualFrameFrameFile() {
  if (!checkElectronAPI()) return;
  try {
    const filePath = await window.electronAPI.selectFile({
      filters: [
        { name: "Ảnh khung viền", extensions: ["png", "webp"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });
    if (filePath) setRenderDualFrameFramePath(filePath);
  } catch (error) {
    console.error("Error selecting dualFrame frame file:", error);
    alert("Lỗi khi chọn ảnh khung viền: " + error.message);
  }
}

async function selectRenderDualFrameFrameFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) setRenderDualFrameFramePath(folder);
}

function setRenderDualFrameFramePath(value) {
  selectedRenderDualFrameFramePath = value;
  const input = document.getElementById("render-df-frame-path");
  if (input) input.value = value;
  saveSettings();
}

function clearRenderDualFrameFramePath() {
  selectedRenderDualFrameFramePath = null;
  const input = document.getElementById("render-df-frame-path");
  if (input) input.value = "";
  saveSettings();
}

// Ảnh người của mode crop: trỏ vào file thì dùng đúng ảnh đó, trỏ vào thư mục
// thì mỗi video bốc ngẫu nhiên một ảnh trong đó.
async function selectPersonFile() {
  if (!checkElectronAPI()) return;
  try {
    const filePath = await window.electronAPI.selectFile({
      filters: [
        { name: "Ảnh người", extensions: ["png", "webp"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });
    if (filePath) setPersonPath(filePath);
  } catch (error) {
    console.error("Error selecting person image:", error);
    alert("Lỗi khi chọn ảnh người: " + error.message);
  }
}

async function selectPersonFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) setPersonPath(folder);
}

function setPersonPath(value) {
  selectedRenderPersonPath = value;
  const input = document.getElementById("render-person-path");
  if (input) input.value = value;
  saveSettings();
}

function clearPersonPath() {
  selectedRenderPersonPath = null;
  const input = document.getElementById("render-person-path");
  if (input) input.value = "";
  saveSettings();
}

// Chỉ đổi hiển thị, KHÔNG lưu — lúc khôi phục cấu hình cũng gọi hàm này, lưu ở
// đó là ghi đè settings bằng giá trị chưa nạp xong.
function updatePersonGroupVisibility() {
  const on = document.getElementById("render-person-enabled")?.checked;
  const group = document.getElementById("render-person-group");
  if (group) group.style.display = on ? "block" : "none";
}

function togglePersonGroup() {
  updatePersonGroupVisibility();
  saveSettings();
}

async function selectRenderEffectFile() {
  if (!checkElectronAPI()) return;
  try {
    const filePath = await window.electronAPI.selectFile({
      filters: [
        { name: "Video hiệu ứng", extensions: ["mp4", "mov", "webm", "mkv"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });
    if (filePath) setRenderEffectPath(filePath);
  } catch (error) {
    console.error("Error selecting effect file:", error);
    alert("Lỗi khi chọn video hiệu ứng: " + error.message);
  }
}

async function selectRenderEffectFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) setRenderEffectPath(folder);
}

function setRenderEffectPath(value) {
  selectedRenderEffectPath = value;
  const input = document.getElementById("render-bf-effect-path");
  if (input) input.value = value;
  saveSettings();
}

function clearRenderEffectPath() {
  selectedRenderEffectPath = null;
  const input = document.getElementById("render-bf-effect-path");
  if (input) input.value = "";
  saveSettings();
}

// Tự động lấy màu chroma key từ video (dùng get-video-chroma.js)
async function autoDetectChromaKeyFromVideos() {
  console.log("🔵 [autoDetectChromaKeyFromVideos] Bắt đầu...");
  
  if (!checkElectronAPI()) {
    console.error("❌ [autoDetectChromaKeyFromVideos] Electron API không khả dụng");
    alert("❌ Electron API không khả dụng. Vui lòng khởi động lại ứng dụng.");
    return;
  }
  
  console.log("✅ [autoDetectChromaKeyFromVideos] Electron API OK");

  // Lấy video từ Folder Overlay (video đầu vào)
  const inputFolder =
    selectedRenderOverlayFolder ||
    document.getElementById("render-overlay-folder")?.value ||
    "./overlays";
  
  console.log("📁 [autoDetectChromaKeyFromVideos] Input folder:", inputFolder);

  // File chromaKey target: ưu tiên file đã chọn, nếu không có thì dùng ./chromaKey.txt
  const chromaKeyFile =
    selectedRenderChromaKeyFile ||
    document.getElementById("render-chromakey-file")?.value ||
    "./chromaKey.txt";
  
  console.log("📄 [autoDetectChromaKeyFromVideos] ChromaKey file:", chromaKeyFile);

  // Lấy các màu (nếu có) từ input, dạng "RRGGBB,RRGGBB,..."
  const paletteInput = document
    .getElementById("render-chromakey-palette")
    ?.value.trim();

  let paletteArg = null;
  if (paletteInput) {
    const parts = paletteInput
      .split(",")
      .map((p) => p.trim().replace("#", "").toUpperCase())
      .filter((p) => /^[0-9A-F]{6}$/.test(p));

    if (parts.length > 0) {
      paletteArg = parts.join(",");
    } else {
      alert(
        "Danh sách màu không hợp lệ. Vui lòng nhập mã hex hợp lệ, cách nhau bởi dấu phẩy (ví dụ: 22BDD6,2B4052,7FBFDE,7097B8).",
      );
      return;
    }
  }

  if (!inputFolder) {
    console.error("❌ [autoDetectChromaKeyFromVideos] Thiếu input folder");
    return;
  }

  if (!chromaKeyFile) {
    console.error("❌ [autoDetectChromaKeyFromVideos] Thiếu chromaKey file");
    return;
  }
  
  console.log("✅ [autoDetectChromaKeyFromVideos] Validation OK, bắt đầu chạy script...");

  // Hiển thị output tab và thông báo bắt đầu
  const outputDiv = document.getElementById("render-output");
  if (outputDiv) {
    outputDiv.style.display = "block";
  }

  clearOutput("render");
  showOutput(
    "render",
    `🎨 Bắt đầu tự động lấy màu chroma key...\n`,
  );
  showOutput(
    "render",
    `📁 Folder video: ${inputFolder}\n`,
  );
  showOutput(
    "render",
    `📄 File output: ${chromaKeyFile}\n`,
  );
  if (paletteArg) {
    showOutput(
      "render",
      `🎨 Palette: ${paletteArg}\n`,
    );
  }
  showOutput(
    "render",
    `\n⏳ Đang xử lý...\n\n`,
  );

  try {
    window.electronAPI.removeScriptOutputListener();
    window.electronAPI.onScriptOutput((data) => {
      showOutput("render", data);
    });

    const args = [inputFolder, chromaKeyFile];
    if (paletteArg) {
      args.push(paletteArg);
    }
    
    console.log("🚀 [autoDetectChromaKeyFromVideos] Gọi script với args:", args);

    await window.electronAPI.runScript(
      "get-video-chroma.js",
      args,
      {},
    );
    
    console.log("✅ [autoDetectChromaKeyFromVideos] Script chạy xong");

    // Thông báo thành công rõ ràng
    showOutput(
      "render",
      `\n\n✅ ✅ ✅ HOÀN THÀNH! ✅ ✅ ✅\n`,
    );
    showOutput(
      "render",
      `✅ Đã lấy màu thành công và ghi vào file: ${chromaKeyFile}\n`,
    );
    showOutput(
      "render",
      `✅ Bạn có thể kiểm tra file để xem kết quả.\n`,
    );
  } catch (error) {
    const errorMsg = getErrorMessage(error);
    showOutput("render", `\n\n❌ ❌ ❌ LỖI! ❌ ❌ ❌\n`);
    showOutput("render", `❌ ${errorMsg}\n`);
    alert(`❌ Lỗi khi lấy màu:\n\n${errorMsg}`);
  }
}

async function selectRenderOverlayFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedRenderOverlayFolder = folder;
    document.getElementById("render-overlay-folder").value = folder;
    // Removed folder path display
    saveSettings();
  }
}

function clearRenderOverlayFolder() {
  selectedRenderOverlayFolder = null;
  const input = document.getElementById("render-overlay-folder");
  if (input) input.value = "";
  saveSettings();
}

async function selectRenderBackgroundFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedRenderBackgroundFolder = folder;
    document.getElementById("render-background-folder").value = folder;
    // Removed folder path display
    saveSettings();
  }
}

function clearRenderBackgroundFolder() {
  selectedRenderBackgroundFolder = null;
  const input = document.getElementById("render-background-folder");
  if (input) input.value = "";
  saveSettings();
}

async function selectRenderOutputFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedRenderOutputFolder = folder;
    document.getElementById("render-output-folder").value = folder;
    // Removed folder path display
    saveSettings();
  }
}

function clearRenderOutputFolder() {
  selectedRenderOutputFolder = null;
  const input = document.getElementById("render-output-folder");
  if (input) input.value = "";
  saveSettings();
}

async function runRenderCore(folderOverride) {
  const day = document.getElementById("render-day").value;
  const videos = document.getElementById("render-videos").value;
  const videoSpeed = document.getElementById("render-video-speed").value;
  const renderMode =
    document.querySelector('input[name="render-mode"]:checked')?.value ||
    "topTransparent";
  const useGPU = document.getElementById("render-use-gpu").checked;
  const maxConcurrentProcesses =
    parseInt(document.getElementById("render-max-concurrent").value) || 2;
  
  // Tự động phát hiện GPU codec nếu useGPU được bật nhưng chưa có codec
  let gpuVideoCodec = document.getElementById("render-gpu-codec").value;
  if (useGPU && !gpuVideoCodec) {
    if (checkElectronAPI() && window.electronAPI) {
      try {
        const result = await window.electronAPI.detectGpuCodec();
        if (result.success && result.codec) {
          gpuVideoCodec = result.codec;
          document.getElementById("render-gpu-codec").value = gpuVideoCodec;
        } else {
          alert("⚠️ Không phát hiện GPU encoder nào. Vui lòng kiểm tra driver GPU.");
          window.__renderOutcome = { ok: false, message: "Không phát hiện GPU encoder" };
          return;
        }
      } catch (error) {
        console.error("Lỗi khi phát hiện GPU codec:", error);
        gpuVideoCodec = "h264_nvenc"; // Fallback
      }
    } else {
      gpuVideoCodec = "h264_nvenc"; // Fallback
    }
  } else if (!useGPU) {
    gpuVideoCodec = "h264_nvenc"; // Giá trị mặc định, không được sử dụng
  }

  const opacity =
    parseFloat(document.getElementById("render-opacity").value) || 0.7;
  const height =
    parseInt(document.getElementById("render-height").value) || 220;
  const y_offset =
    parseInt(document.getElementById("render-y-offset").value) || 490;
  const personEnabled =
    document.getElementById("render-person-enabled")?.checked || false;
  const personPath = selectedRenderPersonPath || "";
  const personPos =
    document.getElementById("render-person-pos")?.value || "center";
  const personScale =
    parseFloat(document.getElementById("render-person-scale")?.value) || 0.9;

  // Nền mờ + Khung config
  const bgBlurEnabled = document.getElementById("render-bf-blur-enabled").checked;
  const bgBlur =
    parseFloat(document.getElementById("render-bf-blur").value) || 20;
  const mainScale =
    parseFloat(document.getElementById("render-bf-main-scale").value) || 0.85;
  const mainOpacity =
    parseFloat(document.getElementById("render-bf-main-opacity").value) || 0.85;
  const frameEnabled = document.getElementById(
    "render-bf-frame-enabled",
  ).checked;
  const framePath = selectedRenderFramePath || "";
  const frameScale =
    parseFloat(document.getElementById("render-bf-frame-scale").value) || 1;
  const effectEnabled = document.getElementById(
    "render-bf-effect-enabled",
  ).checked;
  const effectPath = selectedRenderEffectPath || "";
  const effectOpacity =
    parseFloat(document.getElementById("render-bf-effect-opacity").value) || 0.15;
  const effectBlend =
    document.getElementById("render-bf-effect-blend").value || "normal";
  const effectKeyThreshold =
    parseFloat(
      document.getElementById("render-bf-effect-key-threshold").value,
    ) || 0.15;

  // Khung đôi (dualFrame) config
  const dualFrameBgPath = selectedRenderDualFrameBgPath || "";
  const dualFrameMainX =
    parseInt(document.getElementById("render-df-main-x")?.value) || 40;
  const dualFrameMainY =
    parseInt(document.getElementById("render-df-main-y")?.value) || 40;
  const dualFrameMainWidth =
    parseInt(document.getElementById("render-df-main-width")?.value) || 960;
  const dualFrameMainHeight =
    parseInt(document.getElementById("render-df-main-height")?.value) || 560;
  const dualFrameMainOpacity =
    parseFloat(document.getElementById("render-df-main-opacity")?.value) || 1;
  const dualFrameSmallX =
    parseInt(document.getElementById("render-df-small-x")?.value) || 1000;
  const dualFrameSmallY =
    parseInt(document.getElementById("render-df-small-y")?.value) || 520;
  const dualFrameSmallWidth =
    parseInt(document.getElementById("render-df-small-width")?.value) || 240;
  const dualFrameSmallHeight =
    parseInt(document.getElementById("render-df-small-height")?.value) || 160;
  const dualFrameSmallOpacity =
    parseFloat(document.getElementById("render-df-small-opacity")?.value) || 1;
  const dualFrameSmallRadius =
    parseInt(document.getElementById("render-df-small-radius")?.value) || 0;
  const dualFrameFrameEnabled =
    document.getElementById("render-df-frame-enabled")?.checked || false;
  const dualFrameFramePath = selectedRenderDualFrameFramePath || "";
  const dualFrameFrameScale =
    parseFloat(document.getElementById("render-df-frame-scale")?.value) || 1;

  // Chroma Key config
  let chromaKeyMode = "color";
  let chromaKeyColor = null;
  let chromaKeyFile = null;
  if (renderMode === "chromaKey") {
    chromaKeyMode =
      document.querySelector('input[name="chromakey-mode"]:checked')?.value ||
      "color";
    if (chromaKeyMode === "color") {
      chromaKeyColor =
        document
          .getElementById("render-chromakey-color")
          .value.trim()
          .toUpperCase() || "D4F9D7";
    } else {
      chromaKeyFile = selectedRenderChromaKeyFile;
    }
  }

  const chromaKeySimilarity =
    parseFloat(document.getElementById("render-chromakey-similarity")?.value) ||
    0.3;

  // Keep Color config
  let keepColorColors = null;
  let keepColorCrop = false;
  let keepColorHeight = 220;
  let keepColorYOffset = 490;
  let keepColorAddDarkLayer = false;
  if (renderMode === "keepColor") {
    const colorsInput = document
      .getElementById("render-keepcolor-colors")
      .value.trim()
      .toUpperCase();
    if (colorsInput) {
      keepColorColors = colorsInput
        .split(",")
        .map((c) => c.trim())
        .filter((c) => /^[0-9A-F]{6}$/.test(c));
    }
    keepColorCrop = document.getElementById("render-keepcolor-crop").checked;
    if (keepColorCrop) {
      keepColorHeight =
        parseInt(document.getElementById("render-keepcolor-height").value) ||
        220;
      keepColorYOffset =
        parseInt(document.getElementById("render-keepcolor-y-offset").value) ||
        490;
      keepColorAddDarkLayer = document.getElementById("render-keepcolor-add-dark-layer").checked || false;
    }
  }

  if (!day || !videos) {
    alert("Vui lòng nhập đầy đủ thông tin!");
    window.__renderOutcome = { ok: false, message: "Chưa nhập số ngày hoặc số video" };
    return;
  }

  if (!checkElectronAPI()) return;

  clearOutput("render");
  showOutput(
    "render",
    `🚀 Đang chạy Render Video với ngày=${day}, videos=${videos}...\n\n`,
  );

  try {
    window.electronAPI.removeScriptOutputListener();
    window.electronAPI.onScriptOutput((data) => {
      showOutput("render", data);
    });

    const options = {
      batchName: window.__pipelineBatchName || (typeof rbSelectedId === "function" && rbSelectedId() ? (document.getElementById("render-batch-select")?.selectedOptions[0]?.textContent || "") : ""),
      // Không dùng fileMapping cho render vì render.js sẽ đọc path trực tiếp từ config
      renderConfig: {
        renderMode,
        chromaKeyMode,
        chromaKeyColor,
        chromaKeySimilarity,
        chromaKeyFile,
        keepColorColors,
        keepColorCrop,
        keepColorHeight,
        keepColorYOffset,
        keepColorAddDarkLayer,
        useGPU,
        maxConcurrentProcesses,
        gpuVideoCodec,
        opacity,
        height,
        y_offset,
        personEnabled,
        personPath,
        personPos,
        personScale,
        bgBlurEnabled,
        bgBlur,
        mainScale,
        mainOpacity,
        frameEnabled,
        framePath,
        frameScale,
        effectEnabled,
        effectPath,
        effectOpacity,
        effectBlend,
        effectKeyThreshold,
        dualFrameBgPath,
        dualFrameMainX,
        dualFrameMainY,
        dualFrameMainWidth,
        dualFrameMainHeight,
        dualFrameMainOpacity,
        dualFrameSmallX,
        dualFrameSmallY,
        dualFrameSmallWidth,
        dualFrameSmallHeight,
        dualFrameSmallOpacity,
        dualFrameSmallRadius,
        dualFrameFrameEnabled,
        dualFrameFramePath,
        dualFrameFrameScale,
        // Sử dụng path trực tiếp từ GUI, không copy
        overlayFolder: (folderOverride && folderOverride.overlayFolder) || selectedRenderOverlayFolder || "./overlays",
        backgroundFolder: (folderOverride && folderOverride.backgroundFolder) || selectedRenderBackgroundFolder || "./backgrounds",
        outputFolder: (folderOverride && folderOverride.outputFolder) || selectedRenderOutputFolder || "./done",
        videoSpeed,
      },
    };

    await window.electronAPI.runScript("render.js", [day, videos], options);
    showOutput("render", "\n\n✅ Hoàn thành!");
    window.__renderOutcome = { ok: true, message: "Render xong" };
    const proj = currentProjectName || "default";
    try { await markSelectedBatchRendered(); } catch { /* không để việc báo mẻ làm hỏng render */ }
    if (window.electronAPI.setProjectLastRender) {
      await window.electronAPI.setProjectLastRender(proj);
    }
  } catch (error) {
    showOutput("render", `\n\n❌ Lỗi: ${getErrorMessage(error)}\n`);
    window.__renderOutcome = { ok: false, message: getErrorMessage(error) };
  }
}

// runRender: nút "Chạy Render" như cũ. runRenderForBatch: cho pipeline của mẻ, trả { ok, message } thay vì chỉ ghi ra màn hình.
// Kết quả do runRenderCore ghi vào window.__renderOutcome ở mọi điểm kết thúc; không có dấu nào nghĩa là thoát sớm ngoài dự kiến
// (coi là LỖI, không coi là thành công).
async function runRender() { await runRenderCore(); }
async function runRenderForBatch(folderOverride) {
  window.__renderOutcome = null;
  try { await runRenderCore(folderOverride); } catch (e) { return { ok: false, message: getErrorMessage(e) }; }
  const r = window.__renderOutcome; window.__renderOutcome = null;
  return r && typeof r === "object" ? r : { ok: false, message: "Render dừng sớm (không có kết quả)" };
}

// ============ Hành động của mẻ: mỗi hành động chạy ĐỘC LẬP, có cài đặt riêng ============
// Không nối liền nhau vì giữa các bước người dùng phải upload video bằng tay. Mỗi hành động trả { ok, message } (hoặc { ok:false, canceled:true }).
// Việc báo trạng thái lên server/web do batch-ui.js làm quanh mỗi lần chạy.
function batchDefaultsFromMachine() {
  const v = (id) => (document.getElementById(id)?.value || "").trim();
  return { overlayFolder: selectedRenderOverlayFolder || "", backgroundFolder: selectedRenderBackgroundFolder || "", outputFolder: selectedRenderOutputFolder || "",
    thumbFolder: v("automation-thumb-folder"), numVideos: v("automation-thumb-num"), numDays: v("automation-sch-days"), postTimes: v("automation-sch-times") };
}
async function pickBatchFolder() {
  if (!checkElectronAPI()) return "";
  try { return (await window.electronAPI.selectFolder()) || ""; } catch { return ""; }
}
// Render: áp cấu hình dùng chung + NGÀY HIỆN TẠI của mẻ vào tab Render, dùng thư mục nguồn/nền/đích của mẻ, chạy như bấm tay; xong thì báo server tăng ngày.
async function runBatchRenderAction(batch, settings) {
  const api = window.electronAPI && window.electronAPI.sheet;
  if (!api || !api.batchesApplyRender) return { ok: false, message: "Phiên bản app không hỗ trợ" };
  try {
    await saveSettings(); // giữ những gì đang nhập trước khi ghi đè phần dùng chung
    const a = await api.batchesApplyRender(batch.id, rbProject());
    if (!a || !a.ok) return { ok: false, message: (a && a.error) || "Không lấy được cấu hình của mẻ" };
    await loadSettings();
  } catch (e) { return { ok: false, message: getErrorMessage(e) }; }
  const day = parseInt(document.getElementById("render-day")?.value, 10) || 1;
  // thư mục đích thật sự được dùng: của mẻ nếu có, không thì thư mục đang chọn ở tab Render
  const outFolder = (settings && settings.outputFolder) || selectedRenderOutputFolder || "";
  const countOut = async () => { try { const c = outFolder ? await api.batchesCountVideos(outFolder) : null; return c && c.ok ? { count: c.count, newest: c.newest } : null; } catch { return null; } };
  const before = await countOut();
  window.__pipelineBatchName = batch.name;
  let r;
  try { r = await runRenderForBatch(settings || {}); } finally { window.__pipelineBatchName = ""; }
  r = window.BatchActions.judgeRender(r, before, await countOut()); // ngày của mẻ chỉ tăng khi thật sự có video mới
  if (r && r.ok) {
    let m = null;
    try { m = await api.batchesMarkRendered(batch.id, day); } catch { /* báo ở dưới */ }
    if (!m || !m.ok) return { ok: true, message: "Render xong ngày " + day + " (chưa ghi được ngày lên server)", day };
    const nb = m.batch;
    return { ok: true, day, message: nb && nb.currentDay ? "Xong ngày " + day + ", lần tới ngày " + nb.currentDay + (nb.roundNo > (batch.roundNo || 1) ? " (sang vòng " + nb.roundNo + ")" : "") : "Render xong ngày " + day };
  }
  return r || { ok: false, message: "Render không có kết quả" };
}
// Thay thumbnail / Lên lịch: chạy trên các kênh của mẻ (theo GPM Profile ID), dùng đúng hàm của tab Tự động hóa.
// selectedChannels: mảng gpmProfileId muốn chạy; null/undefined = chạy tất cả kênh trong mẻ.
async function runBatchAutomationAction(kind, batch, settings, selectedChannels) {
  const api = window.electronAPI && window.electronAPI.automation;
  if (!api) return { ok: false, message: "Phiên bản app không hỗ trợ" };
  if (automationRunning) return { ok: false, message: "Tab Tự động hóa đang chạy việc khác, đợi xong rồi chạy lại" };
  const allChannels = (batch.channels || []).filter((c) => c && c.gpmProfileId);
  const selected = Array.isArray(selectedChannels) && selectedChannels.length > 0
    ? allChannels.filter((c) => selectedChannels.includes(c.gpmProfileId))
    : allChannels;
  const profiles = selected.map((c) => ({ id: c.gpmProfileId, name: c.name || c.gpmProfileId, label: c.name || c.gpmProfileId }));
  if (!profiles.length) return { ok: false, message: Array.isArray(selectedChannels) && selectedChannels.length > 0 ? "Chưa chọn kênh nào" : "Mẻ chưa có kênh nào" };
  const base = { gpmHost: autoHost(), profiles, concurrency: parseInt(autoVal("automation-concurrency"), 10) || 1 };
  const opts = kind === "thumb"
    ? { ...base, thumbFolder: settings.thumbFolder, numVideos: settings.numVideos || "8", thumbFolders: {} }
    : { ...base, numDays: settings.numDays || "3", startDate: settings.startDate || undefined, postTimes: settings.postTimes };
  clearAutomationOutput();
  api.removeLogListener();
  api.onLog((payload) => showAutomationOutput(typeof payload === "string" ? payload : payload.msg));
  setAutomationRunning(true);
  showAutomationOutput("🚀 Mẻ “" + batch.name + "” · " + (kind === "thumb" ? "Thay thumbnail" : "Lên lịch") + "\n");
  try {
    const r = await (kind === "thumb" ? api.changeThumb({ ...opts, batchName: batch.name }) : api.schedule({ ...opts, batchName: batch.name }));
    showAutomationOutput(r && r.success ? "\n✅ " + (r.message || "Hoàn tất") : "\n❌ " + ((r && r.error) || "Có lỗi xảy ra"));
    return window.BatchActions.resultFromAutomation(r);
  } catch (e) {
    showAutomationOutput("\n❌ " + getErrorMessage(e));
    return { ok: false, message: getErrorMessage(e) };
  } finally { setAutomationRunning(false); }
}

// Cho batch-ui.js (script riêng) gọi được các hàm của renderer.js
window.runBatchRenderAction = runBatchRenderAction;
window.runBatchAutomationAction = runBatchAutomationAction;
window.__batchMachineDefaults = batchDefaultsFromMachine;
window.__batchPickFolder = pickBatchFolder;

// ============ Mẻ ở tab Render ============
// Mẻ gắn với cấu hình render: lấy/lưu phần DÙNG CHUNG (kiểu render, độ mờ, tốc độ, số ngày...). Đường dẫn, GPU, khóa API, proxy
// luôn ở lại máy này. Chọn mẻ được nhớ theo từng dự án của app (localStorage), không lưu lên server.
const RB_KEY = "render_batch_by_project";
const rbProject = () => currentProjectName || "default";
function rbRemembered() { try { return JSON.parse(localStorage.getItem(RB_KEY) || "{}")[rbProject()] || ""; } catch { return ""; } }
function rbRemember(id) { try { const m = JSON.parse(localStorage.getItem(RB_KEY) || "{}"); if (id) m[rbProject()] = String(id); else delete m[rbProject()]; localStorage.setItem(RB_KEY, JSON.stringify(m)); } catch { /* không quan trọng */ } }
const rbSelectedId = () => { const v = document.getElementById("render-batch-select")?.value; return v ? Number(v) : null; };
function rbHint(text, kind) { const h = document.getElementById("render-batch-hint"); if (!h) return; h.textContent = text; h.className = "rb-hint" + (kind ? " " + kind : ""); }
function rbSyncButtons() { const on = !!rbSelectedId(); for (const id of ["render-batch-load", "render-batch-save"]) { const b = document.getElementById(id); if (b) b.disabled = !on; } }

async function loadRenderBatches() {
  const sel = document.getElementById("render-batch-select"); if (!sel) return;
  const api = window.electronAPI?.sheet; if (!api?.batchesList) return;
  const r = await api.batchesList().catch((e) => ({ ok: false, error: e.message }));
  const keep = rbRemembered();
  sel.replaceChildren(new Option("— Không gắn mẻ —", ""));
  if (r && r.ok) for (const b of r.batches || []) sel.append(new Option(b.name, String(b.id)));
  else rbHint((r && r.error) || "Chưa tải được danh sách mẻ.", "err");
  sel.value = [...sel.options].some((o) => o.value === keep) ? keep : "";
  rbSyncButtons();
}
async function markSelectedBatchRendered() {
  const id = rbSelectedId(); if (!id) return;
  if (window.__pipelineBatchName) return; // pipeline của mẻ tự đánh dấu, tránh tăng ngày hai lần
  const day = parseInt(document.getElementById("render-day")?.value, 10);
  await window.electronAPI.sheet.batchesMarkRendered(id, Number.isFinite(day) ? day : undefined);
}
function bindRenderBatch() {
  const sel = document.getElementById("render-batch-select"); if (!sel || sel.dataset.bound) return; sel.dataset.bound = "1";
  sel.addEventListener("change", () => { rbRemember(sel.value); rbSyncButtons(); rbHint(sel.value ? "Đã gắn mẻ. Render xong, web sẽ ghi nhận mẻ này vừa render." : "Không gắn mẻ.", ""); });
  document.getElementById("render-batch-load")?.addEventListener("click", async (ev) => {
    const id = rbSelectedId(); if (!id) return; const btn = ev.currentTarget; btn.disabled = true;
    try {
      await saveSettings(); // giữ nguyên những gì đang nhập trước khi ghi đè phần dùng chung
      const r = await window.electronAPI.sheet.batchesApplyRender(id, rbProject());
      if (!r || !r.ok) { rbHint((r && r.error) || "Không lấy được cấu hình mẻ.", "err"); return; }
      await loadSettings();
      rbHint("Đã áp " + r.applied + " thông số dùng chung từ mẻ “" + r.batchName + "”" + (r.offline ? " (bản đã lưu, đang mất mạng)" : "") + ". Đường dẫn thư mục của máy này được giữ nguyên.", "ok");
    } catch (e) { rbHint("Lỗi: " + (e.message || e), "err"); } finally { rbSyncButtons(); }
  });
  document.getElementById("render-batch-save")?.addEventListener("click", async (ev) => {
    const id = rbSelectedId(); if (!id) return; const btn = ev.currentTarget; btn.disabled = true;
    try {
      await saveSettings();
      const cfg = await window.electronAPI.loadProjectConfig(rbProject());
      const render = cfg && cfg.success && cfg.config && cfg.config.render;
      if (!render) { rbHint("Chưa có cấu hình render để lưu.", "err"); return; }
      const r = await window.electronAPI.sheet.batchesSaveRender(id, render);
      if (!r || !r.ok) { rbHint((r && r.error) || "Không lưu được lên mẻ.", "err"); return; }
      rbHint("Đã lưu " + r.sent + " thông số dùng chung lên mẻ. Máy khác bấm “Lấy cấu hình từ mẻ” là dùng được.", "ok");
    } catch (e) { rbHint("Lỗi: " + (e.message || e), "err"); } finally { rbSyncButtons(); }
  });
}
document.addEventListener("DOMContentLoaded", () => { bindRenderBatch(); setTimeout(loadRenderBatches, 1500); });
document.querySelector('.tab-button[data-tab="render"]')?.addEventListener("click", () => loadRenderBatches());

// ============ Test Render ============
let selectedTestRenderOutputFolder = null;

async function selectTestRenderOutputFolder() {
  if (!checkElectronAPI()) return;
  try {
    const folderPath = await window.electronAPI.selectFolder();
    if (folderPath) {
      selectedTestRenderOutputFolder = folderPath;
      document.getElementById("test-render-output-folder").value = folderPath;
      saveSettings();
    }
  } catch (error) {
    console.error("Error selecting folder:", error);
    alert("Lỗi khi chọn folder: " + error.message);
  }
}

function clearTestRenderOutputFolder() {
  selectedTestRenderOutputFolder = null;
  const input = document.getElementById("test-render-output-folder");
  if (input) input.value = "";
  saveSettings();
}

async function runTestRender() {
  const duration = parseInt(document.getElementById("test-render-duration")?.value) || 10;
  const overlayFolder = selectedRenderOverlayFolder || "./overlays";

  if (!checkElectronAPI()) return;

  clearOutput("test-render");
  showOutput("test-render", `🧪 Bắt đầu Test Render...\n`);
  showOutput("test-render", `📁 Overlay folder: ${overlayFolder}\n`);
  showOutput("test-render", `⏱️ Thời lượng: ${duration}s\n\n`);

  try {
    window.electronAPI.removeScriptOutputListener();
    window.electronAPI.onScriptOutput((data) => {
      showOutput("test-render", data);
    });

    // Lấy render config hiện tại
    const renderMode = document.querySelector('input[name="render-mode"]:checked')?.value || "topTransparent";
    const useGPU = document.getElementById("render-use-gpu")?.checked || false;
    const gpuVideoCodec = document.getElementById("render-gpu-codec")?.value || "h264_nvenc";
    const maxConcurrentProcesses = parseInt(document.getElementById("render-max-concurrent")?.value) || 2;
    const opacity = parseFloat(document.getElementById("render-opacity")?.value) || 0.7;
    const height = parseInt(document.getElementById("render-height")?.value) || 220;
    const y_offset = parseInt(document.getElementById("render-y-offset")?.value) || 490;
    const videoSpeed = document.getElementById("render-video-speed")?.value || "0.95";

    // Chroma Key config
    let chromaKeyMode = "color";
    let chromaKeyColor = null;
    let chromaKeyFile = null;
    let chromaKeySimilarity = 0.3;
    if (renderMode === "chromaKey") {
      chromaKeyMode = document.querySelector('input[name="chromakey-mode"]:checked')?.value || "color";
      if (chromaKeyMode === "color") {
        chromaKeyColor = document.getElementById("render-chromakey-color")?.value || "D4F9D7";
        chromaKeySimilarity = parseFloat(document.getElementById("render-chromakey-similarity")?.value) || 0.3;
      } else {
        chromaKeyFile = selectedRenderChromaKeyFile || "";
      }
    }

    // Keep Color config
    const keepColorColors = document.getElementById("render-keepcolor-colors")?.value || "FBFF02";
    const keepColorCrop = document.getElementById("render-keepcolor-crop")?.checked || false;
    const keepColorHeight = parseInt(document.getElementById("render-keepcolor-height")?.value) || 220;
    const keepColorYOffset = parseInt(document.getElementById("render-keepcolor-y-offset")?.value) || 490;
    const keepColorAddDarkLayer = document.getElementById("render-keepcolor-add-dark-layer")?.checked || false;

    // Person overlay
    const personEnabled = document.getElementById("render-person-enabled")?.checked || false;
    const personPath = selectedRenderPersonPath || "";
    const personPos = document.getElementById("render-person-pos")?.value || "center";
    const personScale = parseFloat(document.getElementById("render-person-scale")?.value) || 0.9;

    // Background blur + Frame
    const bgBlurEnabled = document.getElementById("render-bf-blur-enabled")?.checked || false;
    const bgBlur = parseFloat(document.getElementById("render-bf-blur")?.value) || 20;
    const mainScale = parseFloat(document.getElementById("render-bf-main-scale")?.value) || 0.85;
    const mainOpacity = parseFloat(document.getElementById("render-bf-main-opacity")?.value) || 0.85;
    const frameEnabled = document.getElementById("render-bf-frame-enabled")?.checked || false;
    const framePath = selectedRenderFramePath || "";
    const frameScale = parseFloat(document.getElementById("render-bf-frame-scale")?.value) || 1;
    const effectEnabled = document.getElementById("render-bf-effect-enabled")?.checked || false;
    const effectPath = selectedRenderEffectPath || "";
    const effectOpacity = parseFloat(document.getElementById("render-bf-effect-opacity")?.value) || 0.15;
    const effectBlend = document.getElementById("render-bf-effect-blend")?.value || "normal";
    const effectKeyThreshold = parseFloat(document.getElementById("render-bf-effect-key-threshold")?.value) || 0.15;

    // Khung đôi (dualFrame)
    const dualFrameBgPath = selectedRenderDualFrameBgPath || "";
    const dualFrameMainX = parseInt(document.getElementById("render-df-main-x")?.value) || 40;
    const dualFrameMainY = parseInt(document.getElementById("render-df-main-y")?.value) || 40;
    const dualFrameMainWidth = parseInt(document.getElementById("render-df-main-width")?.value) || 960;
    const dualFrameMainHeight = parseInt(document.getElementById("render-df-main-height")?.value) || 560;
    const dualFrameMainOpacity = parseFloat(document.getElementById("render-df-main-opacity")?.value) || 1;
    const dualFrameSmallX = parseInt(document.getElementById("render-df-small-x")?.value) || 1000;
    const dualFrameSmallY = parseInt(document.getElementById("render-df-small-y")?.value) || 520;
    const dualFrameSmallWidth = parseInt(document.getElementById("render-df-small-width")?.value) || 240;
    const dualFrameSmallHeight = parseInt(document.getElementById("render-df-small-height")?.value) || 160;
    const dualFrameSmallOpacity = parseFloat(document.getElementById("render-df-small-opacity")?.value) || 1;
    const dualFrameSmallRadius = parseInt(document.getElementById("render-df-small-radius")?.value) || 0;
    const dualFrameFrameEnabled = document.getElementById("render-df-frame-enabled")?.checked || false;
    const dualFrameFramePath = selectedRenderDualFrameFramePath || "";
    const dualFrameFrameScale = parseFloat(document.getElementById("render-df-frame-scale")?.value) || 1;

    const options = {
      testRenderConfig: {
        overlayFolder,
        duration,
        renderMode,
        chromaKeyMode,
        chromaKeyColor,
        chromaKeySimilarity,
        chromaKeyFile,
        keepColorColors,
        keepColorCrop,
        keepColorHeight,
        keepColorYOffset,
        keepColorAddDarkLayer,
        useGPU,
        maxConcurrentProcesses,
        gpuVideoCodec,
        opacity,
        height,
        y_offset,
        personEnabled,
        personPath,
        personPos,
        personScale,
        bgBlurEnabled,
        bgBlur,
        mainScale,
        mainOpacity,
        frameEnabled,
        framePath,
        frameScale,
        effectEnabled,
        effectPath,
        effectOpacity,
        effectBlend,
        effectKeyThreshold,
        dualFrameBgPath,
        dualFrameMainX,
        dualFrameMainY,
        dualFrameMainWidth,
        dualFrameMainHeight,
        dualFrameMainOpacity,
        dualFrameSmallX,
        dualFrameSmallY,
        dualFrameSmallWidth,
        dualFrameSmallHeight,
        dualFrameSmallOpacity,
        dualFrameSmallRadius,
        dualFrameFrameEnabled,
        dualFrameFramePath,
        dualFrameFrameScale,
        backgroundFolder: selectedRenderBackgroundFolder || "./backgrounds",
        outputFolder: selectedTestRenderOutputFolder || "./test-render-output",
        videoSpeed,
      },
    };

    await window.electronAPI.runScript("test-render.js", [], options);
    showOutput("test-render", "\n\n✅ Test Render hoàn thành!");
  } catch (error) {
    showOutput("test-render", `\n\n❌ Lỗi: ${getErrorMessage(error)}\n`);
  }
}

// Download - Selected paths
let selectedUrlsFile = null;
let selectedDownloadOutputFolder = null;
let selectedDownloadDescFolder = null;
let selectedDownloadOverlayImagesFolder = null;
let selectedDownloadThumbsFolder = null;
let selectedDownloadCookiesFile = null;
// Thư mục nhiều cookie: bị chặn thì app tự đổi sang cookie kế tiếp. Để trống thì lùi
// về file cookie đơn ở trên, nên project cũ mở lên vẫn chạy y như trước.
let selectedDownloadCookiesFolder = null;
let selectedDownloadProxy = null;
let selectedDownloadDrive = false;
let selectedDriveLanguage = "jp"; // Mặc định là tiếng Nhật
let selectedStockOutputFolder = null;

async function selectDownloadFile() {
  if (!checkElectronAPI()) return;
  try {
    const filePath = await window.electronAPI.selectFile({
      filters: [
        { name: "Text Files", extensions: ["txt"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });
    if (filePath) {
      selectedUrlsFile = filePath;
      document.getElementById("download-urls-file").value = filePath;
      // Removed folder path display
      saveSettings();
    }
  } catch (error) {
    console.error("Error selecting file:", error);
    alert("Lỗi khi chọn file: " + error.message);
  }
}

function clearDownloadUrlsFile() {
  selectedUrlsFile = null;
  const input = document.getElementById("download-urls-file");
  if (input) input.value = "";
  saveSettings();
}

async function selectDownloadOutputFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedDownloadOutputFolder = folder;
    document.getElementById("download-output-folder").value = folder;
    // Removed folder path display
    saveSettings();
  }
}

function clearDownloadOutputFolder() {
  selectedDownloadOutputFolder = null;
  const input = document.getElementById("download-output-folder");
  if (input) input.value = "";
  saveSettings();
}

async function selectDownloadDescFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedDownloadDescFolder = folder;
    document.getElementById("download-desc-folder").value = folder;
    saveSettings();
  }
}

function clearDownloadDescFolder() {
  selectedDownloadDescFolder = null;
  const input = document.getElementById("download-desc-folder");
  if (input) input.value = "";
  saveSettings();
}

async function selectDownloadOverlayImagesFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedDownloadOverlayImagesFolder = folder;
    document.getElementById("download-overlay-images-folder").value = folder;
    // Removed folder path display
    saveSettings();
  }
}

function clearDownloadOverlayImagesFolder() {
  selectedDownloadOverlayImagesFolder = null;
  const input = document.getElementById("download-overlay-images-folder");
  if (input) input.value = "";
  saveSettings();
}

async function selectDownloadThumbsFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedDownloadThumbsFolder = folder;
    document.getElementById("download-thumbs-folder").value = folder;
    saveSettings();
  }
}

function clearDownloadThumbsFolder() {
  selectedDownloadThumbsFolder = null;
  const input = document.getElementById("download-thumbs-folder");
  if (input) input.value = "";
  saveSettings();
}

async function selectDownloadCookiesFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedDownloadCookiesFolder = folder;
    document.getElementById("download-cookies-folder").value = folder;
    saveSettings();
  }
}

function clearDownloadCookiesFolder() {
  selectedDownloadCookiesFolder = null;
  const input = document.getElementById("download-cookies-folder");
  if (input) input.value = "";
  saveSettings();
}

function toggleDownloadDrive() {
  const driveCheckbox = document.getElementById("download-drive");
  const languageGroup = document.getElementById("drive-language-group");

  if (driveCheckbox) {
    selectedDownloadDrive = driveCheckbox.checked;

    // Hiển thị/ẩn dropdown ngôn ngữ
    if (languageGroup) {
      languageGroup.style.display = selectedDownloadDrive ? "block" : "none";
    }

    saveSettings();
  }
}

function updateDriveLanguage() {
  const languageSelect = document.getElementById("drive-language");
  if (languageSelect) {
    selectedDriveLanguage = languageSelect.value;
    saveSettings();
  }
}

async function downloadYtDlp() {
  if (!checkElectronAPI()) return;

  const btn = document.getElementById("download-ytdlp-btn");
  const statusDiv = document.getElementById("ytdlp-download-status");

  if (!btn || !statusDiv) return;

  // Disable button and show status
  btn.disabled = true;
  btn.textContent = "⏳";
  statusDiv.style.display = "block";
  statusDiv.innerHTML = "🔄 Đang tải yt-dlp mới nhất từ GitHub...";
  statusDiv.style.color = "#1565c0";
  statusDiv.style.background = "#e3f2fd";

  try {
    const result = await window.electronAPI.downloadYtDlp();

    if (result.success) {
      statusDiv.innerHTML = `✅ ${
        result.message || "Đã tải yt-dlp mới nhất thành công!"
      }<br><small style="display: block; margin-top: 5px;">Bạn có thể sử dụng ngay mà không cần khởi động lại ứng dụng.</small>`;
      statusDiv.style.color = "#2e7d32";
      statusDiv.style.background = "#e8f5e9";
      btn.textContent = "📥";
    } else {
      statusDiv.innerHTML = `❌ Lỗi: ${result.error || "Không thể tải yt-dlp"}`;
      statusDiv.style.color = "#c62828";
      statusDiv.style.background = "#ffebee";
      btn.textContent = "📥";
    }
  } catch (error) {
    statusDiv.innerHTML = `❌ Lỗi: ${getErrorMessage(error)}`;
    statusDiv.style.color = "#c62828";
    statusDiv.style.background = "#ffebee";
    btn.textContent = "📥";
  } finally {
    btn.disabled = false;
  }
}

async function runDownload() {
  if (!checkElectronAPI()) return;

  clearOutput("download");
  showOutput("download", "🚀 Đang tải video...\n\n");

  // Đảm bảo load settings từ project hiện tại trước khi chạy
  // để đảm bảo dùng settings mới nhất từ project file
  if (currentProjectName && checkElectronAPI() && window.electronAPI) {
    try {
      const result =
        await window.electronAPI.loadProjectConfig(currentProjectName);
      if (result.success && result.config && result.config.download) {
        // Cập nhật các biến từ project config
        if (result.config.download.urlsFile) {
          selectedUrlsFile = result.config.download.urlsFile;
        }
        if (result.config.download.outputFolder) {
          selectedDownloadOutputFolder = result.config.download.outputFolder;
        }
        if (result.config.download.descFolder) {
          selectedDownloadDescFolder = result.config.download.descFolder;
        }
        if (result.config.download.overlayImagesFolder) {
          selectedDownloadOverlayImagesFolder =
            result.config.download.overlayImagesFolder;
        }
        if (result.config.download.thumbsFolder) {
          selectedDownloadThumbsFolder = result.config.download.thumbsFolder;
        }
        if (result.config.download.cookiesFile) {
          selectedDownloadCookiesFile = result.config.download.cookiesFile;
        }
        if (result.config.download.cookiesFolder) {
          selectedDownloadCookiesFolder = result.config.download.cookiesFolder;
        }
        // Không ghi đè input field proxy ở đây - để user có thể update proxy
        // và giá trị đó sẽ được ưu tiên khi lấy từ input field bên dưới
        // Chỉ load proxy từ config nếu input field đang trống (user chưa chỉnh sửa)
        const proxyInput = document.getElementById("download-proxy");
        const currentProxyValue = proxyInput?.value?.trim();
        
        if (!currentProxyValue && result.config.download.proxy !== undefined) {
          const configProxy = result.config.download.proxy;
          // Chỉ set nếu config có giá trị hợp lệ (không phải null hoặc empty)
          if (configProxy && typeof configProxy === 'string' && configProxy.trim()) {
            selectedDownloadProxy = configProxy.trim();
            if (proxyInput) {
              proxyInput.value = configProxy.trim();
            }
          } else {
            // Nếu config có proxy null/empty, clear nó
            selectedDownloadProxy = null;
            if (proxyInput) {
              proxyInput.value = "";
            }
          }
        } else if (currentProxyValue) {
          // Nếu input field đã có giá trị (user đã chỉnh sửa), dùng giá trị đó
          selectedDownloadProxy = currentProxyValue;
        } else {
          // Nếu cả input field và config đều không có proxy, clear nó
          selectedDownloadProxy = null;
        }
        if (result.config.download.downloadDrive !== undefined) {
          selectedDownloadDrive = result.config.download.downloadDrive;
          const driveCheckbox = document.getElementById("download-drive");
          if (driveCheckbox) {
            driveCheckbox.checked = result.config.download.downloadDrive;
            // Hiển thị/ẩn dropdown ngôn ngữ
            const languageGroup = document.getElementById(
              "drive-language-group",
            );
            if (languageGroup) {
              languageGroup.style.display = result.config.download.downloadDrive
                ? "block"
                : "none";
            }
          }
        }
        if (result.config.download.driveLanguage !== undefined) {
          selectedDriveLanguage = result.config.download.driveLanguage;
          const languageSelect = document.getElementById("drive-language");
          if (languageSelect) {
            languageSelect.value = result.config.download.driveLanguage;
          }
        }
      }
    } catch (error) {
      console.error("Error loading project config before download:", error);
    }
  }

  // Lấy proxy từ input field (nếu có thay đổi)
  const proxyInput = document.getElementById("download-proxy");
  if (proxyInput) {
    const proxyValue = proxyInput.value.trim();
    // Nếu proxy bị bỏ trống, set thành null (không phải empty string)
    selectedDownloadProxy = proxyValue || null;
  }

  // Lấy downloadDrive từ checkbox (nếu có thay đổi)
  const driveCheckbox = document.getElementById("download-drive");
  if (driveCheckbox) {
    selectedDownloadDrive = driveCheckbox.checked;
    // Hiển thị/ẩn dropdown ngôn ngữ
    const languageGroup = document.getElementById("drive-language-group");
    if (languageGroup) {
      languageGroup.style.display = driveCheckbox.checked ? "block" : "none";
    }
  }

  // Lấy driveLanguage từ dropdown (nếu có thay đổi)
  const languageSelect = document.getElementById("drive-language");
  if (languageSelect) {
    selectedDriveLanguage = languageSelect.value;
  }

  let hasError = false;
  let errorMessage = "";

  try {
    window.electronAPI.removeScriptOutputListener();
    window.electronAPI.onScriptOutput((data) => {
      showOutput("download", data);
      // Kiểm tra các lỗi phổ biến của yt-dlp
      const errorPatterns = [
        /yt-dlp.*error/i,
        /ERROR/i,
        /Unable to download/i,
        /This video is unavailable/i,
        /Sign in to confirm your age/i,
        /Video unavailable/i,
        /Private video/i,
        /yt-dlp.*not found/i,
        /executable.*not found/i,
      ];

      const lowerData = data.toLowerCase();
      if (errorPatterns.some((pattern) => pattern.test(data))) {
        hasError = true;
        if (!errorMessage) {
          errorMessage = data;
        }
      }
    });

    // Không cần truyền downloadConfig nữa - script sẽ đọc trực tiếp từ project JSON
    const options = {};

    await window.electronAPI.runScript("download.js", [], options);

    if (hasError) {
      showOutput(
        "download",
        "\n\n⚠️ Có một số lỗi xảy ra trong quá trình tải.\n",
      );
      showOutput(
        "download",
        "💡 Gợi ý: Nếu gặp lỗi liên quan đến yt-dlp, vui lòng tải lại yt-dlp mới nhất ở phần trên.\n",
      );
    } else {
      showOutput("download", "\n\n✅ Hoàn thành!");
    }
  } catch (error) {
    const errorMsg = getErrorMessage(error);
    showOutput("download", `\n\n❌ Lỗi: ${errorMsg}\n`);
    showOutput(
      "download",
      "\n💡 Gợi ý: Nếu lỗi liên quan đến yt-dlp, vui lòng tải lại yt-dlp mới nhất ở phần trên.\n",
    );
  }
}

// Retry - Tải lại video lỗi (đã chuyển vào tab download)
async function runRetry() {
  if (!checkElectronAPI()) return;

  clearOutput("download");
  showOutput("download", "🚀 Đang tải lại video lỗi...\n\n");

  // Đảm bảo load settings từ project hiện tại trước khi chạy
  // để đảm bảo dùng settings mới nhất từ project file
  if (currentProjectName && checkElectronAPI() && window.electronAPI) {
    try {
      const result =
        await window.electronAPI.loadProjectConfig(currentProjectName);
      if (result.success && result.config && result.config.download) {
        // Cập nhật các biến từ project config
        if (result.config.download.urlsFile) {
          selectedUrlsFile = result.config.download.urlsFile;
        }
        if (result.config.download.outputFolder) {
          selectedDownloadOutputFolder = result.config.download.outputFolder;
        }
        if (result.config.download.descFolder) {
          selectedDownloadDescFolder = result.config.download.descFolder;
        }
        if (result.config.download.overlayImagesFolder) {
          selectedDownloadOverlayImagesFolder =
            result.config.download.overlayImagesFolder;
        }
        if (result.config.download.thumbsFolder) {
          selectedDownloadThumbsFolder = result.config.download.thumbsFolder;
        }
        if (result.config.download.cookiesFile) {
          selectedDownloadCookiesFile = result.config.download.cookiesFile;
        }
        if (result.config.download.cookiesFolder) {
          selectedDownloadCookiesFolder = result.config.download.cookiesFolder;
        }
      }
    } catch (error) {
      console.error("Error loading project config before retry:", error);
    }
  }

  // Không cần truyền downloadConfig nữa - script sẽ đọc trực tiếp từ project JSON
  const options = {};

  try {
    window.electronAPI.removeScriptOutputListener();
    window.electronAPI.onScriptOutput((data) => {
      showOutput("download", data);
    });

    await window.electronAPI.runScript("download.js", ["retry"], options);
    showOutput("download", "\n\n✅ Hoàn thành!");
  } catch (error) {
    showOutput("download", `\n\n❌ Lỗi: ${getErrorMessage(error)}\n`);
  }
}

// Stock Download (Pexels & Pixabay)
function toggleStockPexels() {
  const use = document.getElementById("stock-use-pexels")?.checked;
  const group = document.getElementById("stock-pexels-api-group");
  if (group) group.style.display = use ? "block" : "none";
}

function toggleStockPixabay() {
  const use = document.getElementById("stock-use-pixabay")?.checked;
  const group = document.getElementById("stock-pixabay-api-group");
  if (group) group.style.display = use ? "block" : "none";
}

function toggleStockCut() {
  const cut = document.getElementById("stock-cut")?.checked;
  const group = document.getElementById("stock-trim-seconds-group");
  if (group) group.style.display = cut ? "block" : "none";
}

async function selectStockOutputFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedStockOutputFolder = folder;
    document.getElementById("stock-output-folder").value = folder;
    saveSettings();
  }
}

function clearStockOutputFolder() {
  selectedStockOutputFolder = null;
  const input = document.getElementById("stock-output-folder");
  if (input) input.value = "";
  saveSettings();
}

async function runStockDownload() {
  if (!checkElectronAPI()) return;

  const usePexels = document.getElementById("stock-use-pexels")?.checked ?? false;
  const usePixabay = document.getElementById("stock-use-pixabay")?.checked ?? false;
  if (!usePexels && !usePixabay) {
    alert("Chọn ít nhất một nguồn: Pexels hoặc Pixabay.");
    return;
  }
  if (usePexels && !document.getElementById("stock-pexels-api-key")?.value?.trim()) {
    alert("Bật Pexels cần nhập API key Pexels.");
    return;
  }
  if (usePixabay && !document.getElementById("stock-pixabay-api-key")?.value?.trim()) {
    alert("Bật Pixabay cần nhập API key Pixabay.");
    return;
  }
  const query = document.getElementById("stock-search-query")?.value?.trim();
  if (!query) {
    alert("Nhập từ khóa tìm kiếm (Search query).");
    return;
  }
  const maxVideos = parseInt(document.getElementById("stock-max-videos")?.value || "30", 10) || 30;
  const outFolder = selectedStockOutputFolder || "";

  clearOutput("stock-download");
  showOutput("stock-download", "🚀 Đang tải video từ Pexels/Pixabay...\n\n");

  const cut = document.getElementById("stock-cut")?.checked ?? false;
  const trimSeconds = cut ? (parseInt(document.getElementById("stock-trim-seconds")?.value || "3", 10) || 3) : 0;
  const env = {
    STOCK_USE_PEXELS: usePexels ? "1" : "0",
    STOCK_USE_PIXABAY: usePixabay ? "1" : "0",
    STOCK_PEXELS_API_KEY: usePexels ? (document.getElementById("stock-pexels-api-key")?.value?.trim() || "") : "",
    STOCK_PIXABAY_API_KEY: usePixabay ? (document.getElementById("stock-pixabay-api-key")?.value?.trim() || "") : "",
    STOCK_QUERY: query,
    STOCK_MAX_VIDEOS: String(maxVideos),
    STOCK_OUT_DIR: outFolder || "",
    STOCK_ORIENTATION: document.getElementById("stock-orientation")?.value || "landscape",
    STOCK_CONVERT_720: document.getElementById("stock-convert-720")?.checked ? "1" : "0",
    STOCK_REMOVE_AUDIO: document.getElementById("stock-remove-audio")?.checked ? "1" : "0",
    STOCK_TRIM_SECONDS: String(trimSeconds),
  };

  try {
    window.electronAPI.removeScriptOutputListener();
    window.electronAPI.onScriptOutput((data) => {
      showOutput("stock-download", data);
    });
    await window.electronAPI.runScript("stockDownloader.js", [], { env });
    showOutput("stock-download", "\n\n✅ Hoàn thành!");
  } catch (error) {
    showOutput("stock-download", `\n\n❌ Lỗi: ${getErrorMessage(error)}\n`);
  }
}

// Video Snow
let selectedVideoSnowInputFolder = null;
let selectedVideoSnowOutputFolder = null;
let selectedVideoSnowSnowFile = null;

async function selectVideoSnowInputFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedVideoSnowInputFolder = folder;
    document.getElementById("video-snow-input-folder").value = folder;
    saveSettings();
  }
}

function clearVideoSnowInputFolder() {
  selectedVideoSnowInputFolder = null;
  const input = document.getElementById("video-snow-input-folder");
  if (input) input.value = "";
  saveSettings();
}

async function selectVideoSnowOutputFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedVideoSnowOutputFolder = folder;
    document.getElementById("video-snow-output-folder").value = folder;
    saveSettings();
  }
}

function clearVideoSnowOutputFolder() {
  selectedVideoSnowOutputFolder = null;
  const input = document.getElementById("video-snow-output-folder");
  if (input) input.value = "";
  saveSettings();
}

async function selectVideoSnowSnowFile() {
  if (!checkElectronAPI()) return;
  try {
    const filePath = await window.electronAPI.selectFile({
      filters: [
        { name: "Video Files", extensions: ["mp4", "mov", "avi", "mkv"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });
    if (filePath) {
      selectedVideoSnowSnowFile = filePath;
      document.getElementById("video-snow-snow-file").value = filePath;
      saveSettings();
    }
  } catch (error) {
    console.error("Error selecting file:", error);
    alert("Lỗi khi chọn file: " + error.message);
  }
}

function clearVideoSnowSnowFile() {
  selectedVideoSnowSnowFile = null;
  const input = document.getElementById("video-snow-snow-file");
  if (input) input.value = "";
  saveSettings();
}

async function runVideoSnow() {
  if (!checkElectronAPI()) return;

  clearOutput("video-snow");
  showOutput("video-snow", "🚀 Đang tạo video từ ảnh...\n\n");

  try {
    window.electronAPI.removeScriptOutputListener();
    window.electronAPI.onScriptOutput((data) => {
      showOutput("video-snow", data);
    });

    const maxConcurrent =
      parseInt(document.getElementById("video-snow-max-concurrent").value) || 3;
    const segmentMin =
      parseInt(document.getElementById("video-snow-segment-min").value) || 10;
    const segmentMax =
      parseInt(document.getElementById("video-snow-segment-max").value) || 15;

    // Không cần truyền videoSnowConfig nữa - script sẽ đọc trực tiếp từ project JSON
    const options = {};

    await window.electronAPI.runScript("createVideoSnow.js", [], options);
    showOutput("video-snow", "\n\n✅ Hoàn thành!");
  } catch (error) {
    showOutput("video-snow", `\n\n❌ Lỗi: ${getErrorMessage(error)}\n`);
  }
}

// Background Video
let selectedBgInputFolder = null;
let selectedBgOutputFolder = null;

async function selectBgInputFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedBgInputFolder = folder;
    document.getElementById("bg-input-folder").value = folder;
    saveSettings();
  }
}

function clearBgInputFolder() {
  selectedBgInputFolder = null;
  const input = document.getElementById("bg-input-folder");
  if (input) input.value = "";
  saveSettings();
}

async function selectBgOutputFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedBgOutputFolder = folder;
    document.getElementById("bg-output-folder").value = folder;
    saveSettings();
  }
}

function clearBgOutputFolder() {
  selectedBgOutputFolder = null;
  const input = document.getElementById("bg-output-folder");
  if (input) input.value = "";
  saveSettings();
}

async function runBgVideo() {
  const count = document.getElementById("bg-count").value;

  if (!count) {
    alert("Vui lòng nhập số lượng video!");
    return;
  }

  if (!checkElectronAPI()) return;

  clearOutput("bg-video");
  showOutput(
    "bg-video",
    `🚀 Đang tạo video backgrounds với count=${count}...\n\n`,
  );

  try {
    window.electronAPI.removeScriptOutputListener();
    window.electronAPI.onScriptOutput((data) => {
      showOutput("bg-video", data);
    });

    const targetDuration =
      parseInt(document.getElementById("bg-target-duration").value) || 3600;
    const sourceCount =
      parseInt(document.getElementById("bg-source-count").value) || 10;
    const avgClipDuration =
      parseInt(document.getElementById("bg-avg-clip-duration").value) || 12;

    // Không cần truyền bgVideoConfig nữa - script sẽ đọc trực tiếp từ project JSON
    const options = {};

    await window.electronAPI.runScript(
      "createVideoBackgrounds.js",
      [count],
      options,
    );
    showOutput("bg-video", "\n\n✅ Hoàn thành!");
  } catch (error) {
    showOutput("bg-video", `\n\n❌ Lỗi: ${getErrorMessage(error)}\n`);
  }
}

// Trim
let selectedTrimInputFolder = null;
let selectedTrimOutputFolder = null;

async function selectTrimInputFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedTrimInputFolder = folder;
    document.getElementById("trim-input-folder").value = folder;
    saveSettings();
  }
}

function clearTrimInputFolder() {
  selectedTrimInputFolder = null;
  const input = document.getElementById("trim-input-folder");
  if (input) input.value = "";
  saveSettings();
}

async function selectTrimOutputFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedTrimOutputFolder = folder;
    document.getElementById("trim-output-folder").value = folder;
    // Removed folder path display
    saveSettings();
  }
}

async function runTrim() {
  if (!checkElectronAPI()) return;

  const startTime =
    parseFloat(document.getElementById("trim-start-time").value) || 0;
  const duration =
    parseFloat(document.getElementById("trim-duration").value) || 30;

  if (startTime < 0) {
    alert("Thời gian bắt đầu phải lớn hơn hoặc bằng 0!");
    return;
  }

  if (duration <= 0) {
    alert("Thời gian cắt phải lớn hơn 0!");
    return;
  }

  clearOutput("trim");
  showOutput(
    "trim",
    `🚀 Đang cắt video từ giây ${startTime}, độ dài ${duration}s...\n\n`,
  );

  try {
    window.electronAPI.removeScriptOutputListener();
    window.electronAPI.onScriptOutput((data) => {
      showOutput("trim", data);
    });

    // Không cần truyền trimConfig nữa - script sẽ đọc trực tiếp từ project JSON
    const options = {};

    await window.electronAPI.runScript("trim-videos.js", [], options);
    showOutput("trim", "\n\n✅ Hoàn thành!");
  } catch (error) {
    showOutput("trim", `\n\n❌ Lỗi: ${getErrorMessage(error)}\n`);
  }
}

// Cut BG
let selectedCutBgInputFolder = null;
let selectedCutBgOutputFolder = null;

async function selectCutBgInputFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedCutBgInputFolder = folder;
    document.getElementById("cut-bg-input-folder").value = folder;
    saveSettings();
  }
}

function clearCutBgInputFolder() {
  selectedCutBgInputFolder = null;
  const input = document.getElementById("cut-bg-input-folder");
  if (input) input.value = "";
  saveSettings();
}

async function selectCutBgOutputFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedCutBgOutputFolder = folder;
    document.getElementById("cut-bg-output-folder").value = folder;
    saveSettings();
  }
}

function clearCutBgOutputFolder() {
  selectedCutBgOutputFolder = null;
  const input = document.getElementById("cut-bg-output-folder");
  if (input) input.value = "";
  saveSettings();
}

async function runCutBg() {
  if (!checkElectronAPI()) return;

  await saveSettings(); // Lưu settings trước khi chạy script

  clearOutput("cut-bg");
  showOutput("cut-bg", "🚀 Đang cắt video background...\n\n");

  try {
    window.electronAPI.removeScriptOutputListener();
    window.electronAPI.onScriptOutput((data) => {
      showOutput("cut-bg", data);
    });

    // Không cần truyền cutBgConfig nữa - script sẽ đọc trực tiếp từ project JSON
    const options = {};

    await window.electronAPI.runScript("cut-bg.js", [], options);
    showOutput("cut-bg", "\n\n✅ Hoàn thành!");
  } catch (error) {
    showOutput("cut-bg", `\n\n❌ Lỗi: ${getErrorMessage(error)}\n`);
  }
}

// Thumb
let selectedThumbInputFolder = null;
let selectedThumbOverlayFolder = null;
let selectedThumbOutputFolder = null;

async function selectThumbInputFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedThumbInputFolder = folder;
    document.getElementById("thumb-input-folder").value = folder;
    saveSettings();
  }
}

function clearThumbInputFolder() {
  selectedThumbInputFolder = null;
  const input = document.getElementById("thumb-input-folder");
  if (input) input.value = "";
  saveSettings();
}

async function selectThumbOverlayFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedThumbOverlayFolder = folder;
    document.getElementById("thumb-overlay-folder").value = folder;
    saveSettings();
  }
}

function clearThumbOverlayFolder() {
  selectedThumbOverlayFolder = null;
  const input = document.getElementById("thumb-overlay-folder");
  if (input) input.value = "";
  saveSettings();
}

async function selectThumbOutputFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedThumbOutputFolder = folder;
    document.getElementById("thumb-output-folder").value = folder;
    saveSettings();
  }
}

function clearThumbOutputFolder() {
  selectedThumbOutputFolder = null;
  const input = document.getElementById("thumb-output-folder");
  if (input) input.value = "";
  saveSettings();
}

async function runThumb() {
  if (!checkElectronAPI()) return;

  clearOutput("thumb");
  showOutput("thumb", "🚀 Đang tạo ảnh thu nhỏ...\n\n");

  try {
    window.electronAPI.removeScriptOutputListener();
    window.electronAPI.onScriptOutput((data) => {
      showOutput("thumb", data);
    });

    // Không cần truyền thumbConfig nữa - script sẽ đọc trực tiếp từ project JSON
    const options = {};

    await window.electronAPI.runScript("thumb.js", [], options);
    showOutput("thumb", "\n\n✅ Hoàn thành!");
  } catch (error) {
    showOutput("thumb", `\n\n❌ Lỗi: ${getErrorMessage(error)}\n`);
  }
}

// Get URL
let selectedGetUrlOutputFolder = null;

async function selectGetUrlOutputFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedGetUrlOutputFolder = folder;
    document.getElementById("get-url-output-folder").value = folder;
    saveSettings();
  }
}

function clearGetUrlOutputFolder() {
  selectedGetUrlOutputFolder = null;
  const input = document.getElementById("get-url-output-folder");
  if (input) input.value = "";
  saveSettings();
}

async function runGetUrl() {
  const handle = document.getElementById("channel-handle").value.trim();
  const sortBy = document.getElementById("get-url-sort")?.value === "newest" ? "newest" : "views";
  const sortLabel = sortBy === "newest" ? "mới nhất" : "view cao nhất";
  const apiKey = document.getElementById("get-url-api-key")?.value?.trim() || "";

  if (!handle) {
    alert("Vui lòng nhập channel handle!");
    return;
  }

  if (!checkElectronAPI()) return;

  clearOutput("get-url");
  showOutput("get-url", `🚀 Đang lấy URL từ channel ${handle} (${sortLabel})...\n\n`);

  try {
    window.electronAPI.removeScriptOutputListener();
    window.electronAPI.onScriptOutput((data) => {
      showOutput("get-url", data);
    });

    // Truyền API key qua env nếu có
    const options = apiKey ? { env: { YT_API_KEY: apiKey } } : {};

    await window.electronAPI.runScript("get-url.js", [handle, sortBy], options);
    showOutput("get-url", "\n\n✅ Hoàn thành!");
  } catch (error) {
    showOutput("get-url", `\n\n❌ Lỗi: ${getErrorMessage(error)}\n`);
  }
}

// Normalize
let selectedNormalizeInputFolder = null;

async function selectNormalizeInputFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedNormalizeInputFolder = folder;
    document.getElementById("normalize-input-folder").value = folder;
    saveSettings();
  }
}

function clearNormalizeInputFolder() {
  selectedNormalizeInputFolder = null;
  const input = document.getElementById("normalize-input-folder");
  if (input) input.value = "";
  saveSettings();
}

async function runNormalize() {
  if (!checkElectronAPI()) return;

  clearOutput("normalize");
  showOutput("normalize", "🚀 Đang sửa tên ảnh thu nhỏ...\n\n");

  try {
    window.electronAPI.removeScriptOutputListener();
    window.electronAPI.onScriptOutput((data) => {
      showOutput("normalize", data);
    });

    // Không cần truyền normalizeConfig nữa - script sẽ đọc trực tiếp từ project JSON
    const options = {};

    await window.electronAPI.runScript("convertNormalize.js", [], options);
    showOutput("normalize", "\n\n✅ Hoàn thành!");
  } catch (error) {
    showOutput("normalize", `\n\n❌ Lỗi: ${getErrorMessage(error)}\n`);
  }
}

// Help Modal Functions
const helpContents = {
  render: {
    title: "Hướng dẫn Render Video",
    content: `
      <h4>📋 Chức năng:</h4>
      <p>Render video bằng cách kết hợp video overlay với video background theo các chế độ khác nhau. Hệ thống sẽ tự động xử lý nhiều video cùng lúc dựa trên số ngày và số video mỗi folder.</p>
      
      <h4>🔧 Các tham số chi tiết:</h4>
      <ul>
        <li><strong>Số ngày:</strong> Render ngày số nào. Ví dụ: nhập "1" sẽ render video cho ngày số 1. Mỗi ngày sẽ có folder riêng trong output.</li>
        <li><strong>Số video mỗi folder:</strong> Số lượng video sẽ được render trong mỗi folder của mỗi ngày. Ví dụ: "5" nghĩa là mỗi ngày sẽ có 5 video được render trong folder(Tương ứng với folder trong backgrounds).</li>
        <li><strong>Folder Overlay:</strong> Folder chứa video overlay (video chính cần render). Cấu trúc: <code>./overlays/video1.mp4</code>. Để trống sẽ dùng <code>./overlays</code></li>
        <li><strong>Folder Background:</strong> Folder chứa video background (nền). Cấu trúc: <code>./backgrounds/1/bg1.mp4</code>. Để trống sẽ dùng <code>./backgrounds</code></li>
        <li><strong>Chu kỳ (ngày):</strong> Số ngày mà mẻ video đó up lên kênh (dùng cho Dashboard: còn X ngày là phải có video)</li>
      </ul>
      
      <h4>🎨 Các chế độ Render:</h4>
      <li><strong>Top Transparent:</strong> 
          <ul>
            <li>Đặt video overlay lên trên video background với độ trong suốt</li>
            <li>Opacity: Điều chỉnh độ trong suốt (0.0 = hoàn toàn trong suốt, 1.0 = không trong suốt)</li>
            <li>Mặc định: 0.7 (70% độ mờ)</li>
          </ul>
        </li>
        <li><strong>Chroma Key:</strong> 
          <ul>
            <li>Xóa nền của video overlay dựa trên màu chỉ định</li>
            <li>Dùng màu: Nhập mã màu hex (ví dụ: D4F9D7) để xóa nền có màu đó</li>
            <li>Dùng file: Chọn file <code>chromaKey.txt</code> chứa mã màu (mỗi dòng một màu)</li>
            <li>Phù hợp cho video có nền xanh lá (green screen) hoặc nền đồng nhất</li>
          </ul>
        </li>
        <li><strong>Crop:</strong> 
          <ul>
            <li>Cắt một phần của video overlay</li>
            <li>Crop Height: Chiều cao phần cần cắt (pixel, mặc định: 220)</li>
            <li>Crop Y Offset: Vị trí bắt đầu cắt từ trên xuống (pixel, mặc định: 490)</li>
            <li>Ví dụ: Height=220, Y Offset=490 nghĩa là cắt 220px từ vị trí 490px</li>
          </ul>
        </li>
        <li><strong>Keep Color:</strong> 
          <ul>
            <li>Chỉ giữ lại các màu được chỉ định, xóa các màu khác</li>
            <li>Mảng màu: Nhập mã màu hex, cách nhau bởi dấu phẩy (ví dụ: FBFF02,FF0000)</li>
            <li>Có thể bật Crop để kết hợp cắt video</li>
          </ul>
        </li>
      </ul>
      
      <h4>⚙️ Tùy chọn nâng cao:</h4>
      <ul>
        <li><strong>Use GPU (NVIDIA):</strong> Bật để sử dụng card đồ họa NVIDIA tăng tốc render. Yêu cầu card NVIDIA và driver mới nhất.</li>
        <li><strong>GPU Video Codec:</strong> Codec sử dụng khi render bằng GPU (mặc định: h264_nvenc)</li>
        <li><strong>Max Concurrent Processes:</strong> Số video render đồng thời (mặc định: 2). Tăng số này sẽ nhanh hơn nhưng tốn nhiều tài nguyên hơn.</li>
      </ul>
      
      <h4>💡 Lưu ý quan trọng:</h4>
      <ul>
        <li>Đảm bảo cấu trúc folder input đúng: <code>overlays/video1.mp4</code>, <code>backgrounds/1/bg1.mp4</code></li>
        <li>Tên file video trong overlay và background nên khớp nhau để render đúng</li>
        <li>Video output sẽ được lưu tự động với tên giống video overlay</li>
        <li>Nếu dùng GPU, đảm bảo card NVIDIA đã cài đặt driver và hỗ trợ hardware encoding</li>
        <li>Quá trình render có thể mất nhiều thời gian tùy vào độ dài video và số lượng</li>
      </ul>
    `,
  },
  download: {
    title: "Hướng dẫn Tải video",
    content: `
      <h4>📋 Chức năng:</h4>
      <p>Tải video từ YouTube, TikTok, hoặc các nền tảng khác từ danh sách URL. Hệ thống sẽ tự động tải video, tạo thumbnail và xử lý overlay.</p>
      
      <h4>🔧 Các tham số chi tiết:</h4>
      <ul>
        <li><strong>File URLs:</strong> 
          <ul>
            <li>File text chứa danh sách URL (mỗi URL một dòng)</li>
            <li>Ví dụ nội dung file: <br><code>https://youtube.com/watch?v=abc123<br>https://tiktok.com/@user/video/123456</code></li>
            <li>Để trống sẽ dùng <code>./urls.txt</code></li>
            <li>Có thể tạo file này bằng chức năng "Lấy URL"</li>
          </ul>
        </li>
        <li><strong>Folder tải về:</strong> 
          <ul>
            <li>Folder lưu video đã tải về</li>
            <li>Video sẽ được đặt tên tự động theo tên video gốc</li>
            <li>Để trống sẽ dùng <code>./overlays</code></li>
          </ul>
        </li>
        <li><strong>Folder ảnh overlay:</strong> 
          <ul>
            <li>Folder chứa ảnh overlay sẽ được thêm vào thumbnail</li>
            <li>Ảnh overlay sẽ được kết hợp với thumbnail gốc của video</li>
            <li>Để trống sẽ dùng <code>./images</code></li>
          </ul>
        </li>
        <li><strong>Folder output thumbs:</strong> 
          <ul>
            <li>Folder lưu thumbnail đã xử lý (có overlay)</li>
            <li>Thumbnail sẽ được tạo tự động từ video và kết hợp với ảnh overlay</li>
            <li>Cấu trúc: <code>./thumbs/ngày1/video1.jpg</code></li>
            <li>Để trống sẽ dùng <code>./thumbs</code></li>
          </ul>
        </li>
        <li><strong>File cookies.txt:</strong> 
          <ul>
            <li>File cookies để tải video có bảo vệ hoặc video riêng tư</li>
            <li>Định dạng: Netscape HTTP Cookie File</li>
            <li>Có thể export từ trình duyệt (Chrome/Firefox extension)</li>
            <li>Để trống sẽ dùng <code>./cookies.txt</code></li>
            <li>Không bắt buộc nếu video công khai</li>
          </ul>
        </li>
      </ul>
      
      <h4>🔄 Quy trình hoạt động:</h4>
      <ol>
        <li>Đọc danh sách URL từ file</li>
        <li>Tải video từ mỗi URL (sử dụng yt-dlp)</li>
        <li>Lưu video vào folder tải về</li>
        <li>Tạo thumbnail từ video</li>
        <li>Kết hợp thumbnail với ảnh overlay</li>
        <li>Lưu thumbnail đã xử lý vào folder output thumbs</li>
      </ol>
      
      <h4>💡 Lưu ý quan trọng:</h4>
      <ul>
        <li>File urls.txt phải có định dạng UTF-8, mỗi URL một dòng</li>
        <li>Video sẽ được tải với chất lượng tốt nhất có sẵn</li>
        <li>Nếu video tải lỗi, URL sẽ được ghi vào log để tải lại sau</li>
        <li>Thumbnail sẽ tự động khớp với tên video (ví dụ: video.mp4 → video.jpg)</li>
        <li>Quá trình tải có thể mất nhiều thời gian tùy vào số lượng và độ dài video</li>
        <li>Đảm bảo có kết nối internet ổn định</li>
      </ul>
      
      <h4>🔄 Tải lại video lỗi:</h4>
      <p>Sau khi tải video, nếu có video bị lỗi, bạn có thể sử dụng nút <strong>"Tải lại video lỗi"</strong> để tự động tải lại các video đã bị lỗi.</p>
      
      <h4>📋 Cách hoạt động:</h4>
      <ol>
        <li>Hệ thống đọc file log <code>failed_urls.txt</code> (tự động tạo khi có video lỗi)</li>
        <li>Lấy từng URL từ log file</li>
        <li>Thử tải lại video từ URL đó</li>
        <li>Nếu thành công: Xóa URL khỏi log</li>
        <li>Nếu vẫn lỗi: Giữ nguyên trong log để thử lại sau</li>
      </ol>
      
      <h4>💡 Lưu ý về tải lại:</h4>
      <ul>
        <li>Chức năng này chỉ hoạt động sau khi đã chạy "Tải video" và có video bị lỗi</li>
        <li>File <code>failed_urls.txt</code> được tạo tự động trong thư mục gốc</li>
        <li>Có thể chạy nhiều lần cho đến khi tất cả video được tải thành công</li>
        <li>Nếu video vẫn lỗi sau nhiều lần thử, có thể do:
          <ul>
            <li>Video đã bị xóa hoặc không còn tồn tại</li>
            <li>Video bị giới hạn quyền truy cập</li>
            <li>Vấn đề về kết nối mạng</li>
            <li>URL không hợp lệ</li>
          </ul>
        </li>
      </ul>
    `,
  },
  "video-snow": {
    title: "Hướng dẫn Tạo video từ ảnh",
    content: `
      <h4>📋 Chức năng:</h4>
      <p>Chuyển đổi ảnh tĩnh thành video động với hiệu ứng tuyết rơi overlay. Mỗi ảnh sẽ được tạo thành một video segment có độ dài ngẫu nhiên.</p>
      
      <h4>🔧 Các tham số chi tiết:</h4>
      <ul>
        <li><strong>Folder ảnh input:</strong> 
          <ul>
            <li>Folder chứa các ảnh cần chuyển thành video</li>
            <li>Hỗ trợ định dạng: .jpg, .jpeg, .png</li>
            <li>Mỗi ảnh sẽ tạo một video segment riêng</li>
            <li>Để trống sẽ dùng <code>./image_backgrounds</code></li>
          </ul>
        </li>
        <li><strong>Folder output:</strong> 
          <ul>
            <li>Folder lưu video đã tạo</li>
            <li>Video sẽ có tên giống ảnh gốc (đổi extension thành .mp4)</li>
            <li>Ví dụ: <code>image1.jpg</code> → <code>image1.mp4</code></li>
            <li>Để trống sẽ dùng <code>./output_segments</code></li>
          </ul>
        </li>
        <li><strong>File Snow Video:</strong> 
          <ul>
            <li>File video hiệu ứng tuyết rơi sẽ được overlay lên ảnh</li>
            <li>Video này sẽ được lặp lại để phủ toàn bộ thời lượng video</li>
            <li>Đảm bảo file video có độ dài đủ để lặp</li>
            <li>Để trống sẽ dùng <code>./snow1.mp4</code></li>
          </ul>
        </li>
        <li><strong>Max Concurrent:</strong> 
          <ul>
            <li>Số video được tạo đồng thời (mặc định: 3)</li>
            <li>Tăng số này sẽ nhanh hơn nhưng tốn nhiều CPU/RAM hơn</li>
            <li>Khuyến nghị: 2-5 tùy vào cấu hình máy</li>
          </ul>
        </li>
        <li><strong>Segment Min (giây):</strong> 
          <ul>
            <li>Độ dài tối thiểu của mỗi video segment (mặc định: 10 giây)</li>
            <li>Mỗi video sẽ có độ dài ngẫu nhiên từ Min đến Max</li>
          </ul>
        </li>
        <li><strong>Segment Max (giây):</strong> 
          <ul>
            <li>Độ dài tối đa của mỗi video segment (mặc định: 15 giây)</li>
            <li>Ví dụ: Min=10, Max=15 → video sẽ dài 10-15 giây ngẫu nhiên</li>
          </ul>
        </li>
      </ul>
      
      <h4>🔄 Quy trình hoạt động:</h4>
      <ol>
        <li>Đọc danh sách ảnh từ folder input</li>
        <li>Với mỗi ảnh:
          <ul>
            <li>Chuyển ảnh thành video với độ dài ngẫu nhiên (Min-Max giây)</li>
            <li>Overlay video hiệu ứng tuyết lên ảnh</li>
            <li>Lưu video segment vào folder output</li>
          </ul>
        </li>
        <li>Xử lý nhiều ảnh đồng thời theo Max Concurrent</li>
      </ol>
      
      <h4>💡 Lưu ý:</h4>
      <ul>
        <li>Ảnh sẽ được scale để phù hợp với video tuyết</li>
        <li>Video output sẽ có chất lượng tốt, phù hợp để dùng làm background</li>
        <li>Có thể dùng các video segment này cho chức năng "Tạo video backgrounds"</li>
        <li>Đảm bảo file snow video có chất lượng tốt để overlay đẹp</li>
      </ul>
    `,
  },
  "bg-video": {
    title: "Hướng dẫn Tạo video backgrounds",
    content: `
      <h4>Chức năng:</h4>
      <p>Tạo video backgrounds dài từ các segments ngắn</p>
      
      <h4>Các bước sử dụng:</h4>
      <ul>
        <li><strong>Số lượng video mỗi folder:</strong> Số video background sẽ tạo cho mỗi folder</li>
        <li><strong>Folder input segments:</strong> Chọn folder chứa các video segments. Để trống sẽ dùng <code>./output_segments</code></li>
        <li><strong>Folder output:</strong> Chọn folder lưu video backgrounds. Để trống sẽ dùng <code>./backgrounds</code></li>
        <li><strong>Target Duration:</strong> Độ dài mục tiêu của video background (giây, mặc định: 3600 = 1 giờ)</li>
        <li><strong>Source Count:</strong> Số lượng segments nguồn sử dụng (mặc định: 10)</li>
        <li><strong>Avg Clip Duration:</strong> Độ dài trung bình mỗi clip (giây, mặc định: 12)</li>
      </ul>
      
      <h4>Lưu ý:</h4>
      <ul>
        <li>Video backgrounds sẽ được tạo bằng cách ghép các segments ngẫu nhiên</li>
        <li>Độ dài video sẽ gần bằng Target Duration</li>
      </ul>
    `,
  },
  trim: {
    title: "Hướng dẫn Cắt video",
    content: `
      <h4>📋 Chức năng:</h4>
      <p>Cắt video với thời gian và vị trí tùy chỉnh. Có thể cắt từ bất kỳ vị trí nào trong video và với độ dài tùy chọn.</p>
      
      <h4>🔧 Các tham số chi tiết:</h4>
      <ul>
        <li><strong>Folder input:</strong> 
          <ul>
            <li>Folder chứa video cần cắt</li>
            <li>Hỗ trợ định dạng: .mp4, .mov, .avi, .mkv, .webm</li>
            <li>Để trống sẽ dùng <code>./overlays</code></li>
          </ul>
        </li>
        <li><strong>Folder output:</strong> 
          <ul>
            <li>Folder lưu video đã cắt</li>
            <li>Video output sẽ giữ nguyên tên file gốc</li>
            <li>Để trống sẽ dùng <code>./overlays_trimmed</code></li>
          </ul>
        </li>
        <li><strong>Cắt từ giây thứ (Start time):</strong> 
          <ul>
            <li>Vị trí bắt đầu cắt trong video (giây)</li>
            <li>Giá trị: 0 = từ đầu video, 10 = từ giây thứ 10</li>
            <li>Có thể nhập số thập phân (ví dụ: 5.5 = 5 giây 500ms)</li>
            <li>Mặc định: 0 (từ đầu video)</li>
          </ul>
        </li>
        <li><strong>Thời gian cắt (Duration):</strong> 
          <ul>
            <li>Độ dài video sau khi cắt (giây)</li>
            <li>Ví dụ: Start time = 10, Duration = 30 → cắt từ giây 10 đến giây 40</li>
            <li>Có thể nhập số thập phân (ví dụ: 15.5 = 15 giây 500ms)</li>
            <li>Mặc định: 30 giây</li>
          </ul>
        </li>
      </ul>
      
      <h4>💡 Ví dụ cụ thể:</h4>
      <ul>
        <li><strong>Ví dụ 1:</strong> Start time = 0, Duration = 30
          <ul>
            <li>→ Cắt 30 giây đầu tiên của video</li>
          </ul>
        </li>
        <li><strong>Ví dụ 2:</strong> Start time = 10, Duration = 20
          <ul>
            <li>→ Cắt từ giây thứ 10 đến giây thứ 30 (20 giây)</li>
          </ul>
        </li>
        <li><strong>Ví dụ 3:</strong> Start time = 60, Duration = 15
          <ul>
            <li>→ Cắt từ giây thứ 60 đến giây thứ 75 (15 giây)</li>
          </ul>
        </li>
      </ul>
      
      <h4>⚠️ Lưu ý quan trọng:</h4>
      <ul>
        <li>Tất cả video trong folder input sẽ được cắt với cùng tham số</li>
        <li>Nếu video ngắn hơn (startTime + duration), sẽ cắt đến hết video</li>
        <li>Nếu startTime vượt quá độ dài video, video đó sẽ bị bỏ qua</li>
        <li>Video output sẽ được encode lại với codec H.264 (có thể mất thời gian)</li>
        <li>Chất lượng video được giữ ở mức tốt (CRF 23)</li>
      </ul>
    `,
  },
  "cut-bg": {
    title: "Hướng dẫn Cắt video background",
    content: `
      <h4>Chức năng:</h4>
      <p>Cắt video background thành các segments ngắn</p>
      
      <h4>Các bước sử dụng:</h4>
      <ul>
        <li><strong>Folder input:</strong> Chọn folder chứa video background cần cắt. Để trống sẽ dùng <code>./bgs</code></li>
        <li><strong>Folder output:</strong> Chọn folder lưu các segments đã cắt. Để trống sẽ dùng <code>./backgrounds</code></li>
      </ul>
      
      <h4>Lưu ý:</h4>
      <ul>
        <li>Video background sẽ được cắt thành nhiều segments ngẫu nhiên</li>
        <li>Mỗi segment có độ dài khác nhau</li>
      </ul>
    `,
  },
  thumb: {
    title: "Hướng dẫn Tạo ảnh thu nhỏ",
    content: `
      <h4>Chức năng:</h4>
      <p>Tạo ảnh thumbnail từ video với overlay</p>
      
      <h4>Các bước sử dụng:</h4>
      <ul>
        <li><strong>Folder input video:</strong> Chọn folder chứa video cần tạo thumbnail. Để trống sẽ dùng <code>./overlays</code></li>
        <li><strong>Folder ảnh overlay:</strong> Chọn folder chứa ảnh overlay. Để trống sẽ dùng <code>./images</code></li>
        <li><strong>Folder output thumbs:</strong> Chọn folder lưu thumbnail. Để trống sẽ dùng <code>./thumbs</code></li>
      </ul>
      
      <h4>Lưu ý:</h4>
      <ul>
        <li>Thumbnail sẽ được tạo từ frame đầu tiên của video</li>
        <li>Ảnh overlay sẽ được thêm vào thumbnail</li>
        <li>Cấu trúc folder output sẽ giống với folder input</li>
      </ul>
    `,
  },
  "get-url": {
    title: "Hướng dẫn Lấy URL",
    content: `
      <h4>Chức năng:</h4>
      <p>Lấy danh sách URL từ YouTube channel</p>
      
      <h4>Các bước sử dụng:</h4>
      <ul>
        <li><strong>Channel handle:</strong> Nhập handle của channel (ví dụ: <code>@line4091</code>)</li>
        <li><strong>Folder lưu kết quả:</strong> Chọn folder lưu file chứa danh sách URL. Để trống sẽ dùng <code>./channels</code></li>
      </ul>
      
      <h4>Lưu ý:</h4>
      <ul>
        <li>Handle channel phải bắt đầu bằng <code>@</code></li>
        <li>Danh sách URL sẽ được lưu vào file text</li>
        <li>Có thể dùng file này cho chức năng "Tải video"</li>
      </ul>
    `,
  },
  normalize: {
    title: "Hướng dẫn Sửa tên ảnh thu nhỏ",
    content: `
      <h4>Chức năng:</h4>
      <p>Chuẩn hóa tên file ảnh thu nhỏ</p>
      
      <h4>Các bước sử dụng:</h4>
      <ul>
        <li><strong>Folder thumbs:</strong> Chọn folder chứa ảnh thu nhỏ cần sửa tên. Để trống sẽ dùng <code>./thumbs</code></li>
      </ul>
      
      <h4>Lưu ý:</h4>
      <ul>
        <li>Tên file sẽ được chuẩn hóa để phù hợp với video tương ứng</li>
        <li>Chức năng này sẽ xử lý tất cả các ảnh trong folder và các folder con</li>
      </ul>
    `,
  },
  "stock-download": {
    title: "Hướng dẫn Tải video Pexels & Pixabay",
    content: `
      <h4>📋 Chức năng:</h4>
      <p>Tải video stock từ Pexels và/hoặc Pixabay theo từ khóa tìm kiếm. Có thể chọn một hoặc cả hai nguồn.</p>
      
      <h4>🔧 Các bước sử dụng:</h4>
      <ul>
        <li><strong>Tải từ Pexels:</strong> Tích vào ô "Tải từ Pexels" và nhập API key (lấy tại <a href="https://www.pexels.com/api/" target="_blank" rel="noopener">pexels.com/api</a>).</li>
        <li><strong>Tải từ Pixabay:</strong> Tích vào ô "Tải từ Pixabay" và nhập API key (lấy tại <a href="https://pixabay.com/api/docs/" target="_blank" rel="noopener">pixabay.com/api/docs</a>).</li>
        <li><strong>Từ khóa tìm kiếm:</strong> Nhập từ khóa tiếng Anh (ví dụ: nature, ocean, city).</li>
        <li><strong>Số lượng video:</strong> Số video cần tải (tổng từ cả hai nguồn nếu chọn cả Pexels và Pixabay).</li>
        <li><strong>Folder lưu video:</strong> Chọn thư mục lưu. Nếu để trống, video sẽ lưu vào thư mục mặc định.</li>
        <li><strong>Hướng video:</strong> Landscape (ngang), Portrait (dọc), hoặc Square (vuông).</li>
      </ul>
      
      <h4>Xử lý video sau khi tải:</h4>
      <ul>
        <li><strong>Convert về 720p:</strong> Bật để chuyển video về độ phân giải 720p; tắt thì giữ nguyên gốc.</li>
        <li><strong>Xóa âm thanh:</strong> Bật để bỏ track âm thanh; tắt thì giữ nguyên.</li>
        <li><strong>Cắt video:</strong> Bật để chỉ lấy N giây đầu; nhập số giây cần cắt. Tắt thì giữ full video.</li>
      </ul>
      
      <h4>💡 Lưu ý:</h4>
      <ul>
        <li>Chọn ít nhất một nguồn (Pexels hoặc Pixabay). Có thể tích cả hai để tải từ cả hai nguồn.</li>
        <li>API key được lưu trong cấu hình dự án, không gửi lên server nào khác.</li>
      </ul>
    `,
  },
  concat: {
    title: "Hướng dẫn Ghép video",
    content: `
      <h4>📋 Chức năng:</h4>
      <p>Ghép nhiều video ngắn lại thành video dài hơn. Có thể chèn thumbnail giữa các video để tạo hiệu ứng chuyển cảnh mượt mà, hoặc ghép trực tiếp không có thumbnail.</p>
      
      <h4>🔧 Các tham số chi tiết:</h4>
      <ul>
        <li><strong>Folder video input:</strong> 
          <ul>
            <li>Folder chứa các video cần ghép (BẮT BUỘC)</li>
            <li>Video phải có định dạng .mp4 hoặc .mov</li>
            <li>Video sẽ được sắp xếp theo tên (alphabetical order)</li>
            <li>Ví dụ: <code>video1.mp4, video2.mp4, video3.mp4</code></li>
          </ul>
        </li>
        <li><strong>Folder output:</strong> 
          <ul>
            <li>Folder lưu video đã ghép (BẮT BUỘC)</li>
            <li>Video output sẽ có tên theo video đầu tiên trong mỗi nhóm</li>
            <li>Ví dụ: Nhóm [video1, video2] → output: video1.mp4</li>
          </ul>
        </li>
        <li><strong>Chunk size:</strong> 
          <ul>
            <li>Số video sẽ ghép trong mỗi nhóm (mặc định: 2, tối thiểu: 2)</li>
            <li>Ví dụ: Chunk size = 2, có 6 video → tạo 3 video output</li>
            <li>Ví dụ: Chunk size = 3, có 9 video → tạo 3 video output</li>
            <li>Nhóm cuối cùng nếu ít hơn chunk size sẽ bị bỏ qua</li>
          </ul>
        </li>
        <li><strong>Chèn thumbnail giữa các video:</strong>
          <ul>
            <li><strong>BẬT:</strong> Video sẽ được ghép với thumbnail chèn giữa</li>
            <li style="margin-left: 20px;">Cấu trúc: Video1 → Thumbnail2 → Video2 → Thumbnail3 → Video3</li>
            <li style="margin-left: 20px;">Thumbnail sẽ được chuyển thành video với độ dài chỉ định</li>
            <li style="margin-left: 20px;">Tạo hiệu ứng chuyển cảnh mượt mà, chuyên nghiệp</li>
            <li><strong>TẮT:</strong> Video sẽ được ghép trực tiếp không có thumbnail</li>
            <li style="margin-left: 20px;">Cấu trúc: Video1 → Video2 → Video3</li>
            <li style="margin-left: 20px;">Nhanh hơn, không cần folder thumbnail</li>
          </ul>
        </li>
        <li><strong>Folder chứa thumb:</strong> (Chỉ hiện khi bật chèn thumbnail)
          <ul>
            <li>Folder chứa file thumbnail (ảnh .jpg)</li>
            <li>Tên file thumbnail PHẢI khớp với tên video</li>
            <li>Ví dụ: <code>video1.mp4</code> → <code>video1.jpg</code></li>
            <li>Ví dụ: <code>clip_001.mp4</code> → <code>clip_001.jpg</code></li>
            <li>Thumbnail sẽ được tìm tự động dựa trên tên video tiếp theo</li>
          </ul>
        </li>
        <li><strong>Thời gian thumbnail:</strong> (Chỉ hiện khi bật chèn thumbnail)
          <ul>
            <li>Thời gian hiển thị mỗi thumbnail (giây, mặc định: 3)</li>
            <li>Có thể điều chỉnh từ 0.1 giây trở lên</li>
            <li>Thời gian ngắn (1-2s): Chuyển cảnh nhanh, nhịp độ nhanh</li>
            <li>Thời gian dài (3-5s): Chuyển cảnh chậm, nhịp độ chậm</li>
          </ul>
        </li>
      </ul>
      
      <h4>🔄 Quy trình hoạt động:</h4>
      <ol>
        <li>Đọc danh sách video từ folder input</li>
        <li>Sắp xếp video theo tên (alphabetical)</li>
        <li>Chia video thành các nhóm (chunk) theo chunk size</li>
        <li>Với mỗi nhóm:
          <ul>
            <li>Nếu bật thumbnail: Ghép Video1 → Thumbnail2 → Video2 → Thumbnail3 → ...</li>
            <li>Nếu tắt thumbnail: Ghép Video1 → Video2 → Video3 → ...</li>
            <li>Sử dụng FFmpeg với codec copy (nhanh, không re-encode)</li>
          </ul>
        </li>
        <li>Lưu video output với tên video đầu tiên trong nhóm</li>
      </ol>
      
      <h4>💡 Ví dụ cụ thể:</h4>
      <p><strong>Trường hợp 1: Có thumbnail, chunk size = 2</strong></p>
      <ul>
        <li>Input: video1.mp4, video2.mp4, video3.mp4, video4.mp4</li>
        <li>Thumbnails: video2.jpg, video3.jpg, video4.jpg</li>
        <li>Output 1: video1.mp4 (chứa: video1 → video2.jpg → video2)</li>
        <li>Output 2: video3.mp4 (chứa: video3 → video4.jpg → video4)</li>
      </ul>
      
      <p><strong>Trường hợp 2: Không thumbnail, chunk size = 3</strong></p>
      <ul>
        <li>Input: video1.mp4, video2.mp4, video3.mp4, video4.mp4</li>
        <li>Output 1: video1.mp4 (chứa: video1 → video2 → video3)</li>
        <li>Video4 bị bỏ qua (nhóm cuối chỉ có 1 video)</li>
      </ul>
      
      <h4>⚠️ Lưu ý quan trọng:</h4>
      <ul>
        <li>Video input phải có định dạng .mp4 hoặc .mov</li>
        <li>Nếu dùng thumbnail, đảm bảo tên file thumbnail khớp chính xác với tên video</li>
        <li>Video output sẽ có tên theo video đầu tiên trong mỗi nhóm</li>
        <li>Nhóm cuối cùng nếu ít hơn chunk size sẽ bị bỏ qua</li>
        <li>Quá trình ghép sử dụng codec copy nên rất nhanh, không làm giảm chất lượng</li>
        <li>Thumbnail sẽ được chuyển thành video với thông số audio/video khớp với video gốc</li>
        <li>Đảm bảo có đủ dung lượng ổ cứng cho video output</li>
      </ul>
    `,
  },
};

function showHelp(tabId) {
  const modal = document.getElementById("helpModal");
  const title = document.getElementById("helpModalTitle");
  const body = document.getElementById("helpModalBody");

  if (helpContents[tabId]) {
    title.textContent = helpContents[tabId].title;
    body.innerHTML = helpContents[tabId].content;
    modal.classList.add("active");
  }
}

function closeHelp() {
  const modal = document.getElementById("helpModal");
  modal.classList.remove("active");
}

// Đóng modal khi click bên ngoài
document.addEventListener("DOMContentLoaded", () => {
  const modal = document.getElementById("helpModal");
  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      closeHelp();
    }
  });

  // Đóng modal bằng phím ESC
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal.classList.contains("active")) {
      closeHelp();
    }
  });
});

// Concat Video
let selectedConcatInputFolder = null;
let selectedConcatThumbsFolder = null;
let selectedConcatOutputFolder = null;

async function selectConcatInputFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedConcatInputFolder = folder;
    document.getElementById("concat-input-folder").value = folder;
    saveSettings();
  }
}

function clearConcatInputFolder() {
  selectedConcatInputFolder = null;
  const input = document.getElementById("concat-input-folder");
  if (input) input.value = "";
  saveSettings();
}

async function selectConcatThumbsFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedConcatThumbsFolder = folder;
    document.getElementById("concat-thumbs-folder").value = folder;
    saveSettings();
  }
}

function clearConcatThumbsFolder() {
  selectedConcatThumbsFolder = null;
  const input = document.getElementById("concat-thumbs-folder");
  if (input) input.value = "";
  saveSettings();
}

async function selectConcatOutputFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedConcatOutputFolder = folder;
    document.getElementById("concat-output-folder").value = folder;
    saveSettings();
  }
}

function clearConcatOutputFolder() {
  selectedConcatOutputFolder = null;
  const input = document.getElementById("concat-output-folder");
  if (input) input.value = "";
  saveSettings();
}

function toggleConcatThumbs() {
  const useThumbs = document.getElementById("concat-use-thumbs").checked;
  const thumbsOptions = document.getElementById("concat-thumbs-options");
  if (thumbsOptions) {
    thumbsOptions.style.display = useThumbs ? "block" : "none";
  }
}

async function runConcat() {
  const chunkSize =
    parseInt(document.getElementById("concat-chunk-size").value) || 2;
  const useThumbs = document.getElementById("concat-use-thumbs").checked;
  const thumbDuration =
    parseFloat(document.getElementById("concat-thumb-duration").value) || 3;

  if (!selectedConcatInputFolder) {
    alert("Vui lòng chọn folder video input!");
    return;
  }

  if (!selectedConcatOutputFolder) {
    alert("Vui lòng chọn folder output!");
    return;
  }

  if (chunkSize < 2) {
    alert("Chunk size phải lớn hơn hoặc bằng 2!");
    return;
  }

  if (useThumbs) {
    if (!selectedConcatThumbsFolder) {
      alert("Vui lòng chọn folder chứa thumbnail!");
      return;
    }
    if (thumbDuration <= 0) {
      alert("Thời gian thumbnail phải lớn hơn 0!");
      return;
    }
  }

  if (!checkElectronAPI()) return;

  clearOutput("concat");
  showOutput(
    "concat",
    `🚀 Đang ghép video với input="${selectedConcatInputFolder}", chunkSize=${chunkSize}, useThumbs=${useThumbs}...\n\n`,
  );

  try {
    window.electronAPI.removeScriptOutputListener();
    window.electronAPI.onScriptOutput((data) => {
      showOutput("concat", data);
    });

    // Không cần truyền concatConfig nữa - script sẽ đọc trực tiếp từ project JSON
    const options = {};

    await window.electronAPI.runScript("concat-video.js", [], options);
    showOutput("concat", "\n\n✅ Hoàn thành!");
  } catch (error) {
    showOutput("concat", `\n\n❌ Lỗi: ${getErrorMessage(error)}\n`);
  }
}

// ===== Tab Theo dõi Sheet =====
(function initSheetWatch() {
  const api = window.electronAPI?.sheet;
  if (!api) return;
  const $ = (id) => document.getElementById(id);
  const logEl = $("sw-log");
  const tbody = $("sw-tbody");
  const sideEl = $("sw-side");
  const nf = new Intl.NumberFormat("vi-VN");
  let selectedName = null; // kênh đang chọn để hiện chi tiết bên phải

  // Một Map duy nhất cho cả tab: mỗi kênh gom số liệu, trạng thái GPM và video của nó.
  // sheetName -> { name, profileId, videosPerDay, countToday, enabled, stats, gpm, videos, el, open }
  const channels = new Map();

  // Video "đã render nhưng chưa lên lịch" — nguồn là IPC đọc Sheet + resume-state.json,
  // KHÔNG phải c.videos (Map này chỉ sống trong một lượt chạy, tắt app là mất).
  // sheetName -> videos[]; pendingLoading chặn gọi trùng khi card vừa mở đã render nhiều lần.
  const pending = new Map();
  const pendingLoading = new Set();

  function log(msg) {
    if (!logEl) return;
    logEl.textContent += `${new Date().toLocaleTimeString()}  ${msg}\n`;
    logEl.scrollTop = logEl.scrollHeight;
  }
  function shortUrl(u) {
    const s = String(u || "");
    const m = s.match(/[?&]v=([\w-]+)/) || s.match(/\/([\w-]{6,})(?:[/?#]|$)/);
    return m ? m[1] : (s.length > 34 ? "…" + s.slice(-32) : s);
  }
  const num = (v) => (v === null || v === undefined ? "—" : nf.format(v));

  // Ngày địa phương dạng YYYY-MM-DD — cùng quy ước với todayStr() của runner-state.
  const todayKey = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  // Video coi như xong khi đã lên lịch upload, hoặc (không bật GPM) khi render xong.
  const isDone = (v) => /^✅/.test(v.upload || "") || (!v.upload && /^✅/.test(v.state || ""));
  const isErr = (v) => !!v.error || /^❌/.test(v.upload || "");

  // v.error là lỗi của LƯỢT gần nhất, không phải vết sẹo vĩnh viễn: mọi tín hiệu mới cho
  // URL đó (đang tải lại / render xong / upload lại) phải xoá nó. Không xoá thì video
  // retry thành công vẫn bị isErr() đếm là lỗi tới khi tắt app — trong khi digest
  // Telegram (dựng từ kết quả lượt chạy) báo OK.
  function touchVideo(c, url, title) {
    const v = ensureVideo(c, url, title);
    v.error = "";
    return v;
  }

  // ===== Card (giữ lại cho sự kiện video) + Row (layout bảng mới) =====

  // Dòng bảng của một kênh (cùng kiểu với web: tên + kiểu render, bật, hạn proxy, hôm nay, lỗi, tổng)
  function buildRow(c) {
    const tr = document.createElement("tr");
    tr.className = "cv-row"; tr.tabIndex = 0; tr.dataset.name = c.name; tr.title = "Bấm để xem và sửa kênh";
    const tdName = document.createElement("td");
    const nm = document.createElement("div"); nm.className = "cv-name";
    const strong = document.createElement("strong"); strong.textContent = c.name;
    const warn = document.createElement("span"); warn.className = "cv-warn"; warn.style.display = "none";
    nm.append(strong, warn);
    const sub = document.createElement("div"); sub.className = "cv-sub";
    tdName.append(nm, sub);
    const tdOn = document.createElement("td");
    const sw = document.createElement("button"); sw.type = "button"; sw.className = "cv-switch"; sw.setAttribute("role", "switch");
    sw.appendChild(document.createElement("i")); tdOn.append(sw);
    const tdPx = document.createElement("td"); tdPx.className = "cv-pxcell";
    const tdToday = document.createElement("td"); tdToday.className = "num cv-today";
    const tdErr = document.createElement("td"); tdErr.className = "num cv-errs";
    const tdTot = document.createElement("td"); tdTot.className = "num cv-posted";
    tr.append(tdName, tdOn, tdPx, tdToday, tdErr, tdTot);
    tr.addEventListener("click", (e) => { if (e.target.closest(".cv-switch")) return; selectChannel(c.name); });
    tr.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && !e.target.closest(".cv-switch")) { e.preventDefault(); selectChannel(c.name); } });
    sw.addEventListener("click", (e) => { e.stopPropagation(); toggleEnabled(c); });
    c.row = { tr, strong, warn, sub, sw, tdPx, tdToday, tdErr, tdTot };
    return tr;
  }

  function buildCard(c) {
    const card = document.createElement("div");
    card.className = "sw-card";

    const top = document.createElement("div");
    top.className = "sw-card-top";
    const dot = document.createElement("span");
    dot.className = "sw-dot";
    const name = document.createElement("span");
    name.className = "sw-name";
    name.textContent = c.name; // chuỗi từ Sheet: luôn textContent, không nội suy HTML
    name.title = c.name;
    const plug = document.createElement("button");
    plug.className = "sw-icon-btn";
    plug.textContent = "🔌";
    // Pill "N chờ đăng": chỉ để lộ ra là card còn việc, vì phần chi tiết nằm trong body.
    const pill = document.createElement("span");
    pill.className = "sw-pending";
    pill.style.display = "none";
    const quota = document.createElement("span");
    quota.className = "sw-quota";
    const edit = document.createElement("button");
    edit.className = "sw-icon-btn";
    edit.textContent = "✎";
    edit.title = "Sửa cấu hình kênh";
    edit.setAttribute("aria-label", "Sửa cấu hình kênh " + c.name);
    const caret = document.createElement("button");
    caret.className = "sw-caret";
    caret.textContent = "▾";
    caret.title = "Xem video của kênh";
    top.append(dot, name, pill, edit, plug, quota, caret);

    const stats = document.createElement("div");
    stats.className = "sw-stats";
    const updated = document.createElement("div");
    updated.className = "sw-updated";
    const xinfo = document.createElement("div");
    xinfo.className = "sw-xinfo";
    const activity = document.createElement("div");
    activity.className = "sw-activity";
    const body = document.createElement("div");
    body.className = "sw-card-body";
    body.style.display = "none";

    card.append(top, stats, updated, xinfo, activity, body);

    plug.addEventListener("click", () => connectOne(c));
    edit.addEventListener("click", () => window.ChannelConfigUI?.open(c.name));
    caret.addEventListener("click", () => {
      c.open = !c.open;
      caret.textContent = c.open ? "▴" : "▾";
      renderCard(c);
      if (c.open) refreshPending(c, true); // mở card = lúc cần danh sách chờ đăng nhất
    });

    c.el = { card, dot, name, pill, plug, quota, stats, updated, xinfo, activity, body };
    return card;
  }

  function ensureChannel(sheetName) {
    if (!sheetName) return null;
    let c = channels.get(sheetName);
    if (!c) {
      c = {
        name: sheetName, profileId: "", videosPerDay: 0, countToday: 0, countDate: null,
        enabled: true, stats: null, gpm: { state: "idle", msg: "" }, videos: new Map(), open: false,
        confirmUntil: new Map(), // url -> mốc hết hạn của lần bấm xác nhận đầu (dòng ⏳)
      };
      channels.set(sheetName, c);
      tbody.appendChild(buildRow(c));
      buildCard(c); // thẻ chỉ để giữ danh sách video đang chạy (hiện ở tab "Chạy" của khung bên phải), không gắn vào trang
      renderCard(c);
    }
    return c;
  }

  // Kênh đã bị xóa (hoặc chuyển máy) ở web: gỡ khỏi bảng và bộ nhớ. Kênh đang có video chạy dở thì GIỮ LẠI
  // để không nuốt mất tiến trình đang diễn ra; nó sẽ biến mất ở lần đồng bộ sau khi chạy xong.
  // Kênh đang làm việc dở (mở GPM hoặc có video đang tải/render/upload): không được gỡ giữa chừng
  const isBusy = (c) => c.gpm.state === "busy" || [...c.videos.values()].some((v) => (v.state || v.upload) && !isDone(v) && !isErr(v));
  function removeChannel(name) {
    const c = channels.get(name);
    if (!c) return false;
    if (isBusy(c)) return false;
    try { c.row?.tr?.remove(); } catch { /* ignore */ }
    try { c.el?.card?.remove?.(); } catch { /* ignore */ }
    channels.delete(name);
    if (selectedName === name) selectedName = null;
    return true;
  }
  // Đồng bộ danh sách kênh với web: tạo kênh mới, gỡ kênh không còn. Trả về tên các kênh còn giữ lại dù web không còn.
  function dropMissing(webNames) {
    const keep = new Set(webNames), kept = [];
    for (const name of [...channels.keys()]) {
      if (keep.has(name)) continue;
      if (!removeChannel(name)) kept.push(name);
    }
    return kept;
  }

  function ensureVideo(c, url, title) {
    let v = c.videos.get(url);
    if (!v) { v = { url, title: "", state: "", upload: "", error: "" }; c.videos.set(url, v); }
    if (title) v.title = title;
    else if (!v.title) v.title = shortUrl(url);
    return v;
  }

  function activityText(c) {
    const list = [...c.videos.values()];
    const active = list.find((v) => !isDone(v) && !isErr(v) && (v.state || v.upload));
    if (active) return { text: `${active.upload || active.state} — “${active.title}”`, err: false, busy: true };
    // Đủ quota hôm nay là XONG việc của ngày: những URL lỗi còn lại không cản trở gì nữa
    // (lượt sau vẫn tự retry), nên card không báo đỏ. Chi tiết lỗi xem ở cột B/C của Sheet.
    if (c.videosPerDay > 0 && c.countToday >= c.videosPerDay) return { text: "✓ đủ hôm nay", err: false, busy: false };
    const errs = list.filter(isErr).length;
    if (errs) return { text: `❌ ${errs} video lỗi`, err: true, busy: false };
    return { text: "— chờ lượt chạy", err: false, busy: false };
  }

  function renderVideos(c) {
    const body = c.el.body;
    body.textContent = "";
    if (!c.open) { body.style.display = "none"; return; }
    body.style.display = "";

    renderPendingSection(c, body);

    const list = [...c.videos.values()];
    const errs = list.filter(isErr);
    const active = list.filter((v) => !isDone(v) && !isErr(v));
    const doneCount = list.filter(isDone).length;

    for (const v of [...errs, ...active]) {
      const row = document.createElement("div");
      row.className = "sw-vid";
      const t = document.createElement("span");
      t.className = "sw-vid-title";
      t.textContent = v.title;
      t.title = v.url;
      const st = document.createElement("span");
      st.className = "sw-vid-state";
      st.textContent = v.upload || v.state || "—";
      row.append(t, st);
      body.appendChild(row);
      if (v.error) {
        const e = document.createElement("div");
        e.className = "sw-vid-err";
        e.textContent = `⚠ ${v.error}`;
        body.appendChild(e);
      }
    }
    if (doneCount) {
      const d = document.createElement("div");
      d.className = "sw-done-note";
      d.textContent = `✓ ${doneCount} video đã xong`;
      body.appendChild(d);
    }
    if (!list.length) {
      const d = document.createElement("div");
      d.className = "sw-vid-state";
      d.textContent = "Chưa có video nào trong lượt chạy này.";
      body.appendChild(d);
    }

    const actions = document.createElement("div");
    actions.className = "sw-card-actions";
    const handle = c.stats?.sourceHandle;

    // Kiểu sắp xếp khi lấy URL nguồn. Chọn tại chỗ, không lưu vào Sheet —
    // mỗi kênh mỗi lần bấm chọn khác nhau được.
    const sortSel = document.createElement("select");
    sortSel.className = "sw-sort-select";
    sortSel.title = "Thứ tự lấy video từ kênh nguồn";
    for (const [value, label] of [["views", "View cao nhất"], ["newest", "Mới nhất"]]) {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      sortSel.appendChild(opt);
    }
    sortSel.disabled = !handle;

    const btn = document.createElement("button");
    btn.className = "btn btn-secondary";
    btn.textContent = "Lấy URL nguồn";
    btn.disabled = !handle;
    btn.title = handle ? `Lấy video từ ${handle}` : "Kênh chưa điền cột @handle nguồn";
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      sortSel.disabled = true;
      const old = btn.textContent;
      btn.textContent = "⏳ đang lấy…";
      const sortBy = sortSel.value;
      const sortLabel = sortBy === "newest" ? "mới nhất" : "view cao nhất";
      try {
        const out = await api.fetchSourceUrls(c.name, sortBy);
        if (out?.ok) log(`[${c.name}] ✅ Đã thêm ${out.added} URL (${sortLabel}), bỏ qua ${out.skipped} trùng.`);
        else log(`[${c.name}] ❌ ${out?.error || "lấy URL thất bại"}`);
      } catch (err) {
        log(`[${c.name}] ❌ Lỗi khi lấy URL: ${err.message}`);
      } finally {
        btn.textContent = old;
        btn.disabled = false;
        sortSel.disabled = false;
      }
    });
    // Test render riêng kênh này. Không phụ thuộc @handle nguồn như nút bên cạnh:
    // nó lấy dòng đầu cột A, kênh đã chạy xong hết vẫn test được.
    const testBtn = document.createElement("button");
    testBtn.className = "btn btn-secondary";
    testBtn.textContent = "🧪 Test render";
    testBtn.title = "Tải 1 video của kênh, cắt 30s, render thử rồi mở lên xem. Không upload, không ghi vào Sheet.";
    testBtn.addEventListener("click", () => runSheetTestRender(c.name, testBtn));

    // Test AI: chọn 1 ảnh gốc -> xem prompt (có rule), title mới, và ảnh gốc vs ảnh mới. Không upload.
    const aiBtn = document.createElement("button");
    aiBtn.className = "btn btn-secondary";
    aiBtn.textContent = "🤖 Test AI";
    aiBtn.title = "Chọn 1 ảnh gốc, xem title + ảnh AI tạo theo rule/ảnh mẫu của kênh (không upload)";
    aiBtn.addEventListener("click", () => openAiTest(c));

    actions.appendChild(sortSel);
    actions.appendChild(btn);
    actions.appendChild(testBtn);
    actions.appendChild(aiBtn);
    body.appendChild(actions);
  }

  // Bảng nhập video gắn ngay dưới danh sách (giống tab web): "Dán danh sách" hoặc "Nhập Excel".
  // Chỉ dùng textContent (không nội suy HTML) vì link và tên tab đến từ người dùng/file.
  function buildImportPanel(c, host, v) {
    if (v.panelMode === "paste") return pastePanel(c, host, v);
    if (v.panelMode === "excel") return excelPanel(c, host, v);
    return null;
  }
  function pastePanel(c, host, v) {
    const wrap = document.createElement("div"); wrap.className = "vl-panel";
    const msg = document.createElement("div"); msg.className = "vl-hint"; msg.textContent = "Mỗi dòng một link (http/https).";
    const ta = document.createElement("textarea"); ta.rows = 7; ta.spellcheck = false; ta.className = "vl-ta"; ta.placeholder = "https://www.youtube.com/watch?v=...";
    const infoEl = document.createElement("div"); infoEl.className = "vl-hint"; infoEl.textContent = "Chưa có link nào.";
    const row = document.createElement("div"); row.className = "vl-imp-row";
    const go = document.createElement("button"); go.type = "button"; go.className = "sw-mini-btn"; go.textContent = "Thêm vào danh sách";
    const x = document.createElement("button"); x.type = "button"; x.className = "sw-mini-btn"; x.textContent = "Hủy";
    row.append(go, x);
    const refresh = () => {
      const p = VL().parseUrls(ta.value);
      const bits = [p.urls.length + " link hợp lệ"];
      if (p.dup) bits.push(p.dup + " trùng trong ô dán");
      if (p.invalid) bits.push(p.invalid + " mục không phải link http(s) sẽ bị bỏ qua");
      infoEl.textContent = (p.urls.length || p.invalid) ? bits.join(" · ") : "Chưa có link nào.";
      go.disabled = v.busy || !p.urls.length;
    };
    ta.addEventListener("input", refresh);
    x.addEventListener("click", () => { if (v.busy) return; v.panelMode = null; paintUrlList(c, host); });
    go.addEventListener("click", async () => {
      const p = VL().parseUrls(ta.value); if (!p.urls.length || v.busy) return;
      v.busy = true; go.disabled = true; x.disabled = true; go.textContent = "⏳ đang thêm…";
      try {
        const r = await window.electronAPI.sheet.addUrls(c.name, p.urls);
        if (!r || !r.ok) { infoEl.textContent = "❌ " + ((r && r.error) || "Không thêm được"); go.textContent = "Thêm vào danh sách"; go.disabled = false; x.disabled = false; v.busy = false; return; }
        const skipped = r.sent - r.added;
        log("[" + c.name + "] ✅ Đã thêm " + r.added + " link" + (skipped > 0 ? ", bỏ qua " + skipped + " trùng video đã có" : "") + (p.invalid ? ", " + p.invalid + " mục không hợp lệ" : "") + ".");
        appToast(r.added ? ("Đã thêm " + r.added + " link vào " + c.name) : "Tất cả link đã có trong kênh", { kind: r.added ? "success" : "warn" });
        v.busy = false; v.panelMode = null; loadUrlList(c, host);
      } catch (e) { infoEl.textContent = "❌ " + ((e && e.message) || e); go.textContent = "Thêm vào danh sách"; go.disabled = false; x.disabled = false; v.busy = false; }
    });
    wrap.append(msg, ta, infoEl, row);
    refresh();
    return wrap;
  }
  function excelPanel(c, host, v) {
    const wrap = document.createElement("div"); wrap.className = "vl-panel";
    const pickBtn = document.createElement("button"); pickBtn.type = "button"; pickBtn.className = "sw-mini-btn"; pickBtn.textContent = "📂 Chọn file Excel…";
    const note = document.createElement("div"); note.className = "vl-hint"; note.textContent = "Lấy tab trùng tên \"" + c.name + "\" (cột A: link, B/C: trạng thái).";
    const tabRow = document.createElement("div"); tabRow.className = "vl-imp-row"; tabRow.style.display = "none";
    const tabLbl = document.createElement("span"); tabLbl.textContent = "Tab:";
    const tabSel = document.createElement("select"); tabSel.setAttribute("aria-label", "Chọn tab Excel");
    tabRow.append(tabLbl, tabSel);
    const keepLbl = document.createElement("label"); keepLbl.className = "vl-chk"; keepLbl.style.display = "none";
    const keep = document.createElement("input"); keep.type = "checkbox"; keep.checked = true;
    keepLbl.append(keep, document.createTextNode(" Giữ trạng thái đã làm (video đã render/đã lên lịch không bị làm lại)"));
    const infoEl = document.createElement("div"); infoEl.className = "vl-hint"; infoEl.textContent = "Chưa chọn file Excel.";
    const row = document.createElement("div"); row.className = "vl-imp-row";
    const go = document.createElement("button"); go.type = "button"; go.className = "sw-mini-btn"; go.textContent = "Nhập"; go.disabled = true;
    const x = document.createElement("button"); x.type = "button"; x.className = "sw-mini-btn"; x.textContent = "Hủy";
    row.append(go, x);
    let book = null;
    const curTab = () => (book ? book.tabs.find((t) => t.name === tabSel.value) : null);
    const refresh = () => {
      const t = curTab();
      infoEl.textContent = t ? (t.rows.length + " dòng có link trong tab \"" + t.name + "\" (file " + book.file + ").") : "Chưa chọn file Excel.";
      go.disabled = v.busy || !t || !t.rows.length;
    };
    tabSel.addEventListener("change", refresh);
    pickBtn.addEventListener("click", async () => {
      if (v.busy) return; pickBtn.disabled = true;
      try {
        const r = await window.electronAPI.sheet.videosExcelPick(c.name);
        if (r && r.canceled) return;
        if (!r || !r.ok) { infoEl.textContent = "❌ " + ((r && r.error) || "Không đọc được file"); return; }
        book = { file: r.file, tabs: r.tabs || [] };
        tabSel.replaceChildren(...book.tabs.map((t) => { const o = document.createElement("option"); o.value = t.name; o.textContent = t.name + " (" + t.rows.length + ")"; return o; }));
        tabSel.value = r.best; tabRow.style.display = ""; keepLbl.style.display = ""; note.textContent = "Đã chọn: " + r.file; refresh();
      } finally { pickBtn.disabled = false; }
    });
    x.addEventListener("click", () => { if (v.busy) return; v.panelMode = null; paintUrlList(c, host); });
    go.addEventListener("click", async () => {
      const t = curTab(); if (!t || !t.rows.length || v.busy) return;
      v.busy = true; go.disabled = true; x.disabled = true; go.textContent = "⏳ đang nhập…";
      try {
        const r = await window.electronAPI.sheet.videosImportRows({ sheetName: c.name, rows: t.rows, keepStatus: keep.checked });
        if (!r || !r.ok) { infoEl.textContent = "❌ " + ((r && r.error) || "Không nhập được"); go.textContent = "Nhập"; go.disabled = false; x.disabled = false; v.busy = false; return; }
        log("[" + c.name + "] ✅ Đã nhập " + r.added + " video" + (r.existing ? ", bỏ qua " + r.existing + " đã có" : "") + (r.invalid ? ", " + r.invalid + " dòng không hợp lệ" : "") + ".");
        appToast(r.added ? ("Đã nhập " + r.added + " video vào " + c.name) : "Tất cả đã có trong kênh", { kind: r.added ? "success" : "warn" });
        v.busy = false; v.panelMode = null; loadUrlList(c, host);
      } catch (e) { infoEl.textContent = "❌ " + ((e && e.message) || e); go.textContent = "Nhập"; go.disabled = false; x.disabled = false; v.busy = false; }
    });
    wrap.append(pickBtn, note, tabRow, keepLbl, infoEl, row);
    refresh();
    return wrap;
  }

  // Hộp Test AI: chọn chế độ (chỉ title / title + vẽ ảnh), chọn ảnh gốc, rồi hiện prompt + title + ảnh gốc/ảnh mới.
  async function openAiTest(c) {
    const api = window.electronAPI && window.electronAPI.sheet;
    if (!api || !api.aiTestOptimize) { appToast("Chưa chạy được, khởi động lại app.", { kind: "error" }); return; }
    const mk = (t, cls, text) => { const n = document.createElement(t); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
    const dlg = mk("div", "delete-confirm-dialog active"); dlg.setAttribute("role", "dialog"); dlg.setAttribute("aria-modal", "true");
    const header = mk("div", "delete-confirm-header"); header.append(mk("span", "icon", "🤖"), mk("h3", "", "Test AI · " + c.name));
    const body = mk("div", "delete-confirm-body");
    const hint = mk("div", "vl-hint", "Chọn ảnh gốc làm mẫu. Chế độ “Chỉ title” nhanh, không cần Veo3. “Title + vẽ ảnh” cần account Veo3/Flow đã đăng nhập.");
    const btns = mk("div", "vl-imp-row");
    const bTitle = mk("button", "sw-mini-btn on", "Chỉ title"); bTitle.type = "button";
    const bFull = mk("button", "sw-mini-btn", "Title + vẽ ảnh"); bFull.type = "button";
    btns.append(bTitle, bFull);
    let mode = "title";
    bTitle.addEventListener("click", () => { mode = "title"; bTitle.classList.add("on"); bFull.classList.remove("on"); });
    bFull.addEventListener("click", () => { mode = "full"; bFull.classList.add("on"); bTitle.classList.remove("on"); });
    const run = mk("button", "delete-confirm-btn confirm", "Chọn ảnh & chạy"); run.type = "button";
    run.style.background = "var(--gradient-primary, linear-gradient(135deg,#fa6e03,#e85d04))";
    const close = mk("button", "delete-confirm-btn cancel", "Đóng"); close.type = "button";
    const actionsRow = mk("div", "delete-confirm-actions"); actionsRow.append(close, run);
    const out = mk("div", "ai-test-out"); out.style.display = "none";
    body.append(hint, mk("div", "vl-imp-row", null), btns, out, actionsRow);
    const content = mk("div", "delete-confirm-content"); content.style.maxWidth = "900px"; content.style.width = "94%";
    content.append(header, body); dlg.append(content);
    const closeDlg = () => { document.removeEventListener("keydown", onKey, true); dlg.remove(); };
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); closeDlg(); } };
    close.addEventListener("click", closeDlg);
    dlg.addEventListener("click", (e) => { if (e.target === dlg) closeDlg(); });
    const imgBox = async (label, filePath) => {
      const wrap = mk("div", "ai-test-col"); wrap.append(mk("div", "vl-hint", label));
      if (!filePath) { wrap.append(mk("div", "vl-hint", "(không có)")); return wrap; }
      const r = await api.aiTestImage(filePath).catch(() => null);
      if (r && r.ok) { const im = document.createElement("img"); im.src = r.dataUrl; im.className = "ai-test-img"; wrap.append(im); }
      else wrap.append(mk("div", "vl-hint", filePath));
      return wrap;
    };
    run.addEventListener("click", async () => {
      run.disabled = true; close.disabled = true; const old = run.textContent; run.textContent = "⏳ đang chạy…";
      try {
        const r = await api.aiTestOptimize(c.name, mode);
        if (r && r.canceled) return;
        if (!r || !r.ok) { out.style.display = "block"; out.textContent = "❌ " + ((r && r.error) || "lỗi"); return; }
        out.style.display = "block"; out.replaceChildren();
        out.append(mk("div", "ai-test-row", "Title gốc: " + (r.origTitle || "")));
        out.append(mk("div", "ai-test-row ai-test-new", "Title mới: " + (r.newTitle || "(không đổi)")));
        const imgs = mk("div", "ai-test-imgs");
        imgs.append(await imgBox("Ảnh gốc", r.origImage), await imgBox(r.thumbChanged ? "Ảnh AI tạo" : "Ảnh mới (giữ gốc)", r.newImage || (mode === "title" ? "" : r.origImage)));
        out.append(imgs);
        const det = mk("details", "ai-test-prompt"); det.append(mk("summary", null, "Xem prompt gửi AI (kiểm rule có vào không)"));
        det.append(mk("div", "vl-hint", "— Prompt title —"), mk("pre", "ai-test-pre", r.titlePrompt || ""), mk("div", "vl-hint", "— Prompt thumbnail —"), mk("pre", "ai-test-pre", r.thumbPrompt || ""));
        out.append(det);
        if (!r.hasSamples) out.append(mk("div", "vl-hint", "Kênh chưa có ảnh mẫu — prompt dùng nhánh không mẫu."));
      } catch (e) { out.style.display = "block"; out.textContent = "❌ " + ((e && e.message) || e); }
      finally { run.disabled = false; close.disabled = false; run.textContent = old; }
    });
    document.addEventListener("keydown", onKey, true);
    document.body.append(dlg);
  }

  // ===== Chờ đăng: video đã render nhưng chưa lên lịch =====

  const PENDING_LABEL = {
    "maybe-uploaded": "⚠ có thể đã đăng",
    failed: "❌ lỗi",
    waiting: "⏸ chờ",
    "gave-up": "bỏ qua (hết lượt)",
    rendered: "chưa đăng",
  };

  // Nạp danh sách chờ đăng của MỘT kênh. `force` = bỏ cache (sau khi đăng lại / lượt chạy xong).
  async function refreshPending(c, force = false) {
    if (!c) return;
    if (!force && pending.has(c.name)) { renderCard(c); return; }
    if (pendingLoading.has(c.name)) return;
    pendingLoading.add(c.name);
    try {
      const r = await api.pendingUploads(c.name);
      if (r?.ok) {
        const one = (r.channels || []).find((x) => x.sheetName === c.name);
        pending.set(c.name, one?.videos ?? []);
      } else {
        log(`[${c.name}] ❌ không tải được danh sách chờ đăng: ${r?.error || "lỗi"}`);
      }
    } catch (err) {
      log(`[${c.name}] ❌ lỗi tải danh sách chờ đăng: ${err.message}`);
    } finally {
      pendingLoading.delete(c.name);
      renderCard(c);
    }
  }

  // Nạp cho mọi kênh, tuần tự: mỗi kênh là một lượt đọc tab riêng bên Sheet, nã song song
  // 13 tab cùng lúc dễ ăn 429. Chạy nền, không chặn UI.
  // `openOnly` dùng sau mỗi lượt chạy: card đang đóng sẽ tự nạp lại khi người dùng mở ra,
  // khỏi đọc lại cả chục tab mỗi 5 phút.
  async function refreshAllPending(force = false, { openOnly = false } = {}) {
    for (const c of channels.values()) {
      if (openOnly && !c.open) continue;
      await refreshPending(c, force);
    }
  }

  // Đăng lại một hoặc nhiều url; xong thì nạp lại danh sách của kênh.
  async function retryPending(c, urls, btn) {
    const old = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "⏳ đang gửi…"; }
    let ok = false;
    try {
      const r = await api.retryUpload({ sheetName: c.name, urls });
      if (r?.ok) {
        ok = true;
        log(`[${c.name}] ↻ đăng lại ${r.queued} video${r.skipped?.length ? `, bỏ qua ${r.skipped.length}` : ""}.`);
        for (const s of r.skipped ?? []) log(`   • ${shortUrl(s.url)}: ${s.reason}`);
        // Lạc quan: bỏ ngay những video đã vào hàng đợi để nút không mời bấm lại lần nữa.
        // KHÔNG nạp lại ngay từ Sheet — lúc này cột C vừa bị ghi "⏸ chờ: đăng lại thủ công",
        // nạp lại sẽ đẩy đúng những dòng đó quay về danh sách và panel trông như không có gì
        // xảy ra. Danh sách thật được nạp lại ở các mốc ở dưới.
        const skip = new Set((r.skipped ?? []).map((s) => s.url));
        const mine = pending.get(c.name) ?? [];
        pending.set(c.name, mine.filter((v) => !urls.includes(v.url) || skip.has(v.url)));
        renderCard(c);
      } else {
        log(`[${c.name}] ❌ đăng lại thất bại: ${r?.error || "lỗi"}`);
      }
    } catch (err) {
      log(`[${c.name}] ❌ đăng lại lỗi: ${err.message}`);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = old; }
      if (!ok) await refreshPending(c, true); // thất bại thì phải thấy lại đúng thực tế
    }
  }

  function renderPendingSection(c, body) {
    const list = pending.get(c.name) ?? [];
    if (!list.length) return;

    const head = document.createElement("div");
    head.className = "sw-pending-head";
    const label = document.createElement("span");
    label.textContent = `Chờ đăng (${list.length})`;
    // Dòng "có thể đã đăng" KHÔNG bao giờ đi theo nút hàng loạt: đăng lại chúng có thể tạo
    // bản nháp thứ hai, nên mỗi dòng phải được xác nhận riêng.
    const batch = list.filter((v) => v.kind !== "maybe-uploaded");
    const risky = list.length - batch.length;
    const allBtn = document.createElement("button");
    allBtn.className = "sw-mini-btn";
    allBtn.textContent = batch.length ? `Đăng lại tất cả (${batch.length})` : "Đăng lại tất cả";
    allBtn.disabled = !batch.length;
    allBtn.title = risky
      ? `${risky} video "có thể đã đăng" phải bấm riêng từng cái để xác nhận.`
      : "Đăng lại mọi video đang chờ của kênh này.";
    allBtn.addEventListener("click", () => retryPending(c, batch.map((v) => v.url), allBtn));
    head.append(label, allBtn);
    body.appendChild(head);

    for (const v of list) {
      const row = document.createElement("div");
      row.className = "sw-pending-row";

      const t = document.createElement("span");
      t.className = "sw-vid-title";
      t.textContent = v.title;
      t.title = v.url;

      const st = document.createElement("span");
      st.className = "sw-vid-state";
      st.textContent = PENDING_LABEL[v.kind] || v.kind;
      st.title = v.statusText || st.textContent;

      const btn = document.createElement("button");
      btn.className = "sw-mini-btn";
      // Dòng ⏳/b1..b4 nghĩa là file có thể đã lên Studio -> đăng lại có thể tạo bản nháp
      // thứ hai, nên bắt bấm hai lần trong 5 giây.
      const needConfirm = v.kind === "maybe-uploaded";
      const confirming = needConfirm && (c.confirmUntil.get(v.url) ?? 0) > Date.now();
      btn.textContent = confirming ? "⚠ Chắc chắn đăng lại?" : "Đăng lại";
      if (confirming) btn.classList.add("danger");
      if (needConfirm) btn.title = "Có thể video này đã được đăng dở — đăng lại sẽ tạo thêm một bản nháp trên YouTube.";

      btn.addEventListener("click", () => {
        if (needConfirm && !confirming) {
          c.confirmUntil.set(v.url, Date.now() + 5000);
          renderCard(c);
          // Hết 5 giây không bấm lại -> trả nút về như cũ.
          setTimeout(() => {
            if ((c.confirmUntil.get(v.url) ?? 0) <= Date.now()) {
              c.confirmUntil.delete(v.url);
              renderCard(c);
            }
          }, 5200);
          return;
        }
        c.confirmUntil.delete(v.url);
        retryPending(c, [v.url], btn);
      });

      row.append(t, st, btn);
      body.appendChild(row);
    }
  }

  function proxyPill(wc, short) {
    const span = document.createElement("span");
    const d = wc.proxyDaysLeft, s2 = wc.proxyExpiryState;
    if (d === null || d === undefined) {
      span.className = "cv-px none";
      span.textContent = s2 === "searching" ? (short ? "…" : "Đang tra hạn…") : (short ? "?" : "Chưa rõ hạn");
      span.title = s2 === "searching" ? "Đang hỏi nhà cung cấp proxy…" : s2 === "notfound" ? "Không nhà cung cấp nào có IP này" : "Chưa tra được hạn";
    } else {
      span.className = "cv-px " + (d <= 3 ? "bad" : d <= 7 ? "warn" : "ok");
      span.textContent = d <= 0 ? "Hết hạn" : short ? d + " ngày" : "Còn " + d + " ngày";
      span.title = "Hết hạn " + (wc.proxyExpiresAt ? new Date(wc.proxyExpiresAt).toLocaleDateString("vi-VN") : "") + (wc.proxyExpiryProvider ? " · " + wc.proxyExpiryProvider : "");
    }
    return span;
  }

  function renderRow(c) {
    if (!c.row) return;
    const { tr, warn, sub, sw, tdPx, tdToday, tdErr, tdTot } = c.row;
    const wc = window.ChannelConfigUI?.get(c.name);
    const vs = wc?.videoStats || {};
    tr.classList.toggle("cv-current", selectedName === c.name);
    if (selectedName === c.name) tr.setAttribute("aria-current", "true"); else tr.removeAttribute("aria-current");
    const act = activityText(c);
    sub.textContent = (wc?.renderMode ? (wc.renderMode + " · ") : "") + (act.busy || act.err ? act.text : (wc?.uploadEnabled === false ? "chỉ render" : "tự upload"));
    sub.style.color = act.err ? "var(--accent-danger)" : "";
    const nw = wc?.warnings?.length || 0;
    warn.style.display = nw ? "" : "none"; warn.textContent = nw ? "⚠ " + nw : "";
    warn.title = nw ? wc.warnings.map((x) => x.message).join(String.fromCharCode(10)) : "";
    sw.setAttribute("aria-checked", String(!!c.enabled)); sw.setAttribute("aria-label", "Bật kênh " + c.name);
    tdPx.replaceChildren(wc && wc.proxy ? proxyPill(wc, true) : Object.assign(document.createElement("span"), { textContent: "—", className: "muted" }));
    const perDay = vs.perDay ?? c.videosPerDay ?? 0, today = vs.today ?? 0;
    tdToday.replaceChildren(Object.assign(document.createElement("b"), { textContent: String(today) }), Object.assign(document.createElement("span"), { textContent: "/" + perDay }));
    tdToday.classList.toggle("full", perDay > 0 && today >= perDay);
    tdErr.textContent = String(vs.errors || 0); tdErr.classList.toggle("has", (vs.errors || 0) > 0);
    tdTot.replaceChildren(Object.assign(document.createElement("b"), { textContent: String(vs.posted || 0) }), Object.assign(document.createElement("span"), { textContent: "/" + (vs.total || 0) }));
    tdTot.title = "Đã đăng " + (vs.posted || 0) + " trên tổng " + (vs.total || 0) + " video";
  }

  function renderCard(c) {
    if (!c.el) return;
    const { card, dot, pill, plug, quota, stats, updated, activity } = c.el;
    const act = activityText(c);
    const full = c.videosPerDay > 0 && c.countToday >= c.videosPerDay;

    card.classList.toggle("disabled", !c.enabled);
    card.classList.toggle("busy", act.busy);
    // Dải màu bên trái: đang chạy > đủ hôm nay > có lỗi. Chỉ một trạng thái thắng —
    // act.err đã tự tắt khi đủ quota (xem activityText), nên "full" luôn thắng "err".
    card.classList.toggle("err", !act.busy && act.err);
    card.classList.toggle("full", !act.busy && !act.err && full);

    const spin = act.busy || c.gpm.state === "busy";
    dot.className = "sw-dot" + (spin ? " busy"
      : c.gpm.state === "ok" ? " ok"
        : c.gpm.state === "ready" ? " ready"
          : c.gpm.state === "err" ? " err" : "");
    dot.title = c.gpm.msg || (act.busy ? "đang chạy" : "chưa kết nối GPM");

    plug.disabled = !c.profileId || c.gpm.state === "busy";
    plug.title = c.profileId ? "Mở YouTube Studio bằng profile GPM" : "Kênh chưa có GPM Profile ID trong ⚙config";

    quota.textContent = c.videosPerDay > 0 ? `${c.countToday}/${c.videosPerDay}` : "—";
    quota.classList.toggle("full", full);
    quota.title = "Số video đã render hôm nay / hạn mức mỗi ngày";

    const pv = pending.get(c.name) ?? [];
    pill.style.display = pv.length ? "" : "none";
    pill.textContent = `${pv.length} chờ đăng`;
    pill.title = `${pv.length} video đã render nhưng chưa lên lịch — mở card để đăng lại`;

    const s = c.stats;
    stats.textContent = !s ? "…"
      : s.error ? `⚠ ${s.error}`
        : s.updatedAt ? `${num(s.subscribers)} sub · ${num(s.views)} view · ${num(s.videoCount)} video`
          : (s.channelUrl ? "chưa làm mới số liệu" : "chưa điền cột Link kênh");
    stats.classList.toggle("warn", !!s?.error);
    // Số liệu đọc từ ⚙config có thể đã cũ — nói rõ nó cũ tới đâu.
    updated.textContent = s?.updatedAt && !s.error ? `cập nhật lúc ${s.updatedAt}` : "";

    // Ngày còn hạn của proxy và số video đã đăng (lấy từ cấu hình trên web, nạp ở lần mở tab hoặc sau khi sửa)
    const wc = window.ChannelConfigUI?.get(c.name);
    c.el.xinfo.replaceChildren();
    if (wc) {
      const posted = document.createElement("span");
      posted.textContent = `đã đăng ${wc.videoStats?.posted ?? 0}/${wc.videoStats?.total ?? 0} video`;
      c.el.xinfo.append(posted);
      if (wc.proxy) {
        const px = document.createElement("span");
        const d = wc.proxyDaysLeft;
        px.className = d == null ? "" : d <= 3 ? "px-bad" : d <= 7 ? "px-warn" : "px-ok";
        px.textContent = " · " + window.ChannelConfigUI.proxyLine(wc);
        c.el.xinfo.append(px);
      }
      if (wc.warnings?.length) { const w = document.createElement("span"); w.className = "px-warn"; w.textContent = ` · ⚠ ${wc.warnings.length} cảnh báo`; w.title = wc.warnings.map((x) => x.message).join(String.fromCharCode(10)); c.el.xinfo.append(w); }
    }

    activity.textContent = act.text;
    activity.classList.toggle("err", act.err);
    activity.title = act.text;

    renderVideos(c);
    renderRow(c); // cập nhật dòng bảng
  }

  function renderAll() { for (const c of channels.values()) renderCard(c); }

  // ===== Khung chi tiết bên phải (giống web: đầu khung, tab Cấu hình / Chạy) =====
  let sideTab = "cfg";
  function selectChannel(name, tab) {
    const prev = channels.get(selectedName);
    if (prev) prev.open = false;
    selectedName = name; if (tab) sideTab = tab;
    const c = channels.get(name);
    if (c) { c.open = true; refreshPending(c, true); }
    for (const x of channels.values()) renderRow(x);
    renderSide(true);
  }
  function renderSide(full) {
    if (!sideEl) return;
    const c = channels.get(selectedName);
    if (!c) { sideEl.replaceChildren(Object.assign(document.createElement("div"), { className: "cv-empty", textContent: "Chọn một kênh ở danh sách để xem và sửa cấu hình" })); return; }
    const wc = window.ChannelConfigUI?.get(c.name), vs = wc?.videoStats || {};
    // Sub text giống web: owner · máy · hôm nay x/y · z lỗi · đã đăng a/b video
    const subParts = [
      wc?.proxy ? (wc.proxyDaysLeft == null ? "Proxy chưa rõ hạn" : wc.proxyDaysLeft <= 0 ? "Proxy hết hạn" : "Proxy còn " + wc.proxyDaysLeft + " ngày") : "",
      // Hai con số khác nghĩa: "đã làm" = đã render hôm nay (đúng thứ chặn việc tải thêm), "đã up" = đã lên lịch hôm nay.
      "hôm nay: đã làm " + (c.countToday || 0) + "/" + (vs.perDay ?? c.videosPerDay ?? 0) + ", đã up " + (vs.today || 0),
      vs.errors ? vs.errors + " lỗi" : "",
      "đã đăng " + (vs.posted || 0) + "/" + (vs.total || 0) + " video"
    ].filter(Boolean).join(" · ");

    // Head với icon buttons giống web
    const headHtml = `
      <div class="cv-ptitle"><strong>${escHtml(c.name)}</strong><span>${escHtml(subParts)}</span></div>
      <div class="cv-pbtns">
        <button type="button" class="btn-icon ok" data-act="plug" title="${c.profileId ? 'Mở YouTube Studio bằng profile GPM' : 'Kênh chưa có GPM Profile ID'}" ${!c.profileId || c.gpm.state === "busy" ? "disabled" : ""}>${icon("plug")}</button>
        <button type="button" class="btn-icon" data-act="close" title="Đóng (Esc)">${icon("x")}</button>
      </div>`;

    // Tabs với icon giống web
    const tabsHtml = [["cfg", "Cấu hình", "settings"], ["run", "Video", "film"]].map(([id, label, ic]) =>
      `<button type="button" role="tab" aria-selected="${sideTab === id}" data-ptab="${id}" class="${sideTab === id ? "active" : ""}">${icon(ic)}${label}</button>`
    ).join("");

    sideEl.innerHTML = `<div class="cv-phead" id="cv-phead">${headHtml}</div><div class="cv-ptabs seg" id="cv-ptabs" role="tablist">${tabsHtml}</div><div class="cv-pbody" id="cv-pbody"></div>`;

    // Event listeners cho head buttons
    sideEl.querySelector('[data-act="plug"]')?.addEventListener("click", () => connectOne(c));
    sideEl.querySelector('[data-act="close"]')?.addEventListener("click", () => {
      const p = channels.get(selectedName); if (p) p.open = false;
      selectedName = null;
      for (const y of channels.values()) renderRow(y);
      renderSide(true);
    });
    // Event listeners cho tabs
    sideEl.querySelectorAll('[data-ptab]').forEach(btn => {
      btn.addEventListener("click", () => { sideTab = btn.dataset.ptab; renderSide(true); });
    });

    const body = sideEl.querySelector("#cv-pbody");
    if (sideTab === "cfg") {
      window.ChannelConfigUI?.mount(body, c.name, { refresh: false }).then(() => {});
    } else {
      c.open = true; renderVideos(c);
      const act = activityText(c);
      const s = document.createElement("div"); s.className = "cv-note" + (act.err ? " warn" : ""); s.textContent = act.text;
      const listBox = document.createElement("div"); listBox.className = "vl";
      body.append(s, listBox, c.el.body); c.el.body.style.display = "";
      mountUrlList(listBox, c);
    }
  }
  // Helper escape HTML
  function escHtml(v) { return String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  // ===== Danh sách URL của kênh (cùng dữ liệu với tab Video trên web) =====
  // Trạng thái theo kênh: bộ lọc, ô tìm, trang. Nhớ trong phiên để đổi qua lại giữa các kênh không mất.
  const urlView = new Map(); // tên kênh -> { rows, f, q, page, loading, err }
  const URL_PER_PAGE = 50;
  const VL = () => window.UrlList;
  const fmtNum = (n) => Number(n || 0).toLocaleString("vi-VN");
  function urlStateOf(name) {
    if (!urlView.has(name)) urlView.set(name, { rows: null, f: "all", q: "", page: 0, loading: false, err: null, sel: new Set(), busy: false, panelMode: null });
    return urlView.get(name);
  }
  // Làm lại / Đăng lại / Xóa: theo video đã tick, hoặc theo nhóm đang lọc khi không tick gì. Hỏi xác nhận trước (xóa là hành động nguy hiểm).
  async function runVideosAction(c, action, host) {
    const v = urlStateOf(c.name);
    if (v.busy || !v.rows) return;
    const ids = [...v.sel];
    const total = ids.length || VL().filterRows(v.rows, v.f, "").length;
    if (!total) { appToast("Không có video nào để thao tác", { kind: "warn" }); return; }
    const W = {
      reset: ["Làm lại từ đầu", "Trạng thái tải, render và upload sẽ bị xóa: app sẽ tải và render lại video này.", false],
      "retry-upload": ["Đăng lại", "Chỉ áp cho video đã render mà upload bị lỗi.", false],
      delete: ["Xóa khỏi danh sách", "Video bị xóa khỏi danh sách của kênh (không xóa trên YouTube).", true],
    }[action];
    if (!W) return;
    const ok = await window.appConfirm({ title: `${W[0]} ${total} video?`, message: ids.length ? `${ids.length} video đã chọn trong kênh ${c.name}.` : `Cả nhóm đang lọc của kênh ${c.name}.`, detail: W[1], confirmText: W[0], danger: W[2] });
    if (!ok) return;
    v.busy = true; paintUrlList(c, host);
    try {
      const r = await window.electronAPI.sheet.videosAction({ sheetName: c.name, action, ids: ids.length ? ids : undefined, filter: ids.length ? undefined : v.f });
      if (!r?.ok) { appToast(r?.error || "Không thao tác được", { kind: "error" }); log(`[${c.name}] ❌ ${W[0]} thất bại: ${r?.error || "lỗi"}`); return; }
      log(`[${c.name}] ✅ ${W[0]}: ${r.changed} video.`);
      appToast(r.changed ? `${W[0]}: ${r.changed} video` : "Không có video nào phù hợp để xử lý", { kind: r.changed ? "success" : "warn" });
      v.sel.clear();
    } catch (e) { appToast(e?.message || "Không thao tác được", { kind: "error" }); }
    finally { v.busy = false; loadUrlList(c, host); }
  }
  // Bấm "Thử lại": chỉ đặt lại trạng thái (không tự chạy lượt mới, tránh bất ngờ tốn tài nguyên), rồi nhắc người dùng bấm Chạy.
  async function retryFailedVideos(c, urls, btn, host) {
    const old = btn.textContent; btn.disabled = true; btn.textContent = "⏳ đang xử lý…";
    try {
      const r = await api.retryFailed({ sheetName: c.name, urls });
      if (!r?.ok) { appToast(r?.error || "Không thử lại được", { kind: "error" }); log(`[${c.name}] ❌ thử lại thất bại: ${r?.error || "lỗi"}`); return; }
      const parts = [r.reset ? r.reset + " video làm lại từ đầu" : "", r.uploads ? r.uploads + " video đang đăng lại" : ""].filter(Boolean);
      log(`[${c.name}] ↻ thử lại: ${parts.join(", ") || "không có gì để đổi"}${r.skipped?.length ? `, bỏ qua ${r.skipped.length}` : ""}.`);
      for (const s of r.skipped ?? []) log(`   • ${shortUrl(s.url)}: ${s.reason}`);
      appToast(parts.length ? "Đã thử lại: " + parts.join(", ") + (r.reset ? ". Bấm Chạy để làm tiếp." : "") : "Không có video nào thử lại được", { kind: parts.length ? "success" : "warn" });
    } catch (e) { appToast(e?.message || "Không thử lại được", { kind: "error" }); }
    finally { btn.disabled = false; btn.textContent = old; loadUrlList(c, host || null); }
  }

  async function loadUrlList(c, host) {
    const v = urlStateOf(c.name);
    if (v.loading) return;
    v.loading = true; v.err = null;
    if (host) paintUrlList(c, host);
    try {
      const r = await window.electronAPI.sheet.channelVideos(c.name);
      if (!r?.ok) throw new Error(r?.error || "Không tải được danh sách video");
      v.rows = r.rows || [];
      { const live = new Set(v.rows.map((x) => x.rowIndex)); for (const id of [...v.sel]) if (!live.has(id)) v.sel.delete(id); }
    } catch (e) { v.err = e?.message || String(e); }
    finally { v.loading = false; }
    // chỉ vẽ lại nếu người dùng vẫn đang xem đúng kênh này ở tab Video
    const still = sideEl?.querySelector(".vl");
    if (still && selectedName === c.name && sideTab === "run") paintUrlList(c, still);
  }
  function mountUrlList(host, c) {
    paintUrlList(c, host);
    loadUrlList(c, null);
  }
  function paintUrlList(c, host) {
    if (!host || !VL()) return;
    const v = urlStateOf(c.name);
    host.textContent = "";
    if (v.rows === null) {
      const d = document.createElement("div"); d.className = "vl-note";
      d.textContent = v.err ? "⚠ " + v.err : "⏳ Đang tải danh sách video…";
      if (v.err) { const b = document.createElement("button"); b.type = "button"; b.className = "sw-mini-btn"; b.textContent = "Thử lại"; b.addEventListener("click", () => loadUrlList(c, host)); d.append(" ", b); }
      host.append(d); return;
    }
    const sum = VL().summarize(v.rows);
    const head = document.createElement("div"); head.className = "vl-sum";
    const pill = (label, n, key) => {
      const b = document.createElement("button"); b.type = "button"; b.className = "vl-pill" + (v.f === key ? " on" : "");
      const strong = document.createElement("b"); strong.textContent = String(n);
      b.append(strong, " " + label);
      b.addEventListener("click", () => { v.f = key; v.page = 0; v.sel.clear(); paintUrlList(c, host); });
      return b;
    };
    head.append(pill("Tất cả", sum.total, "all"));
    for (const [k, label] of VL().FILTERS) if (k !== "all" && sum[k] > 0) head.append(pill(label, sum[k], k));
    const reload = document.createElement("button"); reload.type = "button"; reload.className = "sw-mini-btn"; reload.textContent = "⟳"; reload.title = "Nạp lại danh sách từ web";
    reload.addEventListener("click", () => loadUrlList(c, host));
    head.append(reload);
    // Thử lại video lỗi: đưa về làm lại (lỗi tải/render) hoặc đăng lại (lỗi upload). Chỉ đặt lại trạng thái; bấm Chạy để chạy tiếp.
    const failedUrls = VL().retryableUrls(v.rows);
    if (failedUrls.length) {
      const rb = document.createElement("button"); rb.type = "button"; rb.className = "sw-mini-btn"; rb.id = "vl-retry-all";
      rb.textContent = "↻ Thử lại " + failedUrls.length + " video lỗi";
      rb.title = "Làm lại video lỗi tải/render và đăng lại video lỗi upload. Sau đó bấm Chạy để tiếp tục.";
      rb.addEventListener("click", () => retryFailedVideos(c, failedUrls, rb, host));
      head.append(rb);
    }

    const bar = document.createElement("div"); bar.className = "vl-bar";
    const q = document.createElement("input"); q.type = "text"; q.placeholder = "Tìm trong danh sách…"; q.value = v.q; q.autocomplete = "off"; q.setAttribute("aria-label", "Tìm video");
    let qt = null;
    q.addEventListener("input", () => {
      clearTimeout(qt);
      qt = setTimeout(() => { v.q = q.value; v.page = 0; paintUrlList(c, host); const n = host.querySelector(".vl-bar input"); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 250);
    });
    bar.append(q);

    // Thanh thao tác: có tick video thì áp cho video đã chọn; không tick thì áp cho cả nhóm đang lọc (hỏi lại vì có thể rất nhiều).
    const acts = document.createElement("div"); acts.className = "vl-acts";
    const mkAct = (label, title, action, cls) => {
      const b = document.createElement("button"); b.type = "button"; b.className = "sw-mini-btn" + (cls ? " " + cls : ""); b.textContent = label; b.title = title; b.disabled = v.busy;
      b.addEventListener("click", () => runVideosAction(c, action, host));
      return b;
    };
    const mkImp = (label, title, mode) => {
      const b = document.createElement("button"); b.type = "button"; b.className = "sw-mini-btn" + (v.panelMode === mode ? " on" : ""); b.textContent = label; b.title = title; b.disabled = v.busy;
      b.addEventListener("click", () => { v.panelMode = v.panelMode === mode ? null : mode; paintUrlList(c, host); });
      return b;
    };
    const sp = document.createElement("span"); sp.className = "vl-sp";
    acts.append(
      mkImp("+ Dán danh sách", "Dán nhiều link, mỗi dòng một link", "paste"),
      mkImp("⬆ Nhập Excel", "Nhập từ file Excel (cột A link, B/C trạng thái)", "excel"),
      sp,
      mkAct("Làm lại", "Xóa trạng thái để tải và render lại từ đầu", "reset"),
      mkAct("Đăng lại", "Đăng lại các video đã render nhưng lỗi upload", "retry-upload"),
      mkAct("🗑 Xóa", "Xóa khỏi danh sách của kênh (không xóa trên YouTube)", "delete", "vl-danger"),
    );
    const scope = document.createElement("div"); scope.className = "vl-scope";
    const fLabel = (VL().FILTERS.find((x) => x[0] === v.f) || [])[1] || "";
    scope.textContent = v.sel.size ? `Thao tác áp cho ${v.sel.size} video đã chọn.` : v.f === "all" ? "Chưa chọn video: thao tác sẽ áp cho TOÀN BỘ danh sách." : `Chưa chọn video: thao tác áp cho nhóm “${fLabel}”.`;

    const list = VL().filterRows(v.rows, v.f, v.q);
    const pages = Math.max(1, Math.ceil(list.length / URL_PER_PAGE));
    v.page = Math.min(v.page, pages - 1);
    const slice = list.slice(v.page * URL_PER_PAGE, (v.page + 1) * URL_PER_PAGE);

    const box = document.createElement("div"); box.className = "vl-tbl";
    if (!slice.length) {
      const d = document.createElement("div"); d.className = "vl-note";
      d.textContent = sum.total ? "Không có video phù hợp bộ lọc." : "Kênh chưa có video nào. Bấm “Nhập link” để dán danh sách, hoặc “Lấy URL nguồn” / Nhập Excel.";
      box.append(d);
    } else {
      const table = document.createElement("table"); const tb = document.createElement("tbody");
      const allOn = slice.length > 0 && slice.every((r) => v.sel.has(r.rowIndex)), someOn = slice.some((r) => v.sel.has(r.rowIndex));
      const selAll = document.createElement("label"); selAll.className = "vl-selall";
      const allCb = document.createElement("input"); allCb.type = "checkbox"; allCb.checked = allOn; allCb.indeterminate = !allOn && someOn; allCb.setAttribute("aria-label", "Chọn cả trang");
      allCb.addEventListener("change", () => { for (const r of slice) allCb.checked ? v.sel.add(r.rowIndex) : v.sel.delete(r.rowIndex); paintUrlList(c, host); });
      selAll.append(allCb, " Chọn cả trang (" + slice.length + ")");
      box.append(selAll);
      for (const r of slice) {
        const key = VL().stateOf(r), tr = document.createElement("tr");
        const tdC = document.createElement("td"); tdC.className = "vl-sel";
        const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = v.sel.has(r.rowIndex); cb.setAttribute("aria-label", "Chọn video");
        cb.addEventListener("change", () => { cb.checked ? v.sel.add(r.rowIndex) : v.sel.delete(r.rowIndex); paintUrlList(c, host); });
        tdC.append(cb); tr.append(tdC);
        const tdU = document.createElement("td"); tdU.className = "vl-url"; tdU.textContent = r.url; tdU.title = r.url;
        const tdS = document.createElement("td"); const chip = document.createElement("span"); chip.className = "vl-chip " + (VL().TONE[key] || ""); chip.textContent = VL().LABEL[key]; tdS.append(chip);
        const det = VL().detailOf(r), tdD = document.createElement("td"); tdD.className = "vl-det"; tdD.textContent = det; tdD.title = det;
        if (VL().canRetry(r)) {
          const tdA = document.createElement("td"); const one = document.createElement("button"); one.type = "button"; one.className = "sw-mini-btn"; one.textContent = "Thử lại";
          one.addEventListener("click", () => retryFailedVideos(c, [r.url], one, host));
          tdA.append(one); tr.append(tdU, tdS, tdD, tdA);
        } else tr.append(tdU, tdS, tdD);
        tb.append(tr);
      }
      table.append(tb); box.append(table);
    }

    const pager = document.createElement("div"); pager.className = "vl-pager";
    const prev = document.createElement("button"); prev.type = "button"; prev.className = "sw-mini-btn"; prev.textContent = "Trước"; prev.disabled = v.page <= 0;
    const next = document.createElement("button"); next.type = "button"; next.className = "sw-mini-btn"; next.textContent = "Sau"; next.disabled = v.page >= pages - 1;
    prev.addEventListener("click", () => { v.page--; paintUrlList(c, host); });
    next.addEventListener("click", () => { v.page++; paintUrlList(c, host); });
    const info = document.createElement("span");
    info.textContent = list.length ? (v.page * URL_PER_PAGE + 1) + "–" + (v.page * URL_PER_PAGE + slice.length) + " / " + fmtNum(list.length) : "0";
    pager.append(prev, info, next);
    const panel = v.panelMode ? buildImportPanel(c, host, v) : null;
    host.append(head, bar, acts, scope, box, pager);
    if (panel) { host.append(panel); if (v.panelMode === "paste") { const t = panel.querySelector("textarea"); if (t) t.focus(); } }
  }
  // Web thêm/xóa/làm lại video hoặc app vừa ghi trạng thái: danh sách đang mở phải nạp lại
  function refreshUrlListIfOpen() {
    if (!selectedName || sideTab !== "run") return;
    const c = channels.get(selectedName), host = sideEl?.querySelector(".vl");
    if (c && host) loadUrlList(c, null);
  }

  async function toggleEnabled(c) {
    const wc = window.ChannelConfigUI?.get(c.name);
    if (!wc || !window.electronAPI?.sheet?.channelsUpdate) { setBanner("Chưa tải được cấu hình kênh từ web, thử lại sau ít giây.", "warn"); return; }
    if (window.ChannelConfigUI.isOffline()) { setBanner("Đang mất kết nối tới máy chủ: chưa bật/tắt được kênh.", "warn"); return; }
    const want = !c.enabled;
    c.enabled = want; renderRow(c); // phản hồi ngay, sai thì trả lại
    const r = await window.electronAPI.sheet.channelsUpdate(wc.id, { enabled: want, version: wc.version }).catch((e) => ({ ok: false, error: e.message }));
    if (!r || !r.ok) {
      c.enabled = !want; renderRow(c);
      setBanner(r && r.status === 409 ? "Kênh vừa được sửa ở nơi khác, đã nạp lại. Hãy bấm lại." : "Không đổi được: " + ((r && r.error) || "lỗi"), "warn");
      await window.ChannelConfigUI.load(); renderAll(); return;
    }
    await window.ChannelConfigUI.load(); renderAll();
  }

  // ===== Nạp danh sách kênh (một lần khi mở tab) =====
  let loaded = false;
  let loading = false;

  function setBanner(text, kind) {
    const el = $("sw-stats-banner");
    if (!el) return;
    if (!text) { el.style.display = "none"; return; }
    el.style.display = "";
    el.textContent = text;
    const red = kind === "error";
    el.style.background = red ? "#fdecea" : "#fff8e1";
    el.style.color = red ? "#c00" : "#7a5c00";
  }

  // Chỗ giữ chỗ khi lưới chưa có card nào. Không bao giờ được xoá card thật:
  // sự kiện runner có thể đã dựng card trước khi người dùng mở tab.
  function setEmpty(text) {
    tbody.querySelector(".sw-empty")?.parentElement?.remove();
    if (tbody.querySelector("tr[data-name]")) return;
    const tr = document.createElement("tr");
    const td = document.createElement("td"); td.colSpan = 6; td.className = "sw-empty"; td.textContent = text;
    tr.append(td); tbody.appendChild(tr);
  }

  async function loadChannelsOnce() {
    if (loaded || loading) return;
    loading = true;
    setEmpty("⏳ đang tải danh sách kênh…");
    try {
      const r = await api.gpmListChannels();
      if (!r?.ok) { setEmpty("Chưa tải được danh sách kênh."); setBanner(`❌ ${r?.error || "lỗi"}`, "error"); return; }
      dropMissing(r.channels.map((x) => x.sheetName));
      if (!r.channels.length) {
        selectedName = null; renderSide(true);
        if (!channels.size) setEmpty("Máy này chưa có kênh nào. Bấm “＋ Thêm kênh” hoặc “📥 Nhập Excel” ở trên để thêm.");
        loaded = true; return;
      }
      // Gộp, KHÔNG xoá: runner có thể đã chạy (autoRunOnOpen) và tạo card từ sự kiện
      // trước khi người dùng mở tab. Xoá sạch ở đây sẽ nuốt mất video đang chạy.
      tbody.querySelector(".sw-empty")?.parentElement?.remove();
      for (const ch of r.channels) {
        const c = ensureChannel(ch.sheetName);
        // Trim: ô Sheet hay dính khoảng trắng, mà probeGpm so id bằng khớp chuỗi tuyệt đối.
        c.profileId = (ch.gpmProfileId || "").trim();
        c.videosPerDay = ch.videosPerDay || 0;
        // runner-state đã tính cả video render trong phiên này, nhưng một video có thể
        // render xong giữa lúc đọc IPC và lúc này — lấy max để không bao giờ lùi số.
        c.countToday = Math.max(ch.countToday || 0, c.countToday);
        c.countDate = todayKey();
        c.enabled = ch.enabled !== false;
        tbody.appendChild(c.row.tr); // xếp lại theo thứ tự
        renderCard(c);
      }
      // Chọn kênh đầu tiên
      if (r.channels.length && !selectedName) selectChannel(r.channels[0].sheetName);
      else renderSide(true);
      loaded = true;
      setBanner("", null);
      // Tên kênh + @handle nguồn: đọc thẳng từ Sheet, KHÔNG gọi YouTube API (không tốn quota).
      applyStats(await api.listStatsChannels());
      probeGpm(); // ngầm, không chặn: card hiện số liệu trước, chấm GPM sáng sau.
      // Chạy nền: 13 tab Sheet, mỗi tab một lượt đọc. Không chặn việc hiện card.
      refreshAllPending();
      // Cấu hình đầy đủ từ web (hạn proxy, số video đã đăng, cảnh báo) để hiện trên thẻ; sửa xong thì thẻ tự cập nhật.
      pushProxyAddr(true).finally(() => window.ChannelConfigUI?.load().then(() => renderAll()).catch(() => {}));
      if (!window.__ccuHooked && window.ChannelConfigUI) {
        window.__ccuHooked = true;
        window.ChannelConfigUI.onChange(() => { window.ChannelConfigUI.load().then(() => { renderAll(); loaded = false; loadChannelsOnce(); }).catch(() => {}); });
      }
    } catch (err) {
      setEmpty("Chưa tải được danh sách kênh.");
      setBanner(`❌ Lỗi khi tải danh sách kênh: ${err.message}`, "error");
    } finally {
      loading = false;
    }
  }

  // runner-state.json là nguồn sự thật của quota (nó tự reset sang ngày mới). Bộ đếm
  // countToday trong UI chỉ là phỏng đoán lạc quan để phản hồi ngay lúc render xong, nên
  // phải đối chiếu lại sau MỖI lượt chạy — không thì nó cộng dồn qua nhiều ngày và hiện
  // ra kiểu "6/3". Cũng là lúc cập nhật videosPerDay nếu ⚙config đổi.
  async function syncQuota() {
    try {
      const r = await api.gpmListChannels();
      if (!r?.ok) return;
      // Web thêm/xóa/chuyển kênh: danh sách đổi thì nạp lại cả bảng (loadChannelsOnce thêm kênh mới và gỡ kênh không còn).
      // Kênh đang chạy dở bị web xóa vẫn được giữ lại tới khi chạy xong, nên chỉ so các kênh còn tồn tại ở cả hai phía.
      const webNames = new Set(r.channels.map((x) => x.sheetName));
      const added = r.channels.some((x) => !channels.has(x.sheetName));
      const gone = [...channels.keys()].some((n) => !webNames.has(n) && !isBusy(channels.get(n)));
      if (loaded && (added || gone)) { loaded = false; loadChannelsOnce(); return; }
      for (const ch of r.channels) {
        const c = ensureChannel(ch.sheetName);
        c.countToday = ch.countToday || 0;
        c.countDate = todayKey();
        c.videosPerDay = ch.videosPerDay || 0;
        c.enabled = ch.enabled !== false; // bật/tắt ở web phải ăn theo
        c.profileId = (ch.gpmProfileId || "").trim();
        renderCard(c);
      }
    } catch { /* im lặng: chỉ là đối chiếu số liệu, không phải việc chính */ }
  }

  // Tự đồng bộ với web: định kỳ và khi quay lại cửa sổ app. Không dựng lại khung chi tiết
  // (tránh mất chữ đang gõ dở); chỉ cập nhật bảng và số liệu.
  let webSyncing = false;
  // opts.manual: người dùng bấm nút "Tải lại"; opts.signal: server báo có thay đổi. Cả hai chạy kể cả khi cửa sổ đang
  // ẩn/không focus (đúng lúc người dùng đang sửa ở web). Chỉ vòng hỏi lại định kỳ mới bỏ qua khi cửa sổ ẩn.
  async function syncFromWeb(opts = {}) {
    const forced = opts.manual || opts.signal;
    if (!loaded || loading || webSyncing || (document.hidden && !forced)) return false;
    webSyncing = true;
    try {
      // Nạp cấu hình trước để giao diện đổi ngay; việc hỏi GPM (chậm hơn) chạy sau, không chặn
      await window.ChannelConfigUI?.load();
      await syncQuota();
      renderAll();
      pushProxyAddr(!!opts.manual).catch(() => {});
      return true;
    } catch { return false; } finally { webSyncing = false; }
  }
  // Gửi địa chỉ proxy (chỉ ip:port, không user/mật khẩu) của GPM profile lên web để tra hạn. GPM tắt thì bỏ qua.
  // Chạy tối đa 1 lần/2 phút: GPM không đổi proxy thường xuyên và mỗi lần phải hỏi GPM liệt kê profile.
  let lastProxyPush = 0;
  async function pushProxyAddr(force = false) {
    if (!window.electronAPI?.sheet?.syncProxy) return;
    if (!force && Date.now() - lastProxyPush < 120000) return;
    lastProxyPush = Date.now();
    try { await window.electronAPI.sheet.syncProxy(); } catch { /* GPM không chạy: bỏ qua */ }
  }
  // Server báo qua kết nối giám sát: nạp lại ngay (gộp tín hiệu sát nhau). Hỏi lại định kỳ chỉ còn là lưới an toàn
  // phòng tín hiệu bị mất khi đứt mạng, nên thưa hơn nhiều so với trước.
  let syncDebounce = null;
  api.onChannelsChanged?.(() => { clearTimeout(syncDebounce); syncDebounce = setTimeout(() => { syncFromWeb({ signal: true }); refreshUrlListIfOpen(); }, 300); });
  setInterval(() => syncFromWeb(), 120000);
  window.addEventListener("focus", () => syncFromWeb());

  // Thêm kênh / Nhập Excel / Template: app là nơi tạo kênh Auto (server lưu, web chỉ xem). Xong thì danh sách tự nạp lại qua ChannelConfigUI.onChange.
  $("sw-add-channel")?.addEventListener("click", () => window.ChannelConfigUI?.openCreate());
  $("sw-templates")?.addEventListener("click", () => window.ChannelConfigUI?.openTemplates());
  $("sw-import-channels")?.addEventListener("click", () => window.ChannelConfigUI?.openImport());

  // Nút "Tải lại": nạp ngay cấu hình từ server, không phụ thuộc socket. Dùng khi nghi app chưa ăn theo.
  const reloadBtn = $("sw-reload-web");
  reloadBtn?.addEventListener("click", async () => {
    if (reloadBtn.disabled) return;
    const label = reloadBtn.textContent;
    reloadBtn.disabled = true; reloadBtn.textContent = "⏳ Đang tải…";
    try {
      if (!loaded) { loadChannelsOnce(); await new Promise((r) => setTimeout(r, 400)); }
      else {
        const ok = await syncFromWeb({ manual: true });
        refreshUrlListIfOpen();
        if (!ok) throw new Error("Chưa tải lại được, thử lại sau ít giây");
      }
      setBanner("", null);
      appToast("Đã tải lại cấu hình từ web", { kind: "success" });
    } catch (e) { appToast(e?.message || "Không tải lại được", { kind: "error" }); }
    finally { reloadBtn.disabled = false; reloadBtn.textContent = label; }
  });

  const MISSING_LABEL = {
    subscribers: "Sub", totalViews: "Tổng view",
    videoCount: "Số video", statsUpdatedAt: "Cập nhật lúc",
  };

  function applyStats(res) {
    if (!res?.ok) { setBanner(`❌ ${res?.error || "Làm mới số liệu thất bại"}`, "error"); return; }

    const allFailed = res.rows.length > 0 && res.rows.every((r) => r.error);
    if (allFailed) setBanner(`❌ Mọi kênh đều lỗi: ${res.rows[0].error}`, "error");
    else if (res.missing?.length) setBanner(`⚠️ Thiếu cột trong ⚙config: ${res.missing.map((k) => MISSING_LABEL[k]).join(", ")}`, "warn");
    else setBanner("", null);

    for (const r of res.rows) {
      const c = ensureChannel(r.sheetName);
      c.stats = r;
      renderCard(c);
    }
  }

  // ===== GPM =====

  // Hỏi GPM ngầm: profile nào ghi trong ⚙config thật sự tồn tại bên GPM. Chỉ ĐỌC danh
  // sách profile — không start trình duyệt nào. Chạy lúc mở app nên phải im lặng: hỏng
  // thì chấm xám + một dòng log, không banner đỏ.
  async function probeGpm() {
    if (!$("sw-gpm-enabled")?.checked || !channels.size) return;
    const host = $("sw-gpm-host").value.trim() || "127.0.0.1:19995";

    // Kênh đang kết nối / đã mở Studio thì giữ nguyên — probe không được hạ cấp nó.
    const pending = [...channels.values()].filter((c) => c.gpm.state !== "busy" && c.gpm.state !== "ok");
    if (!pending.length) return;

    const r = await api.gpmTest(host).catch((err) => ({ ok: false, error: String(err?.message || err) }));
    if (!r?.ok) {
      const msg = r?.error || "không kết nối được";
      for (const c of pending) c.gpm = { state: "idle", msg: `Chưa thấy GPM tại ${host} — ${msg}` };
      log(`⚠ Chưa kết nối được GPM (${host}): ${msg}`);
      renderAll();
      return;
    }

    const byId = new Map(r.profiles.map((p) => [String(p.id), p.name]));
    for (const c of pending) {
      // Người dùng có thể đã bấm 🔌 trong lúc chờ HTTP — kiểm lại, đừng đè lên.
      if (c.gpm.state === "busy" || c.gpm.state === "ok") continue;
      if (!c.profileId) { c.gpm = { state: "idle", msg: "Kênh chưa có GPM Profile ID trong ⚙config" }; continue; }
      const name = byId.get(c.profileId);
      c.gpm = name
        ? { state: "ready", msg: `GPM sẵn sàng — profile “${name}”` }
        : { state: "err", msg: `GPM không có profile ${c.profileId}` };
    }
    const ok = [...channels.values()].filter((c) => c.gpm.state === "ready" || c.gpm.state === "ok").length;
    log(`🔌 GPM (${host}): ${r.profiles.length} profile — ${ok}/${channels.size} kênh đã sẵn sàng.`);
    renderAll();
  }

  async function connectOne(c) {
    if (!c.profileId) return;
    c.gpm = { state: "busy", msg: "đang kết nối…" };
    renderCard(c);
    const r = await api.gpmConnect({ gpmHost: $("sw-gpm-host").value.trim(), profileId: c.profileId, sheetName: c.name });
    c.gpm = r?.ok
      ? { state: "ok", msg: "đã mở YouTube Studio" }
      : { state: "err", msg: r?.error || "kết nối thất bại" };
    if (!r?.ok) log(`[${c.name}] ❌ GPM: ${c.gpm.msg}`);
    renderCard(c);
  }

  $("sw-gpm-connect-all")?.addEventListener("click", async () => {
    for (const c of channels.values()) if (c.profileId) await connectOne(c);
  });

  // ===== Cấu hình (modal) =====
  const cfgModal = $("sw-config-modal");
  const openCfg = () => cfgModal.classList.add("active");
  const closeCfg = () => cfgModal.classList.remove("active");
  $("sw-open-config")?.addEventListener("click", openCfg);
  $("sw-config-close")?.addEventListener("click", closeCfg);
  cfgModal?.addEventListener("click", (e) => { if (e.target === cfgModal) closeCfg(); });
  document.addEventListener("keydown", (e) => {
    // Listener toàn cục: chạy ở MỌI phím bấm, nên phải chịu được cfgModal thiếu.
    if (e.key === "Escape" && cfgModal?.classList.contains("active")) closeCfg();
  });

  // ----- Giám sát trên web -----
  const MONITOR_COLORS = { connected: "#51cf66", connecting: "#fcc419", error: "#ff6b6b", off: "#64748b" };
  function showMonitorStatus(st) {
    const el = $("sw-monitor-status");
    if (!el || !st) return;
    el.textContent = `● ${st.message || ""}`;
    el.style.color = MONITOR_COLORS[st.state] || MONITOR_COLORS.off;
    if (st.machineId) $("sw-monitor-machine").textContent = `Machine ID của máy này: ${st.machineId}`;
  }
  api.monitorStatus?.().then(showMonitorStatus).catch(() => {});
  api.onMonitorStatus?.((st) => showMonitorStatus({ ...st, machineId: undefined }));

  // "Connect tất cả" chỉ có nghĩa khi GPM bật.
  function syncGpmVisibility() {
    const on = $("sw-gpm-enabled").checked;
    $("sw-gpm-panel").style.display = on ? "" : "none";
    $("sw-gpm-connect-all").style.display = on ? "" : "none";
  }

  // Cấu hình cookie 1-file từ bản cũ. Không còn ô nhập, chỉ đọc lên rồi ghi lại
  // nguyên vẹn để lần lưu tiếp theo không xoá mất cookie của người đang dùng nó.
  let legacyCookiesFile = "";

  async function loadSettings() {
    const s = await api.loadSettings();
    $("sw-root").value = s.channelsRoot || "";
    $("sw-poll").value = s.pollSec || 300;
    $("sw-auto-open").checked = !!s.autoRunOnOpen;
    $("sw-video-speed").value = (typeof s.videoSpeed === "number" && s.videoSpeed > 0) ? s.videoSpeed : 0.95;
    $("sw-use-gpu").checked = !!s.useGPU;
    $("sw-cleanup").checked = !!s.cleanupEnabled;
    $("sw-cleanup-days").value = s.cleanupKeepDays ?? 1;
    $("sw-gpm-enabled").checked = !!s.gpmEnabled;
    $("sw-gpm-host").value = s.gpmHost || "127.0.0.1:19995";
    $("sw-gpm-idle-close").value = s.gpmIdleCloseMin ?? 10;
    $("sw-gpm-tg-enabled").checked = !!s.gpmTelegramEnabled;
    $("sw-gpm-tg-token").value = s.gpmTelegramToken || "";
    $("sw-gpm-tg-chat").value = s.gpmTelegramChatId || "";
    $("sw-gpm-tg-topic").value = s.gpmTelegramTopicId || "";
    $("sw-gpm-tg-photo").checked = !!s.gpmTelegramPhoto;
    $("sw-gpm-tg-fields").style.display = s.gpmTelegramEnabled ? "" : "none";
    $("sw-cookies-folder").value = s.cookiesFolder || "";
    // Ô chọn 1 file cookie đã bỏ khỏi UI (chỉ còn thư mục), nhưng giá trị cũ vẫn
    // phải giữ và ghi lại: xoá đi là người đang chạy bằng 1 file cookie mất sạch
    // cookie ngay lần lưu tiếp theo.
    legacyCookiesFile = s.cookiesFile || "";
    syncCookiesHint();
    syncGpmVisibility();
    syncCleanupHint();
  }

  // Chỉ hiện lời cảnh báo khi người dùng thật sự bật — tắt thì nó chỉ là nhiễu.
  function syncCleanupHint() {
    const hint = $("sw-cleanup-hint");
    if (hint) hint.style.display = $("sw-cleanup").checked ? "" : "none";
  }

  // Cho biết lượt tải sắp tới lấy cookie ở đâu — hai chỗ cấu hình cookie mà không
  // nói rõ chỗ nào đang có tác dụng thì rất dễ sửa nhầm chỗ rồi tưởng app hỏng.
  function syncCookiesHint() {
    const hint = $("sw-cookies-hint");
    if (!hint) return;
    const folder = $("sw-cookies-folder").value.trim();
    if (folder) {
      hint.textContent =
        'Đang dùng thư mục cookie riêng của Sheet. Xoá bằng nút × để quay lại cookie ở tab "Tải video".';
    } else if (legacyCookiesFile) {
      hint.textContent = `Đang dùng file cookie cũ đã cấu hình trước đây (${legacyCookiesFile}). Chọn thư mục để chuyển sang xoay vòng nhiều cookie.`;
    } else {
      hint.textContent = 'Để trống thì dùng cookie đã cấu hình ở tab "Tải video".';
    }
  }
  // Ô "giữ N ngày": trống/sai -> 1. KHÔNG dùng `|| 0` như các ô số khác, vì ở đây 0 là
  // giá trị HỢP LỆ (xoá ngay khi upload xong) — ô bỏ trống mà hoá 0 là xoá nhầm video hôm nay.
  function cleanupKeepDaysValue() {
    const n = parseInt($("sw-cleanup-days").value, 10);
    return Number.isFinite(n) && n >= 0 ? n : 1;
  }

  function currentSettings() {
    return {
      channelsRoot: $("sw-root").value.trim(),
      pollSec: parseInt($("sw-poll").value, 10) || 300,
      autoRunOnOpen: $("sw-auto-open").checked,
      videoSpeed: parseFloat($("sw-video-speed").value) > 0 ? parseFloat($("sw-video-speed").value) : 0.95,
      useGPU: $("sw-use-gpu").checked,
      cleanupEnabled: $("sw-cleanup").checked,
      cleanupKeepDays: cleanupKeepDaysValue(),
      gpmEnabled: $("sw-gpm-enabled").checked,
      gpmHost: $("sw-gpm-host").value.trim() || "127.0.0.1:19995",
      gpmIdleCloseMin: Math.max(0, parseInt($("sw-gpm-idle-close").value, 10) || 0),
      gpmTelegramEnabled: $("sw-gpm-tg-enabled").checked,
      gpmTelegramToken: $("sw-gpm-tg-token").value.trim(),
      gpmTelegramChatId: $("sw-gpm-tg-chat").value.trim(),
      gpmTelegramTopicId: $("sw-gpm-tg-topic").value.trim(),
      gpmTelegramPhoto: $("sw-gpm-tg-photo").checked,
      monitorEnabled: true, // app luôn đồng bộ lên web (đã bỏ ô tick bật/tắt)
      // Trống = cố ý lùi về cookie ở tab "Tải video", nên phải ghi xuống chuỗi rỗng
      // chứ không được bỏ khoá đi.
      cookiesFolder: $("sw-cookies-folder").value.trim(),
      // Không còn UI, chỉ chép lại nguyên giá trị đã lưu để không xoá mất cấu hình cũ.
      cookiesFile: legacyCookiesFile,
    };
  }

  // Tự động lưu cấu hình mỗi khi thay đổi (không có nút "Lưu").
  let saveTimer = null;
  async function saveNow() { await api.saveSettings(currentSettings()); }
  function saveDebounced() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 400); }
  ["sw-poll", "sw-video-speed", "sw-gpm-idle-close", "sw-cleanup-days"].forEach((id) =>
    $(id)?.addEventListener("input", saveDebounced));
  ["sw-auto-open", "sw-use-gpu", "sw-gpm-enabled", "sw-gpm-tg-photo"].forEach((id) =>
    $(id)?.addEventListener("change", saveNow));
  $("sw-cleanup")?.addEventListener("change", () => { syncCleanupHint(); saveNow(); });
  ["sw-gpm-host", "sw-gpm-tg-token", "sw-gpm-tg-chat", "sw-gpm-tg-topic"].forEach((id) =>
    $(id)?.addEventListener("input", saveDebounced));
  $("sw-gpm-enabled")?.addEventListener("change", syncGpmVisibility);
  $("sw-gpm-tg-enabled")?.addEventListener("change", () => {
    $("sw-gpm-tg-fields").style.display = $("sw-gpm-tg-enabled").checked ? "" : "none";
    saveNow();
  });

  // Cookie riêng cho luồng Sheet. Dùng thẳng selectFolder/selectFile ở gốc
  // electronAPI — cùng IPC mà tab "Tải video" đang dùng, khỏi thêm kênh sheet: mới.
  $("sw-pick-cookies-folder")?.addEventListener("click", async () => {
    const p = await window.electronAPI?.selectFolder();
    if (p) { $("sw-cookies-folder").value = p; syncCookiesHint(); await saveNow(); }
  });
  $("sw-clear-cookies-folder")?.addEventListener("click", async () => {
    $("sw-cookies-folder").value = ""; syncCookiesHint(); await saveNow();
  });
  $("sw-pick-root")?.addEventListener("click", async () => {
    const p = await api.selectRoot(); if (p) { $("sw-root").value = p; await saveNow(); }
  });
  $("sw-gpm-test")?.addEventListener("click", async () => {
    const statusEl = $("sw-gpm-test-status");
    statusEl.textContent = "⏳ đang kiểm tra…"; statusEl.style.color = "#666";
    const r = await api.gpmTest($("sw-gpm-host").value.trim());
    if (r?.ok) {
      // Kèm version API đã dò được (v3 = GPM bản cũ, v1 = bản mới) cho dễ soi máy nào chạy bản nào.
      const ver = r.apiVersion ? ` (API ${r.apiVersion})` : "";
      statusEl.textContent = `✅ ${r.profiles.length} profiles${ver}`; statusEl.style.color = "#1a7f37";
    }
    else { statusEl.textContent = `❌ ${r?.error || "lỗi"}`; statusEl.style.color = "#c00"; }
    probeGpm(); // đổi host xong bấm Test — soi lại chấm trạng thái trên card luôn.
  });
  $("sw-gpm-tg-test")?.addEventListener("click", async () => {
    const statusEl = $("sw-gpm-tg-status");
    const token = $("sw-gpm-tg-token").value.trim();
    const chatId = $("sw-gpm-tg-chat").value.trim();
    const topicId = $("sw-gpm-tg-topic").value.trim(); // trống = gửi vào General
    if (!token || !chatId) { statusEl.textContent = "❌ thiếu token/chat ID"; statusEl.style.color = "#c00"; return; }
    statusEl.textContent = "⏳ đang gửi…"; statusEl.style.color = "#666";
    await saveNow();
    const r = await api.gpmTestTelegram(token, chatId, topicId);
    if (r?.ok) { statusEl.textContent = "✅ đã gửi — kiểm tra Telegram"; statusEl.style.color = "#1a7f37"; }
    else { statusEl.textContent = `❌ ${r?.error || "lỗi"}`; statusEl.style.color = "#c00"; }
  });

  // ===== Thanh công cụ =====
  $("sw-start")?.addEventListener("click", async () => { await saveNow(); await api.start(); log("▶ Bắt đầu theo dõi."); });
  $("sw-stop")?.addEventListener("click", async () => { await api.stop(); log("⏹ Đã dừng."); });
  $("sw-run-now")?.addEventListener("click", async () => { await saveNow(); log("Chạy tất cả ngay…"); await api.runNow(); });

  // Test render: xem thử bản render của từng kênh (1 video, 30s), KHÔNG upload và không
  // ghi gì vào Sheet. Khoá nút trong lúc chạy — mỗi lượt là một dây yt-dlp + ffmpeg, bấm
  // chồng chỉ nhận lại câu "lượt chạy trước chưa xong".
  async function runSheetTestRender(sheetName, btn) {
    const label = btn ? btn.textContent : null;
    if (btn) { btn.disabled = true; btn.textContent = "⏳ đang test…"; }
    try {
      await saveNow();
      log(sheetName ? `🧪 Test render kênh "${sheetName}"…` : "🧪 Test render tất cả kênh đang bật…");
      const r = await api.testRender(sheetName);
      if (r && r.success === false) log(`❌ Test render: ${r.error}`);
    } catch (err) {
      log(`❌ Test render lỗi: ${err.message}`);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = label; }
    }
  }

  $("sw-test-render")?.addEventListener("click", (e) => runSheetTestRender(undefined, e.currentTarget));
  $("sw-stats-refresh")?.addEventListener("click", async () => {
    const btn = $("sw-stats-refresh");
    btn.disabled = true;
    setBanner("⏳ đang lấy số liệu…", "warn");
    try { applyStats(await api.refreshStats()); }
    catch (err) { applyStats({ ok: false, error: `Lỗi khi làm mới: ${err.message}` }); }
    finally { btn.disabled = false; }
  });

  // ===== Sự kiện từ runner =====
  api.onEvent((evt) => {
    if (evt.type === "channel-status") {
      // Có url → cập nhật video đó; không có url = thông báo cấp kênh → chỉ ghi log.
      if (evt.url) {
        const c = ensureChannel(evt.channel);
        touchVideo(c, evt.url).state = evt.status;
        renderCard(c);
      }
      log(`[${evt.channel}] ${evt.status}${evt.url ? " — " + shortUrl(evt.url) : ""}`);
    } else if (evt.type === "video-rendered") {
      const c = ensureChannel(evt.channel);
      touchVideo(c, evt.sourceUrl, evt.title).state = "✅ render xong";
      // Quota chỉ tính theo video render được, khớp recordRendered. Sang ngày mới thì
      // runner đã reset quota của nó — bộ đếm UI phải reset theo, không cộng tiếp.
      if (c.countDate !== todayKey()) { c.countToday = 0; c.countDate = todayKey(); }
      c.countToday++;
      renderCard(c);
      log(`[${evt.channel}] ✅ render: ${evt.title}`);
    } else if (evt.type === "upload-status") {
      const c = ensureChannel(evt.channel);
      touchVideo(c, evt.url, evt.title).upload = evt.status;
      // Vừa lên lịch xong -> video không còn là việc "chờ đăng" nữa; bỏ ngay khỏi danh sách
      // để pill không hiện số cũ tới lần nạp lại.
      if (evt.url && /^✅/.test(evt.status || "")) {
        const list = pending.get(evt.channel);
        if (list?.some((v) => v.url === evt.url)) {
          pending.set(evt.channel, list.filter((v) => v.url !== evt.url));
        }
      } else if (evt.url && /^❌/.test(evt.status || "")) {
        // Đăng lại vừa hỏng -> phải đưa dòng đó trở lại panel (lượt này nó đã bị bỏ khỏi
        // danh sách một cách lạc quan lúc bấm nút). Một lượt đọc tab, chỉ khi thật sự hỏng.
        refreshPending(c, true);
      }
      renderCard(c);
      log(`[${evt.channel}] ${evt.status}${evt.title ? " — " + evt.title : ""}`);
    } else if (evt.type === "stats") {
      applyStats(evt);
    } else if (evt.type === "error") {
      if (evt.url) {
        const c = ensureChannel(evt.channel);
        ensureVideo(c, evt.url).error = evt.message;
        renderCard(c);
      }
      log(`❌ ${evt.channel ? "[" + evt.channel + "] " : ""}${evt.message}`);
    } else if (evt.type === "done") {
      log("— Hoàn tất lượt chạy —");
      syncQuota();
      // Lượt vừa xong có thể đã đăng được video đang kẹt -> đọc lại danh sách chờ đăng
      // của những card đang mở (card đóng tự nạp lại khi mở ra).
      refreshAllPending(true, { openOnly: true });
    }
  });

  // Bấm vào tab là một lần thử lại, phòng khi lượt nạp lúc khởi động thất bại
  // (chưa cấu hình Sheet, mạng hỏng). `loaded` chặn nạp trùng.
  document.querySelector('.tab-button[data-tab="sheet-watch"]')
    ?.addEventListener("click", () => { loadChannelsOnce(); });

  // Nạp kênh + số liệu ngay khi mở app. Chỉ đọc Sheet (số liệu đã lưu sẵn trong
  // ⚙config), không gọi YouTube API — không tốn quota. Chưa cấu hình thì bỏ qua,
  // để tránh một banner lỗi đập vào mặt người dùng mới cài.
  loadSettings().then(() => {
    loadChannelsOnce(); // dữ liệu kênh lấy từ web; chưa đăng nhập/mất mạng thì hiện thông báo ngay trong tab
  });
})();

// (Khối "Tự động hóa theo Sheet" đã bỏ: tạo profile/đăng nhập/tạo channel làm ở tab Tự động hóa bằng file Excel, mật khẩu không lên web.)


// ----- Tải file Excel mẫu (dùng chung cho Auto Login, Tạo channel và khung Sheet) -----
async function downloadExcelSample(kind) {
  if (!checkElectronAPI()) return;
  try {
    const r = await window.electronAPI.automation.saveSample(kind);
    if (!r.success) { alert(`Không lưu được file mẫu: ${r.error}`); return; }
    if (r.canceled) return;
    showAutomationOutput?.(`📄 Đã lưu file mẫu: ${r.path}`);
    alert(`Đã lưu file mẫu:\n${r.path}`);
  } catch (error) {
    alert(`Không lưu được file mẫu: ${getErrorMessage(error)}`);
  }
}

// ============================================================================
// TỰ ĐỘNG HOÁ (GPM): chạy trên các profile GPM do người dùng chọn.
// Danh sách profile lấy trực tiếp từ GPM local. Luồng Google Sheet (tạo profile, gán proxy,
// tạo channel) nằm ở tab Theo dõi Sheet.
// ============================================================================

// Mỗi mục sidebar = một chức năng. `sub` trùng id khối tuỳ chọn (#automation-sub-<sub>).
const AUTOMATION_TASKS = {
  login:         { title: "Auto Login", api: "login", btn: "▶ Đăng nhập", excel: "login",
    desc: "Mở từng profile GPM đã chọn và đăng nhập Gmail vào YouTube Studio (hỗ trợ 2FA và mail khôi phục). Tài khoản lấy từ file Excel." },
  thumb:         { title: "Auto đổi Thumbnail", api: "changeThumb", btn: "▶ Đổi thumbnail", preview: "run",
    desc: "Với mỗi profile: vào Content, lọc video Scheduled, đổi thumbnail theo ảnh trùng tên video, rồi gắn end screen ngẫu nhiên." },
  schedule:      { title: "Auto Lên lịch", api: "schedule", btn: "▶ Lên lịch", preview: "run",
    desc: "Với mỗi profile: lọc video Draft và đặt lịch lần lượt theo giờ đăng, mỗi ngày một lượt, tính từ ngày kế tiếp." },
  distribute:    { title: "Rải video cho kênh", api: "distribute", btn: "▶ Rải và đăng", preview: "distribute",
    desc: "Chia video trong một thư mục cho các profile đã chọn, tải lên và đặt lịch theo giờ đăng. Nên bấm Xem trước để kiểm tra cách chia." },
  proxycheck:    { title: "Kiểm tra proxy", api: "proxyCheck", btn: "▶ Kiểm tra proxy", noPreview: true, concurrencyLabel: "Số proxy kiểm tra cùng lúc",
    desc: "Kiểm tra proxy đang gán trong từng profile GPM: sống hay chết và IP thoát ra. Mật khẩu proxy không bao giờ hiện." },
  createchannel: { title: "Tạo channel", api: "createChannel", btn: "▶ Tạo channel", excel: "plan",
    desc: "Với mỗi profile: cài đặt kênh (tag, mặc định tải lên) rồi tuỳ chỉnh kênh (tên, handle, mô tả) và xuất bản. Thông tin lấy từ file Excel." },
  changega:      { title: "Đổi GA", noProfile: true, noPreview: true,
    desc: "Chuyển kênh YouTube sang Google Account khác. Nhập Channel ID và cookies, tool sẽ tạo link xác thực để đổi GA." },
};
let automationCurrent = "login";
let automationProfiles = []; // [{ id, name, groupId, hasProxy, proxyMasked }]
let automationGroups = [];   // [{ id, name }]
const automationSelected = new Set(); // id profile đã tick (giữ nguyên khi đổi bộ lọc)
let automationRunning = false;

const autoVal = (id) => document.getElementById(id)?.value?.trim() || "";
const autoHost = () => autoVal("automation-gpm-host") || "127.0.0.1:19995";

// ----- Chọn chức năng -----
function selectAutomationSubTab(sub) {
  if (!AUTOMATION_TASKS[sub]) sub = "login";
  automationCurrent = sub;
  const t = AUTOMATION_TASKS[sub];
  document.querySelectorAll("#automation .automation-sub").forEach((el) => {
    el.style.display = el.id === `automation-sub-${sub}` ? "" : "none";
  });
  document.getElementById("automation-title").textContent = t.title;
  document.getElementById("automation-desc").textContent = t.desc;
  if (sub === "thumb") renderThumbOverrides();

  // Ẩn/hiện các element dựa vào task type
  const runBtn = document.getElementById("automation-run-btn");
  const pvBtn = document.getElementById("automation-preview-btn");
  const cw = document.getElementById("automation-concurrency-wrap");
  const sidebar = document.querySelector("#automation .auto-sidebar");
  const actionBtns = document.querySelector("#automation .action-buttons");

  if (t.noProfile) {
    // Task không cần profile GPM (như changega)
    if (sidebar) sidebar.style.display = "none";
    if (actionBtns) actionBtns.style.display = "none";
  } else {
    if (sidebar) sidebar.style.display = "";
    if (actionBtns) actionBtns.style.display = "";
    if (runBtn) runBtn.textContent = t.btn;
    if (cw) cw.querySelector("label").textContent = t.concurrencyLabel || "Số profile chạy cùng lúc";
    if (pvBtn) pvBtn.style.display = t.noPreview ? "none" : "";
  }
}
document.querySelectorAll('.tab-button[data-tab="automation"]').forEach((btn) => {
  btn.addEventListener("click", () => {
    selectAutomationSubTab(btn.dataset.sub || "login");
    if (!automationProfiles.length) loadAutomationProfiles();
  });
});

// ----- Nạp profile từ GPM local -----
async function loadAutomationProfiles() {
  if (!checkElectronAPI()) return;
  const statusEl = document.getElementById("automation-gpm-status");
  statusEl.textContent = "⏳ Đang đọc GPM...";
  statusEl.style.color = "var(--text-secondary)";
  try {
    const r = await window.electronAPI.sheet.gpmListProfilesFull(autoHost());
    if (!r.ok) throw new Error(r.error);
    automationProfiles = r.profiles || [];
    automationGroups = r.groups || [];
    const ids = new Set(automationProfiles.map((p) => p.id));
    for (const id of [...automationSelected]) if (!ids.has(id)) automationSelected.delete(id);

    const sel = document.getElementById("automation-group-filter");
    const cur = sel.value;
    const per = new Map();
    for (const p of automationProfiles) { const k = p.groupId === undefined || p.groupId === null || p.groupId === "" ? "__none" : String(p.groupId); per.set(k, (per.get(k) || 0) + 1); }
    const gname = new Map(automationGroups.map((g) => [String(g.id), g.name]));
    const opts = [...per].map(([k, n]) => ({ k, n, name: k === "__none" ? "Chung" : gname.get(k) || k }))
      .sort((a, b) => a.name.localeCompare(b.name, "vi"));
    sel.innerHTML = '<option value="">Tất cả group</option>' +
      opts.map((o) => `<option value="${escapeHtml(o.k)}">${escapeHtml(o.name)} (${o.n})</option>`).join("");
    sel.value = opts.some((o) => o.k === cur) ? cur : "";

    statusEl.textContent = `✅ ${automationProfiles.length} profile`;
    statusEl.style.color = "var(--accent-success)";
    renderAutomationProfiles();
  } catch (error) {
    statusEl.textContent = `❌ ${getErrorMessage(error)}`;
    statusEl.style.color = "var(--accent-danger)";
  }
}

function getFilteredAutomationProfiles() {
  const group = autoVal("automation-group-filter");
  const q = autoVal("automation-profile-search").toLowerCase();
  const gname = new Map(automationGroups.map((g) => [String(g.id), String(g.name || "").toLowerCase()]));
  const gk = (p) => (p.groupId === undefined || p.groupId === null || p.groupId === "" ? "__none" : String(p.groupId));
  return automationProfiles.filter((p) => (!group || gk(p) === group)
    && (!q || p.name.toLowerCase().includes(q) || String(p.id).toLowerCase().includes(q) || (gname.get(String(p.groupId)) || "").includes(q)));
}

function renderAutomationProfiles() {
  const list = document.getElementById("automation-profile-list");
  if (!list) return;
  const groupName = new Map(automationGroups.map((g) => [String(g.id), g.name]));
  const shown = getFilteredAutomationProfiles();

  if (!shown.length) {
    list.innerHTML = `<div class="auto-profile-empty">${automationProfiles.length ? "Không có profile nào khớp." : "Không có profile GPM."}</div>`;
  } else {
    // Nhóm profiles theo group và render với headers
    const byGroup = new Map();
    for (const p of shown) {
      const gk = p.groupId === undefined || p.groupId === null || p.groupId === "" ? "__none" : String(p.groupId);
      if (!byGroup.has(gk)) byGroup.set(gk, []);
      byGroup.get(gk).push(p);
    }

    // Sắp xếp groups theo tên
    const sortedGroups = [...byGroup.entries()].sort((a, b) => {
      const na = a[0] === "__none" ? "zzz" : (groupName.get(a[0]) || a[0]).toLowerCase();
      const nb = b[0] === "__none" ? "zzz" : (groupName.get(b[0]) || b[0]).toLowerCase();
      return na.localeCompare(nb, "vi");
    });

    let html = "";
    for (const [gk, profiles] of sortedGroups) {
      const gn = gk === "__none" ? "Chung" : (groupName.get(gk) || gk);
      html += `<div class="auto-profile-group">${escapeHtml(gn)}</div>`;
      for (const p of profiles) {
        const isSelected = automationSelected.has(p.id);
        html += `
          <label class="auto-profile-item${isSelected ? " selected" : ""}">
            <input type="checkbox" data-id="${escapeHtml(p.id)}" ${isSelected ? "checked" : ""} />
            <span class="nm">${escapeHtml(profileLabel(p))}${p.hasProxy ? "" : '<span class="warn-icon" title="Chưa có proxy"> ⚠</span>'}</span>
          </label>`;
      }
    }
    list.innerHTML = html;
  }

  list.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener("change", () => {
      const item = cb.closest(".auto-profile-item");
      cb.checked ? automationSelected.add(cb.dataset.id) : automationSelected.delete(cb.dataset.id);
      item?.classList.toggle("selected", cb.checked);
      updateAutomationSelectionUi();
    });
  });
  updateAutomationSelectionUi();
}

function updateAutomationSelectionUi() {
  renderThumbOverrides();
  const shown = getFilteredAutomationProfiles();
  const countEl = document.getElementById("automation-pick-count");
  if (countEl) countEl.textContent = shown.length + (automationProfiles.length !== shown.length ? " / " + automationProfiles.length : "") + " kênh" + (automationSelected.size ? " · đã chọn " + automationSelected.size : "");
}

function toggleAutomationSelectAll(checked) {
  for (const p of getFilteredAutomationProfiles()) checked ? automationSelected.add(p.id) : automationSelected.delete(p.id);
  renderAutomationProfiles();
}

// ----- Thư mục thumbnail riêng cho từng profile: khoá là PROFILE ID, không phải tên -----
const thumbOwn = new Map(); // profileId -> thư mục riêng (giữ khi bỏ tick rồi tick lại)

function renderThumbOverrides() {
  const box = document.getElementById("automation-thumb-own");
  if (!box) return;
  const sel = getSelectedAutomationProfiles();
  if (!sel.length) { box.innerHTML = '<div class="thumb-own-empty">Chưa tick profile nào ở thanh bên trái.</div>'; return; }
  const common = autoVal("automation-thumb-folder");
  box.innerHTML = sel.map((p) => `
    <div class="thumb-own-row" data-id="${escapeHtml(p.id)}">
      <div class="thumb-own-name" title="Profile ID: ${escapeHtml(p.id)}">${escapeHtml(p.label)}<small>${escapeHtml(String(p.id).slice(0, 8))}…</small></div>
      <input type="text" readonly value="${escapeHtml(thumbOwn.get(p.id) || "")}" placeholder="${escapeHtml(common ? "Dùng thư mục chung: " + common : "Chưa chọn thư mục chung — hãy chọn thư mục riêng")}" />
      <span style="display:flex;gap:6px;">
        <button class="btn btn-secondary" style="min-width:0;padding:6px 12px;" data-act="pick">Chọn</button>
        <button class="btn btn-secondary" style="min-width:0;padding:6px 10px;${thumbOwn.get(p.id) ? "" : "visibility:hidden;"}" data-act="clear" title="Bỏ thư mục riêng">×</button>
      </span>
    </div>`).join("");
  box.querySelectorAll(".thumb-own-row").forEach((row) => {
    const id = row.dataset.id;
    row.querySelector('[data-act="pick"]').addEventListener("click", async () => {
      if (!checkElectronAPI()) return;
      const dir = await window.electronAPI.selectFolder();
      if (dir) { thumbOwn.set(id, dir); renderThumbOverrides(); }
    });
    row.querySelector('[data-act="clear"]').addEventListener("click", () => { thumbOwn.delete(id); renderThumbOverrides(); });
  });
}

// Chỉ gửi thư mục riêng của các profile ĐANG ĐƯỢC TICK (khoá = Profile ID).
function getThumbFolders() {
  const out = {};
  for (const p of getSelectedAutomationProfiles()) if (thumbOwn.get(p.id)) out[p.id] = thumbOwn.get(p.id);
  return out;
}

// ----- Chọn file / thư mục -----
async function pickAutomationFile(inputId) {
  if (!checkElectronAPI()) return;
  const file = await window.electronAPI.selectFile({ filters: [{ name: "Excel", extensions: ["xlsx", "xls"] }] });
  if (file) document.getElementById(inputId).value = file;
}
async function pickAutomationFolder(inputId) { // trả về Promise<void>, đợi chọn xong
  if (!checkElectronAPI()) return;
  const dir = await window.electronAPI.selectFolder();
  if (dir) document.getElementById(inputId).value = dir;
}
function clearAutomationField(inputId) { document.getElementById(inputId).value = ""; }

// ----- Log / trạng thái chạy -----
function showAutomationOutput(message) {
  const out = document.getElementById("automation-output");
  if (!out) return;
  out.style.display = "block";
  out.textContent += message + "\n";
  out.scrollTop = out.scrollHeight;
}
function clearAutomationOutput() {
  const out = document.getElementById("automation-output");
  if (out) { out.textContent = ""; out.style.display = "block"; }
}
function setAutomationRunning(running) {
  automationRunning = running;
  document.querySelectorAll("#automation [data-auto-run]").forEach((b) => { b.disabled = running; });
  document.querySelectorAll("#automation [data-auto-stop]").forEach((b) => { b.style.display = running ? "" : "none"; });
}

// ----- Gom tuỳ chọn của chức năng hiện tại -----
// Đuôi ID chỉ hiện khi tên bị trùng, để người dùng phân biệt được hai profile cùng tên.
function profileLabel(p) {
  const dup = automationProfiles.filter((x) => x.name.trim().toLowerCase() === p.name.trim().toLowerCase()).length > 1;
  return dup ? `${p.name} #${String(p.id).slice(0, 6)}` : p.name;
}

function getSelectedAutomationProfiles() {
  return automationProfiles.filter((p) => automationSelected.has(p.id)).map((p) => ({ id: p.id, name: p.name, label: profileLabel(p) }));
}

function getAutomationOptions() {
  const o = { gpmHost: autoHost(), profiles: getSelectedAutomationProfiles(), concurrency: parseInt(autoVal("automation-concurrency"), 10) || 1 };
  switch (automationCurrent) {
    case "login": o.accountsFile = autoVal("automation-login-file"); break;
    case "thumb":
      o.thumbFolder = autoVal("automation-thumb-folder");
      o.numVideos = autoVal("automation-thumb-num");
      o.linksFile = autoVal("automation-thumb-links") || undefined;
      o.thumbFolders = getThumbFolders(); // { [Profile ID]: thư mục riêng }
      break;
    case "schedule":
      o.numDays = autoVal("automation-sch-days");
      o.startDate = autoVal("automation-sch-start") || undefined; // ô chọn ngày cho ra 2026-04-04
      o.postTimes = autoVal("automation-sch-times");
      break;
    case "distribute":
      o.videoFolder = autoVal("automation-dist-videos");
      o.thumbFolder = autoVal("automation-dist-thumbs") || undefined;
      o.mode = autoVal("automation-dist-mode") || "roundrobin";
      o.perChannel = parseInt(autoVal("automation-dist-per"), 10) || 1;
      o.postTimes = autoVal("automation-dist-times");
      break;
    case "createchannel":
      o.planFile = autoVal("automation-cc-file");
      o.accountsFile = autoVal("automation-cc-accounts") || undefined;
      break;
    case "changega":
      o.planFile = autoVal("automation-ga-file");
      o.accountsFile = autoVal("automation-ga-accounts") || undefined;
      o.manualTimeout = parseInt(autoVal("automation-ga-timeout"), 10) || 300;
      o.headless = document.getElementById("automation-ga-headless")?.checked || false;
      break;
  }
  return o;
}

function checkAutomationInputs(o) {
  if (!o.profiles.length) return "Hãy tick chọn ít nhất 1 profile ở thanh bên trái.";
  switch (automationCurrent) {
    case "login": if (!o.accountsFile) return "Hãy chọn file Excel tài khoản."; break;
    case "thumb": {
      const missing = o.profiles.filter((p) => !o.thumbFolder && !(o.thumbFolders || {})[p.id]);
      if (missing.length) return `Hãy chọn thư mục thumbnail chung, hoặc chọn thư mục riêng cho: ${missing.map((p) => p.label).join(", ")}.`;
      break;
    }
    case "schedule": if (!o.postTimes) return "Hãy nhập giờ đăng."; break;
    case "distribute":
      if (!o.videoFolder) return "Hãy chọn thư mục video.";
      if (!o.postTimes) return "Hãy nhập giờ đăng.";
      break;
    case "createchannel": if (!o.planFile) return "Hãy chọn file Excel tạo channel."; break;
    case "changega": if (!o.planFile) return "Hãy chọn file Excel đổi GA."; break;
  }
  return "";
}

// ----- Xem trước (không mở trình duyệt, không ghi gì) -----
async function previewAutomation() {
  if (!checkElectronAPI() || automationRunning) return;
  const o = getAutomationOptions();
  const err = checkAutomationInputs(o);
  if (err) { alert(err); return; }
  clearAutomationOutput();
  setAutomationRunning(true);
  try {
    const t = AUTOMATION_TASKS[automationCurrent];
    if (t.preview === "distribute") {
      const r = await window.electronAPI.automation.distributePreview(o);
      if (!r.success) { showAutomationOutput(`❌ ${r.error}`); return; }
      showAutomationOutput("👁 XEM TRƯỚC (chưa đăng gì)\n");
      let total = 0;
      for (const c of r.plan.channels) {
        showAutomationOutput(`■ ${c.name}: ${c.items.length} video`);
        for (const it of c.items) {
          total++;
          showAutomationOutput(`   ${it.scheduleISO.replace("T", " ").slice(0, 16)}  ${it.title}${it.hasThumb ? "" : "  (không có thumbnail)"}`);
        }
      }
      showAutomationOutput(`\nTổng ${total} video${r.plan.leftover ? `, ${r.plan.leftover} video dư không đăng lượt này` : ""}.`);
      return;
    }
    if (t.preview === "run") {
      const r = await window.electronAPI.automation.previewRun({ ...o, kind: automationCurrent });
      if (!r.success) { showAutomationOutput(`❌ ${r.error}`); return; }
      showAutomationOutput("👁 XEM TRƯỚC (chưa chạy gì)\n");
      if (r.kind === "thumb") {
        for (const p of r.ready) showAutomationOutput(`■ ${p.name}${p.bkt ? " 💰BKT" : ""}: ${p.numVideos} video · ${p.images} ảnh · ${p.own ? "thư mục RIÊNG" : "thư mục chung"}\n    ${p.folder}`);
        for (const x of r.skipped) showAutomationOutput(`⏭ ${x.name}: ${x.reason}`);
        showAutomationOutput(`\nSẽ chạy ${r.ready.length}/${r.ready.length + r.skipped.length} profile.`);
      } else {
        showAutomationOutput(`Giờ đăng mỗi ngày: ${r.times.join(", ")}`);
        showAutomationOutput(`Các ngày: ${r.days.join(", ")}`);
        showAutomationOutput(`Mỗi kênh cần ${r.videosPerProfile} video nháp (Draft). Thiếu thì lên lịch được bao nhiêu hay bấy nhiêu.\n`);
        showAutomationOutput(`Sẽ chạy ${r.profiles.length} profile: ${r.profiles.join(", ")}`);
        if (r.bkt?.length) showAutomationOutput(`💰 Kênh BKT (chạy theo quy trình riêng): ${r.bkt.join(", ")}`);
      }
      return;
    }
    if (t.excel && (t.excel === "login" || t.excel === "plan" || t.excel === "changega")) {
      const r = await window.electronAPI.automation.previewExcel({
        ...o, kind: t.excel,
      });
      if (!r.success) { showAutomationOutput(`❌ ${r.error}`); return; }
      showAutomationOutput(`👁 XEM TRƯỚC (chưa chạy gì)\n\nExcel có ${r.total} dòng hợp lệ.`);
      showAutomationOutput(`Sẽ chạy ${r.ready.length} profile: ${r.ready.join(", ") || "(không có)"}`);
      for (const n of r.missing) showAutomationOutput(`⏭ ${n}: không có dòng nào trong Excel khớp (cột A)`);
      for (const n of r.ambiguous) showAutomationOutput(`⏭ ${n}: Excel có nhiều dòng cùng khoá ở cột A`);
      for (const n of r.duplicated || []) showAutomationOutput(`⏭ ${n}: tên profile trùng với profile khác trong GPM — ghi Profile ID vào cột A`);
      if (t.excel === "changega") {
        showAutomationOutput(`\n⚠ LƯU Ý: Đổi GA CẦN THAO TÁC THỦ CÔNG trong browser (2FA, chọn account đích, xác nhận).`);
        showAutomationOutput(`   Khuyến nghị chạy từng profile một (Số profile chạy cùng lúc = 1).`);
      }
      return;
    }
    showAutomationOutput(`👁 XEM TRƯỚC (chưa chạy gì)\n\nSẽ chạy ${o.profiles.length} profile: ${o.profiles.map((p) => p.name).join(", ")}`);
  } catch (error) {
    showAutomationOutput(`❌ ${getErrorMessage(error)}`);
  } finally {
    setAutomationRunning(false);
  }
}

// ----- Chạy -----
async function runAutomation() {
  if (!checkElectronAPI() || automationRunning) return;
  const t = AUTOMATION_TASKS[automationCurrent];
  const o = getAutomationOptions();
  const err = checkAutomationInputs(o);
  if (err) { alert(err); return; }

  const warn = {
    distribute: `Sẽ mở ${o.profiles.length} profile và ĐĂNG video thật lên YouTube theo lịch.\nBạn đã bấm "Xem trước" để kiểm tra cách chia chưa? Tiếp tục chạy?`,
    createchannel: `Sẽ chỉnh sửa channel thật trên ${o.profiles.length} profile (tên, handle, mô tả, cài đặt tải lên) và Xuất bản. Tiếp tục?`,
  }[automationCurrent];
  if (warn && !(await appConfirm(warn, { title: t.title, okText: "Chạy" }))) return;

  clearAutomationOutput();
  window.electronAPI.automation.removeLogListener();
  window.electronAPI.automation.onLog((payload) => showAutomationOutput(typeof payload === "string" ? payload : payload.msg));
  setAutomationRunning(true);
  showAutomationOutput(`🚀 ${t.title}\n`);
  try {
    const r = await window.electronAPI.automation[t.api](o);
    showAutomationOutput(r.success ? `\n✅ ${r.message || "Hoàn tất"}` : `\n❌ ${r.error || "Có lỗi xảy ra"}`);
  } catch (error) {
    showAutomationOutput(`\n❌ ${getErrorMessage(error)}`);
  } finally {
    setAutomationRunning(false);
  }
}

async function stopAutomationRun() {
  if (!checkElectronAPI()) return;
  await window.electronAPI.automation.stop();
  showAutomationOutput("⏹ Đã yêu cầu dừng — các profile đang chạy sẽ dừng ở bước kế tiếp.");
}

// ============================================================================
// CHANGE GA - Đổi Google Account cho kênh YouTube (không cần GPM profile)
// ============================================================================
let changeGAState = { channelId: '', cookies: '', loginUrl: '', rapt: '' };

function showChangeGALog(msg) {
  const out = document.getElementById("changega-output");
  if (!out) return;
  out.style.display = "block";
  out.textContent += msg + "\n";
  out.scrollTop = out.scrollHeight;
}

function clearChangeGALog() {
  const out = document.getElementById("changega-output");
  if (out) { out.textContent = ""; out.style.display = "none"; }
}

async function changeGAStep1() {
  if (!checkElectronAPI()) return;

  clearChangeGALog();

  const channelIdInput = document.getElementById("changega-channel-id")?.value?.trim() || "";
  const cookiesInput = document.getElementById("changega-cookies")?.value?.trim() || "";

  if (!channelIdInput) {
    alert("Vui lòng nhập Channel ID (UC...)");
    return;
  }
  if (!cookiesInput) {
    alert("Vui lòng paste cURL hoặc cookies từ YouTube Studio");
    return;
  }

  showChangeGALog("🔄 Đang xử lý...");

  try {
    const result = await window.electronAPI.changeGA.generateLoginLink({
      channelId: channelIdInput,
      cookies: cookiesInput,
    });

    if (!result.success) {
      showChangeGALog(`❌ Lỗi: ${result.error}`);
      return;
    }

    changeGAState.channelId = result.channelId;
    changeGAState.cookies = cookiesInput;
    changeGAState.loginUrl = result.loginUrl;

    // Hiện kết quả bước 1
    document.getElementById("changega-login-url").value = result.loginUrl;
    document.getElementById("changega-step1-result").style.display = "";
    document.getElementById("changega-step2").style.display = "";

    showChangeGALog(`✅ Đã tạo link xác thực cho kênh ${result.channelId}`);
    showChangeGALog(`📋 Mở link ở ô "Link xác thực", đăng nhập và xác nhận mật khẩu`);
    showChangeGALog(`📋 Sau đó copy phần rapt=AE... từ URL và paste vào Bước 3`);

  } catch (error) {
    showChangeGALog(`❌ Lỗi: ${error.message || error}`);
  }
}

function copyChangeGAUrl() {
  const url = document.getElementById("changega-login-url")?.value;
  if (url) {
    navigator.clipboard.writeText(url);
    showChangeGALog("📋 Đã copy link xác thực");
  }
}

function openChangeGAUrl() {
  const url = document.getElementById("changega-login-url")?.value;
  if (url && window.electronAPI?.shell?.openExternal) {
    window.electronAPI.shell.openExternal(url);
  } else if (url) {
    window.open(url, "_blank");
  }
}

async function changeGAStep2() {
  if (!checkElectronAPI()) return;

  const raptInput = document.getElementById("changega-rapt")?.value?.trim() || "";

  if (!raptInput) {
    alert("Vui lòng paste mã rapt (từ AE...) hoặc URL chứa rapt");
    return;
  }

  if (!changeGAState.channelId || !changeGAState.cookies) {
    alert("Vui lòng thực hiện Bước 1 trước");
    return;
  }

  showChangeGALog("🔄 Đang tạo link token đổi GA...");

  try {
    const result = await window.electronAPI.changeGA.generateTransferLink({
      channelId: changeGAState.channelId,
      cookies: changeGAState.cookies,
      rapt: raptInput,
    });

    if (!result.success) {
      showChangeGALog(`❌ Lỗi: ${result.error}`);
      return;
    }

    changeGAState.rapt = result.rapt;

    // Hiện kết quả cuối
    document.getElementById("changega-transfer-url").value = result.transferUrl;
    document.getElementById("changega-final-result").style.display = "";

    showChangeGALog(`✅ Đã tạo link token đổi GA!`);
    showChangeGALog(`🎯 Mở link ở ô "Link Token đổi GA" và đăng nhập bằng Google Account MỚI để nhận kênh`);

  } catch (error) {
    showChangeGALog(`❌ Lỗi: ${error.message || error}`);
  }
}

function copyChangeGATransferUrl() {
  const url = document.getElementById("changega-transfer-url")?.value;
  if (url) {
    navigator.clipboard.writeText(url);
    showChangeGALog("📋 Đã copy link token đổi GA");
  }
}

function openChangeGATransferUrl() {
  const url = document.getElementById("changega-transfer-url")?.value;
  if (url && window.electronAPI?.shell?.openExternal) {
    window.electronAPI.shell.openExternal(url);
  } else if (url) {
    window.open(url, "_blank");
  }
}

// ============================================================================
// MENU TRÁI: gập/mở từng nhóm lớn. Trạng thái được nhớ giữa các lần mở app.
// Chỉ thêm lớp hiển thị, không đụng vào nút tab hay logic chuyển tab.
// ============================================================================
(function setupMenuCollapse() {
  const KEY_COLLAPSED = "vidmaster.menu.collapsed";
  // localStorage có thể bị chặn hoặc hỏng: luôn bọc try/catch, hỏng thì menu vẫn chạy bình thường.
  const load = (k, fallback) => { try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* bỏ qua */ } };

  const groups = [...document.querySelectorAll(".tab-group[data-group]")];
  if (!groups.length) return;

  const saved = load(KEY_COLLAPSED, []);
  const collapsed = new Set(Array.isArray(saved) ? saved : []);

  function applyGroup(g) {
    const isCollapsed = collapsed.has(g.dataset.group);
    g.classList.toggle("collapsed", isCollapsed);
    g.querySelector(".tab-group-title")?.setAttribute("aria-expanded", String(!isCollapsed));
  }

  groups.forEach((g) => {
    applyGroup(g);
    g.querySelector(".tab-group-title")?.addEventListener("click", () => {
      const id = g.dataset.group;
      collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id);
      applyGroup(g);
      save(KEY_COLLAPSED, [...collapsed]);
    });
  });
})();
