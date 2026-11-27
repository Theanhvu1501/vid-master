/**
 * Đổi GA (Google Account) cho kênh YouTube.
 * Chuyển kênh YouTube sang Google Account (Brand Account) khác.
 *
 * Flow:
 * 1. Mở profile GPM đã đăng nhập vào Google Account nguồn
 * 2. Truy cập YouTube Studio > Settings > Channel
 * 3. Tìm và click "Move channel to a Brand Account"
 * 4. Chọn Brand Account đích hoặc nhập email
 * 5. Xác nhận chuyển kênh
 *
 * LƯU Ý: Quy trình cần xác thực thủ công (2FA, chọn account) nên chạy từng profile một.
 */

import { forEachProfile, loginOne, checkCancelled, randomDelay } from "./youtube-automation.js";

const xp = (s) => `xpath=${s.trim()}`;
const T = 30000; // timeout mặc định cho mỗi thao tác (ms)

// URLs
const URLS = {
  YOUTUBE_STUDIO: "https://studio.youtube.com",
  BRAND_ACCOUNTS: "https://myaccount.google.com/brandaccounts",
  CHANNEL_SWITCHER: "https://www.youtube.com/channel_switcher",
};

// Selectors cho YouTube Studio và Google Account
const SELECTORS = {
  // YouTube Studio navigation
  SETTINGS_BUTTON: '#settings-item, button[aria-label="Settings"], ytcp-button[aria-label="Settings"]',
  CHANNEL_TAB: '#channel, tp-yt-paper-tab:has-text("Channel")',
  ADVANCED_TAB: 'tp-yt-paper-tab:has-text("Advanced settings"), #tabsContent tp-yt-paper-tab:nth-child(2)',

  // Move channel (nhiều variant vì UI có thể thay đổi)
  MOVE_CHANNEL_LINK: 'a:has-text("Move channel"), a:has-text("Move to Brand Account"), a[href*="brandaccount"]',
  MOVE_CHANNEL_BUTTON: 'button:has-text("Move"), ytcp-button:has-text("Move")',

  // Brand Account selection page
  BRAND_ACCOUNT_ITEM: '[data-account-id], .brand-account-item, [role="listitem"]',
  CREATE_BRAND_ACCOUNT: 'button:has-text("Create"), a:has-text("Create Brand Account")',

  // Confirmation
  CONFIRM_BUTTON: 'button:has-text("Move channel"), button:has-text("Confirm"), button:has-text("Chuyển kênh")',
  SUCCESS_MESSAGE: 'text="successfully", text="thành công", text="moved"',
};

/**
 * Chờ và click một trong nhiều selector (dùng khi UI có nhiều variant).
 */
async function clickAny(page, selectors, timeout = T) {
  const selectorList = Array.isArray(selectors) ? selectors : selectors.split(", ");
  for (const sel of selectorList) {
    try {
      const loc = page.locator(sel).first();
      if (await loc.isVisible({ timeout: 2000 })) {
        await loc.click({ timeout });
        return true;
      }
    } catch (e) {
      // thử selector tiếp theo
    }
  }
  // Thử lần cuối với selector đầu tiên
  await page.click(selectorList[0], { timeout });
  return true;
}

/**
 * Lấy Channel ID từ URL YouTube Studio hiện tại.
 */
async function getCurrentChannelId(page) {
  const url = page.url();
  const match = url.match(/channel\/(UC[a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

/**
 * Chuyển sang kênh cụ thể nếu account có nhiều kênh.
 */
async function switchToChannel(page, channelId, log) {
  if (!channelId) return;

  log(`kiểm tra kênh hiện tại...`);
  await page.goto(URLS.YOUTUBE_STUDIO, { waitUntil: "domcontentloaded", timeout: 60000 });
  await randomDelay(2000, 3000);

  const currentId = await getCurrentChannelId(page);
  if (currentId === channelId) {
    log(`đã ở đúng kênh ${channelId}`);
    return;
  }

  log(`chuyển sang kênh ${channelId}...`);
  await page.goto(URLS.CHANNEL_SWITCHER, { waitUntil: "networkidle", timeout: 60000 });
  await randomDelay(2000, 3000);

  // Tìm và click vào kênh đích
  try {
    const channelLink = page.locator(`a[href*="${channelId}"], [data-channel-id="${channelId}"]`).first();
    if (await channelLink.isVisible({ timeout: 10000 })) {
      await channelLink.click();
      await page.waitForNavigation({ waitUntil: "networkidle", timeout: 30000 });
      log(`đã chuyển sang kênh ${channelId}`);
    }
  } catch (e) {
    log(`không tìm thấy kênh ${channelId} trong danh sách, thử tiếp...`);
  }
}

/**
 * Truy cập trang Move Channel trong YouTube Studio.
 */
async function navigateToMoveChannel(page, log) {
  log("vào YouTube Studio Settings...");
  await page.goto(URLS.YOUTUBE_STUDIO, { waitUntil: "domcontentloaded", timeout: 60000 });
  await randomDelay(2000, 3000);

  // Click Settings
  await clickAny(page, SELECTORS.SETTINGS_BUTTON);
  await randomDelay(1500, 2500);

  // Click Channel tab
  await clickAny(page, SELECTORS.CHANNEL_TAB);
  await randomDelay(1500, 2500);

  // Click Advanced settings tab (nếu có)
  try {
    await clickAny(page, SELECTORS.ADVANCED_TAB, 5000);
    await randomDelay(1500, 2500);
  } catch (e) {
    log("không thấy tab Advanced settings, thử tìm link Move channel trực tiếp...");
  }

  // Tìm link/button Move channel
  log("tìm nút Move channel...");
  try {
    await clickAny(page, SELECTORS.MOVE_CHANNEL_LINK, 10000);
    log("đã click Move channel link");
    await randomDelay(2000, 3000);
    return true;
  } catch (e) {
    // Fallback: thử truy cập trực tiếp Brand Accounts
    log("không tìm thấy link Move channel, chuyển sang Brand Accounts...");
    await page.goto(URLS.BRAND_ACCOUNTS, { waitUntil: "networkidle", timeout: 60000 });
    await randomDelay(2000, 3000);
    return true;
  }
}

/**
 * Chọn Brand Account đích (nếu có trong danh sách).
 */
async function selectTargetAccount(page, targetEmail, targetName, log) {
  log(`tìm account đích: ${targetEmail || targetName || "(chờ chọn thủ công)"}...`);

  // Chờ danh sách Brand Account load
  try {
    await page.waitForSelector(SELECTORS.BRAND_ACCOUNT_ITEM, { timeout: 15000 });
  } catch (e) {
    log("không thấy danh sách Brand Account, chờ bạn thao tác thủ công...");
    return false;
  }

  // Tìm account theo email hoặc tên
  if (targetEmail) {
    const emailSelector = `[data-email="${targetEmail}"], :has-text("${targetEmail}")`;
    try {
      const item = page.locator(emailSelector).first();
      if (await item.isVisible({ timeout: 5000 })) {
        await item.click();
        log(`đã chọn account ${targetEmail}`);
        return true;
      }
    } catch (e) {
      // thử tên
    }
  }

  if (targetName) {
    const nameSelector = `:has-text("${targetName}")`;
    try {
      const item = page.locator(nameSelector).first();
      if (await item.isVisible({ timeout: 5000 })) {
        await item.click();
        log(`đã chọn account ${targetName}`);
        return true;
      }
    } catch (e) {
      // không tìm thấy
    }
  }

  log("không tìm thấy account đích tự động, chờ bạn chọn thủ công...");
  return false;
}

/**
 * Chờ user hoàn thành thao tác thủ công (2FA, chọn account, xác nhận).
 */
async function waitForManualCompletion(page, timeoutMs, log) {
  log(`chờ bạn hoàn thành xác thực/chọn account trong browser (tối đa ${Math.round(timeoutMs / 1000)}s)...`);

  const startTime = Date.now();
  const checkInterval = 3000;

  while (Date.now() - startTime < timeoutMs) {
    checkCancelled();

    // Kiểm tra thông báo thành công
    try {
      const success = await page.locator(SELECTORS.SUCCESS_MESSAGE).first();
      if (await success.isVisible({ timeout: 1000 })) {
        log("✓ phát hiện thông báo thành công!");
        return true;
      }
    } catch (e) {
      // chưa thành công, tiếp tục chờ
    }

    // Kiểm tra xem đã quay về Studio chưa (sau khi chuyển xong)
    const url = page.url();
    if (url.includes("studio.youtube.com") && !url.includes("brandaccount")) {
      // Có thể đã xong, chờ thêm chút
      await randomDelay(2000, 3000);
      return true;
    }

    await randomDelay(checkInterval, checkInterval + 1000);
  }

  return false;
}

/**
 * Thực hiện đổi GA cho một kênh.
 * @param {Page} page - Playwright page
 * @param {Object} plan - { channelId, targetEmail, targetName }
 * @param {Function} log - Hàm log
 * @param {number} manualTimeout - Thời gian chờ thao tác thủ công (ms)
 */
export async function changeGAOne(page, plan, log, manualTimeout = 300000) {
  const { channelId, targetEmail, targetName } = plan;

  // Bước 1: Chuyển sang đúng kênh (nếu có nhiều kênh)
  if (channelId) {
    await switchToChannel(page, channelId, log);
  }
  checkCancelled();

  // Bước 2: Truy cập trang Move Channel
  await navigateToMoveChannel(page, log);
  checkCancelled();

  // Bước 3: Chọn account đích (nếu tìm được tự động)
  const autoSelected = await selectTargetAccount(page, targetEmail, targetName, log);
  checkCancelled();

  // Bước 4: Chờ user hoàn thành (2FA, chọn account, xác nhận)
  if (!autoSelected) {
    log("⚠ cần thao tác thủ công trong browser:");
    log("   1. Chọn Brand Account đích");
    log("   2. Xác thực 2FA nếu cần");
    log("   3. Xác nhận chuyển kênh");
  }

  const completed = await waitForManualCompletion(page, manualTimeout, log);

  if (completed) {
    return "đã hoàn thành (kiểm tra lại trên YouTube Studio)";
  } else {
    return "timeout chờ xác nhận - vui lòng kiểm tra browser và hoàn thành thủ công";
  }
}

/**
 * Chạy đổi GA trên các profile.
 * @param {Object} o - Options
 * @param {string} o.gpmHost - GPM API host
 * @param {Array} o.profiles - Danh sách profile, mỗi phần tử cần: id, name, plan { channelId, targetEmail, targetName }, account (tuỳ chọn)
 * @param {number} o.concurrency - Số profile chạy cùng lúc (khuyến nghị 1 vì cần thao tác thủ công)
 * @param {number} o.manualTimeout - Timeout chờ thao tác thủ công (ms)
 * @param {Function} o.onLog - Callback log
 * @param {Function} o.onResult - Callback kết quả từng profile
 */
export async function runChangeGA(o) {
  const log = o.onLog || console.log;
  if (!o.profiles?.length) throw new Error("Chưa chọn profile nào");

  // Cảnh báo nếu chạy nhiều profile cùng lúc
  if ((o.concurrency || 1) > 1) {
    log("⚠ CẢNH BÁO: Đổi GA cần thao tác thủ công, chạy nhiều profile cùng lúc có thể gây khó khăn.");
    log("  Khuyến nghị đặt 'Số profile chạy cùng lúc' = 1");
  }

  return forEachProfile({
    gpmHost: o.gpmHost,
    profiles: o.profiles,
    concurrency: o.concurrency || 1,
    log,
    onResult: o.onResult,
    work: async (page, p, plog) => {
      // Đăng nhập nếu có file tài khoản và profile chưa đăng nhập
      if (p.account) {
        await loginOne(page, p.account, plog);
      }
      checkCancelled();

      // Thực hiện đổi GA
      return changeGAOne(page, p.plan, plog, o.manualTimeout || 300000);
    },
  });
}

/**
 * Đọc file Excel chứa thông tin đổi GA.
 * Cột A: Profile ID | B: Channel ID (UC...) | C: Email GA đích | D: Tên Brand Account đích
 */
export function readChangeGAPlans(filePath) {
  const XLSX = require("xlsx");
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

  const plans = new Map();
  for (let i = 1; i < rows.length; i++) {
    const [profileId, channelId, targetEmail, targetName] = rows[i];
    if (!profileId) continue;

    plans.set(String(profileId).trim(), {
      channelId: String(channelId || "").trim(),
      targetEmail: String(targetEmail || "").trim(),
      targetName: String(targetName || "").trim(),
    });
  }

  return plans;
}
