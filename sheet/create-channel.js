// Tự động tạo channel YouTube: chuyển thể từ script GPM 02.auto_create_channel.
// Hai phần như script gốc: (1) Cài đặt kênh (tag, nội dung dành cho trẻ em, mặc định khi tải lên),
// (2) Tuỳ chỉnh kênh (tên, handle, mô tả) rồi Xuất bản.
//
// LƯU Ý: selector chép từ script GPM cũ, CHƯA kiểm chứng với giao diện YouTube Studio hiện tại.
// Script gốc có khai báo thư mục banner/avatar nhưng KHÔNG có bước tải ảnh nào, nên bản này cũng
// chưa tải avatar/banner.

import { forEachProfile, loginOne, checkCancelled, randomDelay } from "./youtube-automation.js";

const xp = (s) => `xpath=${s.trim()}`;
const T = 30000; // thời gian chờ tối đa cho mỗi thao tác (ms)

/** plan: { title, description, videoDescription, tags, handle } */
export async function createChannelOne(page, plan, log, wait = randomDelay) {
  if (!plan?.title) throw new Error("thiếu tên kênh");

  await page.goto("https://studio.youtube.com", { waitUntil: "domcontentloaded", timeout: 60000 });
  await wait(2000, 3000);

  // ===== Phần 1: Cài đặt kênh =====
  log("cài đặt kênh (tag, mặc định tải lên)");
  await page.click("#settings-item", { timeout: T });
  await wait(1000, 2000);
  await page.click("#channel", { timeout: T });
  await wait(1000, 2000);
  if (plan.tags) {
    await page.locator("#text-input").first().fill(plan.tags, { timeout: T });
    await wait(1000, 2000);
  }
  await page.click(xp('//*[@id="tabsContent"]/tp-yt-paper-tab[2]'), { timeout: T }); // tab Nâng cao
  await wait(1000, 2000);
  await page.click(xp('(//*[@id="radioContainer"])[2]'), { timeout: T });              // không dành cho trẻ em
  await wait(1000, 2000);
  await page.click(xp('//*[@id="uploads"]/span'), { timeout: T });                     // mặc định khi tải lên
  await wait(1000, 2000);
  if (plan.videoDescription) {
    await page.locator(xp('//*[@id="description-textarea"]/div/textarea')).fill(plan.videoDescription, { timeout: T });
    await wait(1000, 2000);
  }
  await page.click("#privacy-select", { timeout: T });
  await wait(1000, 2000);
  await page.click("#text-item-2", { timeout: T });                                    // chế độ Không công khai
  await wait(1000, 2000);
  if (plan.tags) {
    // Script gốc điền tag lần hai vào ô #text-input của mục mặc định tải lên (ô sau cùng trên trang).
    await page.locator("#text-input").last().fill(plan.tags, { timeout: T });
    await wait(1000, 2000);
  }
  await page.click("#submit-button", { timeout: T });                                  // Lưu
  await wait(5000, 8000);

  // ===== Phần 2: Tuỳ chỉnh kênh =====
  log("tuỳ chỉnh kênh (tên, handle, mô tả)");
  await page.click("#menu-paper-icon-item-7", { timeout: T });                         // Tuỳ chỉnh kênh
  await wait(4000, 6000);
  await page.locator(xp('(//*[@id="child-input"]/input)[1]')).fill(plan.title, { timeout: T });
  await wait(1000, 2000);
  if (plan.handle) {
    await page.locator(xp('//*[@id="child-input"]/div/input')).fill(plan.handle, { timeout: T });
    await wait(3000, 4000);
  }
  if (plan.description) {
    await page.locator(xp('//*[@id="textbox"]')).first().fill(plan.description, { timeout: T });
    await wait(1000, 2000);
  }
  await page.click("#publish-button", { timeout: T });                                 // Xuất bản
  await wait(4000, 6000);
}

/**
 * Chạy tạo channel trên các profile. Mỗi phần tử profiles cần: id, name, plan,
 * và `account` (tuỳ chọn): có thì đăng nhập trước nếu profile chưa đăng nhập.
 */
export async function runCreateChannel(o) {
  const log = o.onLog || console.log;
  if (!o.profiles?.length) throw new Error("Chưa chọn kênh nào");
  return forEachProfile({
    gpmHost: o.gpmHost, profiles: o.profiles, concurrency: o.concurrency || 1, log, onResult: o.onResult,
    work: async (page, p, plog) => {
      if (p.account) await loginOne(page, p.account, plog); // đã đăng nhập sẵn thì loginOne tự bỏ qua
      checkCancelled();
      await createChannelOne(page, p.plan, plog);
      return "đã tạo channel";
    },
  });
}
