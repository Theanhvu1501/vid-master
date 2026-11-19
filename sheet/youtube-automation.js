/**
 * YouTube Studio automation qua GPM + Playwright.
 * Chuyển thể từ 3 script GPM: 01.auto_login, 03.auto_change_thumb, 04.auto_schedule.
 *
 * Mỗi tác vụ chạy trên danh sách profile do người dùng chọn: mở profile -> làm việc -> đóng profile.
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import pLimit from "p-limit";
import XLSX from "xlsx";
import { connectProfile, closeProfile } from "./gpm-client.js";
import { splitPostTimes, toStudioTime } from "./schedule-slots.js";
import { clickNextUntil, maxNextClicks, pageIo, walkError } from "./studio-wizard.js";

// ============================================================================
// Helpers
// ============================================================================

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Hộp thoại đang mở trong Studio (selector CHƯA kiểm chứng trên kênh BKT thật).
const DIALOG_OPEN = "ytcp-dialog[opened], tp-yt-paper-dialog[opened]";

export const randomDelay = (min, max) => sleep(Math.floor(Math.random() * (max - min + 1)) + min);

// Playwright chỉ tự nhận XPath khi chuỗi bắt đầu bằng "//" — dạng "(//a)[2]" phải có tiền tố.
const xp = (s) => `xpath=${s.trim()}`;

let cancelled = false;
export function stopAutomation() { cancelled = true; }
export function resetCancel() { cancelled = false; }
export function checkCancelled() { if (cancelled) throw new Error("đã dừng theo yêu cầu"); }

// Sinh mã TOTP (RFC 6238, SHA-1, 6 số, bước 30s) từ secret base32.
export function generateTOTP(secret, nowMs = Date.now()) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of String(secret).toUpperCase().replace(/[\s=]/g, "")) {
    const v = alphabet.indexOf(ch);
    if (v === -1) continue;
    bits += v.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  if (!bytes.length) throw new Error("2FA secret không hợp lệ");

  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(Math.floor(nowMs / 1000 / 30)));
  const hmac = crypto.createHmac("sha1", Buffer.from(bytes)).update(buf).digest();
  const o = hmac[hmac.length - 1] & 0xf;
  const code = (((hmac[o] & 0x7f) << 24) | (hmac[o + 1] << 16) | (hmac[o + 2] << 8) | hmac[o + 3]) % 1000000;
  return String(code).padStart(6, "0");
}

// ----- Excel -----

// Ghi nối thêm dòng vào file Excel (tạo mới nếu chưa có). Đồng bộ, không có await giữa
// lúc đọc và ghi nên nhiều profile chạy song song cũng không đè dữ liệu của nhau.
export function appendRowsToExcel(file, rows) {
  if (!rows.length) return;
  let wb, sheetName;
  if (fs.existsSync(file)) {
    wb = XLSX.readFile(file);
    sheetName = wb.SheetNames[0];
  } else {
    wb = XLSX.utils.book_new();
    sheetName = "Sheet1";
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([]), sheetName);
  }
  const existing = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: "" });
  wb.Sheets[sheetName] = XLSX.utils.aoa_to_sheet([...existing, ...rows]);
  XLSX.writeFile(wb, file);
}

// ----- Ngày giờ lên lịch -----

// startDate chấp nhận 20260404 / 2026_04_04 / 2026-04-04 (bỏ ký tự không phải số).
// Danh sách ngày tính từ NGÀY KẾ TIẾP của startDate (rỗng = hôm nay), định dạng MM/DD/YYYY.
export function buildScheduleDays(numDays, startDate, today = new Date()) {
  const digits = String(startDate || "").replace(/\D/g, "");
  let base = today;
  if (digits.length === 8) {
    base = new Date(+digits.slice(0, 4), +digits.slice(4, 6) - 1, +digits.slice(6, 8));
  }
  const days = [];
  for (let i = 1; i <= numDays; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    days.push(`${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`);
  }
  return days;
}

// ----- Chạy qua nhiều profile -----

export async function forEachProfile({ gpmHost, profiles, concurrency = 1, log, work, onResult }) {
  const limit = pLimit(Math.max(1, parseInt(concurrency, 10) || 1));
  const res = { total: profiles.length, ok: 0, fail: 0, skipped: 0 };

  // Báo kết quả từng kênh ra ngoài (để ghi vào Sheet). Lỗi khi báo không được làm hỏng lượt chạy.
  const report = async (p, r, plog) => {
    try { await onResult?.(p, r); }
    catch (e) { plog(`⚠️ không ghi được trạng thái vào Sheet: ${e.message}`); }
  };

  await Promise.all(profiles.map((p) => limit(async () => {
    const plog = (m) => log(`[${p.name}] ${m}`);
    if (cancelled) { res.skipped++; await report(p, { status: "skip", message: "đã dừng" }, plog); return; }
    let browser;
    try {
      plog("mở profile…");
      const conn = await connectProfile(gpmHost, p.id, { log: plog });
      browser = conn.browser;
      const r = await work(conn.page, p, plog);
      if (r === "skip") { res.skipped++; await report(p, { status: "skip", message: "bỏ qua" }, plog); return; }
      res.ok++;
      plog("✅ xong");
      await report(p, { status: "ok", message: typeof r === "string" ? r : "" }, plog);
    } catch (err) {
      res.fail++;
      plog(`❌ ${err?.message || err}`);
      await report(p, { status: "error", message: String(err?.message || err) }, plog);
    } finally {
      if (browser) {
        try { await closeProfile(gpmHost, p.id, { browser }); plog("đã đóng profile"); }
        catch (e) { plog(`⚠️ đóng profile lỗi: ${e.message}`); }
      }
    }
  })));

  const message = `${res.ok}/${res.total} thành công, ${res.fail} lỗi, ${res.skipped} bỏ qua`;
  log(`\n🏁 ${message}`);
  return { success: true, ...res, message };
}

const isLoggedInUrl = (url) => url.includes("studio.youtube.com") && !url.includes("accounts.google.com");

// ============================================================================
// 1. AUTO LOGIN
// ============================================================================

export async function loginOne(page, acct, log) {
  await page.goto("https://studio.youtube.com", { waitUntil: "domcontentloaded", timeout: 60000 });
  await randomDelay(2000, 3000);
  if (isLoggedInUrl(page.url())) { log("đã đăng nhập sẵn"); return; }

  log(`nhập email ${acct.email}`);
  await page.locator("#identifierId").fill(acct.email, { timeout: 30000 });
  await randomDelay(1000, 2000);
  await page.click("#identifierNext");
  await randomDelay(3000, 5000);

  log("nhập mật khẩu");
  await page.locator('input[type="password"]').first().fill(acct.password, { timeout: 30000 });
  await randomDelay(1000, 2000);
  await page.click("#passwordNext");
  await randomDelay(3000, 5000);

  // Bước xác minh (nếu có): mã 2FA hoặc mail khôi phục.
  const totp = await page.waitForSelector("#totpPin", { timeout: 8000 }).catch(() => null);
  if (totp) {
    if (!acct.twoFactorSecret) throw new Error("Google đòi mã 2FA nhưng Excel không có secret (cột E)");
    // Mã sắp hết hạn trong vài giây thì đợi sang chu kỳ mới, tránh nhập mã vừa hết hạn.
    const remain = 30 - ((Date.now() / 1000) % 30);
    if (remain < 3) await sleep((remain + 1) * 1000);
    log("nhập mã 2FA");
    await totp.fill(generateTOTP(acct.twoFactorSecret));
    await randomDelay(1000, 2000);
    await page.click("#totpNext");
    await randomDelay(3000, 5000);
  } else if (page.url().includes("/challenge")) {
    if (!acct.recoveryEmail) throw new Error("Google đòi xác minh nhưng Excel không có mail khôi phục (cột D)");
    log("xác minh bằng mail khôi phục");
    // Lựa chọn thứ 3 trong danh sách xác minh = "Confirm your recovery email" (như script GPM gốc).
    await page.locator(xp('//ul[@class="Dl08I"]/li[3]')).click({ timeout: 10000 });
    await randomDelay(3000, 5000);
    const input = page.locator("#knowledge-preregistered-email-response");
    await input.fill(acct.recoveryEmail, { timeout: 15000 });
    await randomDelay(1000, 2000);
    await input.press("Enter");
    await randomDelay(3000, 5000);
  }

  await randomDelay(5000, 8000);
  // Không tin vào URL ngay sau thao tác — vào lại Studio rồi mới kết luận.
  await page.goto("https://studio.youtube.com", { waitUntil: "domcontentloaded", timeout: 60000 });
  await randomDelay(2000, 3000);
  if (!isLoggedInUrl(page.url())) throw new Error(`chưa đăng nhập được (đang ở ${page.url().slice(0, 80)})`);
}

/**
 * Mỗi phần tử của profiles phải có `account` ({email,password,recoveryEmail,twoFactorSecret}) — lấy từ cột tk của Sheet.
 * @param {{gpmHost:string, profiles:{id:string,name:string,account:object}[], concurrency?:number, onLog?:Function, onResult?:Function}} o
 */
export async function runLogin(o) {
  const log = o.onLog || console.log;
  if (!o.profiles?.length) throw new Error("Chưa chọn kênh nào");
  return forEachProfile({
    gpmHost: o.gpmHost, profiles: o.profiles, concurrency: o.concurrency, log, onResult: o.onResult,
    work: async (page, p, plog) => {
      if (!p.account) throw new Error("kênh chưa có thông tin tài khoản (cột tk)");
      await loginOne(page, p.account, plog);
      return "đã đăng nhập";
    },
  });
}

// ============================================================================
// Mở Studio > Content > lọc theo Visibility
// ============================================================================

// checkboxLabelId: "checkbox-label-2" = Draft (lên lịch), "checkbox-label-4" = Scheduled (đổi thumb) — như script gốc.
async function openFilteredContent(page, checkboxLabelId) {
  await page.goto("https://studio.youtube.com", { waitUntil: "domcontentloaded", timeout: 60000 });
  await randomDelay(2000, 3000);
  try {
    await page.waitForSelector("#menu-item-1", { timeout: 30000 });
  } catch {
    throw new Error("không thấy menu Studio — profile có thể chưa đăng nhập");
  }
  await page.click("#menu-item-1");
  await randomDelay(1000, 2000);
  await page.click("#text-input");
  await randomDelay(1000, 2000);
  await page.click('tp-yt-paper-item[test-id*="VISIBILITY"]');
  await randomDelay(1000, 2000);
  await page.click(`#${checkboxLabelId}`);
  await randomDelay(1000, 2000);
  await page.click("#apply-button");
  await randomDelay(2000, 3000);
}

// ============================================================================
// 2. AUTO CHANGE THUMB
// ============================================================================

const THUMB_EXTS = [".jpg", ".jpeg", ".png"];
function findThumbFile(folder, title) {
  for (const ext of THUMB_EXTS) {
    const f = path.join(folder, `${title}${ext}`);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

async function changeThumbsOne(page, o, p, log) {
  const filterId = "checkbox-label-4";
  await openFilteredContent(page, filterId);

  let done = 0, skipped = 0, failed = 0;
  const numVideos = p.numVideos || o.numVideos;
  for (let i = 0; i < numVideos; i++) {
    checkCancelled();
    const row = page.locator(xp(`(//a[@id='video-title'])[${i + 1}]`));
    if (!(await row.count())) { log(`hết video ở vị trí ${i + 1}, dừng`); break; }

    // Tên file thumbnail = tên video (chuẩn hoá NFC) — đúng quy ước của script gốc.
    const title = ((await row.innerText().catch(() => "")) || "").normalize("NFC").trim();
    const thumb = title ? findThumbFile(p.thumbFolder || o.thumbFolder, title) : null;
    if (!thumb) {
      skipped++;
      log(`⚠️ video ${i + 1} "${title.slice(0, 40)}": không có ảnh cùng tên trong thư mục thumbnail — bỏ qua`);
      continue;
    }

    try {
      log(`video ${i + 1}/${numVideos}: ${title.slice(0, 50)}`);
      await row.click();
      await randomDelay(1000, 2000);

      const url = ((await page.locator(xp(`//*[@id="details"]//a[@target="_blank" and contains(@href,'https://youtu.be')]`)).first().innerText({ timeout: 15000 }).catch(() => "")) || "").trim();

      await page.locator(xp("//input[@type='file']")).first().setInputFiles(thumb);
      await randomDelay(3000, 4000);
      const io = pageIo(page);
      const monetized = !!(p.monetized ?? o.monetized);
      const max = maxNextClicks({ monetized });
      // Tới bước "Yếu tố video" (nơi có nút Nhập từ video) rồi gắn end screen.
      const toElements = await clickNextUntil(io, { isTarget: async () => await io.visible("#import-from-video-button"), maxSteps: max, label: "bước Yếu tố video", log });
      if (!toElements.reached) throw new Error(walkError(toElements, "bước Yếu tố video", { monetized }));
      await page.click("#import-from-video-button");
      await randomDelay(1000, 2000);
      const card = Math.floor(Math.random() * 6) + 1; // chọn ngẫu nhiên 1 trong 6 card
      await page.click(xp(`//div[@id='cards-row']/div[contains(@class,'card')][${card}]`));
      await randomDelay(1000, 2000);
      await page.click("#save-button");
      await randomDelay(1000, 2000);
      // Tới nút Xong: bấm Next cho tới khi nút Xong hiện và dùng được (kênh BKT có thêm bước, nên số lần Next khác nhau).
      const toDone = await clickNextUntil(io, { isTarget: async () => (await io.visible("#done-button")) && (await io.enabled("#done-button")), maxSteps: max, label: "nút Xong", log });
      log(`   ${toElements.clicks + toDone.clicks} lần Next · ${[...toElements.steps, ...toDone.steps].join(" → ") || "(không rõ bước)"}`);
      if (!toDone.reached) throw new Error(walkError(toDone, "nút Xong", { monetized }));
      await page.click("#done-button");
      await randomDelay(1000, 2000);
      const closeBtn = page.locator('#close-button[slot="secondary-footer"]');
      await closeBtn.waitFor({ timeout: 30000 });
      await closeBtn.click();
      await randomDelay(2000, 3000);

      done++;
      if (o.linksFile && url) appendRowsToExcel(o.linksFile, [[url, p.name, title]]);
    } catch (err) {
      failed++;
      log(`❌ video ${i + 1}: ${err.message.split("\n")[0]}`);
      // Đang kẹt trong dialog chỉnh sửa — nạp lại danh sách để làm tiếp video sau.
      await openFilteredContent(page, filterId).catch(() => {});
    }
  }

  log(`đã đổi thumbnail ${done} video, bỏ qua ${skipped}, lỗi ${failed}`);
  if (failed > 0 && done === 0) throw new Error(`đổi thumbnail thất bại cả ${failed} video`);
  return `đổi ${done} thumbnail` + (skipped ? `, bỏ qua ${skipped}` : "") + (failed ? `, lỗi ${failed}` : "");
}

/**
 * Thư mục thumbnail lấy theo từng kênh (p.thumbFolder); o.thumbFolder chỉ là dự phòng.
 * @param {{gpmHost:string, profiles:{id:string,name:string,thumbFolder?:string}[], thumbFolder?:string, numVideos?:number, linksFile?:string, concurrency?:number, onLog?:Function, onResult?:Function}} o
 */
export async function runChangeThumb(o) {
  const log = o.onLog || console.log;
  if (!o.profiles?.length) throw new Error("Chưa chọn kênh nào");
  const opts = { ...o, numVideos: Math.max(1, parseInt(o.numVideos, 10) || 8) };

  return forEachProfile({
    gpmHost: o.gpmHost, profiles: o.profiles, concurrency: o.concurrency, log, onResult: o.onResult,
    work: (page, p, plog) => {
      const folder = p.thumbFolder || o.thumbFolder;
      if (!folder || !fs.existsSync(folder)) throw new Error(`không thấy thư mục thumbnail${folder ? `: ${folder}` : ""}`);
      return changeThumbsOne(page, opts, p, plog);
    },
  });
}

// ============================================================================
// 3. AUTO SCHEDULE
// ============================================================================

async function scheduleOne(page, o, p, log) {
  const numDays = p.numDays || o.numDays;
  const days = buildScheduleDays(numDays, p.startDate || o.startDate);
  const timeSlots = p.timeSlots || o.timeSlots || [];
  if (!timeSlots.length) throw new Error("kênh chưa có giờ đăng (cột Giờ đăng)");
  const perDay = timeSlots.length;
  const wanted = numDays * perDay;

  await openFilteredContent(page, "checkbox-label-2");
  const total = await page.locator(xp('//*[@id="row-container"]/div[3]/div/div')).count();
  log(`có ${total} video nháp, cần lên lịch ${wanted} (${numDays} ngày × ${perDay} khung giờ)`);
  if (total === 0) throw new Error("không có video nháp (Draft) nào để lên lịch");
  const count = Math.min(total, wanted);
  if (total < wanted) log(`⚠️ chỉ đủ video cho ${count}/${wanted} lượt`);

  for (let i = 0; i < count; i++) {
    checkCancelled();
    const day = days[Math.floor(i / perDay)];
    const time = timeSlots[i % perDay];
    const idx = total - i;      // vị trí video trong danh sách (đi từ cuối lên, như script gốc)
    const nth = i + 1;          // thứ tự panel đã mở rộng

    log(`video ${nth}/${count}: ${day} ${time}`);
    await page.click(xp(`(//*[@id="row-container"]/div[1]/ytcp-checkbox-lit/div)[${idx}]`));
    await randomDelay(1000, 2000);
    await page.hover(xp(`(//*[@id="row-container"]/div[3]/div/div/span)[${idx}]`));
    await randomDelay(1000, 2000);
    await page.click(xp(`(//*[@id="row-container"]/div[3]/div/div/span)[${idx}]`));
    await randomDelay(1000, 2000);
    await page.click(xp(`(//*[@id='second-container-expand-button'])[${nth}]`));
    await randomDelay(1000, 2000);

    await page.locator(xp(`//*[@id="input-${i * 2 + 1}"]/input`)).fill(time);
    await randomDelay(500, 1000);
    await page.click(xp(`(//*[@id="datepicker-trigger"]/ytcp-dropdown-trigger)[${nth}]`));
    await randomDelay(1000, 2000);
    await page.locator(xp(`//*[@id="input-${i * 2 + 2}"]/input`)).fill(day);
    await randomDelay(1000, 2000);
    await page.click(xp(`(//button[@aria-label="Schedule"])[${nth}]`));
    await randomDelay(1000, 2000);
    // Kênh BKT: sau khi bấm Schedule có thể hiện hộp thoại chặn (chưa rõ là hộp thoại nào). Không đoán nút để bấm:
    // đọc nguyên văn hộp thoại rồi dừng với thông báo rõ ràng, để lần sau biết chính xác bước nào chặn.
    if (p.monetized ?? o.monetized) {
      const dlg = await page.$(DIALOG_OPEN);
      if (dlg && (await dlg.isVisible().catch(() => false))) {
        const text = ((await dlg.innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim().slice(0, 200);
        throw new Error(`kênh BKT: có hộp thoại chặn sau khi bấm Schedule — "${text || "(không đọc được nội dung)"}". Hãy xử lý tay một lần rồi chạy lại.`);
      }
    }
  }
  log(`đã lên lịch ${count} video`);
  return `lên lịch ${count} video`;
}

/**
 * Giờ đăng: mỗi kênh có thể có `postTimes` riêng; không có thì dùng `o.postTimes` chung.
 * Nhận 24h ("8:00, 18:30") hoặc AM/PM ("8:00 AM; 6:30 PM"), tự đổi sang dạng ô giờ của Studio.
 * @param {{gpmHost:string, profiles:{id:string,name:string,postTimes?:string}[], postTimes?:string, numDays?:number, startDate?:string, concurrency?:number, onLog?:Function, onResult?:Function}} o
 */
export async function runSchedule(o) {
  const log = o.onLog || console.log;
  if (!o.profiles?.length) throw new Error("Chưa chọn kênh nào");
  const opts = { ...o, numDays: Math.max(1, parseInt(o.numDays, 10) || 1) };
  const profiles = o.profiles.map((p) => {
    const own = typeof p.postTimes === "string" && p.postTimes.trim() ? p.postTimes : o.postTimes;
    const { times, invalid } = splitPostTimes(own);
    if (invalid.length) throw new Error(`giờ đăng không đọc được: ${invalid.map((x) => `"${x}"`).join(", ")}`);
    return { ...p, timeSlots: times.map(toStudioTime) };
  });

  return forEachProfile({
    gpmHost: o.gpmHost, profiles, concurrency: o.concurrency, log, onResult: o.onResult,
    work: (page, p, plog) => scheduleOne(page, opts, p, plog),
  });
}
