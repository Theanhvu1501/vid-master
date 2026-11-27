/**
 * YouTube Channel GA (Google Account) Transfer Module
 *
 * Chức năng: Chuyển kênh YouTube sang Google Account khác
 * Sử dụng Puppeteer để tự động hóa quy trình trên YouTube Studio
 *
 * Flow:
 * 1. Đăng nhập vào Google Account nguồn (đang sở hữu kênh)
 * 2. Truy cập YouTube Studio > Settings > Channel > Move channel
 * 3. Chọn Brand Account đích hoặc tạo mới
 * 4. Xác nhận chuyển kênh
 */

import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';
import { EventEmitter } from 'events';

// Các URL quan trọng
const URLS = {
  YOUTUBE_STUDIO: 'https://studio.youtube.com',
  YOUTUBE_STUDIO_SETTINGS: 'https://studio.youtube.com/channel/{channelId}/editing/settings',
  BRAND_ACCOUNTS: 'https://myaccount.google.com/brandaccounts',
  GOOGLE_ACCOUNTS: 'https://accounts.google.com',
  YOUTUBE_CHANNEL_SWITCHER: 'https://www.youtube.com/channel_switcher',
};

// Selectors cho các elements trên trang
const SELECTORS = {
  // YouTube Studio
  STUDIO_AVATAR: '#avatar-btn',
  STUDIO_CHANNEL_NAME: '#channel-title',
  SETTINGS_BUTTON: 'ytcp-button[aria-label="Settings"]',
  CHANNEL_TAB: 'tp-yt-paper-tab:has-text("Channel")',
  MOVE_CHANNEL_BUTTON: 'ytcp-button:has-text("Move channel")',

  // Brand Account selection
  BRAND_ACCOUNT_LIST: '.brand-account-list',
  BRAND_ACCOUNT_ITEM: '.brand-account-item',
  CREATE_BRAND_ACCOUNT: 'button:has-text("Create Brand Account")',

  // Confirmation dialogs
  CONFIRM_BUTTON: 'ytcp-button:has-text("Move channel")',
  CANCEL_BUTTON: 'ytcp-button:has-text("Cancel")',

  // Google login
  EMAIL_INPUT: 'input[type="email"]',
  PASSWORD_INPUT: 'input[type="password"]',
  NEXT_BUTTON: '#identifierNext',
  PASSWORD_NEXT: '#passwordNext',
};

export class ChangeGAModule extends EventEmitter {
  constructor(options = {}) {
    super();
    this.browser = null;
    this.page = null;
    this.options = {
      headless: false, // Hiển thị browser để user có thể xác thực 2FA nếu cần
      userDataDir: options.userDataDir || './browser-data',
      executablePath: options.executablePath || this.findChromePath(),
      timeout: options.timeout || 60000,
      ...options
    };
  }

  /**
   * Tìm đường dẫn Chrome/Edge trên hệ thống
   */
  findChromePath() {
    const possiblePaths = [
      // Windows Chrome
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
      // Windows Edge
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      // Linux
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser',
      // macOS
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ];

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }

    throw new Error('Không tìm thấy Chrome/Edge. Vui lòng cài đặt hoặc chỉ định đường dẫn.');
  }

  /**
   * Khởi tạo browser
   */
  async init() {
    this.emit('status', 'Đang khởi tạo browser...');

    this.browser = await puppeteer.launch({
      headless: this.options.headless,
      executablePath: this.options.executablePath,
      userDataDir: this.options.userDataDir,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--window-size=1366,768',
      ],
      defaultViewport: {
        width: 1366,
        height: 768
      }
    });

    this.page = await this.browser.newPage();

    // Giả lập user agent thực
    await this.page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    // Ẩn webdriver
    await this.page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    this.emit('status', 'Browser đã sẵn sàng');
    return this;
  }

  /**
   * Đăng nhập Google Account
   * @param {string} email - Email đăng nhập
   * @param {string} password - Mật khẩu (tùy chọn - có thể nhập thủ công)
   */
  async login(email, password = null) {
    this.emit('status', 'Đang đăng nhập Google Account...');

    await this.page.goto(URLS.GOOGLE_ACCOUNTS, { waitUntil: 'networkidle2' });

    // Nhập email
    await this.page.waitForSelector(SELECTORS.EMAIL_INPUT, { timeout: this.options.timeout });
    await this.page.type(SELECTORS.EMAIL_INPUT, email, { delay: 50 });
    await this.page.click(SELECTORS.NEXT_BUTTON);

    // Chờ trang password load
    await this.page.waitForSelector(SELECTORS.PASSWORD_INPUT, { timeout: this.options.timeout });

    if (password) {
      await this.page.type(SELECTORS.PASSWORD_INPUT, password, { delay: 50 });
      await this.page.click(SELECTORS.PASSWORD_NEXT);
    } else {
      this.emit('status', 'Vui lòng nhập mật khẩu và xác thực 2FA (nếu có) trong browser');
      this.emit('manual-action-required', 'password');
    }

    // Chờ đăng nhập hoàn tất
    await this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 120000 });

    this.emit('status', 'Đăng nhập thành công');
    return true;
  }

  /**
   * Chuyển sang kênh cụ thể (nếu account có nhiều kênh)
   * @param {string} channelId - ID kênh YouTube (UC...)
   */
  async switchToChannel(channelId) {
    this.emit('status', `Đang chuyển sang kênh ${channelId}...`);

    await this.page.goto(URLS.YOUTUBE_CHANNEL_SWITCHER, { waitUntil: 'networkidle2' });

    // Tìm và click vào kênh
    const channelSelector = `a[href*="${channelId}"], div[data-channel-id="${channelId}"]`;

    try {
      await this.page.waitForSelector(channelSelector, { timeout: 10000 });
      await this.page.click(channelSelector);
      await this.page.waitForNavigation({ waitUntil: 'networkidle2' });
      this.emit('status', 'Đã chuyển sang kênh thành công');
      return true;
    } catch (e) {
      // Có thể đã ở đúng kênh rồi
      this.emit('status', 'Không cần chuyển kênh hoặc đã ở đúng kênh');
      return true;
    }
  }

  /**
   * Lấy danh sách Brand Accounts có thể chuyển kênh đến
   */
  async getBrandAccounts() {
    this.emit('status', 'Đang lấy danh sách Brand Accounts...');

    await this.page.goto(URLS.BRAND_ACCOUNTS, { waitUntil: 'networkidle2' });

    // Chờ danh sách load
    await this.page.waitForSelector('.brand-account-container, .c-wiz', { timeout: this.options.timeout });

    // Extract thông tin các Brand Account
    const accounts = await this.page.evaluate(() => {
      const items = document.querySelectorAll('[data-account-id], .brand-account-item');
      return Array.from(items).map(item => ({
        id: item.getAttribute('data-account-id') || item.querySelector('[data-account-id]')?.getAttribute('data-account-id'),
        name: item.querySelector('.account-name, .brand-name')?.textContent?.trim(),
        email: item.querySelector('.account-email, .brand-email')?.textContent?.trim(),
      })).filter(a => a.id);
    });

    this.emit('brand-accounts', accounts);
    return accounts;
  }

  /**
   * Thực hiện đổi GA cho kênh
   * @param {string} channelId - ID kênh cần chuyển
   * @param {string} targetAccountId - ID Brand Account đích
   */
  async changeGA(channelId, targetAccountId) {
    this.emit('status', `Bắt đầu chuyển kênh ${channelId} sang account ${targetAccountId}...`);

    // Bước 1: Vào YouTube Studio
    const studioUrl = URLS.YOUTUBE_STUDIO_SETTINGS.replace('{channelId}', channelId);
    await this.page.goto(studioUrl, { waitUntil: 'networkidle2' });

    this.emit('progress', { step: 1, total: 5, message: 'Đã vào YouTube Studio' });

    // Bước 2: Tìm và click "Move channel to a Brand Account"
    // Lưu ý: UI YouTube có thể thay đổi, cần điều chỉnh selector
    try {
      // Chờ trang settings load
      await this.page.waitForSelector('ytcp-settings-section', { timeout: this.options.timeout });

      // Tìm section Channel
      const channelSection = await this.page.$('ytcp-settings-section:has-text("Channel")');
      if (channelSection) {
        await channelSection.click();
      }

      this.emit('progress', { step: 2, total: 5, message: 'Đang tìm nút Move channel...' });

      // Tìm nút Move channel
      // YouTube thường có flow: Settings > Channel > Advanced settings > Move channel
      const advancedBtn = await this.page.$('text="Advanced settings"');
      if (advancedBtn) {
        await advancedBtn.click();
        await this.page.waitForTimeout(1000);
      }

      // Tìm link/button Move channel
      const moveBtn = await this.page.$('a:has-text("Move channel"), button:has-text("Move")');
      if (moveBtn) {
        await moveBtn.click();
        this.emit('progress', { step: 3, total: 5, message: 'Đã click Move channel' });
      } else {
        // Fallback: Truy cập trực tiếp Brand Accounts
        await this.page.goto(URLS.BRAND_ACCOUNTS, { waitUntil: 'networkidle2' });
      }

    } catch (error) {
      this.emit('error', `Lỗi khi tìm nút Move channel: ${error.message}`);
      this.emit('status', 'Thử phương pháp thay thế qua Brand Accounts...');

      // Fallback: Dùng Brand Accounts page
      await this.page.goto(URLS.BRAND_ACCOUNTS, { waitUntil: 'networkidle2' });
    }

    // Bước 3: Chọn account đích
    this.emit('progress', { step: 4, total: 5, message: 'Đang chọn account đích...' });

    // Tìm và click account đích
    const targetSelector = `[data-account-id="${targetAccountId}"], div:has-text("${targetAccountId}")`;
    try {
      await this.page.waitForSelector(targetSelector, { timeout: 10000 });
      await this.page.click(targetSelector);
    } catch (e) {
      this.emit('manual-action-required', 'select-account');
      this.emit('status', 'Vui lòng chọn account đích trong browser');
    }

    // Bước 4: Xác nhận
    this.emit('progress', { step: 5, total: 5, message: 'Chờ xác nhận...' });
    this.emit('manual-action-required', 'confirm');
    this.emit('status', 'Vui lòng xác nhận chuyển kênh trong browser');

    return true;
  }

  /**
   * Chờ user hoàn thành action thủ công
   * @param {number} timeout - Thời gian chờ tối đa (ms)
   */
  async waitForManualAction(timeout = 300000) {
    this.emit('status', 'Đang chờ bạn hoàn thành thao tác trong browser...');

    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(async () => {
        try {
          // Kiểm tra xem có thông báo thành công không
          const successIndicator = await this.page.$('text="successfully", text="thành công"');
          if (successIndicator) {
            clearInterval(checkInterval);
            clearTimeout(timeoutId);
            resolve(true);
          }
        } catch (e) {
          // Ignore
        }
      }, 2000);

      const timeoutId = setTimeout(() => {
        clearInterval(checkInterval);
        reject(new Error('Timeout chờ thao tác thủ công'));
      }, timeout);
    });
  }

  /**
   * Lấy thông tin kênh hiện tại
   */
  async getCurrentChannelInfo() {
    await this.page.goto(URLS.YOUTUBE_STUDIO, { waitUntil: 'networkidle2' });

    const info = await this.page.evaluate(() => {
      return {
        channelName: document.querySelector('#channel-title')?.textContent?.trim(),
        channelId: window.location.pathname.match(/channel\/(UC[a-zA-Z0-9_-]+)/)?.[1],
        avatar: document.querySelector('#avatar-btn img')?.src,
      };
    });

    return info;
  }

  /**
   * Chụp screenshot
   * @param {string} filename - Tên file
   */
  async screenshot(filename) {
    const screenshotPath = path.join(this.options.userDataDir, `${filename}.png`);
    await this.page.screenshot({ path: screenshotPath, fullPage: true });
    return screenshotPath;
  }

  /**
   * Đóng browser
   */
  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
    this.emit('status', 'Đã đóng browser');
  }
}

// Export singleton instance for convenience
let instance = null;

export function getChangeGAModule(options) {
  if (!instance) {
    instance = new ChangeGAModule(options);
  }
  return instance;
}

export default ChangeGAModule;
