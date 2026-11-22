/**
 * Veo3 Flow page helpers
 * Adapted from phoma - trimmed to what the API image path needs.
 */
import { createLogger } from './logger.js';
import { LABS_FLOW_URL } from './constants.js';
import { createVeo3FlowProject } from './flow-batch.js';
import { isLoginPage, readPageUserAgent } from './page.js';
import { Veo3ApiError } from './api-errors.js';
import { AsyncMutex, throwIfAborted } from './async-utils.js';
import { stripDataUrlPrefix } from './image-artifacts.js';

const log = createLogger('Veo 3');

export function isDetachedFrameError(err) {
  const message = err?.message || '';
  return (
    message.includes('detached Frame') ||
    message.includes('Execution context was destroyed') ||
    message.includes('Cannot find context with specified id') ||
    message.includes('page is closed') ||
    message.includes('Target closed') ||
    message.includes('Session closed') ||
    message.includes('Protocol error')
  );
}

export function getVeo3FlowImageAspectRatio(value) {
  const ratios = {
    '1:1': 1,
    square: 1,
    '9:16': 2,
    portrait: 2,
    '16:9': 3,
    landscape: 3,
    '3:4': 4,
    '4:3': 5,
  };
  return ratios[value] ?? ratios['9:16'];
}

export function isGoogleFlowUrl(url) {
  try {
    return new URL(url).hostname === 'flow.google.com';
  } catch {
    return false;
  }
}

export async function createVeo3ImageJobPage(browser) {
  const page = await browser.newPage();
  try {
    await page.goto(LABS_FLOW_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (isLoginPage(page.url())) {
      throw new Veo3ApiError('Phiên đăng nhập Veo3 đã hết hạn.', 401);
    }
    if (!isGoogleFlowUrl(page.url())) {
      throw new Error(`Tab tạo ảnh Veo3 chưa vào được Google Flow (${page.url()}).`);
    }
    return page;
  } catch (error) {
    if (!page.isClosed()) await page.close().catch(() => undefined);
    throw error;
  }
}

/**
 * A reusable project context: creates one Flow project on a dedicated page and
 * reuses it for subsequent generations (avoids re-creating project each time).
 */
export function createVeo3FlowImageProjectContext(browser, title = 'Veo3 Generation') {
  let projectIdPromise = null;
  let primaryPage = null;
  const projectMutex = new AsyncMutex();
  const ensureProject = async () => {
    if (projectIdPromise) return projectIdPromise;
    await projectMutex.acquire();
    try {
      if (!projectIdPromise) {
        const pendingProject = (async () => {
          primaryPage = await createVeo3ImageJobPage(browser);
          const projectId = await createVeo3FlowProject(primaryPage, title);
          await primaryPage.goto(new URL(`/project/${projectId}`, LABS_FLOW_URL).toString(), {
            waitUntil: 'domcontentloaded',
            timeout: 30000,
          });
          return projectId;
        })();
        const sharedProject = pendingProject.catch(async (error) => {
          if (projectIdPromise === sharedProject) projectIdPromise = null;
          if (primaryPage && !primaryPage.isClosed()) {
            await primaryPage.close().catch(() => undefined);
          }
          primaryPage = null;
          throw error;
        });
        projectIdPromise = sharedProject;
      }
      return await projectIdPromise;
    } finally {
      projectMutex.release();
    }
  };
  return {
    async acquireJobPage(signal) {
      const projectId = await ensureProject();
      throwIfAborted(signal);
      if (!primaryPage || primaryPage.isClosed()) {
        throw new Error('Tab Google Flow đã bị đóng.');
      }
      return {
        page: primaryPage,
        projectId,
        release: async () => undefined,
      };
    },
    async close() {
      if (primaryPage && !primaryPage.isClosed()) {
        await primaryPage.close().catch(() => undefined);
      }
      primaryPage = null;
    },
  };
}

export async function readImageArtifactBuffer(page, url, signal) {
  const nodeResponse = await fetch(url, {
    headers: {
      Referer: 'https://flow.google.com/',
      'User-Agent': await readPageUserAgent(page),
    },
    signal,
  }).catch(() => null);
  if (nodeResponse?.ok) {
    return Buffer.from(await nodeResponse.arrayBuffer());
  }
  const dataUrl = await page.evaluate(async (imageUrl) => {
    const res = await fetch(imageUrl, { credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error('Failed to read image blob.'));
      reader.readAsDataURL(blob);
    });
  }, url);
  return Buffer.from(stripDataUrlPrefix(dataUrl), 'base64');
}
