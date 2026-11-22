/**
 * Download & save generated Veo3 Flow images.
 * Adapted from phoma - `write` is injected so the caller decides where files go.
 */
import { createLogger } from './logger.js';
import { throwIfAborted } from './async-utils.js';
import { waitForVeo3FlowImageArtifacts } from './image-artifact-poll.js';
import { readImageArtifactBuffer } from './flow-page.js';

const log = createLogger('Veo 3');

/**
 * @param {object} input
 * @param {object} io - { read, write, poll } - write(buffer, {index, prompt}) must return saved file info
 */
export async function completeVeo3FlowImages(input, io = {}) {
  const read = io.read ?? readImageArtifactBuffer;
  const poll = io.poll ?? waitForVeo3FlowImageArtifacts;
  const write = io.write;
  if (typeof write !== 'function') {
    throw new Error('completeVeo3FlowImages requires io.write(buffer, meta)');
  }

  const { page, projectId, result, requestedCount, model, prompt, send, signal } = input;
  const expectedCount = Math.max(requestedCount, result.responseRowCount);
  const rows = new Map(result.rows.map((row) => [row.index, row]));
  const images = [];
  const failedImageIndexes = [];

  for (let index = 0; index < expectedCount; index += 1) {
    throwIfAborted(signal);
    const row = rows.get(index);
    if (row) {
      try {
        const artifacts = row.imageUrl
          ? [{ url: row.imageUrl, mediaId: row.mediaId }]
          : await poll({
              page,
              projectId,
              mediaId: row.mediaId,
              signal,
              send,
              progress: 80,
              message: `Đang chờ ảnh ${index + 1}/${expectedCount} sẵn sàng...`,
            });
        const artifact =
          artifacts.find((item) => item.mediaId === row.mediaId) ?? artifacts.find((item) => !item.mediaId);
        if (!artifact) throw new Error('Image URL pending');
        send({ step: 'downloading', progress: 85, message: `Đang tải ảnh ${index + 1}/${expectedCount}...` });
        const buffer = await read(page, artifact.url, signal);
        throwIfAborted(signal);
        const saved = await write(buffer, { index, prompt, model, projectId, mediaId: row.mediaId });
        const image = {
          ...saved,
          index,
          veo3MediaId: row.mediaId,
          veo3ProjectId: projectId,
        };
        images.push(image);
        send({
          step: 'image_done',
          progress: 85 + Math.round((10 * (index + 1)) / expectedCount),
          message: `Đã tạo ${images.length}/${expectedCount} ảnh...`,
          images: [image],
          imageIndex: index,
          completedImageCount: images.length,
          expectedImageCount: expectedCount,
        });
        continue;
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        log.warn('[Veo3] Flow image artifact unavailable', {
          projectId,
          imageIndex: index,
          mediaId: row.mediaId,
          errorType: error.name,
        });
      }
    }
    failedImageIndexes.push(index);
    send({
      step: 'image_error',
      imageIndex: index,
      error: row ? 'Không tải được ảnh này từ Google Flow.' : 'Google Flow không trả ảnh ở vị trí này.',
      progress: 85 + Math.round((10 * (index + 1)) / expectedCount),
      completedImageCount: images.length,
      expectedImageCount: expectedCount,
      failedImageCount: failedImageIndexes.length,
      failedImageIndexes: [...failedImageIndexes],
    });
  }

  throwIfAborted(signal);
  if (images.length === 0) {
    send({
      step: 'error',
      error: 'Không tải được ảnh nào từ Google Flow.',
      expectedImageCount: expectedCount,
      failedImageCount: failedImageIndexes.length,
      failedImageIndexes,
    });
    return { ok: false, images: [] };
  }
  send({
    step: 'done',
    progress: 100,
    message: `Đã tạo ${images.length} ảnh!`,
    images,
    model,
    prompt,
    expectedImageCount: expectedCount,
    completedImageCount: images.length,
    failedImageCount: failedImageIndexes.length,
    failedImageIndexes,
  });
  return { ok: true, images };
}
