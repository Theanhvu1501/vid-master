/**
 * Veo3 Browser Pool
 *
 * Launches one Chrome process per account (own user-data-dir / profile),
 * connects via CDP with puppeteer-core. Replaces phoma's browser.service.js
 * worker-lease system with a lighter per-account manager tailored to voxable.
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import puppeteer from 'puppeteer-core';
import { createLogger } from './logger.js';
import { LABS_FLOW_URL } from './constants.js';

const log = createLogger('Veo3 Browser');

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  (process.env.LOCALAPPDATA || '') + '\\Google\\Chrome\\Application\\chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
];

export function findChrome() {
  for (const c of CHROME_CANDIDATES) {
    if (c && fs.existsSync(c)) return c;
  }
  throw new Error('Không tìm thấy Google Chrome trên máy. Vui lòng cài Chrome.');
}

function isCdpReady(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/json/version`, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function waitCdp(timeoutMs, port) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = async () => {
      if (await isCdpReady(port)) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('CDP timeout'));
      setTimeout(check, 400);
    };
    check();
  });
}

function repairChromeProfileStateFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return;
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!data || typeof data !== 'object') return;
    data.profile = data.profile && typeof data.profile === 'object' ? data.profile : {};
    let changed = false;
    if (data.profile.exit_type === 'Crashed') {
      data.profile.exit_type = 'Normal';
      changed = true;
    }
    if (data.profile.exited_cleanly === false) {
      data.profile.exited_cleanly = true;
      changed = true;
    }
    if (changed) fs.writeFileSync(filePath, JSON.stringify(data));
  } catch {
    /* ignore */
  }
}

function repairChromeCrashRestoreState(userDataDir) {
  try {
    repairChromeProfileStateFile(path.join(userDataDir, 'Local State'));
    if (!fs.existsSync(userDataDir)) return;
    for (const entry of fs.readdirSync(userDataDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      repairChromeProfileStateFile(path.join(userDataDir, entry.name, 'Preferences'));
    }
  } catch {
    /* ignore */
  }
}

function launchChromeProcess(chromePath, { port, userDataDir, startUrl, background, proxyServer }) {
  const isWindows = process.platform === 'win32';
  const backgroundArgs = background
    ? [
        '--start-minimized',
        '--window-size=1440,1000',
        ...(isWindows ? ['--window-position=-32000,-32000'] : []),
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
      ]
    : isWindows
    ? ['--window-position=100,100']
    : [];
  fs.mkdirSync(userDataDir, { recursive: true });
  repairChromeCrashRestoreState(userDataDir);
  return spawn(
    chromePath,
    [
      `--remote-debugging-port=${port}`,
      '--remote-debugging-address=127.0.0.1',
      `--user-data-dir=${userDataDir}`,
      '--remote-allow-origins=*',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-session-crashed-bubble',
      '--disable-sync',
      '--disable-blink-features=AutomationControlled',
      ...(proxyServer ? [`--proxy-server=${proxyServer}`] : []),
      ...backgroundArgs,
      ...(startUrl ? [startUrl] : []),
    ],
    { stdio: 'ignore', detached: false }
  );
}

/**
 * Per-account browser session. One Chrome process + puppeteer connection,
 * keyed by a unique CDP port derived from the account slot.
 */
export class Veo3BrowserPool {
  /**
   * @param {object} opts
   * @param {string} opts.profilesDir - base dir for Chrome profiles
   * @param {number} [opts.basePort] - starting CDP port (each account gets basePort+index)
   * @param {boolean} [opts.headless] - run Chrome minimized/background
   */
  constructor({ profilesDir, basePort = 9400, headless = true } = {}) {
    this.profilesDir = profilesDir;
    this.basePort = basePort;
    this.headless = headless;
    // accountId -> { browser, chromeProcess, port, profileDir }
    this.sessions = new Map();
    this.portCounter = 0;
  }

  _portFor(accountId) {
    const existing = this.sessions.get(accountId);
    if (existing) return existing.port;
    return this.basePort + (this.portCounter++ % 100);
  }

  _profileDirFor(accountId) {
    return path.join(this.profilesDir, `veo3-${accountId}`);
  }

  /**
   * Launch (if needed) and connect to the browser for an account.
   * Returns a puppeteer Browser instance.
   */
  async ensureBrowser(accountId, { profileDir } = {}) {
    const existing = this.sessions.get(accountId);
    if (existing?.browser && existing.browser.connected !== false) {
      try {
        await existing.browser.version();
        return existing.browser;
      } catch {
        // stale connection, fall through to relaunch
        await this.closeAccount(accountId);
      }
    }

    const port = this._portFor(accountId);
    const dir = profileDir || this._profileDirFor(accountId);
    const chromePath = findChrome();

    const alreadyUp = await isCdpReady(port);
    let chromeProcess = null;
    if (!alreadyUp) {
      log.info(`Launching Chrome for account ${accountId} on port ${port}`);
      chromeProcess = launchChromeProcess(chromePath, {
        port,
        userDataDir: dir,
        startUrl: 'about:blank',
        background: this.headless,
      });
      chromeProcess.on('exit', (code) => {
        log.info(`Chrome for ${accountId} exited (code=${code})`);
        const s = this.sessions.get(accountId);
        if (s) {
          s.browser = null;
          s.chromeProcess = null;
        }
      });
      await waitCdp(30000, port);
    }

    let browser = null;
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        browser = await puppeteer.connect({
          browserURL: `http://127.0.0.1:${port}`,
          defaultViewport: null,
        });
        break;
      } catch (e) {
        if (attempt === 5) throw e;
        await new Promise((r) => setTimeout(r, 400));
      }
    }

    this.sessions.set(accountId, { browser, chromeProcess, port, profileDir: dir });
    return browser;
  }

  /**
   * Open a visible Chrome window at Flow for the user to log in.
   * Returns when the window is launched (does not wait for login).
   */
  async openLoginWindow(accountId, { profileDir } = {}) {
    // Close any background session first so the visible window owns the profile.
    await this.closeAccount(accountId);
    const port = this._portFor(accountId);
    const dir = profileDir || this._profileDirFor(accountId);
    const chromePath = findChrome();
    const chromeProcess = launchChromeProcess(chromePath, {
      port,
      userDataDir: dir,
      startUrl: LABS_FLOW_URL,
      background: false,
    });
    await waitCdp(30000, port).catch(() => {});
    this.sessions.set(accountId, { browser: null, chromeProcess, port, profileDir: dir, visible: true });
    return { ok: true };
  }

  async closeAccount(accountId) {
    const s = this.sessions.get(accountId);
    if (!s) return;
    try {
      if (s.browser) await s.browser.disconnect();
    } catch {
      /* ignore */
    }
    try {
      if (s.chromeProcess && !s.chromeProcess.killed) s.chromeProcess.kill();
    } catch {
      /* ignore */
    }
    this.sessions.delete(accountId);
  }

  async destroy() {
    const ids = [...this.sessions.keys()];
    for (const id of ids) {
      await this.closeAccount(id);
    }
  }
}
