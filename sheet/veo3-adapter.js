/**
 * Veo3 Adapter
 *
 * High-level API used by IPC handlers and the video pipeline. Wraps the Veo3
 * module (puppeteer + Google Flow API) with account management, a browser pool,
 * and a `generateImages` function compatible with the old FlowAgentPool.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import pLimit from 'p-limit';
import { createLogger } from './veo3/logger.js';
import { Veo3BrowserPool } from './veo3/browser-pool.js';
import { createVeo3FlowImageProjectContext } from './veo3/flow-page.js';
import { handleVeo3Generate } from './veo3/image-generation.js';
import { VEO3_MODEL_LABELS, VEO3_ASPECT_RATIOS } from './veo3/constants.js';
import {
  listAccounts,
  getAccount,
  getActiveAccount,
  addAccount,
  updateAccount,
  setActiveAccount,
  deleteAccount,
  getProfilesDir,
} from './veo3/accounts-store.js';

const log = createLogger('Veo3 Adapter');

let browserPool = null;

function getPool(headless = true) {
  if (!browserPool) {
    browserPool = new Veo3BrowserPool({ profilesDir: getProfilesDir(), headless });
  }
  return browserPool;
}

/** Build a file-writer that saves images into outputDir. */
function makeImageWriter(outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  return async (buffer, meta) => {
    const safePrompt = (meta.prompt || 'veo3')
      .slice(0, 40)
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    const filename = `${safePrompt || 'veo3'}_${meta.index}_${Date.now()}_${crypto
      .randomUUID()
      .slice(0, 8)}.jpg`;
    const filePath = path.join(outputDir, filename);
    await fs.promises.writeFile(filePath, buffer);
    return { filename, filePath, size: buffer.length, mime: 'image/jpeg' };
  };
}

// ── Account management (thin wrappers over the store) ─────────────────────────
export const accounts = {
  list: listAccounts,
  get: getAccount,
  getActive: getActiveAccount,
  add: addAccount,
  update: updateAccount,
  setActive: setActiveAccount,
  remove: deleteAccount,
};

/** Open a visible Chrome window so the user can log into Google Flow. */
export async function openLoginWindow(accountId) {
  const account = getAccount(accountId);
  if (!account) throw new Error('Account không tồn tại');
  const pool = getPool();
  await pool.openLoginWindow(accountId, { profileDir: account.profileDir });
  return { ok: true };
}

/** Mở (nếu cần) Chrome của account và trả về puppeteer Browser — dùng cho nhập cookie. */
export async function ensureBrowserFor(accountId, { headless = true } = {}) {
  const account = getAccount(accountId);
  if (!account) throw new Error('Account không tồn tại');
  return getPool(headless).ensureBrowser(accountId, { profileDir: account.profileDir });
}

/** Close the browser for an account (e.g. after login, to switch to background). */
export async function closeAccountBrowser(accountId) {
  if (!browserPool) return { ok: true };
  await browserPool.closeAccount(accountId);
  return { ok: true };
}

export const MODELS = VEO3_MODEL_LABELS;
export const ASPECT_RATIOS = Object.keys(VEO3_ASPECT_RATIOS).filter((k) => k.includes(':'));

/**
 * Generate a single prompt's images using a specific account.
 * @returns {Promise<{ok:boolean, images:Array}>}
 */
export async function generateForAccount(accountId, params, send, options = {}) {
  const account = getAccount(accountId);
  if (!account) {
    send?.({ step: 'error', error: 'Account không tồn tại' });
    return { ok: false, images: [] };
  }
  const pool = getPool(options.headless ?? true);
  const browser = await pool.ensureBrowser(accountId, { profileDir: account.profileDir });

  const outputDir = options.outputDir || path.join(getProfilesDir(), '..', 'output');
  const write = makeImageWriter(outputDir);

  const result = await handleVeo3Generate(
    browser,
    {
      prompt: params.prompt,
      model: params.model || 'Nano Banana pro',
      aspectRatio: params.aspectRatio || '9:16',
      outputCount: params.outputCount || 1,
      referenceImages: params.referenceImages || [],
      imageTags: params.imageTags || [],
    },
    (data) => {
      if (data.step === 'need_login') {
        updateAccount(accountId, { lastLoginStatus: 'logged_out' });
      }
      send?.({ ...data, accountId, accountLabel: account.email || account.name });
    },
    { signal: options.signal, write, flowImageProjectContext: options.flowImageProjectContext }
  );
  if (result?.ok) {
    updateAccount(accountId, { lastLoginStatus: 'logged_in' });
  }
  return result ?? { ok: false, images: [] };
}

/**
 * Batch generate many prompts, distributing across accounts with concurrency.
 * Drop-in compatible with the old generateImages(pool, prompts, opts, onProgress).
 *
 * @param {string[]} prompts
 * @param {object} opts - { model, aspectRatio, outputCount, outputDir, parallelJobs, headless }
 * @param {(p:object)=>void} onProgress
 * @param {object} ctx - { signal }
 */
export async function generateImages(prompts, opts = {}, onProgress = () => {}, ctx = {}) {
  if (!Array.isArray(prompts) || prompts.length === 0) return [];
  const accs = listAccounts().filter((a) => a.lastLoginStatus !== 'logged_out');
  const usableAccounts = accs.length > 0 ? accs : listAccounts();
  if (usableAccounts.length === 0) {
    throw new Error('Chưa có account Veo3 nào. Vào tab Tạo ảnh → Thêm account và đăng nhập.');
  }

  const concurrency = Math.max(1, Math.min(Number(opts.parallelJobs) || 1, usableAccounts.length, prompts.length));
  const limit = pLimit(concurrency);
  const headless = opts.headless ?? true;

  // Reuse a shared Flow project per account to avoid re-creating projects.
  const projectContexts = new Map();
  const pool = getPool(headless);

  const results = await Promise.all(
    prompts.map((prompt, promptIndex) =>
      limit(async () => {
        // Round-robin account by prompt index
        const account = usableAccounts[promptIndex % usableAccounts.length];
        onProgress({ prompt, status: 'pending', account: account.id });
        try {
          const browser = await pool.ensureBrowser(account.id, { profileDir: account.profileDir });
          if (!projectContexts.has(account.id)) {
            projectContexts.set(account.id, createVeo3FlowImageProjectContext(browser, 'Voxable Veo3'));
          }
          const flowImageProjectContext = projectContexts.get(account.id);

          const result = await generateForAccount(
            account.id,
            {
              prompt,
              model: opts.model,
              aspectRatio: opts.aspectRatio,
              outputCount: opts.outputCount || 1,
              referenceImages: opts.referenceImages || [],
              imageTags: opts.imageTags || [],
            },
            (data) => onProgress({ ...data, prompt, promptIndex }),
            { signal: ctx.signal, outputDir: opts.outputDir, headless, flowImageProjectContext }
          );

          const filePath = result?.images?.[0]?.filePath ?? null;
          const status = result?.ok ? 'done' : 'error';
          onProgress({ prompt, promptIndex, status, account: account.id, filePath });
          return { prompt, status, account: account.id, filePath, images: result?.images ?? [] };
        } catch (e) {
          if (e.name === 'AbortError') {
            onProgress({ prompt, promptIndex, status: 'cancelled', account: account.id });
            return { prompt, status: 'cancelled' };
          }
          log.error('Generate failed:', e.message);
          onProgress({ prompt, promptIndex, status: 'error', account: account.id, error: e.message });
          return { prompt, status: 'error', error: e.message };
        }
      })
    )
  );

  // Clean up shared project pages
  for (const ctxObj of projectContexts.values()) {
    await ctxObj.close().catch(() => {});
  }
  return results;
}

export async function destroy() {
  if (browserPool) {
    await browserPool.destroy();
    browserPool = null;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Pipeline-compatible pool
//
// The video pipeline (scene-background.js, sheet-watcher.js, job-runner.js) was
// built around the old FlowImagePool interface:
//   new FlowImagePool(accounts, mode, gpmHost, opts)
//   pool.init(); pool.prewarm(); pool.capacity(); pool.acquireableCount()
//   generateImages(pool, prompts, opts, onProgress, { saveFn })
//
// Veo3ImagePool implements that surface on top of the Veo3 adapter so those
// callers only need their import swapped — no logic changes.
// ──────────────────────────────────────────────────────────────────────────────

export class Veo3ImagePool {
  // Signature kept compatible with FlowImagePool(accounts, mode, gpmHost, opts)
  constructor(_accounts, _mode, _gpmHost, opts = {}) {
    this.headless = opts.headless ?? true;
    this.slotsPerAccount = Math.max(1, Number(opts.slotsPerAccount) || 1);
    this.onAccountUnhealthy = opts.onAccountUnhealthy || null;
    this.pool = getPool(this.headless);
    this.projectContexts = new Map();
    // Only use accounts that are not known-logged-out.
    this.accountIds = listAccounts()
      .filter((a) => a.lastLoginStatus !== 'logged_out')
      .map((a) => a.id);
    if (this.accountIds.length === 0) {
      this.accountIds = listAccounts().map((a) => a.id);
    }
    this.busy = new Map();
  }

  // Compat: thumbnail-flow.js reads `pool.accounts.length` for retry attempts.
  get accounts() {
    return this.accountIds;
  }

  async init() {
    if (this.accountIds.length === 0) {
      throw new Error('Chưa có account Veo3 nào. Vào tab Tạo ảnh → Thêm account và đăng nhập Google Flow.');
    }
  }

  async prewarm() {
    // Open browsers in the background so the first generation is faster.
    await Promise.all(
      this.accountIds.map((id) => {
        const acc = getAccount(id);
        return this.pool.ensureBrowser(id, { profileDir: acc?.profileDir }).catch(() => null);
      })
    );
  }

  acquireableCount() {
    return this.accountIds.length;
  }

  capacity() {
    return this.acquireableCount() * this.slotsPerAccount;
  }

  _active(id) {
    return this.busy.get(id) || 0;
  }

  async acquire({ avoid = [] } = {}) {
    // Pick the least-busy account not in `avoid`.
    const candidates = this.accountIds
      .filter((id) => !avoid.includes(id))
      .sort((a, b) => this._active(a) - this._active(b));
    const id = candidates[0] ?? this.accountIds[0];
    this.busy.set(id, this._active(id) + 1);
    return { index: id };
  }

  release(id) {
    const left = this._active(id) - 1;
    if (left > 0) this.busy.set(id, left);
    else this.busy.delete(id);
  }

  async closeAccount(id) {
    await this.pool.closeAccount(id);
    const ctx = this.projectContexts.get(id);
    if (ctx) {
      await ctx.close().catch(() => {});
      this.projectContexts.delete(id);
    }
  }

  async _getProjectContext(accountId, browser) {
    if (!this.projectContexts.has(accountId)) {
      this.projectContexts.set(accountId, createVeo3FlowImageProjectContext(browser, 'Voxable Veo3'));
    }
    return this.projectContexts.get(accountId);
  }

  /**
   * generateImage(accountId, prompt, opts) -> { response, seed }
   * `response.images[]` carries the saved files; saveFn in the pipeline uses
   * our already-saved buffer via `response`.
   */
  async generateImage(accountId, prompt, opts = {}) {
    const acc = getAccount(accountId);
    const browser = await this.pool.ensureBrowser(accountId, { profileDir: acc?.profileDir });
    const flowImageProjectContext = await this._getProjectContext(accountId, browser);
    const result = await generateForAccount(
      accountId,
      {
        prompt,
        model: opts.model,
        aspectRatio: opts.aspect || opts.aspectRatio,
        outputCount: opts.outputCount || 1,
      },
      opts.onProgress || (() => {}),
      {
        signal: opts.signal,
        outputDir: opts.outputDir,
        headless: this.headless,
        flowImageProjectContext,
      }
    );
    if (!result.ok) {
      const err = new Error(result.error || 'Veo3 generation failed');
      throw err;
    }
    return { response: { images: result.images }, seed: null };
  }

  async destroy() {
    for (const ctx of this.projectContexts.values()) {
      await ctx.close().catch(() => {});
    }
    this.projectContexts.clear();
    this.busy.clear();
    // Note: we leave the shared browserPool alone (other callers may use it).
  }
}

/**
 * Pool-based generateImages compatible with the old flow-image.js export.
 * The pipeline calls: generateImagesPool(pool, prompts, opts, onProgress, { saveFn })
 *
 * Our Veo3 path already writes images to disk, so when `saveFn` is provided we
 * hand it the saved file so it can re-save under the pipeline's naming scheme.
 */
export async function generateImagesPool(pool, prompts, opts = {}, onProgress = () => {}, { saveFn } = {}) {
  if (!Array.isArray(prompts) || prompts.length === 0) return [];
  const concurrency = Math.max(1, Math.min(Number(opts.parallelJobs) || 1, pool.capacity(), prompts.length));
  const limit = pLimit(concurrency);
  const maxAttempts = Math.max(1, pool.acquireableCount());

  return await Promise.all(
    prompts.map((prompt, promptIndex) =>
      limit(async () => {
        const used = [];
        let lastErr = null;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          let acquiredId = null;
          if (attempt === 1) onProgress({ prompt, status: 'pending' });
          try {
            const { index } = await pool.acquire({ avoid: used });
            acquiredId = index;
            used.push(index);
            onProgress({ prompt, status: 'generating', account: index, attempt });
            try {
              const { response } = await pool.generateImage(index, prompt, {
                model: opts.model,
                aspect: opts.aspectRatio,
                outputCount: opts.outputCount || 1,
                outputDir: opts.outputDir,
                signal: opts.signal,
              });
              const firstImage = response.images?.[0];
              let filePath = firstImage?.filePath ?? null;
              // Let the pipeline re-save under its own naming if it wants to.
              if (saveFn && firstImage) {
                try {
                  filePath = await saveFn(response, {
                    outputDir: opts.outputDir,
                    prompt,
                    index: promptIndex,
                    seed: null,
                    sourceFilePath: firstImage.filePath,
                  });
                } catch {
                  filePath = firstImage.filePath;
                }
              }
              onProgress({ prompt, status: 'done', account: index, filePath });
              return { prompt, status: 'done', account: index, filePath };
            } finally {
              pool.release(index);
            }
          } catch (e) {
            lastErr = e;
            if (acquiredId != null) {
              try {
                await pool.closeAccount(acquiredId);
              } catch {
                /* ignore */
              }
            }
            onProgress({ prompt, status: 'retry', account: acquiredId, attempt, error: e.message });
            if (attempt >= maxAttempts) break;
          }
        }
        const result = { prompt, status: 'error', error: lastErr?.message || 'unknown' };
        onProgress(result);
        return result;
      })
    )
  );
}
