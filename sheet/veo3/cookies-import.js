// Nhập cookie đăng nhập Google cho một account Veo3 (thay cho việc đăng nhập tay trong Chrome).
// Hỗ trợ: JSON mảng (EditThisCookie / Cookie-Editor), JSON { cookies: [...] }, Netscape cookies.txt.
// Cookie là bí mật: hàm ở đây KHÔNG BAO GIỜ ghi giá trị cookie vào log hay thông báo lỗi; chỉ trả về số lượng và tên miền.

const GOOGLE_HOST = /(^|\.)(google\.com|youtube\.com|googleusercontent\.com|gstatic\.com)$/i;
const SAME_SITE = { no_restriction: "None", none: "None", lax: "Lax", strict: "Strict", unspecified: undefined };

function fromNetscape(text) {
  const out = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const httpOnly = line.startsWith("#HttpOnly_");
    if (line.startsWith("#") && !httpOnly) continue;
    const parts = (httpOnly ? line.slice(10) : line).split("\t");
    if (parts.length < 7) continue;
    const [domain, , path, secure, expires, name, ...rest] = parts;
    out.push({ domain, path: path || "/", secure: /^true$/i.test(secure), expires: Number(expires) || undefined, name, value: rest.join("\t"), httpOnly });
  }
  return out;
}

/** Đọc văn bản dán vào thành danh sách cookie thô. Ném Error (không chứa giá trị cookie) nếu không nhận ra. */
export function parseCookieText(text) {
  const t = String(text ?? "").trim();
  if (!t) throw new Error("Chưa dán cookie.");
  if (t.startsWith("[") || t.startsWith("{")) {
    let j;
    try { j = JSON.parse(t); } catch { throw new Error("JSON cookie không hợp lệ."); }
    const arr = Array.isArray(j) ? j : Array.isArray(j?.cookies) ? j.cookies : null;
    if (!arr) throw new Error("JSON cần là mảng cookie hoặc { cookies: [...] }.");
    return arr;
  }
  const list = fromNetscape(t);
  if (!list.length) throw new Error("Không nhận ra định dạng cookie (cần JSON hoặc Netscape cookies.txt).");
  return list;
}

/** Chuẩn hóa sang tham số của Network.setCookies; chỉ giữ cookie thuộc Google/YouTube. */
export function toCdpCookies(raw) {
  const out = [];
  for (const c of Array.isArray(raw) ? raw : []) {
    if (!c || typeof c.name !== "string" || typeof c.value !== "string" || !c.name) continue;
    const domain = String(c.domain ?? c.host ?? "").trim();
    if (!domain || !GOOGLE_HOST.test(domain.replace(/^\./, ""))) continue;
    const exp = Number(c.expirationDate ?? c.expires ?? c.expiry);
    const ck = {
      name: c.name, value: c.value, domain, path: String(c.path || "/"),
      secure: c.secure === true || /^__(Secure|Host)-/.test(c.name),
      httpOnly: c.httpOnly === true,
    };
    if (Number.isFinite(exp) && exp > 0) ck.expires = exp;
    const ss = SAME_SITE[String(c.sameSite ?? "").toLowerCase()];
    if (ss) ck.sameSite = ss;
    out.push(ck);
  }
  return out;
}

/** Tóm tắt không lộ giá trị: số cookie, các tên miền, có cookie phiên đăng nhập hay không. */
export function summarize(cookies) {
  const domains = [...new Set(cookies.map((c) => c.domain.replace(/^\./, "")))].sort();
  const hasSession = cookies.some((c) => /^(SID|__Secure-1PSID|__Secure-3PSID|SAPISID|__Secure-1PSIDTS)$/.test(c.name));
  return { count: cookies.length, domains, hasSession };
}

/**
 * Nạp cookie vào Chrome của account rồi mở Flow để biết đã đăng nhập chưa.
 * @param {object} o
 * @param {object} o.browser  puppeteer Browser của account
 * @param {string} o.text     văn bản cookie người dùng dán
 * @param {string} [o.flowUrl]
 * @returns {Promise<{ok:boolean, count:number, loggedIn:boolean, summary:object, error?:string}>}
 */
export async function importCookiesIntoBrowser({ browser, text, flowUrl = "https://flow.google.com/" }) {
  let cookies;
  try { cookies = toCdpCookies(parseCookieText(text)); } catch (e) { return { ok: false, count: 0, loggedIn: false, error: e.message }; }
  const summary = summarize(cookies);
  if (!cookies.length) return { ok: false, count: 0, loggedIn: false, summary, error: "Không có cookie nào của Google/YouTube trong nội dung đã dán." };
  if (!summary.hasSession) return { ok: false, count: cookies.length, loggedIn: false, summary, error: "Thiếu cookie phiên đăng nhập Google (SID/__Secure-1PSID...). Hãy xuất cookie khi đã đăng nhập." };
  const page = await browser.newPage();
  try {
    const cdp = await page.createCDPSession();
    const res = await cdp.send("Network.setCookies", { cookies });
    if (res && res.success === false) return { ok: false, count: cookies.length, loggedIn: false, summary, error: "Chrome từ chối nạp cookie." };
    await page.goto(flowUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await new Promise((r) => setTimeout(r, 2500));
    const url = page.url();
    const loggedIn = !/accounts\.google\.com|\/signin/.test(url) && /flow\.google\.com|labs\.google/.test(url);
    return { ok: true, count: cookies.length, loggedIn, summary };
  } catch (e) {
    return { ok: false, count: cookies.length, loggedIn: false, summary, error: "Không mở được Flow sau khi nạp cookie: " + String(e?.message || e).slice(0, 100) };
  } finally {
    try { await page.close(); } catch { /* đã đóng */ }
  }
}
