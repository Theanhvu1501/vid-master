/**
 * Đổi GA (Google Account) cho kênh YouTube - API-based flow
 *
 * Flow:
 * 1. User add kênh (Channel ID) + cookies từ YouTube Studio
 * 2. Tool tạo link ServiceLogin với rapt token
 * 3. User mở link, xác nhận mật khẩu → lấy rapt mới từ URL redirect
 * 4. Paste rapt vào tool → Gen link token đổi GA
 */

import fetch from 'node-fetch';

// YouTube Studio API endpoints
const ENDPOINTS = {
  // Lấy session info và tạo rapt token ban đầu
  ESR: 'https://studio.youtube.com/youtubei/v1/att/esr',
  // Reauth endpoint
  REAUTH: 'https://studio.youtube.com/reauth',
  // Brand account management
  BRAND_ACCOUNTS: 'https://myaccount.google.com/brandaccounts',
};

// Google ServiceLogin URL template
const SERVICE_LOGIN_TEMPLATE = 'https://accounts.google.com/ServiceLogin?service=youtube&uilel=3&continue={continue}&hl=en&rapt={rapt}';

// Continue URL cho reauth
const REAUTH_CONTINUE = encodeURIComponent('https://www.youtube.com/signin?action_handle_signin=true&app=desktop&next=' + encodeURIComponent('https://studio.youtube.com/reauth') + '&feature=reauth&skip_identity_prompt=true');

/**
 * Parse cookies từ cURL string hoặc raw cookie string
 * @param {string} input - cURL command hoặc cookie string
 * @returns {string} - Cookie header value
 */
export function parseCookies(input) {
  if (!input) return '';

  // Nếu là cURL command, extract cookie
  if (input.includes('curl ') || input.includes("curl '")) {
    // Tìm -H 'cookie: ...' hoặc -H "cookie: ..."
    const cookieMatch = input.match(/-H\s+['"]cookie:\s*([^'"]+)['"]/i) ||
                        input.match(/--header\s+['"]cookie:\s*([^'"]+)['"]/i);
    if (cookieMatch) {
      return cookieMatch[1].trim();
    }
  }

  // Nếu là raw cookie string
  return input.trim();
}

/**
 * Parse cookies từ Netscape/Mozilla format (export từ browser extension)
 * @param {string} text - Cookie text dạng Netscape
 * @returns {string} - Cookie header value
 */
export function parseNetscapeCookies(text) {
  const lines = text.split('\n').filter(line =>
    line.trim() && !line.startsWith('#') && !line.startsWith('//')
  );

  const cookies = [];
  for (const line of lines) {
    const parts = line.split('\t');
    if (parts.length >= 7) {
      // Format: domain, flag, path, secure, expiry, name, value
      const name = parts[5];
      const value = parts[6];
      if (name && value) {
        cookies.push(`${name}=${value}`);
      }
    } else if (line.includes('=')) {
      // Simple name=value format
      cookies.push(line.trim());
    }
  }

  return cookies.join('; ');
}

/**
 * Extract SAPISIDHASH từ cookies (cần cho YouTube API auth)
 * @param {string} cookies - Cookie string
 * @param {string} origin - Origin URL
 * @returns {string} - SAPISIDHASH header value
 */
function getSapisidHash(cookies, origin = 'https://studio.youtube.com') {
  const sapisidMatch = cookies.match(/SAPISID=([^;]+)/);
  if (!sapisidMatch) return null;

  const sapisid = sapisidMatch[1];
  const timestamp = Math.floor(Date.now() / 1000);

  // SAPISIDHASH = timestamp_sha1(timestamp + " " + SAPISID + " " + origin)
  const crypto = require('crypto');
  const hash = crypto.createHash('sha1')
    .update(`${timestamp} ${sapisid} ${origin}`)
    .digest('hex');

  return `SAPISIDHASH ${timestamp}_${hash}`;
}

/**
 * Lấy session info từ YouTube Studio (gọi API esr)
 * @param {string} channelId - Channel ID (UC...)
 * @param {string} cookies - Cookie string
 * @returns {Object} - Session info bao gồm rapt token
 */
export async function getSessionInfo(channelId, cookies) {
  const sapisidHash = getSapisidHash(cookies);

  const headers = {
    'accept': '*/*',
    'accept-language': 'en-US,en;q=0.9',
    'content-type': 'application/json',
    'cookie': cookies,
    'origin': 'https://studio.youtube.com',
    'referer': `https://studio.youtube.com/channel/${channelId}`,
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  };

  if (sapisidHash) {
    headers['authorization'] = sapisidHash;
  }

  // Request body cho esr endpoint
  const body = {
    context: {
      client: {
        clientName: 62, // YOUTUBE_STUDIO
        clientVersion: '1.0',
      },
      request: {
        returnLogEntry: true,
        internalExperimentFlags: [],
      },
    },
    channelId: channelId,
  };

  try {
    const response = await fetch(`${ENDPOINTS.ESR}?alt=json&key=AIzaSyBUPetSUmoZL-OhlxA7wSac5XinrygCqMo`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    throw new Error(`Không thể lấy session info: ${error.message}`);
  }
}

/**
 * Tạo link ServiceLogin để xác nhận ownership
 * @param {string} channelId - Channel ID
 * @param {string} cookies - Cookie string
 * @returns {Object} - { loginUrl, initialRapt }
 */
export async function generateLoginLink(channelId, cookies) {
  // Lấy session info để có rapt token ban đầu
  const sessionInfo = await getSessionInfo(channelId, cookies);

  // Extract rapt từ response (nếu có)
  // Rapt thường nằm trong sessionInfo hoặc cần gọi thêm API
  let initialRapt = '';

  // Thử extract rapt từ session
  if (sessionInfo?.rapt) {
    initialRapt = sessionInfo.rapt;
  } else if (sessionInfo?.responseContext?.serviceTrackingParams) {
    // Tìm trong tracking params
    for (const param of sessionInfo.responseContext.serviceTrackingParams) {
      if (param.params) {
        const raptParam = param.params.find(p => p.key === 'rapt');
        if (raptParam) {
          initialRapt = raptParam.value;
          break;
        }
      }
    }
  }

  // Tạo login URL
  const continueUrl = `https://www.youtube.com/signin?action_handle_signin=true&app=desktop&next=${encodeURIComponent('https://studio.youtube.com/reauth')}&feature=reauth&skip_identity_prompt=true`;

  let loginUrl = `https://accounts.google.com/ServiceLogin?service=youtube&uilel=3&continue=${encodeURIComponent(continueUrl)}&hl=en`;

  if (initialRapt) {
    loginUrl += `&rapt=${initialRapt}`;
  }

  return {
    loginUrl,
    initialRapt,
    channelId,
  };
}

/**
 * Generate link token đổi GA từ rapt token đã xác nhận
 * @param {string} channelId - Channel ID
 * @param {string} cookies - Cookie string
 * @param {string} rapt - Rapt token từ URL redirect sau khi user xác nhận
 * @returns {Object} - { transferUrl, token }
 */
export async function generateTransferLink(channelId, cookies, rapt) {
  if (!rapt) {
    throw new Error('Chưa có rapt token. Vui lòng mở link ở Bước 1, xác nhận mật khẩu, rồi copy rapt từ URL.');
  }

  const sapisidHash = getSapisidHash(cookies);

  const headers = {
    'accept': '*/*',
    'accept-language': 'en-US,en;q=0.9',
    'content-type': 'application/json',
    'cookie': cookies,
    'origin': 'https://studio.youtube.com',
    'referer': `https://studio.youtube.com/channel/${channelId}`,
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  };

  if (sapisidHash) {
    headers['authorization'] = sapisidHash;
  }

  // Gọi API với rapt token để lấy link chuyển GA
  // Endpoint này cần được xác định chính xác từ network traffic của SteamManage
  // Tạm thời tạo URL dạng Brand Account management

  const transferUrl = `https://myaccount.google.com/brandaccounts/${channelId}/transfer?rapt=${rapt}`;

  // Hoặc có thể là YouTube channel transfer endpoint
  const youtubeTransferUrl = `https://studio.youtube.com/channel/${channelId}/editing/transfer?rapt=${rapt}`;

  return {
    transferUrl,
    youtubeTransferUrl,
    rapt,
    channelId,
  };
}

/**
 * Extract rapt từ URL redirect
 * @param {string} url - URL chứa rapt parameter
 * @returns {string} - Rapt value
 */
export function extractRaptFromUrl(url) {
  if (!url) return '';

  // Tìm rapt= trong URL
  const match = url.match(/rapt=([^&\s]+)/);
  if (match) {
    return match[1];
  }

  // Nếu user paste trực tiếp giá trị rapt (bắt đầu bằng AE)
  if (url.startsWith('AE')) {
    return url.trim();
  }

  return '';
}

/**
 * Validate Channel ID format
 * @param {string} channelId - Channel ID to validate
 * @returns {boolean}
 */
export function isValidChannelId(channelId) {
  return /^UC[a-zA-Z0-9_-]{22}$/.test(channelId);
}

/**
 * Extract Channel ID từ URL YouTube
 * @param {string} input - URL hoặc Channel ID
 * @returns {string} - Channel ID
 */
export function extractChannelId(input) {
  if (!input) return '';

  input = input.trim();

  // Đã là Channel ID
  if (isValidChannelId(input)) {
    return input;
  }

  // Extract từ URL
  const patterns = [
    /youtube\.com\/channel\/(UC[a-zA-Z0-9_-]{22})/,
    /studio\.youtube\.com\/channel\/(UC[a-zA-Z0-9_-]{22})/,
  ];

  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return input; // Trả về nguyên nếu không match
}

export default {
  parseCookies,
  parseNetscapeCookies,
  getSessionInfo,
  generateLoginLink,
  generateTransferLink,
  extractRaptFromUrl,
  isValidChannelId,
  extractChannelId,
};
