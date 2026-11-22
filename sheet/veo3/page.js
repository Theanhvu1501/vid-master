/**
 * Veo3 page helpers (minimal)
 * Only the functions the API image path needs.
 */
import { isVeo3LoginUrl } from './constants.js';

export function isLoginPage(url) {
  return isVeo3LoginUrl(url);
}

export async function readPageUserAgent(page) {
  return page.evaluate(() => navigator.userAgent).catch(async () => page.browser().userAgent());
}

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

export function findEmailInValue(value) {
  if (typeof value === 'string') {
    const match = value.match(EMAIL_PATTERN);
    return match?.[0] ?? null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const email = findEmailInValue(item);
      if (email) return email;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const entries = Object.entries(value);
  const prioritized = entries.filter(([key]) => /email|mail|account/i.test(key));
  for (const [, item] of prioritized) {
    const email = findEmailInValue(item);
    if (email) return email;
  }
  for (const [, item] of entries) {
    const email = findEmailInValue(item);
    if (email) return email;
  }
  return null;
}

/**
 * Read the logged-in Google account email from the Flow page (best effort).
 */
export async function readVeo3AccountEmail(page) {
  try {
    const data = await page.evaluate(() => {
      const win = window;
      return win.WIZ_global_data ?? null;
    });
    return findEmailInValue(data);
  } catch {
    return null;
  }
}
