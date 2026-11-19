// Đi qua các bước của hộp thoại chỉnh sửa video trong YouTube Studio:
//   kênh thường:  Chi tiết -> Yếu tố video -> Kiểm tra -> Chế độ hiển thị
//   kênh BKT:     Chi tiết -> KIẾM TIỀN -> Yếu tố video -> Kiểm tra -> Chế độ hiển thị
// Kênh đã bật kiếm tiền (BKT) có thêm bước, nên bấm "Next" một số lần cố định (đúng cho kênh thường) sẽ
// kẹt giữa chừng ở kênh BKT.
//
// Thay vì đếm số lần bấm, bấm Next lặp lại cho tới khi THẤY dấu hiệu của bước đích, có trần số lần để không
// lặp vô hạn. Mỗi bước đi qua được ghi log, và nếu Next bị khoá (bước bắt buộc điền, vd bảng đánh giá phù hợp
// với nhà quảng cáo) thì dừng ngay với thông báo rõ ràng thay vì treo tới hết thời gian chờ.
//
// LƯU Ý: các selector ở đây chưa được kiểm chứng trên một kênh BKT thật.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const NEXT = "#next-button";

/**
 * Bấm Next cho tới khi `isTarget()` trả true.
 * @param {object} io  { click(sel), visible(sel), enabled(sel), step(): Promise<string>, wait(ms) }
 * @param {object} o   { isTarget, maxSteps, label, log, pause, enableTries }
 * @returns {Promise<{ reached: boolean, clicks: number, steps: string[], reason: ""|"max"|"no-next"|"disabled" }>}
 */
export async function clickNextUntil(io, { isTarget, maxSteps = 8, log = () => {}, label = "bước đích", pause = 1200, enableTries = 5 } = {}) {
  const steps = [];
  let clicks = 0;
  const fail = (reason, msg) => { log(`⚠️ ${msg} — các bước đã qua: ${steps.join(" → ") || "(không rõ)"}`); return { reached: false, clicks, steps, reason }; };

  for (;;) {
    if (await isTarget()) return { reached: true, clicks, steps, reason: "" };
    if (clicks >= maxSteps) return fail("max", `đã bấm Next ${clicks} lần mà chưa tới ${label}`);
    if (!(await io.visible(NEXT))) return fail("no-next", `không còn nút Next trước khi tới ${label}`);

    // Next có thể khoá ngắn lúc bước vừa tải: chờ một chút trước khi kết luận là bị khoá thật.
    let ready = await io.enabled(NEXT);
    for (let i = 0; !ready && i < enableTries; i++) { await io.wait(800); ready = await io.enabled(NEXT); }
    if (!ready) return fail("disabled", `nút Next đang bị khoá, không qua được bước hiện tại để tới ${label}`);

    let name = "";
    try { name = await io.step(); } catch { /* không đọc được tên bước thì thôi */ }
    steps.push(name || `bước ${clicks + 1}`);
    await io.click(NEXT);
    clicks++;
    await io.wait(pause);
  }
}

/** Số lần Next TỐI ĐA cho phép: kênh BKT có thêm bước Kiếm tiền (và đôi khi bước phụ) nên được nhiều hơn. */
export function maxNextClicks({ monetized = false } = {}) {
  return monetized ? 8 : 5;
}

/** Thông báo lỗi cho người dùng khi không tới được bước đích. */
export function walkError(res, label, { monetized = false } = {}) {
  const where = res.steps.length ? ` (đã qua: ${res.steps.join(" → ")})` : "";
  const kind = monetized ? "kênh BKT" : "kênh thường";
  if (res.reason === "disabled") {
    return `không tới được ${label}: nút Next bị khoá${where}. ` +
      (monetized
        ? 'Kênh BKT thường bị khoá ở bước Kiếm tiền cho tới khi hoàn tất bảng đánh giá phù hợp với nhà quảng cáo — hãy làm tay bước đó một lần cho video này.'
        : "Bước hiện tại có thể bắt buộc điền thông tin; nếu kênh đã bật kiếm tiền, hãy bật \"Kênh BKT\" trong Sheet.");
  }
  if (res.reason === "no-next") return `không tới được ${label}: hết nút Next${where} (${kind})`;
  return `không tới được ${label} sau ${res.clicks} lần bấm Next${where} (${kind})` +
    (monetized ? "" : '; nếu kênh đã bật kiếm tiền (có thêm bước) hãy bật "Kênh BKT" trong Sheet');
}

/** Tạo `io` từ một Playwright page (tách ra để phần logic ở trên test được mà không cần trình duyệt). */
export function pageIo(page, { delay = sleep } = {}) {
  const el = (sel) => page.$(sel);
  return {
    click: (sel) => page.click(sel),
    // "thấy" = có trong DOM VÀ đang hiển thị (nút Next ẩn ở bước cuối vẫn còn trong DOM).
    visible: async (sel) => { const e = await el(sel); return !!e && (await e.isVisible().catch(() => false)); },
    enabled: async (sel) => {
      const e = await el(sel);
      if (!e) return false;
      return e.evaluate((n) => !(n.disabled || n.hasAttribute("disabled") || n.getAttribute("aria-disabled") === "true")).catch(() => true);
    },
    wait: delay,
    // Tên bước hiện tại: nhãn của bước đang được chọn trên thanh tiến trình của hộp thoại.
    step: async () => {
      const e = await el('[id^="step-badge-"][selected], [id^="step-badge-"][aria-selected="true"]');
      return e ? ((await e.innerText().catch(() => "")) || "").trim().replace(/\s+/g, " ").slice(0, 40) : "";
    },
  };
}
