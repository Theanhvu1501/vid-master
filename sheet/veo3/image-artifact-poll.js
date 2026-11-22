/**
 * Poll Google Flow for generated image artifacts.
 * Adapted from phoma.
 */
import { createLogger } from './logger.js';
import { getVeo3FlowAssetDetail } from './flow-batch.js';
import { sleepAbortable, throwIfAborted } from './async-utils.js';
import { collectImageArtifacts } from './image-artifacts.js';

const log = createLogger('Veo 3');

const POLL_ATTEMPTS = 12;
const POLL_DELAY_MS = 2500;

export async function waitForVeo3FlowImageArtifacts({ page, projectId, mediaId, signal, send, progress, message }) {
  for (let attempt = 1; attempt <= POLL_ATTEMPTS; attempt += 1) {
    throwIfAborted(signal);
    send({
      step: 'polling',
      progress: Math.min(progress + attempt, 84),
      message,
      mediaId,
      projectId,
    });
    await sleepAbortable(POLL_DELAY_MS, signal);
    throwIfAborted(signal);
    try {
      const detailPayload = await getVeo3FlowAssetDetail({ page, projectId, mediaId, signal });
      const artifacts = collectImageArtifacts(detailPayload);
      if (artifacts.length > 0) return artifacts;
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      log.warn('[Veo3] Flow image asset detail pending:', { mediaId, attempt, error: err.message });
    }
  }
  return [];
}
