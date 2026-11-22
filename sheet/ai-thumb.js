// Vẽ lại thumbnail bằng Google Flow (Veo3) NGAY TRONG profile GPM của kênh (không mở Chrome riêng).
// Nối vào profile qua CDP bằng puppeteer-core, mở một tab riêng cho Flow rồi trả lại: KHÔNG đóng profile,
// KHÔNG đụng các tab Studio đang chạy. Người dùng tự đăng nhập Flow một lần trong profile; chưa đăng nhập thì ném lỗi rõ ràng.
// Mọi phụ thuộc được bơm vào để test không cần GPM/Flow thật.

import { buildThumbPrompt } from "./ai-optimize.js";

const MIME = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
const extOf = (p) => (String(p).match(/\.[^.\\/]+$/) || [""])[0].toLowerCase();

/** Chuyển data URI thành buffer + metadata để gửi lên Flow */
function dataUriToRef(dataUri, index) {
  const m = dataUri.match(/^data:(image\/[^;]+);base64,(.+)$/);
  if (!m) return null;
  const mime = m[1];
  const ext = mime === "image/png" ? ".png" : mime === "image/webp" ? ".webp" : ".jpg";
  const buffer = Buffer.from(m[2], "base64");
  return { buffer, mime, filename: `sample${index}${ext}` };
}

/**
 * @param {object} opts
 * @param {string} opts.gpmHost
 * @param {string} opts.profileId
 * @param {string} opts.title - Title mới để vẽ theo
 * @param {string} opts.referencePath - Đường dẫn thumbnail gốc
 * @param {string} opts.outPath - Đường dẫn lưu ảnh mới
 * @param {string} [opts.customRule] - Rule vẽ thumbnail từ người dùng (aiThumbRule)
 * @param {string[]} [opts.sampleImages] - Mảng hình mẫu (data URI hoặc URL)
 * @param {object} opts.deps
 */
export async function makeThumbViaProfile({ gpmHost, profileId, title, referencePath, outPath, customRule = "", sampleImages = [], deps }) {
  const { startProfile, connect, generate, writeFile, log = () => {}, model = "Nano Banana pro" } = deps;
  if (!profileId) throw new Error("kênh chưa có GPM Profile");
  const address = await startProfile(gpmHost, profileId);
  const browser = await connect(address);
  let lastError = "", needLogin = false;
  try {
    const send = (d) => {
      if (d?.step === "need_login") needLogin = true;
      if (d?.error) lastError = String(d.error);
      else if (d?.message && d.step === "need_login") lastError = String(d.message);
    };
    const write = async (buffer) => { writeFile(outPath, buffer); return { filePath: outPath, size: buffer.length }; };

    // Chuẩn bị reference images: ảnh gốc + hình mẫu (nếu có)
    const referenceImages = [
      { filePath: referencePath, mime: MIME[extOf(referencePath)] || "image/jpeg", filename: "reference" + (extOf(referencePath) || ".jpg") },
    ];

    // Thêm hình mẫu từ config (data URI chuyển thành buffer, URL bỏ qua vì Flow không nhận URL trực tiếp)
    const validSamples = (sampleImages || []).filter((s) => s && typeof s === "string" && s.startsWith("data:image/"));
    for (let i = 0; i < validSamples.length && referenceImages.length < 4; i++) {
      const ref = dataUriToRef(validSamples[i], i + 1);
      if (ref) referenceImages.push(ref);
    }

    const r = await generate(
      browser,
      {
        prompt: buildThumbPrompt(title, customRule, validSamples.length > 0),
        model,
        aspectRatio: "16:9",
        outputCount: 1,
        referenceImages,
      },
      send, { write },
    );
    if (!r || !r.ok) {
      if (needLogin) throw new Error("profile chưa đăng nhập Google Flow — hãy mở profile này, vào flow.google.com và đăng nhập một lần");
      throw new Error(lastError.split("\n")[0].slice(0, 200) || "Flow không tạo được ảnh");
    }
  } finally {
    try { await browser.disconnect(); } catch { /* đã ngắt */ }
  }
  log(`đã vẽ thumbnail → ${outPath}`);
  return outPath;
}
