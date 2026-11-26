// Nối nhiều video đã render thành 1 video dài hơn trước khi upload.
// Tích hợp vào flow kênh Auto: render N video → đủ concatCount → nối → upload video nối.
//
// Config kênh:
//   concatCount: số video nối (0 hoặc 1 = không nối, mặc định 0)
//   concatUseThumbs: chèn thumbnail giữa các video (mặc định false)
//   concatThumbDuration: thời lượng thumbnail (giây, mặc định 3)
//
// Trạng thái video trong sheet (cột C):
//   "⏳ chờ nối 1/3" - video đã render, đang chờ đủ nhóm
//   "✅ ... · đã nối" - video nguồn sau khi nối xong (giữ lại để tracking)

import path from "path";
import fs from "fs";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// FFmpeg path - giống concat-video.js
const FFMPEG_PATH = path.join(__dirname, "..", "bin", "ffmpeg.exe");
const FFPROBE_PATH = path.join(__dirname, "..", "bin", "ffprobe.exe");
const SILENCE_PATH = fs.existsSync(path.join(__dirname, "..", "bin", "silence.mp3"))
  ? path.join(__dirname, "..", "bin", "silence.mp3")
  : path.join(__dirname, "..", "silence.mp3");

// Trạng thái chờ nối
export const CONCAT_WAIT = "⏳ chờ nối";
export const CONCAT_DONE_SUFFIX = "· đã nối";

/**
 * Kiểm tra video có đang chờ nối không (đọc từ uploadStatus - cột C)
 */
export function isConcatWaiting(uploadStatus) {
  return String(uploadStatus ?? "").startsWith(CONCAT_WAIT);
}

/**
 * Tạo text trạng thái chờ nối: "⏳ chờ nối 1/3"
 */
export function concatWaitText(index, total) {
  return `${CONCAT_WAIT} ${index}/${total}`;
}

/**
 * Tạo text trạng thái đã nối: "✅ 2025-01-15 10:30 · đã nối"
 */
export function concatDoneText(originalUploadStatus) {
  const base = String(originalUploadStatus ?? "").trim();
  if (base.includes(CONCAT_DONE_SUFFIX)) return base;
  return base ? `${base} ${CONCAT_DONE_SUFFIX}` : CONCAT_DONE_SUFFIX;
}

/**
 * Lấy metadata video bằng ffprobe
 */
export function probeVideo(videoPath) {
  return new Promise((resolve, reject) => {
    const args = ["-v", "quiet", "-print_format", "json", "-show_streams", videoPath];
    const proc = spawn(FFPROBE_PATH, args);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => { stdout += d; });
    proc.stderr.on("data", (d) => { stderr += d; });
    proc.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffprobe failed: ${stderr}`));
      try {
        const data = JSON.parse(stdout);
        const videoStream = (data.streams || []).find((s) => s.codec_type === "video");
        const audioStream = (data.streams || []).find((s) => s.codec_type === "audio");
        if (!videoStream) return reject(new Error("Không tìm thấy video stream"));
        resolve({
          width: videoStream.width,
          height: videoStream.height,
          frame_rate: videoStream.r_frame_rate || "30",
          pix_fmt: videoStream.pix_fmt || "yuv420p",
          audio_codec: audioStream?.codec_name || "aac",
          sample_rate: audioStream?.sample_rate || "44100",
          audio_channels: audioStream?.channels || 2,
          audio_bitrate: audioStream?.bit_rate || "128000",
        });
      } catch (e) {
        reject(new Error(`Không parse được ffprobe output: ${e.message}`));
      }
    });
    proc.on("error", reject);
  });
}

/**
 * Tạo video ngắn từ thumbnail (để chèn giữa các video)
 * @param {string} thumbPath - Đường dẫn ảnh thumbnail
 * @param {object} metadata - Metadata từ probeVideo
 * @param {string} outputPath - Đường dẫn video output
 * @param {number} duration - Thời lượng (giây)
 */
export function createVideoFromThumb(thumbPath, metadata, outputPath, duration = 3) {
  return new Promise((resolve, reject) => {
    const audioBitrate = typeof metadata.audio_bitrate === "number"
      ? `${Math.round(metadata.audio_bitrate / 1000)}k`
      : String(metadata.audio_bitrate || "128k").replace(/\D*$/, "") + "k";

    const filter = `scale=${metadata.width}:${metadata.height}:force_original_aspect_ratio=decrease,pad=${metadata.width}:${metadata.height}:-1:-1:color=black`;

    const args = [
      "-y",
      "-loop", "1", "-i", thumbPath,
      "-i", SILENCE_PATH,
      "-t", String(duration),
      "-vf", filter,
      "-c:v", "libx264",
      "-pix_fmt", metadata.pix_fmt,
      "-r", metadata.frame_rate,
      "-c:a", metadata.audio_codec,
      "-ar", metadata.sample_rate,
      "-ac", String(metadata.audio_channels),
      "-b:a", audioBitrate,
      "-map", "0:v:0",
      "-map", "1:a:0",
      "-shortest",
      outputPath,
    ];

    const proc = spawn(FFMPEG_PATH, args);
    let stderr = "";
    proc.stderr.on("data", (d) => { stderr += d; });
    proc.on("close", (code) => {
      if (code !== 0) return reject(new Error(`Tạo video từ thumb thất bại: ${stderr.slice(-500)}`));
      resolve(outputPath);
    });
    proc.on("error", reject);
  });
}

/**
 * Nối nhiều video thành 1 bằng ffmpeg concat demuxer (-c copy, rất nhanh)
 * @param {string[]} videoPaths - Danh sách đường dẫn video theo thứ tự
 * @param {string} outputPath - Đường dẫn video output
 * @param {object} [options]
 * @param {string} [options.tempDir] - Thư mục chứa file tạm
 */
export function concatVideos(videoPaths, outputPath, options = {}) {
  return new Promise((resolve, reject) => {
    if (!videoPaths.length) return reject(new Error("Không có video để nối"));
    if (videoPaths.length === 1) {
      // Chỉ có 1 video: copy thẳng
      fs.copyFileSync(videoPaths[0], outputPath);
      return resolve(outputPath);
    }

    const tempDir = options.tempDir || path.dirname(outputPath);
    const listFile = path.join(tempDir, `concat_${Date.now()}.txt`);

    // Tạo file danh sách cho concat demuxer
    const listContent = videoPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
    fs.writeFileSync(listFile, listContent, "utf-8");

    const args = [
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", listFile,
      "-c", "copy",
      outputPath,
    ];

    const proc = spawn(FFMPEG_PATH, args);
    let stderr = "";
    proc.stderr.on("data", (d) => { stderr += d; });
    proc.on("close", (code) => {
      // Dọn file tạm
      try { fs.unlinkSync(listFile); } catch { /* ignore */ }
      if (code !== 0) return reject(new Error(`Nối video thất bại: ${stderr.slice(-500)}`));
      resolve(outputPath);
    });
    proc.on("error", (err) => {
      try { fs.unlinkSync(listFile); } catch { /* ignore */ }
      reject(err);
    });
  });
}

/**
 * Nối video có chèn thumbnail giữa các video
 * @param {Array<{videoPath: string, thumbPath?: string}>} items - Video + thumb tương ứng
 * @param {string} outputPath - Đường dẫn output
 * @param {object} [options]
 * @param {number} [options.thumbDuration=3] - Thời lượng thumbnail (giây)
 * @param {string} [options.tempDir] - Thư mục chứa file tạm
 */
export async function concatVideosWithThumbs(items, outputPath, options = {}) {
  const { thumbDuration = 3, tempDir = path.dirname(outputPath) } = options;

  if (!items.length) throw new Error("Không có video để nối");
  if (items.length === 1) {
    fs.copyFileSync(items[0].videoPath, outputPath);
    return outputPath;
  }

  // Lấy metadata từ video đầu tiên làm chuẩn
  const metadata = await probeVideo(items[0].videoPath);
  const tempFiles = [];
  const videosToConcat = [];

  try {
    for (let i = 0; i < items.length; i++) {
      // Thêm video gốc
      videosToConcat.push(items[i].videoPath);

      // Nếu không phải video cuối và có thumbnail của video SAU -> chèn thumbnail
      if (i < items.length - 1) {
        const nextThumb = items[i + 1].thumbPath;
        if (nextThumb && fs.existsSync(nextThumb)) {
          const tempVideo = path.join(tempDir, `thumb_${Date.now()}_${i}.mp4`);
          await createVideoFromThumb(nextThumb, metadata, tempVideo, thumbDuration);
          videosToConcat.push(tempVideo);
          tempFiles.push(tempVideo);
        }
      }
    }

    await concatVideos(videosToConcat, outputPath, { tempDir });
    return outputPath;
  } finally {
    // Dọn file tạm
    for (const f of tempFiles) {
      try { fs.unlinkSync(f); } catch { /* ignore */ }
    }
  }
}

/**
 * Xử lý nối video cho một kênh sau khi render xong.
 * Gom các video đang "chờ nối" đủ số lượng → nối → trả về thông tin để upload.
 *
 * @param {object} params
 * @param {string} params.sheetName - Tên kênh
 * @param {number} params.concatCount - Số video cần nối (từ config kênh)
 * @param {boolean} [params.concatUseThumbs=false] - Có chèn thumbnail không
 * @param {number} [params.concatThumbDuration=3] - Thời lượng thumbnail
 * @param {Array<{url, rowIndex, uploadStatus, outputPath, title, thumbPath?}>} params.pendingVideos - Video đang chờ
 * @param {string} params.outputDir - Thư mục output của kênh
 * @param {string} [params.tempDir] - Thư mục tạm
 * @param {(msg: string) => void} [params.log] - Log function
 * @returns {Promise<{
 *   concatenated: Array<{outputPath: string, title: string, sourceVideos: Array<{url, rowIndex, outputPath}>}>,
 *   stillWaiting: Array<{url, rowIndex, waitIndex: number}>
 * }>}
 */
export async function processConcatQueue({
  sheetName,
  concatCount,
  concatUseThumbs = false,
  concatThumbDuration = 3,
  pendingVideos,
  outputDir,
  tempDir,
  log = () => {},
}) {
  const result = { concatenated: [], stillWaiting: [] };

  if (!concatCount || concatCount <= 1 || !pendingVideos.length) {
    return result;
  }

  // Sắp xếp theo thứ tự (rowIndex để đảm bảo thứ tự trong sheet)
  const sorted = [...pendingVideos].sort((a, b) => a.rowIndex - b.rowIndex);

  // Chia thành các nhóm đủ concatCount
  const groups = [];
  for (let i = 0; i < sorted.length; i += concatCount) {
    const group = sorted.slice(i, i + concatCount);
    if (group.length === concatCount) {
      groups.push(group);
    } else {
      // Chưa đủ: đánh dấu chờ
      group.forEach((v, idx) => {
        result.stillWaiting.push({ url: v.url, rowIndex: v.rowIndex, waitIndex: idx + 1 });
      });
    }
  }

  // Nối từng nhóm
  for (const group of groups) {
    const firstVideo = group[0];
    const concatOutputPath = path.join(outputDir, `${firstVideo.title}_concat.mp4`);

    try {
      log(`[${sheetName}] Nối ${group.length} video: ${firstVideo.title}...`);

      if (concatUseThumbs) {
        const items = group.map((v) => ({
          videoPath: v.outputPath,
          thumbPath: v.thumbPath,
        }));
        await concatVideosWithThumbs(items, concatOutputPath, {
          thumbDuration: concatThumbDuration,
          tempDir: tempDir || outputDir,
        });
      } else {
        await concatVideos(
          group.map((v) => v.outputPath),
          concatOutputPath,
          { tempDir: tempDir || outputDir }
        );
      }

      result.concatenated.push({
        outputPath: concatOutputPath,
        title: firstVideo.title, // Lấy title từ video đầu tiên
        thumbPath: firstVideo.thumbPath, // Thumbnail cũng từ video đầu
        sourceVideos: group.map((v) => ({
          url: v.url,
          rowIndex: v.rowIndex,
          outputPath: v.outputPath,
          title: v.title,
        })),
      });

      log(`[${sheetName}] Đã nối xong: ${path.basename(concatOutputPath)}`);
    } catch (err) {
      log(`[${sheetName}] Lỗi nối video: ${err.message}`);
      // Nếu nối lỗi, đẩy lại vào hàng chờ
      group.forEach((v, idx) => {
        result.stillWaiting.push({ url: v.url, rowIndex: v.rowIndex, waitIndex: idx + 1 });
      });
    }
  }

  return result;
}
