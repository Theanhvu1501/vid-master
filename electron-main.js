import { spawn } from "child_process";
import { app, BrowserWindow, clipboard, dialog, ipcMain, safeStorage, shell } from "electron";
import fs from "fs";
import https from "https";
import { createRequire } from "module";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { getMachineId } from "./license-check.js";
import { createSessionManager } from "./app-session.js";
import pLimit from "p-limit";
import sharp from "sharp";
import { createSheetRunner } from "./sheet/sheet-runner.js";
import { createSheetsClient, readConfigSheet, readConfigValues, writeConfigCell, ensureGridColumns, formatHeaderGroups, parseConfigRows, findStatsColumns, STATS_KEYS, writeChannelStats, appendUrls, readChannelUrls, setUrlStatus, setUploadStatus, readUploadStatuses, testSheetConnection } from "./sheet/sheets-service.js";
import { createYoutubeClient, fetchChannelStats, fetchSourceVideos, pickNewUrls, DEFAULT_YT_API_KEY } from "./sheet/youtube-api.js";
import { parseScheduledISO, formatStamp } from "./sheet/schedule-slots.js";
import { testGpmConnection, connectAndOpenStudio, connectProfile, getGpmApiVersion, listGpmGroups, listGpmProfilesFull, createGpmProfile, updateGpmProfileProxy } from "./sheet/gpm-client.js";
import { runLogin, runChangeThumb, runSchedule, stopAutomation, resetCancel, forEachProfile, loginOne, checkCancelled, isCancelled } from "./sheet/youtube-automation.js";
import { runDistribute, buildPlan, listVideos } from "./sheet/distribute.js";
import { runSheetAutomation, previewSheetAutomation } from "./sheet/sheet-automation.js";
import { runProxyCheck, maskProxy, checkProxy } from "./sheet/proxy-tools.js";
import { createMonitorAgent, createProxyHealth, buildSnapshot, proxyIdentity, toHttpBase, DEFAULT_SERVER_URL } from "./sheet/monitor-agent.js";
import { createTaskTracker, channelResultEvent, isTrackedTask, lastMeaningfulLine } from "./sheet/task-monitor.js";
import { readLoginAccounts, readChannelPlans, attachProfileData, countNames } from "./sheet/excel-import.js";
import { resolveThumbRun, resolveScheduleRun } from "./sheet/run-options.js";
import { runCreateChannel, createChannelOne } from "./sheet/create-channel.js";
import { describeTask, createMissingColumns, TASKS, COLUMN_GROUPS, readChannelRows } from "./sheet/channel-sheet.js";
import { writeSample, SAMPLE_FILES } from "./sheet/excel-samples.js";
import { createUploadQueue } from "./sheet/upload-queue.js";
import { sendTelegram, sendTelegramPhoto, buildDigest, buildChannelReport, parseTopicId } from "./sheet/telegram-notify.js";
import { renderOne, resolveFfmpegPaths } from "./sheet/render-core.js";
import { detectChromaColor } from "./sheet/chroma-detect.js";
import { downloadOne, copyLocalOverlay } from "./sheet/channel-download.js";
import { loadYtdlpSettings, saveYtdlpSettings } from "./sheet/ytdlp-config.js";
import { loadDownloadConfig, getNodeExecutable, getBgutilPaths } from "./sheet/download-options.js";
import { startPotServer } from "./sheet/pot-provider.js";
import { createCookiePool, resolveSheetCookieSource } from "./sheet/cookie-pool.js";
import { loadState, saveState, todayStr, computeRemaining } from "./sheet/runner-state.js";
import { loadResume, saveResume, getEntry } from "./sheet/resume-state.js";
import { listPendingUploads } from "./sheet/pending-uploads.js";
import { registerComposerIpc, getPresetsDir } from "./sheet/composer-ipc.js";
import { pickClipStart } from "./sheet/test-render-channel.js";

const require = createRequire(import.meta.url);
const { autoUpdater } = require("electron-updater");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper function to get config directory (userData in production, __dirname in development)
function getConfigDir() {
  // In production (packaged), use userData directory
  // In development, use __dirname
  if (app.isPackaged) {
    return app.getPath("userData");
  } else {
    return __dirname;
  }
}

// Helper function to get app path (works in both dev and production)
function getAppPath() {
  if (app.isPackaged) {
    // In production, scripts are unpacked to app.asar.unpacked
    // process.resourcesPath points to the resources folder
    // Scripts will be in: resources/app.asar.unpacked/
    const resourcesPath = process.resourcesPath;
    const unpackedPath = path.join(resourcesPath, "app.asar.unpacked");

    // Check if unpacked directory exists (where scripts are unpacked)
    if (fs.existsSync(unpackedPath)) {
      return unpackedPath;
    }

    // Fallback: use resources path
    return resourcesPath;
  } else {
    return __dirname;
  }
}

let mainWindow;

// =================================================================
// AUTO UPDATER CONFIGURATION
// =================================================================

// Cấu hình auto-updater - GitHub Releases
autoUpdater.setFeedURL({
  provider: "github",
  owner: "Theanhvu1501",
  repo: "vid-master",
});

// Chỉ check update trong production (không check khi dev)
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

// Flag để test auto-update trong dev mode (set = true để test)
const ENABLE_DEV_UPDATE_TEST = false; // ⚠️ CHỈ BẬT KHI CẦN TEST, NHỚ TẮT LẠI SAU!

// Override app.isPackaged để force test update trong dev mode
// CHỈ BẬT KHI ENABLE_DEV_UPDATE_TEST = true
if (ENABLE_DEV_UPDATE_TEST && !app.isPackaged) {
  console.log("🧪 [DEV MODE] Overriding app.isPackaged để test auto-update");
  Object.defineProperty(app, "isPackaged", {
    get: () => true,
    configurable: true,
  });

  // Force dev update config trong electron-updater (nếu có property này)
  try {
    if (
      autoUpdater &&
      typeof autoUpdater.forceDevUpdateConfig !== "undefined"
    ) {
      autoUpdater.forceDevUpdateConfig = true;
      console.log("🧪 [DEV MODE] Đã set forceDevUpdateConfig = true");
    }
  } catch (e) {
    // Property có thể không tồn tại, không sao
  }
}

// Log update events
autoUpdater.logger = {
  info: (message) => console.log(`[AutoUpdater] ${message}`),
  warn: (message) => console.warn(`[AutoUpdater] ${message}`),
  error: (message) => console.error(`[AutoUpdater] ${message}`),
};

// Các event handlers cho auto-updater
autoUpdater.on("checking-for-update", () => {
  console.log("🔍 [AutoUpdater] Đang kiểm tra cập nhật...");
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("update-status", {
      status: "checking",
      message: "Đang kiểm tra cập nhật...",
    });
  } else {
    console.warn("⚠️ [AutoUpdater] mainWindow chưa sẵn sàng để gửi message");
  }
});

autoUpdater.on("update-available", (info) => {
  console.log(`✅ [AutoUpdater] Có bản cập nhật mới: ${info.version}`);
  console.log(`📋 [AutoUpdater] Release notes:`, info.releaseNotes);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("update-status", {
      status: "available",
      message: `Có bản cập nhật mới: v${info.version}`,
      version: info.version,
      releaseNotes: info.releaseNotes,
    });
    console.log(
      "✅ [AutoUpdater] Đã gửi update-status 'available' đến renderer"
    );
  } else {
    console.warn("⚠️ [AutoUpdater] mainWindow chưa sẵn sàng để gửi message");
  }
  // Không hiển thị dialog native, để renderer hiển thị custom dialog đẹp hơn
});

autoUpdater.on("update-not-available", (info) => {
  const currentVersion = app.getVersion();
  console.log(
    `✅ [AutoUpdater] Đã sử dụng phiên bản mới nhất: ${info?.version || "N/A"}`
  );
  console.log(`📌 [AutoUpdater] Phiên bản hiện tại của app: ${currentVersion}`);
  console.log(`📋 [AutoUpdater] Info object:`, JSON.stringify(info, null, 2));
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("update-status", {
      status: "not-available",
      message: "Đã sử dụng phiên bản mới nhất",
      version: info?.version || currentVersion,
    });
  }
});

autoUpdater.on("error", (error) => {
  console.error(`❌ [AutoUpdater] Lỗi kiểm tra cập nhật: ${error.message}`);
  console.error(`❌ [AutoUpdater] Error stack:`, error.stack);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("update-status", {
      status: "error",
      message: `Lỗi: ${error.message}`,
    });
  }
});

autoUpdater.on("download-progress", (progressObj) => {
  const percent = Math.round(progressObj.percent);
  console.log(`📥 Đang tải: ${percent}%`);
  if (mainWindow) {
    mainWindow.webContents.send("update-progress", {
      percent,
      transferred: progressObj.transferred,
      total: progressObj.total,
    });
  }
});

autoUpdater.on("update-downloaded", (info) => {
  console.log(`✅ Đã tải xong bản cập nhật: ${info.version}`);
  if (mainWindow) {
    // Lưu version để hiển thị thông báo sau khi update
    const configDir = getConfigDir();
    const updateVersionPath = path.join(
      configDir,
      ".last-updated-version.json"
    );
    try {
      fs.writeFileSync(
        updateVersionPath,
        JSON.stringify({
          version: info.version,
          updatedAt: new Date().toISOString(),
        }),
        "utf-8"
      );
    } catch (err) {
      console.error("Error saving update version:", err);
    }

    mainWindow.webContents.send("update-status", {
      status: "downloaded",
      message: `Đã tải xong v${info.version}. Ứng dụng sẽ khởi động lại để cài đặt.`,
      version: info.version,
    });
  }
  // Không hiển thị dialog native, để renderer hiển thị custom dialog đẹp hơn
});

// Hàm kiểm tra update (chỉ chạy trong production, hoặc dev nếu ENABLE_DEV_UPDATE_TEST = true)
// Chỉ chạy khi người dùng yêu cầu (manual update)
function checkForUpdates() {
  const shouldCheck = app.isPackaged || ENABLE_DEV_UPDATE_TEST;

  if (shouldCheck) {
    if (!app.isPackaged && ENABLE_DEV_UPDATE_TEST) {
      console.log("🧪 [DEV MODE] Auto-update testing được bật!");
    }
    const currentVersion = app.getVersion();
    console.log(
      `🚀 Đang kiểm tra cập nhật... (Phiên bản hiện tại: ${currentVersion})`
    );
    console.log(`📦 GitHub repo: Theanhvu1501/vid-master`);

    // Đảm bảo mainWindow sẵn sàng trước khi check
    if (!mainWindow || mainWindow.isDestroyed()) {
      console.warn("⚠️ mainWindow chưa sẵn sàng, bỏ qua check update");
      return;
    }

    // Set timeout để detect nếu không có response
    let timeoutId = setTimeout(() => {
      console.warn(
        "⚠️ Timeout: Không nhận được phản hồi từ auto-updater sau 30 giây"
      );
      console.warn(
        "⚠️ Có thể do: GitHub không accessible, hoặc không có event được trigger"
      );
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("update-status", {
          status: "error",
          message:
            "Timeout: Không thể kiểm tra cập nhật. Vui lòng thử lại sau.",
        });
      }
    }, 30000); // 30 giây timeout

    // Clear timeout khi có event nào đó
    const clearTimeoutWrapper = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    // Lắng nghe tạm thời các event để clear timeout
    const checkHandler = () => clearTimeoutWrapper();
    autoUpdater.once("update-available", checkHandler);
    autoUpdater.once("update-not-available", checkHandler);
    autoUpdater.once("error", checkHandler);

    autoUpdater
      .checkForUpdates()
      .then((result) => {
        clearTimeoutWrapper();
        console.log("✅ [checkForUpdates] Promise resolved");
        if (result && result.updateInfo) {
          console.log(
            `📋 [checkForUpdates] Update info:`,
            JSON.stringify(result.updateInfo, null, 2)
          );
        } else {
          console.log(
            `📋 [checkForUpdates] Result:`,
            JSON.stringify(result, null, 2)
          );
        }
      })
      .catch((error) => {
        clearTimeoutWrapper();
        console.error("❌ [checkForUpdates] Lỗi khi kiểm tra update:", error);
        console.error("❌ [checkForUpdates] Error details:", {
          message: error.message,
          stack: error.stack,
          code: error.code,
          errno: error.errno,
        });
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("update-status", {
            status: "error",
            message: `Lỗi kiểm tra cập nhật: ${error.message}`,
          });
        }
      });
  } else {
    console.log("⚠️ Chế độ development - bỏ qua kiểm tra update");
    console.log(
      "💡 Để test update trong dev mode, set ENABLE_DEV_UPDATE_TEST = true ở dòng 175"
    );
  }
}

// Auto check update sẽ được gọi sau khi window load xong (trong createWindow)
// Không cần gọi ở đây nữa vì có thể window chưa sẵn sàng

/**
 * Hiển thị dialog thông báo chưa đăng ký và copy machineId
 */
function showUnregisteredDialog(machineId) {
  return new Promise((resolve) => {
    // Copy machineId vào clipboard
    clipboard.writeText(machineId);

    const licenseWindow = new BrowserWindow({
      width: 550,
      height: 650,
      resizable: false,
      frame: false,
      transparent: false,
      backgroundColor: "#667eea",
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: false,
      },
      modal: true,
      show: false,
    });

    // Đọc file HTML và replace placeholder
    const dialogPath = path.join(__dirname, "license-dialog.html");
    let htmlContent = fs.readFileSync(dialogPath, "utf-8");
    htmlContent = htmlContent.replace("MACHINE_ID_PLACEHOLDER", machineId);

    // Load HTML từ data URL
    licenseWindow.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`
    );

    // Hiển thị window khi sẵn sàng
    licenseWindow.once("ready-to-show", () => {
      licenseWindow.show();
    });

    // Khi window đóng, quit app
    licenseWindow.on("closed", () => {
      app.quit();
      resolve();
    });

    // Prevent close by clicking outside (modal behavior)
    licenseWindow.setAlwaysOnTop(true);
  });
}

/**
 * Hiển thị dialog thông báo license đã bị khóa
 */
function showLicenseRevokedDialog(errorMessage) {
  return new Promise((resolve) => {
    // Disable mainWindow để không thể tương tác
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setEnabled(false);
    }

    const revokedWindow = new BrowserWindow({
      width: 550,
      height: 600,
      resizable: false,
      frame: false,
      transparent: false,
      backgroundColor: "#dc3545",
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: false,
      },
      modal: true,
      parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
      show: false,
    });

    // Đọc file HTML
    const dialogPath = path.join(__dirname, "license-revoked-dialog.html");
    let htmlContent = fs.readFileSync(dialogPath, "utf-8");

    // Inject error message vào HTML nếu có
    if (errorMessage) {
      // Escape HTML để tránh XSS
      const escapedError = errorMessage
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

      // Thay thế error text và hiển thị error details
      htmlContent = htmlContent.replace(
        '<div id="errorText"></div>',
        `<div id="errorText">${escapedError}</div>`
      );
      htmlContent = htmlContent.replace(
        'id="errorDetails" style="display: none;">',
        'id="errorDetails">'
      );
    }

    // Load HTML từ data URL
    revokedWindow.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`
    );

    // Hiển thị window khi sẵn sàng
    revokedWindow.once("ready-to-show", () => {
      revokedWindow.show();
      revokedWindow.focus();
      revokedWindow.setAlwaysOnTop(true);
    });

    // Ngăn chặn đóng bằng cách khác (như Alt+F4, ESC)
    revokedWindow.on("close", (event) => {
      // Chỉ cho phép đóng khi người dùng click nút đóng
      // Hoặc force quit
      app.quit();
    });

    // Khi window đóng, quit app
    revokedWindow.on("closed", () => {
      app.quit();
      resolve();
    });

    // Ngăn chặn minimize
    revokedWindow.on("minimize", (event) => {
      event.preventDefault();
      revokedWindow.show();
    });
  });
}

/**
 * Kiểm tra license trước khi mở app
 */
// ================= Đăng nhập tài khoản (thay cho kiểm tra license chỉ bằng mã máy) =================
// Vào được app khi: tài khoản + mật khẩu đúng VÀ mã máy này đang được admin gán cho tài khoản đó trên web.
// Mật khẩu không bao giờ được lưu; chỉ giữ token, mã hóa bằng kho của hệ điều hành (safeStorage).
const appSessionPath = () => path.join(getConfigDir(), ".app-session.bin");
const loginHintPath = () => path.join(getConfigDir(), ".app-login-hint.json");
const appSessionStore = {
  load() {
    if (!safeStorage.isEncryptionAvailable()) return null;
    try { return JSON.parse(safeStorage.decryptString(fs.readFileSync(appSessionPath()))); } catch { return null; }
  },
  save(v) {
    // Không mã hóa được thì KHÔNG lưu (không bao giờ ghi token dạng thô): lần mở sau đăng nhập lại.
    if (!v || !safeStorage.isEncryptionAvailable()) return false;
    fs.writeFileSync(appSessionPath(), safeStorage.encryptString(JSON.stringify(v)), { mode: 0o600 });
    return true;
  },
  clear() { try { fs.unlinkSync(appSessionPath()); } catch { /* chưa có */ } },
};
const appServerBase = () => toHttpBase(monitorServerUrl());
const sessionMgr = createSessionManager({ getBase: appServerBase, getMachineId, getHostname: () => { try { return os.hostname(); } catch { return ""; } }, store: appSessionStore });

const readLoginHint = () => { try { return String(JSON.parse(fs.readFileSync(loginHintPath(), "utf-8")).user || ""); } catch { return ""; } };
const writeLoginHint = (user) => { try { fs.writeFileSync(loginHintPath(), JSON.stringify({ user }), "utf-8"); } catch { /* không quan trọng */ } };

let loginWin = null, loginNotice = "";
ipcMain.handle("app-login:info", (e) => {
  if (!loginWin || e.sender !== loginWin.webContents) return {};
  return { lastUser: readLoginHint(), notice: loginNotice };
});
ipcMain.handle("app-login:quit", (e) => { if (loginWin && e.sender === loginWin.webContents) loginWin.close(); });

// Hiện cửa sổ đăng nhập; trả true khi đăng nhập xong, false khi người dùng đóng cửa sổ.
function showLoginDialog(notice = "") {
  return new Promise((resolve) => {
    loginNotice = notice;
    let done = false;
    const finish = (ok) => { if (done) return; done = true; resolve(ok); };
    loginWin = new BrowserWindow({
      width: 460, height: 640, resizable: false, minimizable: false, maximizable: false, autoHideMenuBar: true,
      title: "Đăng nhập - VidMaster", icon: path.join(__dirname, "assets/icon.ico"), backgroundColor: "#0f1419", show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: path.join(__dirname, "login-preload.cjs") },
    });
    loginWin.setMenuBarVisibility(false);
    loginWin.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    loginWin.webContents.on("will-navigate", (ev) => ev.preventDefault());
    loginWin.loadFile("login-dialog.html");
    loginWin.once("ready-to-show", () => loginWin?.show());

    const handler = async (e, { username, password } = {}) => {
      if (!loginWin || e.sender !== loginWin.webContents) return { ok: false, message: "Không hợp lệ" };
      const r = await sessionMgr.login(String(username || ""), String(password || ""));
      if (r.ok) {
        writeLoginHint(String(username || "").trim());
        setTimeout(() => { finish(true); loginWin?.close(); }, 350);
        return { ok: true };
      }
      return { ok: false, kind: r.kind, message: r.message, retryAfter: r.retryAfter };
    };
    ipcMain.removeHandler("app-login:submit");
    ipcMain.handle("app-login:submit", handler);
    loginWin.on("closed", () => { ipcMain.removeHandler("app-login:submit"); loginWin = null; finish(false); });
  });
}

// Mở app: khôi phục phiên đã lưu, hỏi server còn hợp lệ không; không có/không hợp lệ thì bắt đăng nhập.
async function checkLicenseBeforeStart() {
  try {
    const r = await sessionMgr.restore();
    if (r.state === "valid") return true;
    if (r.state === "offline") { console.log(`⚠️ Không kết nối được server, dùng phiên đã lưu (offline ${r.ageDays} ngày)`); return true; }
    const notice = r.state === "invalid" || r.state === "need-online" ? r.message : "";
    const ok = await showLoginDialog(notice);
    if (!ok) { app.quit(); return false; }
    return true;
  } catch (error) {
    console.error("Error in login check:", error);
    await dialog.showMessageBox(null, { type: "error", title: "Lỗi", message: "Lỗi kiểm tra đăng nhập", detail: String(error?.message || error), buttons: ["OK"] });
    app.quit();
    return false;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    icon: path.join(__dirname, "assets/icon.ico"),
    width: 1400,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  mainWindow.loadFile("renderer.html");

  // Auto-run sheet-watch khi mở app nếu người dùng đã bật "Tự chạy khi mở app"
  // Delay 4 s để renderer kịp gắn listener 'sheet:event' trước khi runner bắt đầu emit
  try {
    const sw = loadSheetSettings();
    if (sw.autoRunOnOpen && sw.spreadsheetId && sw.credentialsPath && sw.channelsRoot) {
      setTimeout(() => {
        try {
          sheetRunner = buildSheetRunner(mainWindow);
          sheetRunner.start((sw.pollSec || 300) * 1000);
        } catch (err) { console.error("Auto-run sheet-watch lỗi:", err); }
      }, 4000);
    }
  } catch (err) { console.error(err); }

  // Đợi window load xong rồi mới check update
  // Đảm bảo renderer.js đã load và setup listeners
  mainWindow.webContents.once("did-finish-load", () => {
    console.log("✅ Window đã load xong, bắt đầu check update sau 2 giây...");
    // Đợi thêm 2 giây để đảm bảo renderer.js đã setup listeners
    setTimeout(() => {
      checkForUpdates();
    }, 2000);
  });

  // Open DevTools in development (uncomment to enable)
  // mainWindow.webContents.openDevTools();
}

// Biến lưu interval check license
let licenseCheckInterval = null;
// Hỏi lại server mỗi giờ: admin gỡ máy / khóa tài khoản / thu hồi license thì có hiệu lực trong vòng 1 giờ.
const LICENSE_CHECK_INTERVAL = 60 * 60 * 1000;

async function forceLogout(message) {
  try { monitorAgent.stop(); } catch { /* ignore */ }
  sessionMgr.logout();
  await dialog.showMessageBox(null, { type: "warning", title: "Đã đăng xuất", message: message || "Phiên đăng nhập không còn hợp lệ.", buttons: ["OK"] });
  app.relaunch();
  app.quit();
}

// Hỏi lại server định kỳ: admin gỡ máy / khóa tài khoản / thu hồi license thì có hiệu lực trong vòng 1 giờ.
async function checkLicensePeriodically() {
  try {
    const r = await sessionMgr.verify();
    if (r.state === "invalid") await forceLogout(r.message);
    else if (r.state === "need-online") console.log("⚠️ " + r.message);
  } catch (error) {
    console.error("Error in periodic session check:", error); // lỗi mạng: không đăng xuất oan
  }
}

function startPeriodicLicenseCheck() {
  // Dừng interval cũ nếu có
  if (licenseCheckInterval) {
    clearInterval(licenseCheckInterval);
  }

  console.log(
    `⏰ Bắt đầu kiểm tra license định kỳ mỗi ${
      LICENSE_CHECK_INTERVAL / 1000 / 60
    } phút`
  );

  // Check ngay lần đầu sau 1 phút (để app khởi động xong)
  setTimeout(() => {
    checkLicensePeriodically();
  }, 60 * 1000); // 1 phút

  // Sau đó check định kỳ
  licenseCheckInterval = setInterval(() => {
    checkLicensePeriodically();
  }, LICENSE_CHECK_INTERVAL);
}

// Dừng kiểm tra license định kỳ
function stopPeriodicLicenseCheck() {
  if (licenseCheckInterval) {
    clearInterval(licenseCheckInterval);
    licenseCheckInterval = null;
    console.log("⏹️ Đã dừng kiểm tra license định kỳ");
  }
}

// Hàm kiểm tra và hiển thị thông báo update thành công
async function checkAndShowUpdateSuccess() {
  try {
    const configDir = getConfigDir();
    const updateVersionPath = path.join(
      configDir,
      ".last-updated-version.json"
    );

    if (!fs.existsSync(updateVersionPath)) {
      return; // Không có file, chưa từng update
    }

    const updateInfo = JSON.parse(fs.readFileSync(updateVersionPath, "utf-8"));
    const currentVersion = app.getVersion();

    // Logic: Nếu version trong file khớp với version hiện tại
    // và file được tạo gần đây (trong 1 giờ) → đã update thành công
    if (
      updateInfo.version &&
      updateInfo.version === currentVersion &&
      updateInfo.updatedAt
    ) {
      const updateTime = new Date(updateInfo.updatedAt);
      const now = new Date();
      const hoursSinceUpdate = (now - updateTime) / (1000 * 60 * 60);

      // Chỉ hiển thị nếu update trong vòng 1 giờ trước
      if (hoursSinceUpdate < 1) {
        // Gửi message để renderer hiển thị custom dialog đẹp
        setTimeout(() => {
          // Đợi window sẵn sàng
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("update-status", {
              status: "update-success",
              message: `Đã cập nhật lên phiên bản ${currentVersion}`,
              version: currentVersion,
            });

            // Xóa file sau khi đã gửi message
            setTimeout(() => {
              try {
                fs.unlinkSync(updateVersionPath);
              } catch (err) {
                console.error("Error deleting update version file:", err);
              }
            }, 3000);
          }
        }, 2000); // Đợi 2 giây sau khi window load
        return;
      }
    }

    // Nếu không khớp điều kiện, xóa file để tránh hiển thị lại
    try {
      fs.unlinkSync(updateVersionPath);
    } catch (err) {
      console.error("Error deleting update version file:", err);
    }
  } catch (error) {
    console.error("Error checking update success:", error);
    // Xóa file nếu có lỗi parse
    try {
      const configDir = getConfigDir();
      const updateVersionPath = path.join(
        configDir,
        ".last-updated-version.json"
      );
      if (fs.existsSync(updateVersionPath)) {
        fs.unlinkSync(updateVersionPath);
      }
    } catch (err) {
      // Ignore
    }
  }
}

app.whenReady().then(async () => {
  // Kiểm tra license trước khi mở window
  const canContinue = await checkLicenseBeforeStart();
  if (canContinue) {
    createWindow();
    // Bắt đầu kiểm tra license định kỳ sau khi window được tạo
    startPeriodicLicenseCheck();
    // Kiểm tra và hiển thị thông báo update thành công
    checkAndShowUpdateSuccess();

    // Kết nối giám sát (chỉ khi người dùng đã bật + nhập token)
    try { if (loadSheetSettings().monitorEnabled) monitorAgent.start(); } catch (err) { console.error("monitor start:", err); }

    // Làm nóng server PO token ngay lúc mở app: lần đầu trên máy mới, antivirus quét
    // node.exe nên server lên chậm — dựng sẵn ở đây thì lúc bấm tải là đã có token.
    // KHÔNG await: server lên chậm không được chặn cửa sổ hiện ra.
    ensurePotServer((message) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win && !win.isDestroyed()) win.webContents.send("sheet:event", { type: "log", message });
      console.log(message);
    });
  }
});

app.on("window-all-closed", () => {
  // Dừng kiểm tra license khi đóng tất cả windows
  stopPeriodicLicenseCheck();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  // Dừng kiểm tra license trước khi quit
  stopPeriodicLicenseCheck();
  // Tắt server PO token, không để tiến trình node mồ côi giữ cổng 4416 — lần mở app
  // sau sẽ tưởng cổng bận và nhảy sang 4417.
  stopPotServer();
  taskTracker.abortAll();
  monitorAgent.stop();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC handler để mở cửa sổ mới
ipcMain.handle("open-new-window", async () => {
  createWindow();
  return { success: true };
});

// Helper function để lấy projects directory
function getProjectsDir() {
  const configDir = getConfigDir();
  return path.join(configDir, "projects");
}

// Helper function để đảm bảo projects directory tồn tại
function ensureProjectsDir() {
  const projectsDir = getProjectsDir();
  if (!fs.existsSync(projectsDir)) {
    fs.mkdirSync(projectsDir, { recursive: true });
  }
  return projectsDir;
}

// Helper function để lấy file path của project config
function getProjectConfigPath(projectName) {
  const projectsDir = ensureProjectsDir();
  // Sanitize project name để tránh invalid file names
  const sanitizedName = projectName.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(projectsDir, `${sanitizedName}.json`);
}

// Helper function để lấy file path của current project
function getCurrentProjectPath() {
  const configDir = getConfigDir();
  return path.join(configDir, ".current-project.json");
}

// Tên project đang mở — tải theo Sheet đọc settings.download của đúng project này,
// giống hệt lúc bấm tải thủ công (run-script truyền PROJECT_NAME xuống download.js).
function getCurrentProjectName() {
  try {
    const p = getCurrentProjectPath();
    if (!fs.existsSync(p)) return "default";
    return JSON.parse(fs.readFileSync(p, "utf-8")).projectName || "default";
  } catch {
    return "default";
  }
}

// IPC handler để lấy danh sách projects
ipcMain.handle("get-projects", async () => {
  try {
    const projectsDir = ensureProjectsDir();
    const files = fs.readdirSync(projectsDir);
    const projects = files
      .filter((file) => file.endsWith(".json"))
      .map((file) => file.replace(".json", ""));
    return { success: true, projects };
  } catch (error) {
    console.error("Error getting projects:", error);
    return { success: false, error: error.message, projects: [] };
  }
});

// IPC handler để lấy danh sách projects kèm metadata (cho dashboard)
ipcMain.handle("get-projects-with-meta", async () => {
  try {
    const projectsDir = ensureProjectsDir();
    const currentProjectPath = getCurrentProjectPath();
    let currentProjectName = null;
    if (fs.existsSync(currentProjectPath)) {
      try {
        const content = fs.readFileSync(currentProjectPath, "utf-8");
        currentProjectName = JSON.parse(content).projectName;
      } catch (err) {
        // ignore
      }
    }
    const files = fs.readdirSync(projectsDir).filter((f) => f.endsWith(".json"));
    const list = [];
    for (const file of files) {
      const name = file.replace(".json", "");
      const filePath = path.join(projectsDir, file);
      let createdAt = null;
      let updatedAt = null;
      let projectName = name;
      let renderDay = null;
      let renderVideos = null;
      let outputFolder = null;
      let cycleDays = 1;
      let lastRenderAt = null;
      let starred = false;
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        const data = JSON.parse(content);
        createdAt = data.createdAt || null;
        updatedAt = data.updatedAt || null;
        if (data.projectName) projectName = data.projectName;
        starred = !!data.starred;
        if (data.settings && data.settings.render) {
          const r = data.settings.render;
          renderDay = r.day != null ? String(r.day) : null;
          renderVideos = r.videos != null ? String(r.videos) : null;
          outputFolder = r.outputFolder || null;
          cycleDays = typeof r.cycleDays !== "undefined" ? Math.max(1, parseInt(r.cycleDays, 10) || 1) : (parseInt(r.day, 10) || 1);
          lastRenderAt = r.lastRenderAt || null;
        }
      } catch (err) {
        // ignore
      }
      const now = Date.now();
      const dayMs = 24 * 60 * 60 * 1000;
      let daysLeft = null;
      if (lastRenderAt) {
        const last = new Date(lastRenderAt).getTime();
        const nextDeadline = last + cycleDays * dayMs;
        daysLeft = Math.ceil((nextDeadline - now) / dayMs);
      } else {
        daysLeft = 0;
      }
      list.push({
        name,
        displayName: name === "default" ? "Mặc định" : projectName,
        createdAt,
        updatedAt,
        isCurrent: name === currentProjectName,
        renderDay,
        renderVideos,
        outputFolder,
        cycleDays,
        lastRenderAt,
        daysLeft,
        starred,
      });
    }
    // Sắp xếp: có sao (BKT) luôn ở đầu, trong mỗi nhóm sort theo ngày còn lại (gần deadline trước)
    list.sort((a, b) => {
      if (a.starred && !b.starred) return -1;
      if (!a.starred && b.starred) return 1;
      const da = a.daysLeft ?? 9999;
      const db = b.daysLeft ?? 9999;
      return da - db;
    });
    return { success: true, projects: list };
  } catch (error) {
    console.error("Error getting projects with meta:", error);
    return { success: false, error: error.message, projects: [] };
  }
});

// IPC handler: đánh dấu BKT (ngôi sao) cho dự án
ipcMain.handle("set-project-starred", async (event, projectName, starred) => {
  try {
    if (!projectName || projectName.trim() === "") {
      return { success: false, error: "Tên dự án không hợp lệ" };
    }
    const projectPath = getProjectConfigPath(projectName);
    if (!fs.existsSync(projectPath)) {
      return { success: false, error: "Dự án không tồn tại" };
    }
    const content = fs.readFileSync(projectPath, "utf-8");
    const data = JSON.parse(content);
    data.starred = !!starred;
    data.updatedAt = new Date().toISOString();
    fs.writeFileSync(projectPath, JSON.stringify(data, null, 2));
    return { success: true };
  } catch (error) {
    console.error("Error set-project-starred:", error);
    return { success: false, error: error.message };
  }
});

// IPC handler: cập nhật thời điểm render cuối (sau khi chạy render xong)
ipcMain.handle("set-project-last-render", async (event, projectName) => {
  try {
    if (!projectName || projectName.trim() === "") {
      return { success: false, error: "Tên dự án không hợp lệ" };
    }
    const projectPath = getProjectConfigPath(projectName);
    if (!fs.existsSync(projectPath)) {
      return { success: false, error: "Dự án không tồn tại" };
    }
    const content = fs.readFileSync(projectPath, "utf-8");
    const data = JSON.parse(content);
    if (!data.settings) data.settings = {};
    if (!data.settings.render) data.settings.render = {};
    data.settings.render.lastRenderAt = new Date().toISOString();
    data.updatedAt = new Date().toISOString();
    fs.writeFileSync(projectPath, JSON.stringify(data, null, 2));
    return { success: true };
  } catch (error) {
    console.error("Error set-project-last-render:", error);
    return { success: false, error: error.message };
  }
});

// IPC handler để tạo project mới
ipcMain.handle("create-project", async (event, projectName) => {
  try {
    if (!projectName || projectName.trim() === "") {
      return { success: false, error: "Tên dự án không được để trống" };
    }

    const sanitizedName = projectName.trim().replace(/[^a-zA-Z0-9_-]/g, "_");
    if (sanitizedName === "") {
      return { success: false, error: "Tên dự án không hợp lệ" };
    }

    const projectPath = getProjectConfigPath(sanitizedName);
    if (fs.existsSync(projectPath)) {
      return { success: false, error: "Dự án đã tồn tại" };
    }

    // Tạo config mặc định cho project mới
    const defaultConfig = {
      projectName: sanitizedName,
      createdAt: new Date().toISOString(),
      settings: {},
    };

    fs.writeFileSync(projectPath, JSON.stringify(defaultConfig, null, 2));
    return { success: true, projectName: sanitizedName };
  } catch (error) {
    console.error("Error creating project:", error);
    return { success: false, error: error.message };
  }
});

// IPC handler để xóa project
ipcMain.handle("delete-project", async (event, projectName) => {
  try {
    if (!projectName || projectName.trim() === "") {
      return { success: false, error: "Tên dự án không hợp lệ" };
    }

    const projectPath = getProjectConfigPath(projectName);
    if (!fs.existsSync(projectPath)) {
      return { success: false, error: "Dự án không tồn tại" };
    }

    // Kiểm tra xem có phải project hiện tại không
    const currentProjectPath = getCurrentProjectPath();
    let currentProject = null;
    if (fs.existsSync(currentProjectPath)) {
      try {
        const currentContent = fs.readFileSync(currentProjectPath, "utf-8");
        currentProject = JSON.parse(currentContent).projectName;
      } catch (err) {
        // Ignore
      }
    }

    // Xóa file config
    fs.unlinkSync(projectPath);

    // Nếu là project hiện tại, xóa current project
    if (currentProject === projectName) {
      if (fs.existsSync(currentProjectPath)) {
        fs.unlinkSync(currentProjectPath);
      }
    }

    return { success: true };
  } catch (error) {
    console.error("Error deleting project:", error);
    return { success: false, error: error.message };
  }
});

// IPC handler để lưu config của project
ipcMain.handle("save-project-config", async (event, projectName, config) => {
  try {
    if (!projectName || projectName.trim() === "") {
      return { success: false, error: "Tên dự án không hợp lệ" };
    }

    const projectPath = getProjectConfigPath(projectName);
    let projectData = {
      projectName: projectName,
      settings: {},
    };

    // Đọc config hiện tại nếu có
    if (fs.existsSync(projectPath)) {
      try {
        const existingContent = fs.readFileSync(projectPath, "utf-8");
        projectData = JSON.parse(existingContent);
      } catch (err) {
        console.error(`Error reading existing project config: ${err.message}`);
      }
    }

    // Cập nhật settings, giữ lại lastRenderAt nếu config từ renderer không gửi
    const existingLastRender = projectData.settings?.render?.lastRenderAt;
    projectData.settings = config;
    if (existingLastRender && projectData.settings?.render && projectData.settings.render.lastRenderAt == null) {
      projectData.settings.render.lastRenderAt = existingLastRender;
    }
    projectData.updatedAt = new Date().toISOString();

    fs.writeFileSync(projectPath, JSON.stringify(projectData, null, 2));
    return { success: true };
  } catch (error) {
    console.error("Error saving project config:", error);
    return { success: false, error: error.message };
  }
});

// IPC handler để load config của project
// Mặc định load "default" nếu không có project được chỉ định
ipcMain.handle("load-project-config", async (event, projectName) => {
  try {
    // Nếu không có projectName hoặc là null, dùng "default"
    const projectToLoad = projectName && projectName.trim() !== "" 
      ? projectName.trim() 
      : "default";

    const projectPath = getProjectConfigPath(projectToLoad);
    if (!fs.existsSync(projectPath)) {
      // Nếu project không tồn tại, tạo project "default" với cấu trúc mẫu
      if (projectToLoad === "default") {
        const defaultProject = {
          projectName: "default",
          createdAt: new Date().toISOString(),
          settings: {},
          updatedAt: new Date().toISOString(),
        };
        fs.writeFileSync(
          projectPath,
          JSON.stringify(defaultProject, null, 2)
        );
        return { success: true, config: {} };
      }
      return { success: true, config: {} };
    }

    const content = fs.readFileSync(projectPath, "utf-8");
    const projectData = JSON.parse(content);
    return { success: true, config: projectData.settings || {} };
  } catch (error) {
    console.error("Error loading project config:", error);
    return { success: false, error: error.message, config: {} };
  }
});

// IPC handler để lấy project hiện tại
// Mặc định trả về "default" nếu không có project được chọn
ipcMain.handle("get-current-project", async () => {
  try {
    const currentProjectPath = getCurrentProjectPath();
    if (!fs.existsSync(currentProjectPath)) {
      // Nếu không có project được chọn, mặc định là "default"
      return { success: true, projectName: "default" };
    }

    const content = fs.readFileSync(currentProjectPath, "utf-8");
    const data = JSON.parse(content);
    const projectName = data.projectName || "default";
    // Đảm bảo project "default" tồn tại
    if (projectName === "default") {
      const defaultProjectPath = getProjectConfigPath("default");
      if (!fs.existsSync(defaultProjectPath)) {
        // Tạo project "default" với cấu trúc mẫu
        const defaultProject = {
          projectName: "default",
          createdAt: new Date().toISOString(),
          settings: {},
          updatedAt: new Date().toISOString(),
        };
        fs.writeFileSync(
          defaultProjectPath,
          JSON.stringify(defaultProject, null, 2)
        );
      }
    }
    return { success: true, projectName };
  } catch (error) {
    console.error("Error getting current project:", error);
    return { success: false, error: error.message, projectName: "default" };
  }
});

// IPC handler để set project hiện tại
ipcMain.handle("set-current-project", async (event, projectName) => {
  try {
    const currentProjectPath = getCurrentProjectPath();
    const data = { projectName: projectName || null };
    fs.writeFileSync(currentProjectPath, JSON.stringify(data, null, 2));
    return { success: true };
  } catch (error) {
    console.error("Error setting current project:", error);
    return { success: false, error: error.message };
  }
});

// Helper function để tải file với redirect handling
function downloadFile(url, filePath) {
  return new Promise((resolve, reject) => {
    const download = (currentUrl) => {
      const file = fs.createWriteStream(filePath);

      https
        .get(currentUrl, (response) => {
          // Xử lý redirect
          if (
            response.statusCode === 301 ||
            response.statusCode === 302 ||
            response.statusCode === 307 ||
            response.statusCode === 308
          ) {
            file.close();
            fs.unlinkSync(filePath);
            const redirectUrl = response.headers.location;
            if (!redirectUrl) {
              reject({ success: false, error: "Redirect URL không hợp lệ" });
              return;
            }
            // Follow redirect
            download(redirectUrl);
            return;
          }

          // Kiểm tra status code
          if (response.statusCode !== 200) {
            file.close();
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
            }
            reject({
              success: false,
              error: `Lỗi HTTP: ${response.statusCode} ${response.statusMessage}`,
            });
            return;
          }

          // Lấy content length để hiển thị progress (optional)
          const totalSize = parseInt(response.headers["content-length"], 10);
          let downloadedSize = 0;

          response.on("data", (chunk) => {
            downloadedSize += chunk.length;
          });

          response.pipe(file);

          file.on("finish", () => {
            file.close();
            resolve({
              success: true,
              message: `Đã tải yt-dlp mới nhất thành công!`,
              size: downloadedSize,
            });
          });
        })
        .on("error", (err) => {
          file.close();
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
          reject({ success: false, error: `Lỗi kết nối: ${err.message}` });
        });
    };

    download(url);
  });
}

// IPC handlers cho auto-updater
ipcMain.handle("check-for-updates", async () => {
  if (!app.isPackaged) {
    return {
      success: false,
      message: "Chức năng này chỉ hoạt động trong phiên bản đã build",
    };
  }
  try {
    await autoUpdater.checkForUpdates();
    return { success: true, message: "Đang kiểm tra cập nhật..." };
  } catch (error) {
    return {
      success: false,
      message: error.message || "Lỗi khi kiểm tra cập nhật",
    };
  }
});

ipcMain.handle("download-update", async () => {
  if (!app.isPackaged) {
    return {
      success: false,
      message: "Chức năng này chỉ hoạt động trong phiên bản đã build",
    };
  }
  try {
    await autoUpdater.downloadUpdate();
    return { success: true, message: "Đang tải cập nhật..." };
  } catch (error) {
    return {
      success: false,
      message: error.message || "Lỗi khi tải cập nhật",
    };
  }
});

ipcMain.handle("install-update", async () => {
  if (!app.isPackaged) {
    return {
      success: false,
      message: "Chức năng này chỉ hoạt động trong phiên bản đã build",
    };
  }
  try {
    // Lưu version để hiển thị thông báo sau khi update
    const updateVersionPath = path.join(
      getConfigDir(),
      ".last-updated-version.json"
    );
    try {
      // Lấy version từ update info (nếu có trong memory hoặc từ event trước đó)
      // Nếu không có, dùng current version + 1 (fallback)
      const currentVersion = app.getVersion();
      fs.writeFileSync(
        updateVersionPath,
        JSON.stringify({
          version: currentVersion, // Sẽ được update khi app khởi động lại với version mới
          updatedAt: new Date().toISOString(),
        }),
        "utf-8"
      );
    } catch (err) {
      console.error("Error saving update version:", err);
    }

    autoUpdater.quitAndInstall(false, true);
    return { success: true, message: "Đang khởi động lại để cài đặt..." };
  } catch (error) {
    return {
      success: false,
      message: error.message || "Lỗi khi cài đặt cập nhật",
    };
  }
});

// IPC handler để tải yt-dlp mới nhất
ipcMain.handle("download-ytdlp", async () => {
  try {
    const appPath = getAppPath();
    const binDir = path.join(appPath, "bin");
    const ytdlpPath = path.join(binDir, "yt-dlp.exe");
    const downloadUrl =
      "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";

    // Đảm bảo thư mục bin tồn tại
    if (!fs.existsSync(binDir)) {
      fs.mkdirSync(binDir, { recursive: true });
    }

    // Tải file
    const result = await downloadFile(downloadUrl, ytdlpPath);
    return {
      ...result,
      message: result.message || "Đã tải yt-dlp mới nhất thành công!",
    };
  } catch (error) {
    const errorMsg =
      error?.error || error?.message || error?.toString() || String(error);
    console.error(`Error downloading yt-dlp: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
});

// Cài đặt yt-dlp dùng chung toàn app (ytdlp-settings.json). Tách khỏi project JSON để
// YouTube đổi cơ chế thì sửa đúng MỘT chỗ, áp cho cả tải thủ công lẫn chạy theo Sheet.
ipcMain.handle("ytdlp:get-settings", async () => loadYtdlpSettings(getConfigDir()));
ipcMain.handle("ytdlp:save-settings", async (event, settings) => {
  try {
    return { success: true, ...saveYtdlpSettings(getConfigDir(), settings) };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
});

// IPC handler để tự động phát hiện GPU codec
ipcMain.handle("detect-gpu-codec", async () => {
  return new Promise((resolve) => {
    try {
      const appPath = getAppPath();
      const ffmpegPath = path.join(appPath, "bin", "ffmpeg.exe");
      
      // Kiểm tra xem ffmpeg có tồn tại không
      if (!fs.existsSync(ffmpegPath)) {
        console.warn(`FFmpeg không tìm thấy tại: ${ffmpegPath}`);
        resolve({ success: false, codec: null, error: "FFmpeg không tìm thấy" });
        return;
      }

      const checkProcess = spawn(ffmpegPath, ["-encoders"]);
      let output = "";

      checkProcess.stdout.on("data", (data) => {
        output += data.toString();
      });

      checkProcess.stderr.on("data", (data) => {
        output += data.toString();
      });

      checkProcess.on("close", () => {
        // Ưu tiên theo thứ tự: NVIDIA > Intel > AMD
        // Kiểm tra NVIDIA NVENC
        if (output.includes("h264_nvenc")) {
          console.log("✅ Phát hiện GPU: NVIDIA (h264_nvenc)");
          resolve({ success: true, codec: "h264_nvenc" });
          return;
        }
        
        // Kiểm tra Intel QuickSync
        if (output.includes("h264_qsv")) {
          console.log("✅ Phát hiện GPU: Intel QuickSync (h264_qsv)");
          resolve({ success: true, codec: "h264_qsv" });
          return;
        }
        
        // Kiểm tra AMD AMF
        if (output.includes("h264_amf")) {
          console.log("✅ Phát hiện GPU: AMD AMF (h264_amf)");
          resolve({ success: true, codec: "h264_amf" });
          return;
        }
        
        // Không tìm thấy GPU encoder nào
        console.warn("⚠️ Không phát hiện GPU encoder nào");
        resolve({ success: false, codec: null, error: "Không tìm thấy GPU encoder" });
      });

      checkProcess.on("error", (error) => {
        console.error(`❌ Lỗi khi kiểm tra GPU encoder: ${error.message}`);
        resolve({ success: false, codec: null, error: error.message });
      });
    } catch (error) {
      console.error(`❌ Lỗi trong detect-gpu-codec: ${error.message}`);
      resolve({ success: false, codec: null, error: error.message });
    }
  });
});

// ===== Sheet-watch feature =====
function sheetSettingsPath() {
  return path.join(getConfigDir(), "sheet-settings.json");
}
function loadSheetSettings() {
  try { return JSON.parse(fs.readFileSync(sheetSettingsPath(), "utf-8")); }
  catch { return { spreadsheetId: "", credentialsPath: "", channelsRoot: "", pollSec: 300, autoRunOnOpen: false, useGPU: false, videoSpeed: 0.95, gpuVideoCodec: "h264_nvenc", ytApiKey: "", gpmIdleCloseMin: 10, cleanupEnabled: false, cleanupKeepDays: 1 }; }
}
function saveSheetSettings(s) { fs.writeFileSync(sheetSettingsPath(), JSON.stringify(s, null, 2), "utf-8"); }

const YTDLP_PATH = path.join(getAppPath(), "bin", "yt-dlp.exe");
let sheetRunner = null;

// ===== Giám sát trên web (chỉ gửi LÊN server, không nhận lệnh) =====
// Token kết nối do server cấp tự động lần đầu, lưu riêng khỏi sheet-settings.json: file đó là cấu hình
// người dùng hay sao chép/gửi nhờ hỗ trợ, token thì không được lẫn vào.
const monitorTokenPath = () => path.join(getConfigDir(), ".monitor-token.json");
function loadMonitorToken() {
  try { return String(JSON.parse(fs.readFileSync(monitorTokenPath(), "utf-8")).token || ""); } catch { return ""; }
}
function saveMonitorToken(token) {
  if (!token) { try { fs.unlinkSync(monitorTokenPath()); } catch { /* chưa có file */ } return; }
  fs.writeFileSync(monitorTokenPath(), JSON.stringify({ token }), { encoding: "utf-8", mode: 0o600 });
}
// Địa chỉ server mặc định cố định trong app; biến môi trường chỉ để chạy thử trên máy dev.
const monitorServerUrl = () => process.env.VIDMASTER_SERVER_URL || DEFAULT_SERVER_URL;
// Chỉ cờ bật/tắt mới ảnh hưởng kết nối.
const monitorSettingsKey = (s) => JSON.stringify([!!s?.monitorEnabled]);
const proxyHealth = createProxyHealth({ checkFn: (raw) => checkProxy(raw) });

// Dựng ảnh chụp trạng thái từ Sheet + file trạng thái trên máy. Trả null khi chưa cấu hình Sheet
// (khác với "Sheet rỗng": gửi snapshot rỗng sẽ xoá hết kênh đang hiện trên web).
async function collectMonitorSnapshot() {
  const s = loadSheetSettings();
  if (requireSheetSettings(s) || !s.channelsRoot) return null;
  const sheets = createSheetsClient(s.credentialsPath);
  const channels = await readConfigSheet(sheets, s.spreadsheetId);

  // Đọc tab từng kênh, 3 kênh một lượt để không dội quota Sheets (60 lượt đọc/phút).
  const urlsByChannel = new Map();
  for (let i = 0; i < channels.length; i += 3) {
    await Promise.all(channels.slice(i, i + 3).map(async (c) => {
      try { urlsByChannel.set(c.sheetName, await readChannelUrls(sheets, s.spreadsheetId, c.sheetName)); }
      catch { /* tab lỗi/thiếu: để null -> web hiện "—", không báo hết video nhầm */ }
    }));
  }

  // Số liệu YouTube đã nằm sẵn trong ⚙config (đọc lại, không tốn quota YouTube).
  const statsByChannel = new Map();
  try {
    const st = await listStatsChannels();
    if (st.ok) for (const r of st.rows) statsByChannel.set(r.sheetName, r);
  } catch { /* thiếu số liệu không phải lỗi */ }

  // Kiểm tra proxy chạy nền; xong thì gửi snapshot bù để web thấy kết quả sớm.
  const idents = channels.filter((c) => c.enabled && c.videoSource !== "local").map((c) => proxyIdentity(c.proxy)).filter(Boolean);
  const uniq = [...new Map(idents.map((p) => [p.key, p])).values()];
  proxyHealth.refresh(uniq).then((n) => { if (n > 0) monitorAgent?.requestSnapshot(); }).catch(() => {});

  return buildSnapshot({
    channels, urlsByChannel, statsByChannel,
    state: loadState(path.join(s.channelsRoot, "runner-state.json")),
    resume: loadResume(path.join(s.channelsRoot, "resume-state.json")),
    today: todayStr(new Date()),
    fileExists: (p) => { try { return fs.existsSync(p); } catch { return false; } },
    proxyHealth: proxyHealth.snapshot(),
  });
}

// Theo dõi tác vụ chạy tay. emit gửi qua agent (agent tự bỏ qua khi chưa bật giám sát), lỗi ở đây không bao giờ lan sang tác vụ thật.
const taskTracker = createTaskTracker({ emit: (m) => monitorAgent?.onTaskEvent(m) });
const monitorAgent = createMonitorAgent({
  getSettings: loadSheetSettings,
  getToken: loadMonitorToken,
  getAppToken: () => sessionMgr.getToken(),
  saveToken: saveMonitorToken,
  getServerUrl: monitorServerUrl,
  getMachineId,
  appVersion: app.getVersion(),
  collectSnapshot: collectMonitorSnapshot,
  getState: () => ({
    running: !!sheetRunner?.isRunning?.(), watching: !!sheetRunner?.isWatching?.(),
    // Tác vụ chạy tay (render, tải, đổi thumbnail, lên lịch...). Có cái này thì web không còn báo "rảnh" khi máy đang bận.
    tasks: taskTracker.list(),
  }),
  log: (m) => console.log(`[monitor] ${m}`),
  onStatus: (st) => {
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send("monitor:status", st);
  },
});
let sheetRunnerWin = null;   // cửa sổ mà runner đang phát sự kiện tới
let sheetRunnerKey = null;   // ảnh chụp cấu hình lúc dựng runner (đổi -> phải dựng lại)

// --- PO token (bgutil) ------------------------------------------------------
// Một server duy nhất cho cả app, dựng lúc mở và tắt lúc thoát. Không có nó thì
// yt-dlp báo "PO Token Providers: none" và YouTube hoặc chặn thẳng, hoặc âm thầm
// chỉ trả về format rác (đo được: 360p thay vì 2160p).
let potServer = null;

function bgutilPaths() {
  return getBgutilPaths(getAppPath());
}

async function ensurePotServer(log = () => {}) {
  if (potServer) return potServer;
  const { serverDir } = bgutilPaths();
  if (!serverDir) {
    log("⚠️ Chưa có bin/bgutil — chạy `node scripts/setup-bgutil.mjs` để tránh bị YouTube chặn");
    return null;
  }
  potServer = await startPotServer({
    nodePath: getNodeExecutable(getAppPath()),
    serverDir,
    log,
  });
  return potServer;
}

async function stopPotServer() {
  try {
    await potServer?.stop?.();
  } catch {
    // Tắt app rồi, tiến trình con chết theo cũng được.
  }
  potServer = null;
}

// Cờ PO token truyền cho yt-dlp. Gom một chỗ để hai luồng tải không trôi khác nhau.
function potOptions() {
  const { pluginDir, scriptPath } = bgutilPaths();
  return {
    pluginDirs: pluginDir,
    potBaseUrl: potServer?.baseUrl || null,
    potScriptPath: scriptPath,
  };
}

// --- pool cookie ------------------------------------------------------------
// Giữ vị trí xoay vòng GIỮA các lần tải: dựng pool mới cho mỗi video thì cookie đã
// cháy lại bị thử đầu tiên ở mọi video, tốn một lượt bị chặn mỗi lần.
// Nhưng vẫn phải dựng lại khi người dùng đổi cấu hình giữa chừng, nên khoá theo
// chính cặp (thư mục, file).
let cookiePoolCache = { key: null, pool: null };

function getCookiePool({ folder, file }) {
  const key = `${folder || ""}|${file || ""}`;
  if (cookiePoolCache.key !== key) {
    cookiePoolCache = { key, pool: createCookiePool({ folder, file }) };
  }
  return cookiePoolCache.pool;
}

function buildSheetRunner(win) {
  const s = loadSheetSettings();
  const sheets = createSheetsClient(s.credentialsPath);
  const statePath = path.join(s.channelsRoot, "runner-state.json");
  const resumePath = path.join(s.channelsRoot, "resume-state.json");
  const emitEvent = (evt) => {
    if (win && !win.isDestroyed()) win.webContents.send("sheet:event", evt);
    // Chép sự kiện lên web giám sát. Lỗi ở đây không bao giờ được ảnh hưởng tới runner.
    try { monitorAgent?.onSheetEvent(evt); } catch { /* ignore */ }
  };
  // Topic của group Telegram: nhiều máy chung 1 group thì mỗi máy một topic.
  // Bỏ trống → undefined → tin vào General như trước.
  const tgTopicId = parseTopicId(s.gpmTelegramTopicId);
  // Hàng đợi upload GPM (state riêng, log ra cùng luồng sự kiện Sheet).
  const uploadQueue = createUploadQueue({
    // Nguồn sự thật = Sheet cột C: đọc trạng thái upload của kênh → slot đã dùng + url đã lên lịch.
    readChannelUploads: async (sheetName) => {
      const rows = await readUploadStatuses(sheets, s.spreadsheetId, sheetName);
      const scheduledUrls = new Set();
      const usedSlots = [];
      for (const { url, uploadStatus } of rows) {
        const iso = parseScheduledISO(uploadStatus);
        if (iso) { scheduledUrls.add(url); usedSlots.push(iso); }
      }
      return { scheduledUrls, usedSlots };
    },
    log: (message) => emitEvent({ type: "log", message }),
    emit: emitEvent, // phát sự kiện upload-status lên bảng UI
    // connectProfile tự đóng phiên đang mở của profile trước khi start — truyền log để
    // người dùng thấy nó có thật sự đóng cái gì hay không.
    connect: (gpmHost, profileId) =>
      connectProfile(gpmHost, profileId, { log: (message) => emitEvent({ type: "log", message }) }),
    // Rảnh bấy lâu thì tắt trình duyệt GPM (0 = luôn giữ mở). Đọc 1 lần lúc dựng runner:
    // đổi cấu hình khi đang chạy thì phải Dừng → Chạy lại.
    idleCloseMs: Math.max(0, Number(s.gpmIdleCloseMin ?? 10) || 0) * 60_000,

    // Ghi ngược trạng thái từng bước vào cột C của tab kênh.
    setUploadStatus: (sheetName, rowIndex, status) =>
      setUploadStatus(sheets, s.spreadsheetId, sheetName, rowIndex, status),
    // Gửi 1 digest Telegram khi hàng đợi upload rảnh.
    notifyDigest: async (results) => {
      if (!s.gpmTelegramEnabled) return; // người dùng tắt thông báo
      const text = buildDigest(results);
      if (!text) return;
      if (!s.gpmTelegramToken || !s.gpmTelegramChatId) return;
      const r = await sendTelegram(s.gpmTelegramToken, s.gpmTelegramChatId, text, { threadId: tgTopicId });
      if (!r.ok) emitEvent({ type: "log", message: `Telegram lỗi: ${r.error || "?"}` });
    },
    // Xong một kênh → một tin mang cả ảnh trang Nội dung lẫn kết quả của riêng kênh đó.
    // Phải bật RIÊNG ô "Gửi kèm ảnh…"; không bật thì để null hẳn để hàng đợi khỏi tốn
    // công chụp (~20s/kênh) và chỉ còn digest tổng như trước.
    // Đọc 1 lần lúc dựng runner — đổi cấu hình khi đang chạy thì phải Dừng → Chạy lại.
    notifyChannel: !(s.gpmTelegramEnabled && s.gpmTelegramPhoto) ? null : async (sheetName, results, image) => {
      if (!s.gpmTelegramToken || !s.gpmTelegramChatId) return;
      const caption = buildChannelReport(sheetName, results);
      // Mất ảnh không được làm mất kết quả: không chụp được thì gửi tin chữ.
      const r = image
        ? await sendTelegramPhoto(s.gpmTelegramToken, s.gpmTelegramChatId, image, caption, { threadId: tgTopicId })
        : await sendTelegram(s.gpmTelegramToken, s.gpmTelegramChatId, caption, { threadId: tgTopicId });
      if (!r.ok) emitEvent({ type: "log", message: `Telegram [${sheetName}] lỗi: ${r.error || "?"}` });
    },
  });
  return createSheetRunner({
    uploadQueue,
    refreshStats: async () => {
      const r = await refreshChannelStats();
      emitEvent({ type: "stats", ...r });
      if (!r.ok) throw new Error(r.error);
    },
    config: {
      spreadsheetId: s.spreadsheetId, channelsRoot: s.channelsRoot, statePath, renderConcurrency: 2,
      presetsDir: getPresetsDir(app), // thiếu dòng này thì mọi kênh renderMode:"composer" bị sheet-runner.js bỏ qua preset (config.presetsDir undefined)
      useGPU: !!s.useGPU,
      gpuVideoCodec: s.gpuVideoCodec || "h264_nvenc",
      videoSpeed: (typeof s.videoSpeed === "number" && s.videoSpeed > 0) ? s.videoSpeed : 0.95,
      gpmEnabled: !!s.gpmEnabled,
      gpmHost: s.gpmHost || "127.0.0.1:19995",
      gpmLocale: s.gpmLocale || "vi",
      cleanupEnabled: !!s.cleanupEnabled,
      // Không ?? 1 ở đây: để nguyên giá trị thô cho planCleanup tự quyết, vì 0 là giá trị
      // HỢP LỆ (xoá ngay khi upload xong) còn null/"" mới là "chưa cấu hình" -> lùi về 1.
      cleanupKeepDays: s.cleanupKeepDays,
    },
    sheetsApi: {
      readConfigSheet: () => readConfigSheet(sheets, s.spreadsheetId),
      readChannelUrls: (name) => readChannelUrls(sheets, s.spreadsheetId, name),
      setUrlStatus: (name, row, status) => setUrlStatus(sheets, s.spreadsheetId, name, row, status),
      setUploadStatus: (name, row, status) => setUploadStatus(sheets, s.spreadsheetId, name, row, status),
      appendUrls: (name, urls) => appendUrls(sheets, s.spreadsheetId, name, urls),
    },
    // Preflight đầu lượt: GPM có đang chạy không. Ném lỗi = chưa mở GPM.
    checkGpm: async () => { await testGpmConnection(s.gpmHost || "127.0.0.1:19995"); return true; },
    // extractorArgs VÀ cấu hình tải đọc TỪNG LƯỢT TẢI (không cache lúc dựng runner):
    // YouTube đổi cơ chế giữa chừng thì người dùng sửa trong app là lượt kế đã ăn ngay,
    // khỏi Dừng → Chạy lại.
    // Tải theo Sheet dùng ĐÚNG cấu hình của tab "Tải video" (cookies, Drive, ngôn ngữ)
    // như khi bấm tải thủ công; riêng proxy vẫn lấy từ cột proxy trong Sheet (opts.proxy).
    downloader: (url, dir, opts) => {
      const { extractorArgs } = loadYtdlpSettings(getConfigDir());
      const dl = loadDownloadConfig(getProjectsDir(), getCurrentProjectName());
      const jsRuntime = getNodeExecutable(getAppPath());
      // Ghi ra log những gì thực sự truyền cho yt-dlp: nó BỎ QUA âm thầm key extractor lạ
      // và cookies sai đường dẫn, gõ sai không có lỗi nào cả — nhìn log là biết ngay.
      // Đọc lại settings Sheet MỖI LƯỢT như đọc lại cấu hình tải: cookie cháy giữa
      // chừng thì người dùng bỏ cookie mới vào rồi sửa trong app là lượt kế ăn ngay,
      // khỏi phải Dừng → Chạy lại cả lượt đang chạy dở.
      // Cookie riêng của Sheet thắng; để trống mới lùi về cấu hình tab "Tải video",
      // nên ai đang chạy Sheet bằng cookie ở tab đó không bị mất gì.
      const ckSrc = resolveSheetCookieSource(loadSheetSettings(), dl);
      const cookiesNote = ckSrc.file
        ? (fs.existsSync(ckSrc.file) ? path.basename(ckSrc.file) : `${ckSrc.file} (KHÔNG THẤY FILE)`)
        : "không dùng";
      // Nhiều cookie thì xoay vòng khi bị chặn; thư mục rỗng thì lùi về file đơn.
      const cookiePool = getCookiePool(ckSrc);
      const pot = potOptions();
      // Ghi rõ cookie lấy từ ĐÂU: có hai chỗ cấu hình cookie, không nói ra thì sửa
      // nhầm chỗ rồi ngồi đoán vì sao vẫn bị chặn.
      const from = { sheet: " [settings Sheet]", download: ' [tab "Tải video"]', none: "" }[ckSrc.source];
      const cookiesInfo =
        cookiePool.size > 1 ? `${cookiePool.size} file (xoay vòng)${from}` : `${cookiesNote}${from}`;
      emitEvent({
        type: "log",
        message: `tải: extractor-args=${extractorArgs || "(không truyền)"} | cookies=${cookiesInfo} | js-runtime=${jsRuntime} | PO token=${pot.potBaseUrl || (pot.pluginDirs ? "script mode" : "KHÔNG CÓ")}`,
      });
      return downloadOne(url, dir, {
        ...opts,
        cookiePool,
        downloadDrive: dl.downloadDrive,
        driveLanguage: dl.driveLanguage,
        // descDir cố tình bỏ trống: kênh chạy theo Sheet lấy tiêu đề/mô tả từ cột trong
        // Sheet, bật --write-description chỉ rơi file .description thừa vào overlays/.
        jsRuntime,
        ytdlpPath: YTDLP_PATH,
        extractorArgs,
        ...pot,
        onRotate: ({ to, attempt, total }) =>
          emitEvent({
            type: "log",
            message: `🔄 Bị chặn — đổi cookie (${attempt}/${total}): ${to ? path.basename(to) : "không có"}`,
          }),
      });
    },
    copyLocalOverlay,
    listLocalInputs: (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".mp4")).sort() : []),
    renderer: (opts) => renderOne(opts),
    detectChroma: (videoPath, palette) =>
      detectChromaColor(videoPath, palette, { ffmpegPath: resolveFfmpegPaths().ffmpegPath, spawn, sharp }),
    listBackgrounds: (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".mp4")) : []),
    // Liệt kê kèm mtime/size cho khâu tự dọn video cũ. stat từng file riêng trong try:
    // file bị xoá xen giữa readdir và stat chỉ nên biến mất khỏi danh sách, không được
    // ném hỏng cả lượt dọn.
    listFilesWithStat: (dir) => {
      let names = [];
      try { names = fs.readdirSync(dir); } catch { return []; }
      return names.flatMap((name) => {
        const p = path.join(dir, name);
        try {
          const st = fs.statSync(p);
          return st.isFile() ? [{ path: p, mtimeMs: st.mtimeMs, size: st.size }] : [];
        } catch { return []; }
      });
    },
    ensureDirs: (root) => {
      const dirs = {
        backgroundsDir: path.join(root, "backgrounds"),
        overlaysDir: path.join(root, "overlays"),
        outputDir: path.join(root, "output"),
        inputsDir: path.join(root, "inputs"),
      };
      for (const d of [dirs.overlaysDir, dirs.outputDir, dirs.inputsDir]) if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
      return dirs;
    },
    stateStore: { load: () => loadState(statePath), save: (st) => saveState(statePath, st) },
    resumeStore: { load: () => loadResume(resumePath), save: (st) => saveResume(resumePath, st) },
    fileExists: (p) => { try { return fs.existsSync(p); } catch { return false; } },
    emit: emitEvent,
    now: () => new Date(),
    pLimitFn: (n) => pLimit(n),
    rand: () => Math.random(),
    unlink: (p) => { try { fs.unlinkSync(p); } catch { /* ignore */ } },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    // ===== Ba dep dưới đây CHỈ nhánh "Test render" dùng =====
    ensureDir: (d) => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); },
    cutClip: (opts) => cutClip(opts),
    // shell.openPath nuốt lỗi vào giá trị trả về (chuỗi rỗng = ok) chứ không ném — không
    // mở được player thì cũng chỉ là phiền, file render vẫn nằm đó, đừng để nó giết cả lượt.
    openFile: (p) => {
      shell.openPath(p).then((err) => {
        if (err) emitEvent({ type: "log", message: `Không mở được video: ${err}` });
      });
    },
  });
}

// Cắt <seconds> giây ở đoạn giữa video. RE-ENCODE chứ không -c copy: copy cắt theo
// keyframe nên hay ra vài giây đen/đứng hình ở đầu — mà đầu clip lại đúng là chỗ người
// dùng nhìn để đánh giá bản render. 30 giây ultrafast chỉ tốn vài giây.
function cutClip({ input, output, seconds }) {
  const { ffmpegPath, ffprobePath } = resolveFfmpegPaths();
  return new Promise((resolve, reject) => {
    const probe = spawn(ffprobePath, [
      "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", input,
    ]);
    let out = "";
    probe.stdout.on("data", (d) => { out += d.toString(); });
    probe.on("error", reject);
    probe.on("close", () => {
      const start = pickClipStart(parseFloat(out.trim()), seconds);
      // -ss ĐẶT SAU -i (output seek): chậm hơn input seek một chút nhưng cắt đúng mốc,
      // không phụ thuộc keyframe gần nhất.
      const ff = spawn(ffmpegPath, [
        "-y", "-i", input, "-ss", String(start), "-t", String(seconds),
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "18",
        "-c:a", "aac", "-b:a", "192k", output,
      ]);
      let err = "";
      ff.stderr.on("data", (d) => { err += d.toString().slice(-2000); });
      ff.on("error", reject);
      ff.on("close", (code) => {
        if (code === 0) resolve(output);
        // Vài trăm ký tự cuối của stderr: dòng cuối mới là câu ffmpeg nói vì sao nó chết.
        else reject(new Error(`cắt clip thất bại (ffmpeg mã ${code}): ${err.trim().slice(-300)}`));
      });
    });
  });
}

// ===== Theo dõi kênh YouTube =====
function ytClientFrom(st) {
  return createYoutubeClient((st.ytApiKey || "").trim() || DEFAULT_YT_API_KEY);
}

function requireSheetSettings(st) {
  if (!st.spreadsheetId) return "Chưa nhập Spreadsheet ID.";
  if (!st.credentialsPath) return "Chưa chọn file service account JSON.";
  return null;
}

// Đọc ⚙config một lần, gọi API, ghi ngược từng dòng, trả bảng cho UI.
// Một kênh hỏng chỉ làm hỏng dòng của nó.
async function refreshChannelStats() {
  const st = loadSheetSettings();
  const bad = requireSheetSettings(st);
  if (bad) return { ok: false, error: bad };

  const sheets = createSheetsClient(st.credentialsPath);
  const values = await readConfigValues(sheets, st.spreadsheetId);
  const channels = parseConfigRows(values);
  const { cols } = findStatsColumns(values);
  const missing = STATS_KEYS.filter((k) => cols[k] === undefined);

  const targets = channels.filter((c) => c.channelUrl);
  const stats = targets.length
    ? await fetchChannelStats(ytClientFrom(st), targets.map((c) => c.channelUrl))
    : [];
  const statByName = new Map(targets.map((c, i) => [c.sheetName, stats[i]]));
  const updatedAt = formatStamp(new Date());

  const rows = [];
  for (const ch of channels) {
    const base = { sheetName: ch.sheetName, sourceHandle: ch.sourceHandle || "", channelUrl: ch.channelUrl || "" };
    const s = statByName.get(ch.sheetName);
    if (!s) { rows.push({ ...base }); continue; } // kênh không khai Link kênh
    if (s.error) { rows.push({ ...base, error: s.error }); continue; }
    try {
      await writeChannelStats(sheets, st.spreadsheetId, "⚙config", ch.rowIndex, cols, { ...s, updatedAt });
    } catch (err) {
      rows.push({ ...base, error: String(err?.message || err) });
      continue;
    }
    rows.push({ ...base, subscribers: s.subscribers, views: s.views, videoCount: s.videoCount, hidden: s.hidden, updatedAt });
  }
  return { ok: true, rows, missing };
}

// Danh sách kênh cho bảng số liệu, chỉ đọc Sheet — KHÔNG gọi YouTube API.
// Nhờ vậy nút "Lấy URL nguồn" có ngay mà không tốn quota và không cần API key.
async function listStatsChannels() {
  const st = loadSheetSettings();
  const bad = requireSheetSettings(st);
  if (bad) return { ok: false, error: bad };

  const sheets = createSheetsClient(st.credentialsPath);
  const values = await readConfigValues(sheets, st.spreadsheetId);
  const channels = parseConfigRows(values);
  const { cols } = findStatsColumns(values);
  const missing = STATS_KEYS.filter((k) => cols[k] === undefined);

  // Số liệu đã được writeChannelStats ghi vào ⚙config từ lần làm mới trước. Đọc lại
  // chúng thay vì gọi YouTube API: card hiện số ngay khi mở app, không tốn quota.
  const cell = (row, key) => (cols[key] === undefined ? undefined : row?.[cols[key]]);
  // Sheets trả FORMATTED_VALUE nên số có thể kèm dấu phân cách ("1,200" / "1.200")
  // tuỳ locale của bảng tính. Bỏ mọi ký tự không phải chữ số rồi mới parse.
  const toNum = (v) => {
    const s = String(v ?? "").trim();
    if (!s || s === "—") return undefined; // ô trống, hoặc kênh ẩn số sub
    const digits = s.replace(/\D/g, "");
    return digits ? Number(digits) : undefined;
  };

  return {
    ok: true,
    missing,
    rows: channels.map((c) => {
      const row = values[c.rowIndex - 1]; // rowIndex là số dòng A1 (1-based)
      const subs = cell(row, "subscribers");
      return {
        sheetName: c.sheetName,
        sourceHandle: c.sourceHandle || "",
        channelUrl: c.channelUrl || "",
        subscribers: toNum(subs),
        hidden: String(subs ?? "").trim() === "—",
        views: toNum(cell(row, "totalViews")),
        videoCount: toNum(cell(row, "videoCount")),
        updatedAt: String(cell(row, "statsUpdatedAt") ?? "").trim() || undefined,
      };
    }),
  };
}

// sortBy: "views" (view cao nhất) | "newest" (mới nhất). Người dùng chọn ngay
// cạnh nút "Lấy URL nguồn" trên card kênh, không lưu vào Sheet.
async function fetchSourceUrlsFor(sheetName, sortBy = "views") {
  const st = loadSheetSettings();
  const bad = requireSheetSettings(st);
  if (bad) return { ok: false, error: bad };

  const sheets = createSheetsClient(st.credentialsPath);
  const channels = await readConfigSheet(sheets, st.spreadsheetId);
  const ch = channels.find((c) => c.sheetName === sheetName);
  if (!ch) return { ok: false, error: `Không thấy kênh "${sheetName}" trong ⚙config.` };
  if (!ch.sourceHandle) return { ok: false, error: "Kênh chưa điền cột @handle nguồn." };

  const videos = await fetchSourceVideos(ytClientFrom(st), ch.sourceHandle, { sortBy });
  const existing = (await readChannelUrls(sheets, st.spreadsheetId, sheetName)).map((r) => r.url);
  const fresh = pickNewUrls(existing, videos.map((v) => v.url));
  await appendUrls(sheets, st.spreadsheetId, sheetName, fresh);
  return { ok: true, added: fresh.length, skipped: videos.length - fresh.length };
}

// Ảnh chụp các trường cấu hình mà buildSheetRunner đọc MỘT LẦN lúc dựng. Đổi bất kỳ trường
// nào trong đây thì runner đang giữ đã lạc hậu và phải dựng lại.
function sheetSettingsKey(s) {
  return JSON.stringify([
    s?.spreadsheetId ?? "", s?.credentialsPath ?? "", s?.channelsRoot ?? "",
    !!s?.gpmEnabled, s?.gpmHost ?? "", s?.gpmIdleCloseMin ?? 10, s?.gpmLocale ?? "vi",
    !!s?.gpmTelegramEnabled, s?.gpmTelegramToken ?? "", s?.gpmTelegramChatId ?? "",
    s?.gpmTelegramTopicId ?? "", !!s?.gpmTelegramPhoto,
    !!s?.useGPU, s?.gpuVideoCodec ?? "", s?.videoSpeed ?? 0.95,
    !!s?.cleanupEnabled, s?.cleanupKeepDays ?? 1,
  ]);
}

// MỘT runner cho mỗi cửa sổ. Trước đây run-now và test-render dựng runner tạm rồi vứt đi;
// nếu "đăng lại thủ công" cũng dựng riêng thì có hai uploadQueue và hai phiên GPM cùng
// profile -> bản nháp trùng, tranh slot giờ, và cờ `running` của runner không còn chặn được
// gì (mỗi object một cờ).
function getSheetRunner(win) {
  const key = sheetSettingsKey(loadSheetSettings());
  if (sheetRunner && sheetRunnerWin === win && sheetRunnerKey === key) return sheetRunner;
  // Đang chạy thì KHÔNG dựng lại: runner mới có cờ running=false riêng, sẽ chạy chồng lên
  // lượt đang dở của runner cũ. Giữ bản cũ; cấu hình mới áp dụng ở lần dựng kế tiếp
  // (đúng quy ước "đổi cấu hình khi đang chạy thì Stop rồi Start lại").
  if (sheetRunner && sheetRunner.isRunning?.()) return sheetRunner;
  sheetRunner = buildSheetRunner(win);
  sheetRunnerWin = win;
  sheetRunnerKey = key;
  return sheetRunner;
}

ipcMain.handle("sheet:test-connection", async (e, s) => {
  try {
    const st = s || loadSheetSettings();
    if (!st.spreadsheetId) return { success: false, error: "Chưa nhập Spreadsheet ID." };
    if (!st.credentialsPath) return { success: false, error: "Chưa chọn file service account JSON." };
    const sheets = createSheetsClient(st.credentialsPath);
    const info = await testSheetConnection(sheets, st.spreadsheetId);
    return { success: true, ...info };
  } catch (err) {
    return { success: false, error: String(err?.message || err) };
  }
});
ipcMain.handle("sheet:load-settings", async () => loadSheetSettings());
ipcMain.handle("sheet:save-settings", async (e, s) => {
  const before = loadSheetSettings();
  saveSheetSettings(s);
  // Chỉ nối lại khi cấu hình giám sát thật sự đổi: ô nhập tự lưu sau mỗi lần gõ, đổi các ô khác không được làm rớt kết nối.
  if (monitorSettingsKey(before) !== monitorSettingsKey(s)) monitorAgent?.reconfigure();
  return { success: true };
});
ipcMain.handle("account:get", () => {
  const u = sessionMgr.getUser();
  return { loggedIn: sessionMgr.isLoggedIn(), username: u?.username || "", displayName: u?.displayName || u?.username || "", role: u?.role || "" };
});
ipcMain.handle("account:logout", async () => {
  const w = BrowserWindow.getFocusedWindow() || undefined;
  const { response } = await dialog.showMessageBox(w, { type: "question", title: "Đăng xuất", message: "Đăng xuất khỏi tài khoản trên máy này?", detail: "Các tác vụ đang chạy sẽ bị dừng và ứng dụng sẽ khởi động lại.", buttons: ["Đăng xuất", "Hủy"], defaultId: 1, cancelId: 1 });
  if (response !== 0) return { ok: false };
  try { taskTracker.abortAll(); monitorAgent.stop(); } catch { /* ignore */ }
  sessionMgr.logout();
  app.relaunch();
  app.quit();
  return { ok: true };
});
ipcMain.handle("monitor:get-status", async () => ({ ...(monitorAgent?.getStatus() || { state: "off", message: "Chưa bật" }), machineId: getMachineId() }));
ipcMain.handle("sheet:select-credentials", async () => {
  const r = await dialog.showOpenDialog({ properties: ["openFile"], filters: [{ name: "JSON", extensions: ["json"] }] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle("sheet:select-root", async () => {
  const r = await dialog.showOpenDialog({ properties: ["openDirectory"] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle("sheet:start", async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const s = loadSheetSettings();
  const runner = getSheetRunner(win);
  runner.stop();
  runner.start((s.pollSec || 300) * 1000);
  return { success: true };
});
ipcMain.handle("sheet:stop", async () => { if (sheetRunner) sheetRunner.stop(); return { success: true }; });
// Test render: xem thử 1 video/kênh. Dùng lại runner đang chạy nếu có (để chia chung cờ
// running, không giẫm lên lượt thật); chưa chạy thì dựng như sheet:run-now.
ipcMain.handle("sheet:test-render", async (e, sheetName) => {
  try {
    const win = BrowserWindow.fromWebContents(e.sender);
    const runner = getSheetRunner(win);
    await runner.testRenderNow(sheetName || undefined);
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err?.message || err) };
  }
});
ipcMain.handle("sheet:run-now", async (e, sheetName) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const runner = getSheetRunner(win);
  await runner.runNow(sheetName || undefined);
  return { success: true };
});

// Danh sách video đã render nhưng chưa lên lịch — nguồn cho panel "Chờ đăng".
// Chỉ đọc Sheet + resume-state.json + sự tồn tại của file, không đụng gì.
ipcMain.handle("sheet:pending-uploads", async (e, sheetName) => {
  try {
    const s = loadSheetSettings();
    if (!s.spreadsheetId || !s.credentialsPath || !s.channelsRoot || !s.gpmEnabled) {
      return { ok: true, channels: [] }; // chưa cấu hình / GPM tắt -> không có gì để đăng
    }
    const sheets = createSheetsClient(s.credentialsPath);
    let channels = await readConfigSheet(sheets, s.spreadsheetId);
    // KHÔNG lọc theo `enabled`: kênh đang tạm dừng vẫn có video đã render xong chờ đăng.
    // Ẩn chúng đi đúng là lỗi đang sửa (việc còn nợ mà không thấy ở đâu). Upload lại không
    // cần tải/render nên tạm dừng kênh không phải lý do để giấu.
    channels = channels.filter((c) => c.uploadEnabled !== false);
    if (sheetName) channels = channels.filter((c) => c.sheetName === sheetName);
    const resume = loadResume(path.join(s.channelsRoot, "resume-state.json"));
    const out = [];
    for (const ch of channels) {
      let rows = [];
      try {
        rows = await readChannelUrls(sheets, s.spreadsheetId, ch.sheetName);
      } catch {
        continue; // tab hỏng không được làm mất danh sách các kênh còn lại
      }
      const videos = listPendingUploads({
        rows,
        resolveEntry: (url) => getEntry(resume, ch.sheetName, url),
        fileExists: (p) => { try { return fs.existsSync(p); } catch { return false; } },
      });
      if (videos.length) out.push({ sheetName: ch.sheetName, videos });
    }
    return { ok: true, channels: out };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

// Đăng lại thủ công: chỉ đẩy file đã render vào lại hàng đợi upload.
ipcMain.handle("sheet:retry-upload", async (e, { sheetName, urls } = {}) => {
  try {
    const win = BrowserWindow.fromWebContents(e.sender);
    const runner = getSheetRunner(win);
    return await runner.retryUploads(String(sheetName || "").trim(), urls);
  } catch (err) {
    return { ok: false, queued: 0, skipped: [], error: String(err?.message || err) };
  }
});


registerComposerIpc({ ipcMain, app, BrowserWindow }); // Giai đoạn 2A — tab Composer: 9 kênh composer:* (sheet/composer-ipc.js)
ipcMain.handle("yt:list-channels", async () => {
  try { return await listStatsChannels(); }
  catch (err) { return { ok: false, error: String(err?.message || err) }; }
});

ipcMain.handle("yt:refresh-stats", async () => {
  try { return await refreshChannelStats(); }
  catch (err) { return { ok: false, error: String(err?.message || err) }; }
});

ipcMain.handle("yt:fetch-source-urls", async (e, { sheetName, sortBy } = {}) => {
  try { return await fetchSourceUrlsFor((sheetName || "").trim(), sortBy === "newest" ? "newest" : "views"); }
  catch (err) { return { ok: false, error: String(err?.message || err) }; }
});

ipcMain.handle("gpm:test", async (e, { gpmHost } = {}) => {
  try {
    const host = (gpmHost || "").trim() || "127.0.0.1:19995";
    const profiles = await testGpmConnection(host);
    return { ok: true, profiles, apiVersion: getGpmApiVersion(host) };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle("gpm:list-channels", async () => {
  try {
    const st = loadSheetSettings();
    if (!st.spreadsheetId) return { ok: false, error: "Chưa nhập Spreadsheet ID." };
    if (!st.credentialsPath) return { ok: false, error: "Chưa chọn file service account JSON." };
    const sheets = createSheetsClient(st.credentialsPath);
    const channels = await readConfigSheet(sheets, st.spreadsheetId);
    // Quota hôm nay: đọc runner-state.json để card hiện "3/8". computeRemaining tự
    // coi quota là 0 khi lastRunDate khác hôm nay, nên không cần reset thủ công.
    const state = st.channelsRoot ? loadState(path.join(st.channelsRoot, "runner-state.json")) : {};
    const today = todayStr(new Date());
    return {
      ok: true,
      channels: channels.map((c) => {
        const perDay = parseInt(c.videosPerDay, 10) || 0;
        return {
          sheetName: c.sheetName,
          gpmProfileId: c.gpmProfileId || "",
          videosPerDay: perDay,
          enabled: !!c.enabled,
          countToday: perDay - computeRemaining(state[c.sheetName], perDay, today),
        };
      }),
    };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle("gpm:test-telegram", async (e, { token, chatId, topicId } = {}) => {
  try {
    const r = await sendTelegram((token || "").trim(), (chatId || "").trim(),
      "✅ VidMaster: test thông báo Telegram thành công.", { threadId: topicId });
    return r.ok ? { ok: true } : { ok: false, error: r.error || "gửi thất bại" };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle("gpm:connect", async (e, { gpmHost, profileId } = {}) => {
  try {
    const host = (gpmHost || "").trim() || "127.0.0.1:19995";
    const pid = (profileId || "").trim();
    if (!pid) return { ok: false, error: "Kênh chưa có GPM Profile ID." };
    await connectAndOpenStudio(host, pid);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle("gpm:list-groups", async (e, { gpmHost } = {}) => {
  try {
    const host = (gpmHost || "").trim() || "127.0.0.1:19995";
    const groups = await listGpmGroups(host);
    return { ok: true, groups };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle("gpm:list-profiles-full", async (e, { gpmHost } = {}) => {
  try {
    const host = (gpmHost || "").trim() || "127.0.0.1:19995";
    const profiles = (await listGpmProfilesFull(host)).map(({ rawProxy, ...p }) => ({ ...p, proxyMasked: maskProxy(rawProxy), hasProxy: !!rawProxy }));
    const groups = await listGpmGroups(host);
    return { ok: true, profiles, groups };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

// ============================================================================
// YouTube Automation IPC Handlers (Auto Login, Auto Thumb, Auto Schedule)
// ============================================================================

// ============================================================================
// TỰ ĐỘNG HOÁ: chạy trên các profile GPM do người dùng chọn (danh sách lấy từ GPM local).
// Log đẩy về renderer qua "automation:log". Luồng Google Sheet (tạo profile, gán proxy, tạo channel)
// nằm ở tab Theo dõi Sheet, dùng chung cấu hình Sheet ở đó.
// ============================================================================
const SHEET_TAB = "⚙config";
const gpmHostOf = (h) => (h || "").trim() || "127.0.0.1:19995";

function sheetDeps(gpmHost) {
  const host = gpmHostOf(gpmHost);
  const st = loadSheetSettings();
  if (!st.spreadsheetId) throw new Error("Chưa nhập Spreadsheet ID (Theo dõi Sheet → ⚙).");
  if (!st.credentialsPath) throw new Error("Chưa chọn file service account JSON (Theo dõi Sheet → ⚙).");
  const sheets = createSheetsClient(st.credentialsPath);
  return {
    host, channelsRoot: st.channelsRoot || "",
    readValues: () => readConfigValues(sheets, st.spreadsheetId, SHEET_TAB),
    listProfiles: () => listGpmProfilesFull(host),
    createProfile: (a) => createGpmProfile(host, a),
    updateProxy: (id, raw) => updateGpmProfileProxy(host, id, raw),
    writeCell: (row, col, v) => writeConfigCell(sheets, st.spreadsheetId, SHEET_TAB, row, col, v),
    ensureColumns: (n) => ensureGridColumns(sheets, st.spreadsheetId, SHEET_TAB, n),
    formatGroups: (spec) => formatHeaderGroups(sheets, st.spreadsheetId, SHEET_TAB, spec),
    forEach: forEachProfile, login: loginOne, checkCancelled,
  };
}

// Chặn chạy chồng: hai tác vụ cùng mở/đóng profile GPM sẽ đá nhau; và Theo dõi Sheet đang chạy
// thì đóng profile của nó giữa chừng upload.
let automationBusy = null;
function guardedHandler(channel, run) {
  ipcMain.handle(channel, async (e, opts = {}) => {
    try {
      if (automationBusy) return { success: false, error: `Đang chạy "${automationBusy}" — đợi xong hoặc bấm Dừng rồi chạy lại` };
      if (sheetRunner?.isRunning?.()) return { success: false, error: "Theo dõi Sheet đang chạy một lượt — đợi xong rồi chạy lại để tránh đóng nhầm profile đang upload" };
      const win = BrowserWindow.fromWebContents(e.sender);
      const onLog = (msg) => { if (win && !win.isDestroyed()) win.webContents.send("automation:log", { task: channel, msg }); };
      automationBusy = channel;
      resetCancel(); // mỗi lượt bắt đầu với cờ dừng sạch
      // Theo dõi cho web giám sát. Mọi lỗi của phần theo dõi bị nuốt, không bao giờ ảnh hưởng tới việc chạy thật.
      // Đăng nhập kênh, tạo channel, tự động hóa theo Sheet làm TRỰC TIẾP trong app và KHÔNG báo lên web
      // (chúng dùng tài khoản/mật khẩu). Xem UNTRACKED_TASKS trong sheet/task-monitor.js.
      const tracked = isTrackedTask(channel);
      const taskId = tracked ? taskTracker.start(channel, { total: Array.isArray(opts.profiles) ? opts.profiles.length : null }) : null;
      const userOnResult = opts.onResult;
      const onResult = tracked
        ? async (p, r) => {
            try { monitorAgent?.onTaskChannelResult(taskId, channelResultEvent(channel, p, r)); taskTracker.progress(taskId, { channel: p?.name }); } catch { /* ignore */ }
            return userOnResult?.(p, r);
          }
        : userOnResult;
      let result, stopped = false;
      try {
        result = await run({ ...opts, onLog, onResult });
        return result;
      } catch (err) {
        result = { success: false, error: String(err?.message || err) };
        return result;
      } finally {
        try { stopped = isCancelled(); } catch { /* ignore */ }
        if (taskId) taskTracker.finish(taskId, result, { stopped });
      }
    } catch (err) {
      return { success: false, error: String(err?.message || err) };
    } finally {
      automationBusy = null;
    }
  });
}

const needProfiles = (o) => {
  if (!Array.isArray(o.profiles) || !o.profiles.length) throw new Error("Chưa chọn profile nào");
  // label = tên + đuôi ID khi tên trùng (do giao diện tính) — chỉ để hiển thị trong log, KHÔNG dùng để ghép.
  return o.profiles.map((p) => ({ id: String(p.id), name: String(p.name ?? ""), label: String(p.label || p.name || "") }));
};

// Cờ "Kênh BKT" của từng profile, tra theo PROFILE ID trong cột "GPM Profile ID" của Sheet (không theo tên).
// Không đọc được Sheet (chưa cấu hình, mất mạng...) thì coi mọi kênh là kênh thường và báo ra log, không chặn việc chạy.
async function monetizedFlags(o, host) {
  try {
    const d = sheetDeps(host);
    const { rows, cols } = readChannelRows(await d.readValues());
    const map = new Map();
    for (const r of rows) if (r.gpmProfileId) map.set(r.gpmProfileId, !!r.monetized);
    const hasCol = cols.monetized !== undefined;
    return { map, note: hasCol ? "" : 'Sheet chưa có cột "Kênh BKT" — mọi kênh được coi là kênh thường' };
  } catch (e) {
    return { map: new Map(), note: `không đọc được cờ "Kênh BKT" từ Sheet (${String(e?.message || e).split("\n")[0]}) — mọi kênh được coi là kênh thường` };
  }
}

// Gắn cờ BKT vào các profile sắp chạy và ghi rõ kênh nào được chạy theo quy trình BKT.
async function withMonetized(o, host, list) {
  const { map, note } = await monetizedFlags(o, host);
  if (note) o.onLog(`⚠️ ${note}`);
  const out = list.map((p) => ({ ...p, monetized: map.get(p.id) === true }));
  const bkt = out.filter((p) => p.monetized).map((p) => p.label || p.name);
  if (bkt.length) o.onLog(`💰 Chạy theo quy trình kênh BKT: ${bkt.join(", ")}`);
  return out;
}

// Số profile GPM theo từng tên. Tên trùng thì ghép theo tên sẽ nhầm profile nên phải biết để chặn.
async function gpmNameCounts(host) {
  return countNames(await listGpmProfilesFull(host));
}

function logAttachSkips(o, r) {
  for (const n of r.missing) o.onLog(`[${n}] ⏭ bỏ qua: không có dòng nào trong Excel khớp (cột A: Profile ID hoặc tên profile)`);
  for (const n of r.ambiguous) o.onLog(`[${n}] ⏭ bỏ qua: Excel có nhiều dòng cùng khoá ở cột A`);
  for (const n of r.duplicated) o.onLog(`[${n}] ⏭ bỏ qua: tên profile trùng với profile khác trong GPM — hãy ghi Profile ID vào cột A để không bị nhầm`);
}

// --- Chạy trên profile GPM đã chọn ---
guardedHandler("automation:login", async (o) => {
  const profiles = needProfiles(o);
  const host = gpmHostOf(o.gpmHost);
  if (!o.accountsFile || !fs.existsSync(o.accountsFile)) throw new Error("Chưa chọn file Excel tài khoản (hoặc file không tồn tại)");
  const r = attachProfileData(profiles, readLoginAccounts(o.accountsFile), await gpmNameCounts(host));
  logAttachSkips(o, r);
  if (!r.matched.length) throw new Error("Không profile nào khớp với file Excel (cột A: Profile ID hoặc tên profile)");
  return runLogin({ ...o, gpmHost: host, profiles: r.matched.map((p) => ({ id: p.id, name: p.name, label: p.label, account: p.data })) });
});

// Đổi thumbnail: thư mục riêng của từng profile ghép theo Profile ID (o.thumbFolders = { [id]: thư mục }),
// profile nào không có thư mục riêng thì dùng thư mục chung (o.thumbFolder).
guardedHandler("automation:change-thumb", async (o) => {
  const profiles = needProfiles(o);
  const run = resolveThumbRun({ profiles, folders: o.thumbFolders, defaultFolder: o.thumbFolder, numVideos: o.numVideos });
  if (run.error) throw new Error(run.error);
  for (const x of run.skipped) o.onLog(`[${x.name}] ⏭ bỏ qua: ${x.reason}`);
  if (!run.profiles.length) throw new Error("Không có profile nào chạy được — xem các dòng bỏ qua ở trên");
  const host = gpmHostOf(o.gpmHost);
  return runChangeThumb({ ...o, gpmHost: host, profiles: await withMonetized(o, host, run.profiles) });
});

// Lên lịch: không dùng Excel. Giờ đăng, số ngày, ngày bắt đầu nhập chung cho mọi profile đã chọn.
guardedHandler("automation:schedule", async (o) => {
  const run = resolveScheduleRun({ profiles: needProfiles(o), postTimes: o.postTimes, numDays: o.numDays, startDate: o.startDate });
  if (run.error) throw new Error(run.error);
  const host = gpmHostOf(o.gpmHost);
  return runSchedule({ ...o, ...run.options, gpmHost: host, profiles: await withMonetized(o, host, run.profiles) });
});

guardedHandler("automation:distribute", async (o) => {
  if (!o.videoFolder || !fs.existsSync(o.videoFolder)) throw new Error("Chưa chọn thư mục video (hoặc thư mục không tồn tại)");
  if (!String(o.postTimes || "").trim()) throw new Error("Chưa nhập giờ đăng");
  const host = gpmHostOf(o.gpmHost);
  return runDistribute({ ...o, gpmHost: host, profiles: await withMonetized(o, host, needProfiles(o)) });
});

guardedHandler("automation:proxy-check", (o) => runProxyCheck({ ...o, gpmHost: gpmHostOf(o.gpmHost), profiles: needProfiles(o) }));

guardedHandler("automation:create-channel", async (o) => {
  const profiles = needProfiles(o);
  const host = gpmHostOf(o.gpmHost);
  if (!o.planFile || !fs.existsSync(o.planFile)) throw new Error("Chưa chọn file Excel tạo channel (hoặc file không tồn tại)");
  const counts = await gpmNameCounts(host);
  const r = attachProfileData(profiles, readChannelPlans(o.planFile), counts);
  logAttachSkips(o, r);
  if (!r.matched.length) throw new Error("Không profile nào khớp với file Excel (cột A: Profile ID hoặc tên profile)");
  // File tài khoản (tuỳ chọn) cũng ghép theo Profile ID trước, tên sau, và chặn khi tên trùng.
  let accounts = new Map();
  if (o.accountsFile && fs.existsSync(o.accountsFile)) {
    const a = attachProfileData(r.matched, readLoginAccounts(o.accountsFile), counts);
    accounts = new Map(a.matched.map((p) => [p.id, p.data]));
  }
  return runCreateChannel({
    ...o, gpmHost: host,
    profiles: r.matched.map((p) => ({
      id: p.id, name: p.name, label: p.label, account: accounts.get(p.id) || null,
      plan: { title: p.data.title, description: p.data.description, videoDescription: p.data.videoDescription, tags: p.data.tags, handle: p.data.handle },
    })),
  });
});

// Xem trước kế hoạch rải video (không mở trình duyệt, không đăng gì).
ipcMain.handle("automation:distribute-preview", async (e, o = {}) => {
  try {
    const profiles = needProfiles(o);
    if (!o.videoFolder || !fs.existsSync(o.videoFolder)) throw new Error("Chưa chọn thư mục video (hoặc thư mục không tồn tại)");
    if (!String(o.postTimes || "").trim()) throw new Error("Chưa nhập giờ đăng");
    const plan = buildPlan({ ...o, profiles, videos: listVideos(o.videoFolder), startDate: new Date() });
    return { success: true, plan: {
      leftover: plan.leftover.length,
      channels: plan.channels.map((c) => ({ name: c.name, items: c.items.map((i) => ({ title: i.title, hasThumb: !!i.thumbnailPath, scheduleISO: i.scheduleISO })) })),
    } };
  } catch (err) { return { success: false, error: String(err?.message || err) }; }
});

// Xem trước các chức năng chạy theo Excel (không mở trình duyệt, không ghi gì).
ipcMain.handle("automation:preview-excel", async (e, o = {}) => {
  try {
    const profiles = needProfiles(o);
    const file = o.kind === "login" ? o.accountsFile : o.planFile;
    if (!file || !fs.existsSync(file)) throw new Error("Chưa chọn file Excel (hoặc file không tồn tại)");
    const items = o.kind === "login" ? readLoginAccounts(file) : readChannelPlans(file);
    const r = attachProfileData(profiles, items, await gpmNameCounts(gpmHostOf(o.gpmHost)));
    return {
      success: true, total: items.length,
      ready: r.matched.map((p) => `${p.label}${p.by === "id" ? " (khớp theo Profile ID)" : ""}`),
      missing: r.missing, ambiguous: r.ambiguous, duplicated: r.duplicated,
    };
  } catch (err) { return { success: false, error: String(err?.message || err) }; }
});

// Xem trước đổi thumbnail / lên lịch (không mở trình duyệt, không ghi gì).
ipcMain.handle("automation:preview-run", async (e, o = {}) => {
  try {
    const profiles = needProfiles(o);
    const { map: bktMap, note: bktNote } = await monetizedFlags(o, gpmHostOf(o.gpmHost));
    const bktSet = new Set([...bktMap].filter(([, v]) => v).map(([k]) => k));
    if (o.kind === "thumb") {
      const run = resolveThumbRun({ profiles, folders: o.thumbFolders, defaultFolder: o.thumbFolder, numVideos: o.numVideos });
      if (run.error) throw new Error(run.error);
      return {
        success: true, kind: "thumb", skipped: run.skipped,
        ready: run.profiles.map((p) => ({ name: p.label, folder: p.thumbFolder, images: p.imageCount, numVideos: p.numVideos, own: p.ownFolder, bkt: bktSet.has(p.id) })),
      };
    }
    if (o.kind === "schedule") {
      const run = resolveScheduleRun({ profiles, postTimes: o.postTimes, numDays: o.numDays, startDate: o.startDate });
      if (run.error) throw new Error(run.error);
      return { success: true, kind: "schedule", profiles: run.profiles.map((p) => p.label), bkt: run.profiles.filter((p) => bktSet.has(p.id)).map((p) => p.label), days: run.days, times: run.studioTimes, videosPerProfile: run.videosPerProfile };
    }
    throw new Error("Loại xem trước không hợp lệ");
  } catch (err) { return { success: false, error: String(err?.message || err) }; }
});

// --- Luồng Google Sheet (nằm ở Theo dõi Sheet) ---
// Không có cấu hình trong app: kênh nào làm gì do cột "Tạo profile" / "Tạo channel" của Sheet quyết định.
guardedHandler("sheet-auto:run", (o) => {
  const d = sheetDeps(o.gpmHost);
  return runSheetAutomation({ ...o, gpmHost: d.host }, { ...d, createChannel: createChannelOne });
});

ipcMain.handle("sheet-auto:preview", async (e, o = {}) => {
  try { return { success: true, plan: await previewSheetAutomation(o, sheetDeps(o.gpmHost)) }; }
  catch (err) { return { success: false, error: String(err?.message || err) }; }
});

// Cột Sheet mà luồng tự động hóa cần: có/thiếu, và tạo cột thiếu (chỉ khi người dùng bấm).
ipcMain.handle("sheet-auto:columns", async (e, o = {}) => {
  try {
    const values = await sheetDeps(o.gpmHost).readValues();
    return { success: true, groups: COLUMN_GROUPS.map(({ id, label, keys, band }) => ({ id, label, keys, band })), tasks: Object.fromEntries(Object.keys(TASKS).map((t) => [t, describeTask(values, t)])) };
  } catch (err) { return { success: false, error: String(err?.message || err) }; }
});
ipcMain.handle("sheet-auto:create-columns", async (e, o = {}) => {
  try {
    let formatError = "";
    const deps = { ...sheetDeps(o.gpmHost), onFormatError: (err) => { formatError = String(err?.message || err); } };
    const created = await createMissingColumns(deps, Object.keys(TASKS));
    return { success: true, created, formatError };
  } catch (err) { return { success: false, error: String(err?.message || err) }; }
});

// Lưu file Excel mẫu: hộp thoại "Lưu thành", rồi ghi file. Windows tự hỏi nếu ghi đè file có sẵn.
ipcMain.handle("excel-sample:save", async (e, { kind } = {}) => {
  try {
    if (!SAMPLE_FILES[kind]) throw new Error(`Không có file mẫu loại "${kind}"`);
    const isTxt = /\.txt$/i.test(SAMPLE_FILES[kind]);
    const win = BrowserWindow.fromWebContents(e.sender);
    const r = await dialog.showSaveDialog(win, {
      title: "Lưu file mẫu",
      defaultPath: path.join(app.getPath("documents"), SAMPLE_FILES[kind]),
      filters: isTxt ? [{ name: "Văn bản", extensions: ["txt"] }] : [{ name: "Excel", extensions: ["xlsx"] }],
    });
    if (r.canceled || !r.filePath) return { success: true, canceled: true };
    // Mẫu đầy đủ ⚙config là file có sẵn trong docs/sheet-mau (59 cột, màu theo mode, tab hướng dẫn).
    const fullSheetSource = path.join(getAppPath(), "docs", "sheet-mau", "Vid-Master-Template-3.xlsx");
    const outPath = await writeSample(kind, r.filePath, { fullSheetSource });
    return { success: true, path: outPath };
  } catch (err) { return { success: false, error: String(err?.message || err) }; }
});

ipcMain.handle("automation:stop", () => { stopAutomation(); return { ok: true }; });

// IPC Handlers
ipcMain.handle("select-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("select-file", async (event, options = {}) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: options.filters || [{ name: "All Files", extensions: ["*"] }],
  });
  return result.canceled ? null : result.filePaths[0];
});

// IPC handler để lưu render config vào file
// DEPRECATED: Không còn tạo file .render-config.json riêng lẻ nữa
// Config được lưu trong project JSON
ipcMain.handle("save-render-config", async (event, config) => {
  // Không còn tạo file config riêng lẻ - config được lưu trong project JSON
  return { success: true };
});

// IPC handler để đọc render config từ file
// DEPRECATED: Không còn đọc từ file .render-config.json nữa
// Config được đọc từ project JSON
ipcMain.handle("load-render-config", async () => {
  // Không còn đọc từ file config riêng lẻ - config được đọc từ project JSON
  return { success: true, config: null };
});

// IPC handler để sync config files từ project settings
// DEPRECATED: Không còn tạo file config riêng lẻ nữa, scripts đọc trực tiếp từ project JSON
// Giữ lại để tương thích ngược nhưng không làm gì
ipcMain.handle("sync-config-files", async (event, configs) => {
  // Không còn tạo file config riêng lẻ - scripts đọc trực tiếp từ project JSON
  // Thông qua environment variable PROJECT_NAME
  return { success: true };
});

ipcMain.handle(
  "run-script",
  async (event, scriptPath, args = [], options = {}) => {
    try {
      return await new Promise((resolve, reject) => {
        // Không cần fileMapping nữa - scripts sẽ đọc paths trực tiếp từ config files
        // Config files sẽ được ghi vào userData directory (có thể ghi được trong production)

        const configDir = getConfigDir();
        const appPath = getAppPath();

        // Helper function để serialize error messages
        const getErrorMessage = (err) => {
          if (typeof err === "string") return err;
          if (err && err.message) return err.message;
          if (err && err.toString) return err.toString();
          return String(err);
        };

        // Tạo unique ID cho job để tránh conflict khi chạy đồng thời
        const jobId =
          options.jobId ||
          `job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        // Lấy project name hiện tại (mặc định là "default")
        let projectName = "default";
        try {
          const currentProjectPath = getCurrentProjectPath();
          if (fs.existsSync(currentProjectPath)) {
            const content = fs.readFileSync(currentProjectPath, "utf-8");
            const data = JSON.parse(content);
            projectName = data.projectName || "default";
          }
        } catch (err) {
          console.warn("Error getting current project, using default:", err);
        }

        // Set environment variables để scripts biết đọc config từ project JSON
        // Phải khai báo env trước khi sử dụng
        const env = {
          ...process.env,
          CONFIG_DIR: configDir,
          PROJECT_NAME: projectName, // Truyền project name để scripts đọc từ project JSON
          PROJECTS_DIR: path.join(configDir, "projects"), // Đường dẫn đến thư mục projects
          // Cài đặt yt-dlp dùng chung (sửa được trong app) — download.js đọc từ đây.
          YTDLP_EXTRACTOR_ARGS: loadYtdlpSettings(configDir).extractorArgs,
          // Địa chỉ server PO token đã dựng sẵn. Chuỗi rỗng khi chưa lên: download.js
          // vẫn tải được nhờ script mode, chỉ chậm hơn.
          POT_BASE_URL: potServer?.baseUrl || "",
          ...options.env,
        };

        // Truyền renderConfig qua environment variable (JSON string) thay vì tạo file
        // Để tránh conflict khi chạy đồng thời nhiều job, mỗi job có jobId riêng
        if (options.renderConfig) {
          try {
            // Truyền config qua environment variable dưới dạng JSON string
            env.RENDER_CONFIG_JSON = JSON.stringify(options.renderConfig);
            env.RENDER_JOB_ID = jobId; // Truyền jobId để tránh conflict
          } catch (err) {
            console.error(
              `Error serializing render config: ${getErrorMessage(err)}`
            );
            event.sender.send(
              "script-output",
              `⚠️ Cảnh báo: Lỗi khi serialize config: ${getErrorMessage(err)}\n`
            );
          }
        }

        // Test Render config
        if (options.testRenderConfig) {
          try {
            env.TEST_RENDER_CONFIG_JSON = JSON.stringify(options.testRenderConfig);
          } catch (err) {
            console.error(`Error serializing test render config: ${getErrorMessage(err)}`);
          }
        }

        // KHÔNG TẠO các file .config.json riêng lẻ nữa
        // Scripts sẽ đọc trực tiếp từ projects/{PROJECT_NAME}.json

        // Xác định đường dẫn script và node executable
        let scriptFullPath = path.join(appPath, scriptPath);

        // Trong production, nếu script không tồn tại ở appPath, thử tìm ở các vị trí khác
        if (!fs.existsSync(scriptFullPath) && app.isPackaged) {
          // Thử các vị trí có thể:
          const possiblePaths = [
            path.join(appPath, scriptPath), // app.asar.unpacked (primary location)
            path.join(process.resourcesPath, "app.asar.unpacked", scriptPath), // explicit unpacked path
            path.join(process.resourcesPath, scriptPath), // resources folder (fallback)
          ];

          for (const possiblePath of possiblePaths) {
            if (fs.existsSync(possiblePath)) {
              scriptFullPath = possiblePath;
              console.log(`Found script at: ${scriptFullPath}`);
              break;
            }
          }
        }

        // Kiểm tra xem script có tồn tại không
        if (!fs.existsSync(scriptFullPath)) {
          const debugInfo = {
            scriptPath,
            appPath,
            isPackaged: app.isPackaged,
            asarPath: app.isPackaged ? app.getAppPath() : null,
            resourcesPath: process.resourcesPath,
            checkedPath: scriptFullPath,
          };
          const errorMsg = `Script không tồn tại: ${scriptPath}\nĐã kiểm tra: ${scriptFullPath}\nDebug: ${JSON.stringify(
            debugInfo,
            null,
            2
          )}`;
          console.error(errorMsg);
          event.sender.send("script-output", `❌ ${errorMsg}\n`);
          reject({
            success: false,
            error: `Script không tồn tại: ${scriptPath}`,
          });
          return;
        }

        console.log(`Running script: ${scriptFullPath}`);
        event.sender.send(
          "script-output",
          `📝 Đang chạy script: ${scriptPath}\n`
        );

        // Trong production, sử dụng node.exe từ app.asar.unpacked/bin nếu có
        // Trong development, sử dụng 'node' từ PATH
        let nodeExecutable = "node";
        if (app.isPackaged) {
          // Folder bin/ được unpack vào app.asar.unpacked/bin/
          const possibleNodePaths = [
            path.join(
              process.resourcesPath,
              "app.asar.unpacked",
              "bin",
              "node.exe"
            ),
            path.join(process.resourcesPath, "bin", "node.exe"), // Fallback
          ];

          let nodePath = null;
          for (const possiblePath of possibleNodePaths) {
            if (fs.existsSync(possiblePath)) {
              nodePath = possiblePath;
              break;
            }
          }

          if (nodePath) {
            nodeExecutable = nodePath;
            console.log(`Sử dụng Node.js từ: ${nodePath}`);
          } else {
            // Nếu không tìm thấy node.exe, thử dùng node từ PATH
            console.warn(
              `Node executable không tìm thấy. Đã kiểm tra: ${possibleNodePaths.join(
                ", "
              )}. Sử dụng 'node' từ PATH`
            );
          }
        }

        // env đã được khai báo ở trên, chỉ cần cập nhật NODE_PATH nếu cần

        // Trong production, set NODE_PATH để scripts có thể tìm node_modules
        if (app.isPackaged) {
          const asarPath = app.getAppPath();
          // node_modules có thể ở trong app.asar hoặc app.asar.unpacked
          const possibleNodeModulesPaths = [
            path.join(
              process.resourcesPath,
              "app.asar.unpacked",
              "node_modules"
            ), // unpacked first
            path.join(process.resourcesPath, "app.asar", "node_modules"), // in asar (if not unpacked)
          ];

          // Tìm node_modules path tồn tại
          let nodeModulesPath = null;
          for (const possiblePath of possibleNodeModulesPaths) {
            if (fs.existsSync(possiblePath)) {
              nodeModulesPath = possiblePath;
              break;
            }
          }

          // Nếu tìm thấy, thêm vào NODE_PATH
          if (nodeModulesPath) {
            const existingNodePath = env.NODE_PATH || "";
            env.NODE_PATH = existingNodePath
              ? `${nodeModulesPath}${path.delimiter}${existingNodePath}`
              : nodeModulesPath;
            console.log(`Set NODE_PATH to: ${env.NODE_PATH}`);
          } else {
            console.warn("Không tìm thấy node_modules trong production build");
          }
        }

        const child = spawn(nodeExecutable, [scriptFullPath, ...args], {
          cwd: appPath,
          stdio: "pipe",
          env: env,
        });
        const scriptKey = path.basename(scriptPath);
        const taskId = isTrackedTask(scriptKey) ? taskTracker.start(scriptKey) : null;
        const finishTask = (r) => { if (taskId) taskTracker.finish(taskId, r); };

        let stdout = "";
        let stderr = "";

        child.stdout.on("data", (data) => {
          stdout += data.toString();
          event.sender.send("script-output", data.toString());
        });

        child.stderr.on("data", (data) => {
          stderr += data.toString();
          event.sender.send("script-output", data.toString());
        });

        child.on("close", (code) => {
          // Không cần cleanup nữa - không tạo file config riêng lẻ
          // Config được truyền qua environment variable hoặc đọc từ project JSON

          if (code === 0) {
            finishTask({ success: true, message: "Hoàn tất" });
            resolve({ success: true, output: stdout });
          } else {
            const errorMsg = stderr || `Script exited with code ${code}`;
            finishTask({ success: false, error: lastMeaningfulLine(stderr) || `Script thoát với mã ${code}` });
            reject({ success: false, error: errorMsg, code });
          }
        });

        child.on("error", (error) => {
          // Không cần cleanup nữa - không tạo file config riêng lẻ

          const errorMsg = getErrorMessage(error);
          console.error(`Error spawning script: ${errorMsg}`);
          finishTask({ success: false, error: errorMsg });
          reject({ success: false, error: errorMsg });
        });
      });
    } catch (error) {
      // Catch any synchronous errors
      const errorMsg = error?.message || error?.toString() || String(error);
      console.error(`Error in run-script handler: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }
  }
);
