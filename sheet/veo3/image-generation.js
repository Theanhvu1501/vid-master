/**
 * Veo3 image generation (API mode).
 * Adapted & simplified from phoma - uses the Flow batchexecute API path only
 * (no DOM extension mode, no worker-lease system). Browser lifecycle is managed
 * by veo3-adapter.js.
 */
import crypto from 'crypto';
import fs from 'fs';
import { createLogger } from './logger.js';
import {
  Veo3ApiError,
  describeVeo3ApiError,
  isVeo3AuthApiError,
  isVeo3AuthError,
  isVeo3QuotaApiError,
} from './api-errors.js';
import {
  createVeo3FlowProject,
  prepareVeo3FlowImageUpload,
  resolveVeo3FlowReferenceImage,
  submitVeo3FlowImage,
  uploadVeo3FlowReferenceImage,
} from './flow-batch.js';
import { LABS_FLOW_URL, VEO3_MODELS, isVeo3PageUrl } from './constants.js';
import { isLoginPage } from './page.js';
import { createVeo3ImageJobPage, getVeo3FlowImageAspectRatio } from './flow-page.js';
import { sleepAbortable, startProgressPulse, throwIfAborted } from './async-utils.js';
import { stripDataUrlPrefix } from './image-artifacts.js';
import { getVeo3RecaptchaToken } from './recaptcha.js';
import { completeVeo3FlowImages } from './image-results.js';

const log = createLogger('Veo 3');

/**
 * Generate images via Google Flow API.
 *
 * @param {import('puppeteer-core').Browser} browser - connected browser
 * @param {object} params - { prompt, model, aspectRatio, outputCount, referenceImages, imageTags }
 * @param {(data:object)=>void} send - progress callback
 * @param {object} options - { signal, write, flowImageProjectContext }
 *        write(buffer, meta) -> saved file info (required)
 */
export async function handleVeo3Generate(browser, params, send, options = {}) {
  const { signal, write } = options;
  throwIfAborted(signal);
  if (typeof write !== 'function') {
    throw new Error('handleVeo3Generate requires options.write(buffer, meta)');
  }

  const {
    prompt,
    model: requestedModel = 'Nano Banana pro',
    aspectRatio = '9:16',
    outputCount = 1,
    referenceImages = [],
    imageTags = [],
  } = params;

  const model = requestedModel === 'Nano Banana 2' ? 'Nano Banana 2.1' : requestedModel;
  const modelKey = VEO3_MODELS[model] ?? VEO3_MODELS['Nano Banana pro'];
  const aspectRatioKey = getVeo3FlowImageAspectRatio(aspectRatio);
  const count = Math.min(4, Math.max(1, Math.floor(Number(outputCount) || 1)));

  send({ step: 'init', progress: 0, message: 'Đang mở tab Google Flow...' });

  // ── 1. Get/create Google Flow tab ───────────────────────────────────────────
  let labsPage = null;
  let flowJobLease = null;
  let projectId = '';
  let shouldCloseLabsPage = false;

  const closeImageJobPage = async () => {
    if (flowJobLease) {
      await flowJobLease.release();
      flowJobLease = null;
      return;
    }
    if (shouldCloseLabsPage && labsPage && !labsPage.isClosed()) {
      await labsPage.close().catch(() => {});
    }
  };

  try {
    if (options.flowImageProjectContext) {
      flowJobLease = await options.flowImageProjectContext.acquireJobPage(signal);
      labsPage = flowJobLease.page;
      projectId = flowJobLease.projectId;
    } else {
      labsPage = await createVeo3ImageJobPage(browser);
      shouldCloseLabsPage = true;
    }
    throwIfAborted(signal);
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    if (isVeo3AuthError(err)) {
      send({ step: 'need_login', message: 'Phiên đăng nhập Veo3 đã hết hạn. Vui lòng đăng nhập lại.' });
      await closeImageJobPage();
      return { ok: false };
    }
    send({ step: 'error', error: 'Không thể mở tab: ' + err.message });
    await closeImageJobPage();
    return { ok: false };
  }

  // ── 2. Navigate to Google Flow if needed ─────────────────────────────────────
  try {
    if (!isVeo3PageUrl(labsPage.url())) {
      send({ step: 'init', progress: 3, message: 'Đang điều hướng đến Google Flow...' });
      await labsPage.goto(LABS_FLOW_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
      throwIfAborted(signal);
    }
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    if (!isVeo3PageUrl(labsPage.url()) && !isLoginPage(labsPage.url())) {
      send({ step: 'error', error: `Không vào được Google Flow: ${err.message}` });
      await closeImageJobPage();
      return { ok: false };
    }
  }
  throwIfAborted(signal);

  if (isLoginPage(labsPage.url())) {
    send({ step: 'need_login', message: 'Bạn chưa đăng nhập Veo 3. Vui lòng vào Tài khoản để đăng nhập rồi thử lại.' });
    await closeImageJobPage();
    return { ok: false };
  }
  if (!isVeo3PageUrl(labsPage.url())) {
    send({ step: 'error', error: `Tab tạo ảnh chưa ở Google Flow (${labsPage.url()}).` });
    await closeImageJobPage();
    return { ok: false };
  }

  send({ step: 'session', progress: 10, message: 'Đang kiểm tra phiên đăng nhập...' });

  // ── 3. Create project if we don't have one yet ───────────────────────────────
  const batchId = crypto.randomUUID();
  const baseSeed = crypto.randomInt(0, 2_147_483_648);
  if (!projectId) {
    send({ step: 'project', progress: 22, message: 'Đang tạo workspace cho ảnh...' });
    try {
      projectId = await createVeo3FlowProject(labsPage, 'Veo3 Generation', signal);
      throwIfAborted(signal);
      await labsPage.goto(new URL(`/project/${projectId}`, LABS_FLOW_URL).toString(), {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      throwIfAborted(signal);
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      log.warn('[Veo3] Flow create project failed:', err.message);
      if (isVeo3AuthError(err)) {
        send({ step: 'need_login', message: 'Phiên đăng nhập Veo3 đã hết hạn. Vui lòng đăng nhập lại.' });
        await closeImageJobPage();
        return { ok: false };
      }
      send({ step: 'error', error: 'Không tạo được project trên Google Flow. Vui lòng kiểm tra lại phiên đăng nhập.' });
      await closeImageJobPage();
      return { ok: false };
    }
  }

  // ── 4. Upload reference images (optional) ─────────────────────────────────────
  const uploadReferenceImage = async (image) => {
    throwIfAborted(signal);
    const token = await getVeo3RecaptchaToken(labsPage, 'IMAGE_GENERATION', { signal });
    throwIfAborted(signal);
    const base64 = image.base64
      ? stripDataUrlPrefix(image.base64)
      : image.filePath
      ? (await fs.promises.readFile(image.filePath)).toString('base64')
      : '';
    const uploaded = await uploadVeo3FlowReferenceImage({
      page: labsPage,
      projectId,
      image: {
        base64,
        mime: image.mime || 'image/png',
        filename: image.filename || `reference_${Date.now()}.png`,
      },
      recaptchaToken: token,
      signal,
    });
    throwIfAborted(signal);
    const resolved = await resolveVeo3FlowReferenceImage({
      page: labsPage,
      projectId,
      mediaId: uploaded.mediaId,
      handle: uploaded.handle,
      signal,
    });
    return { ...resolved, filename: image.filename };
  };

  const validReferenceImages = referenceImages.filter((image) => image.base64 || image.filePath);
  let uploadedReferences = [];
  if (validReferenceImages.length > 0) {
    send({ step: 'uploading', progress: 24, message: `Đang upload ${validReferenceImages.length} ảnh tham chiếu...` });
    try {
      await prepareVeo3FlowImageUpload(labsPage, projectId, signal);
      throwIfAborted(signal);
      const uploaded = [];
      for (const image of validReferenceImages) {
        uploaded.push(await uploadReferenceImage(image));
      }
      throwIfAborted(signal);
      uploadedReferences = uploaded;
      send({ step: 'uploading', progress: 30, message: `Đã upload ${uploadedReferences.length} ảnh tham chiếu.` });
      if (uploadedReferences.length > 1) {
        send({ step: 'uploading', progress: 32, message: 'Đang chờ Google Labs xử lý ảnh tham chiếu...' });
        await sleepAbortable(3000, signal);
      }
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      if (err instanceof Veo3ApiError && isVeo3AuthApiError(err.status, err.responseBody)) {
        send({ step: 'need_login', message: 'Phiên đăng nhập Veo3 đã hết hạn. Vui lòng vào Tài khoản để đăng nhập lại.' });
        await closeImageJobPage();
        return { ok: false };
      }
      send({ step: 'error', error: 'Không upload được ảnh tham chiếu lên Google Flow. Vui lòng thử lại.' });
      await closeImageJobPage();
      return { ok: false };
    }
  }

  // ── 5. reCAPTCHA + submit generation ─────────────────────────────────────────
  send({ step: 'recaptcha', progress: 34, message: 'Đang xác thực yêu cầu tạo ảnh...' });
  log.info('[Veo3] Executing Flow image RPC ogiZ0b...');
  send({ step: 'generating', progress: 45, message: 'Đã gửi prompt, Google Labs đang tạo ảnh...' });

  let apiPulse = null;
  try {
    apiPulse = startProgressPulse(send, { from: 46, to: 78, step: 'generating', message: 'Google Labs đang tạo ảnh...' });
    const token = await getVeo3RecaptchaToken(labsPage, 'IMAGE_GENERATION', { signal });
    throwIfAborted(signal);
    const result = await submitVeo3FlowImage({
      page: labsPage,
      projectId,
      prompt,
      modelKey,
      aspectRatio: aspectRatioKey,
      seed: baseSeed,
      outputCount: count,
      recaptchaToken: token,
      batchId,
      referenceMedia: uploadedReferences,
      imageTags,
      signal,
    });
    throwIfAborted(signal);
    clearInterval(apiPulse);
    apiPulse = null;
    send({ step: 'parsing', progress: 80, message: 'Đang xử lý kết quả...' });
    const completed = await completeVeo3FlowImages(
      { page: labsPage, projectId, result, requestedCount: count, model, prompt, send, signal },
      { write }
    );
    await closeImageJobPage();
    return completed;
  } catch (err) {
    if (err.name === 'AbortError') {
      await closeImageJobPage();
      throw err;
    }
    log.error('[Veo3] API execution error:', err.message);
    if (err instanceof Veo3ApiError) {
      const auth = isVeo3AuthApiError(err.status, err.responseBody);
      send({
        step: auth ? 'need_login' : 'error',
        error: describeVeo3ApiError(err.status, err.responseBody, model),
        ...(isVeo3QuotaApiError(err.status, err.responseBody) ? { errorCode: 'quota' } : {}),
      });
    } else {
      send({ step: 'error', error: 'Kết nối tới Google Labs chưa ổn định. Vui lòng thử lại sau ít phút.' });
    }
    await closeImageJobPage();
    return { ok: false };
  } finally {
    if (apiPulse) clearInterval(apiPulse);
  }
}
