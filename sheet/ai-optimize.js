// Step "AI title + thumbnail" của flow Kênh, chạy SAU khi tải xong và TRƯỚC khi render:
//   1) AI đọc title cũ + mô tả cũ  -> viết title mới chuẩn SEO, thu hút hơn
//   2) AI lấy title mới + thumbnail cũ -> vẽ lại thumbnail mới cùng phong cách
// Upload sau đó dùng title mới (customTitle) và thumbnail mới (cùng tên file thumbnail cũ).
//
// Nguyên tắc: AI chỉ là bước phụ. Thiếu khóa, thiếu đăng nhập Flow, hết hạn mức, treo, lỗi bất kỳ -> giữ title/thumbnail GỐC,
// video vẫn render và upload bình thường. Hàm này KHÔNG BAO GIỜ ném lỗi.
// Mọi phụ thuộc (khóa, Gemini, vẽ ảnh, đĩa) được bơm vào để test không đụng mạng/GPM thật.

const clip = (s, n) => String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

function withTimeout(promise, ms, label) {
  let t;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${label} quá thời gian chờ`)), ms); t.unref?.(); }),
  ]).finally(() => clearTimeout(t));
}

/** Prompt vẽ lại thumbnail: giữ phong cách ảnh cũ (và hình mẫu nếu có), đổi nội dung theo title mới.
 * @param {string} newTitle - Title mới của video
 * @param {string} [customRule] - Rule tùy chỉnh từ người dùng (aiThumbRule)
 * @param {boolean} [hasSamples] - Có hình mẫu thumbnail ngoài reference không
 */
// AI vẽ hết, title đưa vào để model tự viết chữ trên ảnh. Ảnh mẫu (nếu có) chỉ là GỢI Ý bố cục/phong cách.
// Lỗi hay gặp: model tự thêm một dòng phụ đề/bản dịch tiếng Anh ở dưới -> cấm rõ, chỉ dùng đúng ngôn ngữ của title.
export function buildThumbPrompt(newTitle, customRule = "", hasSamples = false) {
  const lines = [
    "Create a NEW YouTube thumbnail image (16:9) for a video titled:",
    `"${clip(newTitle, 120)}"`,
  ];
  if (hasSamples) {
    // Có ảnh mẫu: dùng làm gợi ý bố cục + phong cách; nhân vật lấy từ ảnh gốc (first reference). Không copy y hệt.
    lines.push(
      "",
      "Use the sample reference images (all images after the first) only as a GUIDE for the overall layout, composition, color palette and visual style — e.g. where the text block and the character sit. Follow that style but decide the details yourself.",
      "The FIRST reference image is the original scene: take the main character/subject from it. Do not copy the original's composition; arrange it in the sample style instead.",
      "Make a fresh thumbnail in the same family as the samples, not an exact duplicate of any image.",
    );
  } else {
    lines.push(
      "",
      "Keep the same art style, color palette, character design and lighting as the reference image; re-stage the scene to match the title.",
    );
  }
  if (customRule) {
    lines.push("", "Also follow these style requirements from the user:", `"${clip(customRule, 400)}"`);
  }
  // Chữ: để model tự viết theo title, NHƯNG chỉ đúng ngôn ngữ của title. Cấm thêm dòng tiếng Anh/bản dịch/phụ đề.
  lines.push(
    "",
    "Any on-image text must be ONLY in the same language as the title above. Do NOT add any English text, translation, subtitle, caption line, watermark or extra wording that is not in the title.",
    "16:9, high contrast, eye-catching, readable at small size.",
  );
  return lines.join("\n");
}

/**
 * @param {object} o
 * @param {{name:string, gpmProfileId?:string, aiTitleRule?:string, aiThumbRule?:string, aiThumbSamples?:string[]}} o.channel
 * @param {string} o.title            title gốc
 * @param {string} [o.descriptionPath] file mô tả gốc (.description do yt-dlp ghi)
 * @param {string} [o.thumbPath]      thumbnail gốc (.jpg cạnh video)
 * @param {object} o.deps  { getKey(name), generateTitle(opts), makeThumb({channel,title,referencePath,outPath,customRule,sampleImages}), exists, readText, rename, copy, unlink, log }
 * @returns {Promise<{ title: string, thumbChanged: boolean, skipped?: string }>}  title rỗng = giữ title gốc
 */
export async function optimizeVideo({ channel, title, descriptionPath = "", thumbPath = "", deps, timeouts = {} }) {
  const { getKey, generateTitle, makeThumb, exists = () => false, readText = () => "", rename = () => {}, copy = () => {}, unlink = () => {}, log = () => {}, normalizeThumb } = deps || {};
  // Runner truyền kênh với trường `sheetName` (còn form/UI dùng `name`): nhận cả hai, không để tên rỗng làm mất khóa.
  const name = clip(channel?.sheetName ?? channel?.name, 100);
  const say = (m) => { try { log(`[${name}] ${m}`); } catch { /* log lỗi không được phá bước này */ } };
  const out = { title: "", thumbChanged: false };

  // Lấy rule và hình mẫu từ config kênh
  const titleRule = clip(channel?.aiTitleRule, 500);
  const thumbRule = clip(channel?.aiThumbRule, 500);
  const thumbSamples = Array.isArray(channel?.aiThumbSamples) ? channel.aiThumbSamples.filter((s) => typeof s === "string" && s.trim()) : [];

  try {
    const apiKey = typeof getKey === "function" ? getKey(name) : "";
    if (!apiKey) { say("AI: kênh chưa có khóa AI → dùng title/thumbnail gốc."); return { ...out, skipped: "no-key" }; }

    let description = "";
    try { if (descriptionPath && exists(descriptionPath)) description = clip(readText(descriptionPath), 1500); } catch { /* không đọc được mô tả thì viết theo title */ }
    try { if (descriptionPath && exists(descriptionPath)) unlink(descriptionPath); } catch { /* file thừa, kệ */ }

    // ---- 1) title mới (có thể dùng customRule)
    let newTitle = "";
    try {
      const r = await withTimeout(generateTitle({ apiKey, fileTitle: title, description, original: title, channelName: name, retries: 3, customRule: titleRule }), timeouts.title ?? 150_000, "AI viết title");
      if (r && r.ok && r.title && r.title.trim() !== String(title ?? "").trim()) newTitle = r.title.trim();
      else say(`AI không viết được title mới (${(r && (r.error || r.code)) || "title trùng bản gốc"}) → giữ title gốc.`);
    } catch (e) { say(`AI viết title lỗi (${clip(e?.message, 120)}) → giữ title gốc.`); }
    if (!newTitle) return { ...out, skipped: "no-title" };
    out.title = newTitle;
    say(`AI viết title: "${newTitle}"`);

    // ---- 2) thumbnail mới (cần ảnh cũ làm mẫu phong cách, có thể thêm hình mẫu + rule)
    if (!thumbPath || !exists(thumbPath)) { say("Không có thumbnail gốc để làm mẫu → giữ thumbnail gốc."); return out; }
    if (typeof makeThumb !== "function") return out;
    const tmp = thumbPath.replace(/\.[^.]+$/, ".ai-new.jpg"), backup = thumbPath.replace(/\.[^.]+$/, ".orig.jpg");
    try {
      await withTimeout(makeThumb({ channel, title: newTitle, referencePath: thumbPath, outPath: tmp, customRule: thumbRule, sampleImages: thumbSamples }), timeouts.thumb ?? 300_000, "AI vẽ thumbnail");
      if (!exists(tmp)) throw new Error("không thấy ảnh mới được tạo");
      // Đưa về đúng cỡ thumbnail YouTube (1280x720). Lỗi ở bước này không được làm mất ảnh vừa vẽ: giữ nguyên ảnh gốc của AI.
      if (typeof normalizeThumb === "function") { try { await normalizeThumb(tmp); } catch (e) { say(`Không chuẩn hóa được cỡ ảnh (${clip(e?.message, 80)}) → dùng ảnh AI nguyên bản.`); } }
      try { copy(thumbPath, backup); } catch { /* không backup được thì vẫn thay */ }
      rename(tmp, thumbPath); // cùng tên thumbnail cũ → upload tự khớp theo title
      out.thumbChanged = true;
      say("AI vẽ lại thumbnail xong (bản gốc lưu là .orig.jpg).");
    } catch (e) {
      try { if (exists(tmp)) unlink(tmp); } catch { /* ignore */ }
      say(`AI vẽ thumbnail lỗi (${clip(e?.message, 160)}) → giữ thumbnail gốc, vẫn dùng title mới.`);
    }
    return out;
  } catch (e) {
    say(`AI lỗi bất ngờ (${clip(e?.message, 120)}) → dùng bản gốc.`);
    return { title: "", thumbChanged: false, skipped: "error" };
  }
}
