import crypto from 'crypto';
import { Veo3ApiError } from './api-errors.js';
import { createLogger } from './logger.js';
import { FLOW_BATCH_PATH, FLOW_RPC_SOURCE_PATH, } from './flow-batch-types.js';
import { parseVeo3FlowImageSubmitPayload, parseVeo3FlowImageSubmitRows, collectUuids, describeFlowSubmitMiss, findStringByPattern, findUuid, parseFlowBatchErrorCode, parseFlowBatchRpcError, parseFlowBatchResponse, parseVeo3FlowAssetDetailPayload, parseVeo3FlowImageUpscalePayload, parseVeo3FlowVideoPollPayload, parseVeo3FlowVideoSubmitPayload, parseVeo3FlowVideoUpscaleSubmitPayload, } from './flow-batch-parsing.js';
import { buildVeo3FlowImagePayload, buildVeo3FlowImageUpscalePayload, buildVeo3FlowReferenceVideoPayload, buildVeo3FlowStartEndVideoPayload, buildVeo3FlowStartVideoPayload, buildVeo3FlowTextVideoPayload, buildVeo3FlowVideoUpscalePayload, } from './flow-batch-payloads.js';
export { parseVeo3FlowAssetDetailPayload, parseVeo3FlowImageUpscalePayload, parseVeo3FlowVideoPollPayload, parseVeo3FlowVideoSubmitPayload, parseVeo3FlowVideoUpscaleSubmitPayload, parseFlowBatchRpcError, } from './flow-batch-parsing.js';
export { buildVeo3FlowImagePayload, buildVeo3FlowImageUpscalePayload, buildVeo3FlowReferenceVideoPayload, buildVeo3FlowStartEndVideoPayload, buildVeo3FlowStartVideoPayload, buildVeo3FlowTextVideoPayload, buildVeo3FlowVideoUpscalePayload, getVeo3FlowVideoAspectRatio, } from './flow-batch-payloads.js';
let flowBatchRequestSequence = 0;
const imageLog = createLogger('Veo 3');
const GOOGLE_RPC_GLOBAL_KEYS = {
    at: 'SNlM0e',
    buildLabel: 'cfb2h',
    fSid: 'FdrFJe',
};
async function getFlowBatchParams(page) {
    return page.evaluate(({ keys }) => {
        const win = window;
        const wiz = win.WIZ_global_data ?? {};
        const html = document.documentElement.innerHTML;
        const urls = performance
            .getEntriesByType('resource')
            .map((entry) => entry.name)
            .filter((url) => url.includes('/data/batchexecute'));
        const latestUrl = urls.at(-1) ?? '';
        const params = latestUrl ? new URL(latestUrl).searchParams : new URLSearchParams();
        const readGlobal = (key) => {
            const value = wiz[key];
            if (typeof value === 'string' || typeof value === 'number')
                return String(value);
            const match = html.match(new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`));
            return match?.[1] ?? '';
        };
        const findString = (value, predicate) => {
            if (typeof value === 'string' && predicate(value))
                return value;
            if (!value || typeof value !== 'object')
                return '';
            const items = Array.isArray(value) ? value : Object.values(value);
            for (const item of items) {
                const found = findString(item, predicate);
                if (found)
                    return found;
            }
            return '';
        };
        const readAt = () => {
            const globalAt = readGlobal(keys.at);
            if (globalAt)
                return globalAt;
            const inputAt = document.querySelector('input[name="at"]')?.value?.trim();
            if (inputAt)
                return inputAt;
            const metaAt = document.querySelector('meta[name="at"],meta[property="at"]')?.content?.trim();
            if (metaAt)
                return metaAt;
            const wizAt = findString(wiz, (text) => /^AIQ-[^\s"'&<>]+:\d+$/.test(text.trim()));
            if (wizAt)
                return wizAt.trim();
            const patterns = [
                new RegExp(`["']${keys.at}["']\\s*:\\s*["']([^"']+)["']`),
                new RegExp(`["']${keys.at}["']\\s*,\\s*["']([^"']+)["']`),
                /AIQ-[A-Za-z0-9._:-]+:\d+/,
            ];
            for (const pattern of patterns) {
                const match = html.match(pattern);
                if (match)
                    return (match[1] ?? match[0]).trim();
            }
            return '';
        };
        return {
            buildLabel: readGlobal(keys.buildLabel) || params.get('bl') || '',
            fSid: readGlobal(keys.fSid) || params.get('f.sid') || '',
            at: readAt(),
            hl: params.get('hl') || 'en-GB',
            requestId: Number(params.get('_reqid')) || Math.floor(Date.now() % 100000000),
        };
    }, { keys: GOOGLE_RPC_GLOBAL_KEYS });
}
export async function callVeo3FlowRpc(page, options) {
    if (options.signal?.aborted)
        throw new DOMException('Aborted', 'AbortError');
    const params = await getFlowBatchParams(page);
    if (!params.buildLabel) {
        throw new Error('Không đọc được Flow batchexecute build label từ trang hiện tại.');
    }
    const flowRequestId = params.requestId + 100000 + ((flowBatchRequestSequence += 1) % 10000);
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const onAbort = () => {
        void page
            .evaluate((id) => {
            const scope = globalThis;
            scope.__phomaFlowAbortControllers?.get(id)?.abort();
        }, requestId)
            .catch(() => { });
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    try {
        const text = await page.evaluate(async ({ id, batchPath, rpcId, rpcPayload, sourcePath, batchParams, flowRequestId }) => {
            const scope = globalThis;
            const controllers = scope.__phomaFlowAbortControllers ?? new Map();
            scope.__phomaFlowAbortControllers = controllers;
            const controller = new AbortController();
            controllers.set(id, controller);
            try {
                const url = new URL(batchPath, location.origin);
                url.searchParams.set('rpcids', rpcId);
                url.searchParams.set('source-path', sourcePath);
                url.searchParams.set('bl', batchParams.buildLabel);
                if (batchParams.fSid)
                    url.searchParams.set('f.sid', batchParams.fSid);
                url.searchParams.set('hl', batchParams.hl);
                url.searchParams.set('_reqid', String(flowRequestId));
                url.searchParams.set('rt', 'c');
                const body = new URLSearchParams();
                body.set('f.req', JSON.stringify([[[rpcId, JSON.stringify(rpcPayload), null, 'generic']]]));
                if (batchParams.at)
                    body.set('at', batchParams.at);
                const res = await fetch(url.toString(), {
                    method: 'POST',
                    credentials: 'include',
                    referrer: new URL(sourcePath, location.origin).toString(),
                    headers: {
                        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
                        'x-same-domain': '1',
                    },
                    body,
                    signal: controller.signal,
                });
                return `${res.status}\n${await res.text()}`;
            }
            finally {
                controllers.delete(id);
            }
        }, {
            id: requestId,
            batchPath: FLOW_BATCH_PATH,
            rpcId: options.rpcId,
            rpcPayload: options.payload,
            sourcePath: options.sourcePath ?? FLOW_RPC_SOURCE_PATH,
            batchParams: params,
            flowRequestId,
        });
        const separator = text.indexOf('\n');
        const status = Number(text.slice(0, separator)) || 0;
        const body = separator >= 0 ? text.slice(separator + 1) : text;
        const calls = parseFlowBatchResponse(body);
        return {
            status,
            text: body,
            calls,
            debug: {
                rpcIds: calls.map((call) => call.rpcId),
                hasAt: Boolean(params.at),
                hasFSid: Boolean(params.fSid),
                hasBuildLabel: Boolean(params.buildLabel),
                hl: params.hl,
                sourcePath: options.sourcePath ?? FLOW_RPC_SOURCE_PATH,
                flowRequestId,
                batchexecuteErrorCode: parseFlowBatchErrorCode(body),
            },
        };
    }
    catch (err) {
        if (options.signal?.aborted)
            throw new DOMException('Aborted', 'AbortError');
        throw err;
    }
    finally {
        options.signal?.removeEventListener('abort', onAbort);
    }
}
export async function createVeo3FlowProject(page, title, signal) {
    let lastStatus = 0;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
        const response = await callVeo3FlowRpc(page, {
            rpcId: 'jHPbke',
            payload: ['projects/*', [null, [title]], [null, 22]],
            signal,
        });
        lastStatus = response.status;
        if (response.status >= 400) {
            throw new Veo3ApiError(`Flow create project failed: HTTP ${response.status}`, response.status, response.text);
        }
        const payload = response.calls.find((call) => call.rpcId === 'jHPbke')?.payload;
        const projectId = findUuid(payload);
        if (projectId)
            return projectId;
        await new Promise((resolve) => setTimeout(resolve, attempt * 600));
    }
    throw new Error(`Flow create project did not return project id. HTTP ${lastStatus}`);
}
export async function prepareVeo3FlowImageUpload(page, projectId, signal) {
    const warmupCalls = [
        { rpcId: 'NfrxTb', payload: [14] },
        { rpcId: 've2Lsc', payload: [] },
        { rpcId: 'DTaVef', payload: [1] },
        { rpcId: 'nzlxg', payload: [] },
    ];
    for (const call of warmupCalls) {
        const response = await callVeo3FlowRpc(page, {
            rpcId: call.rpcId,
            sourcePath: `/project/${projectId}`,
            payload: call.payload,
            signal,
        });
        if (response.status >= 400) {
            throw new Error(`Flow project warm-up ${call.rpcId} failed: HTTP ${response.status}`);
        }
    }
}
export async function refreshVeo3FlowProjectState(page, projectId, signal) {
    const response = await callVeo3FlowRpc(page, {
        rpcId: 'nzlxg',
        sourcePath: `/project/${projectId}`,
        payload: [],
        signal,
    });
    if (response.status >= 400) {
        throw new Error(`Flow project state refresh failed: HTTP ${response.status}`);
    }
}
export async function uploadVeo3FlowReferenceImage({ page, projectId, image, recaptchaToken, signal, }) {
    const context = [null, 22, null, null, null, projectId, null, null, null, null, [recaptchaToken, 1]];
    const response = await callVeo3FlowRpc(page, {
        rpcId: 'maseQ',
        sourcePath: `/project/${projectId}`,
        payload: [
            context,
            image.base64,
            image.mime || 'image/png',
            1,
            null,
            null,
            null,
            null,
            image.filename || `reference_${Date.now()}.png`,
            null,
            crypto.randomUUID().toUpperCase(),
            crypto.randomUUID().toUpperCase(),
        ],
        signal,
    });
    if (response.status >= 400) {
        throw new Error(`Flow reference upload failed: HTTP ${response.status}`);
    }
    const payload = response.calls.find((call) => call.rpcId === 'maseQ')?.payload;
    const mediaId = collectUuids(payload)[0];
    if (!mediaId) {
        throw new Error('Flow reference upload did not return media id.');
    }
    return { mediaId, handle: image.filename || mediaId };
}
export async function resolveVeo3FlowReferenceImage({ page, projectId, mediaId, handle, signal, }) {
    let lastStatus = 0;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
        const response = await callVeo3FlowRpc(page, {
            rpcId: 'as29s',
            sourcePath: `/project/${projectId}`,
            payload: [mediaId],
            signal,
        });
        lastStatus = response.status;
        if (response.status >= 400) {
            throw new Error(`Flow reference resolve failed: HTTP ${response.status}`);
        }
        const payload = response.calls.find((call) => call.rpcId === 'as29s')?.payload;
        const resolvedMediaId = collectUuids(payload)[0] ?? mediaId;
        const imageUrl = findStringByPattern(payload, /^https?:\/\/|^\/\//);
        if (imageUrl) {
            return { mediaId: resolvedMediaId, handle };
        }
        await new Promise((resolve) => setTimeout(resolve, attempt * 600));
    }
    throw new Error(`Flow reference resolve did not finish. HTTP ${lastStatus}`);
}
export async function submitVeo3FlowImage({ page, projectId, prompt, referenceMedia = [], imageTags = [], modelKey, aspectRatio, seed, outputCount, recaptchaToken, batchId, signal, }) {
    const startedAt = Date.now();
    const response = await callVeo3FlowRpc(page, {
        rpcId: 'ogiZ0b',
        sourcePath: `/project/${projectId}`,
        payload: buildVeo3FlowImagePayload({
            projectId,
            prompt,
            referenceMedia,
            imageTags,
            modelKey,
            aspectRatio,
            seed,
            outputCount,
            recaptchaToken,
            batchId,
        }),
        signal,
    });
    const payload = response.calls.find((call) => call.rpcId === 'ogiZ0b')?.payload;
    const rpcError = parseFlowBatchRpcError(response.text, 'ogiZ0b');
    imageLog.info('Flow image submit completed', {
        projectId,
        elapsedMs: Date.now() - startedAt,
        status: response.status,
        rpcIds: response.debug.rpcIds,
        rpcError,
        payloadShape: Array.isArray(payload)
            ? payload.map((item) => (Array.isArray(item) ? `array(${item.length})` : typeof item))
            : typeof payload,
    });
    if (response.status >= 400 || rpcError) {
        const status = response.status >= 400 ? response.status : (rpcError?.status ?? 400);
        throw new Veo3ApiError('Flow image submit rejected', status, response.text, 'ogiZ0b');
    }
    const rows = parseVeo3FlowImageSubmitRows(payload);
    const ids = parseVeo3FlowImageSubmitPayload(payload);
    if (rows.length === 0) {
        throw new Error(`Flow image submit returned an invalid response. ${describeFlowSubmitMiss(response, 'ogiZ0b')}`);
    }
    return {
        status: response.status,
        text: response.text,
        payload,
        ...ids,
        mediaId: ids?.mediaId ?? rows[0].mediaId,
        rows,
        responseRowCount: Array.isArray(payload) && Array.isArray(payload[0]) ? payload[0].length : 0,
    };
}
function assertVeo3FlowVideoSubmitAccepted(response, rpcId, operation) {
    const rpcError = parseFlowBatchRpcError(response.text, rpcId);
    if (response.status < 400 && !rpcError)
        return;
    const status = rpcError?.status ?? (response.status >= 400 ? response.status : 400);
    throw new Veo3ApiError(`Flow ${operation} submit failed: HTTP ${status}`, status, response.text, rpcId);
}
export async function submitVeo3FlowTextVideo(input) {
    const response = await callVeo3FlowRpc(input.page, {
        rpcId: 'YhhmEf',
        sourcePath: `/project/${input.projectId}`,
        payload: buildVeo3FlowTextVideoPayload(input),
        signal: input.signal,
    });
    assertVeo3FlowVideoSubmitAccepted(response, 'YhhmEf', 'text-to-video');
    const payload = response.calls.find((call) => call.rpcId === 'YhhmEf')?.payload;
    const result = parseVeo3FlowVideoSubmitPayload(payload, input.projectId);
    if (!result) {
        throw new Error(`Flow text-to-video submit did not return generation id. ${describeFlowSubmitMiss(response, 'YhhmEf')}`);
    }
    return result;
}
export async function submitVeo3FlowReferenceVideo(input) {
    const response = await callVeo3FlowRpc(input.page, {
        rpcId: 'MZZa6b',
        sourcePath: `/project/${input.projectId}`,
        payload: buildVeo3FlowReferenceVideoPayload(input),
        signal: input.signal,
    });
    assertVeo3FlowVideoSubmitAccepted(response, 'MZZa6b', 'reference-to-video');
    const payload = response.calls.find((call) => call.rpcId === 'MZZa6b')?.payload;
    const result = parseVeo3FlowVideoSubmitPayload(payload, input.projectId);
    if (!result) {
        throw new Error(`Flow reference-to-video submit did not return generation id. ${describeFlowSubmitMiss(response, 'MZZa6b')}`);
    }
    return result;
}
export async function submitVeo3FlowStartVideo(input) {
    const response = await callVeo3FlowRpc(input.page, {
        rpcId: 'eb1hJf',
        sourcePath: `/project/${input.projectId}`,
        payload: buildVeo3FlowStartVideoPayload(input),
        signal: input.signal,
    });
    assertVeo3FlowVideoSubmitAccepted(response, 'eb1hJf', 'start-to-video');
    const payload = response.calls.find((call) => call.rpcId === 'eb1hJf')?.payload;
    const result = parseVeo3FlowVideoSubmitPayload(payload, input.projectId);
    if (!result) {
        throw new Error(`Flow start-to-video submit did not return generation id. ${describeFlowSubmitMiss(response, 'eb1hJf')}`);
    }
    return result;
}
export async function submitVeo3FlowStartEndVideo(input) {
    const response = await callVeo3FlowRpc(input.page, {
        rpcId: 'nprQif',
        sourcePath: `/project/${input.projectId}`,
        payload: buildVeo3FlowStartEndVideoPayload(input),
        signal: input.signal,
    });
    assertVeo3FlowVideoSubmitAccepted(response, 'nprQif', 'start-end-to-video');
    const payload = response.calls.find((call) => call.rpcId === 'nprQif')?.payload;
    const result = parseVeo3FlowVideoSubmitPayload(payload, input.projectId);
    if (!result) {
        throw new Error(`Flow start-end-to-video submit did not return generation id. ${describeFlowSubmitMiss(response, 'nprQif')}`);
    }
    return result;
}
export async function submitVeo3FlowVideoUpscale(input) {
    const response = await callVeo3FlowRpc(input.page, {
        rpcId: 'p0UkFb',
        sourcePath: `/project/${input.projectId}`,
        payload: buildVeo3FlowVideoUpscalePayload(input),
        signal: input.signal,
    });
    if (response.status >= 400) {
        throw new Error(`Flow video upscale submit failed: HTTP ${response.status}`);
    }
    const payload = response.calls.find((call) => call.rpcId === 'p0UkFb')?.payload;
    const result = parseVeo3FlowVideoUpscaleSubmitPayload(payload, input.projectId, input.workflowId);
    if (!result) {
        throw new Error(`Flow video upscale submit did not return media id. ${describeFlowSubmitMiss(response, 'p0UkFb')}`);
    }
    return result;
}
export async function submitVeo3FlowImageUpscale(input) {
    const response = await callVeo3FlowRpc(input.page, {
        rpcId: 'SPrCad',
        sourcePath: `/project/${input.projectId}`,
        payload: buildVeo3FlowImageUpscalePayload(input),
        signal: input.signal,
    });
    if (response.status >= 400) {
        throw new Error(`Flow image upscale failed: HTTP ${response.status}`);
    }
    const payload = response.calls.find((call) => call.rpcId === 'SPrCad')?.payload;
    const result = parseVeo3FlowImageUpscalePayload(payload, input.projectId);
    if (!result) {
        throw new Error(`Flow image upscale did not return a 2K image. ${describeFlowSubmitMiss(response, 'SPrCad')}`);
    }
    return result;
}
export async function pollVeo3FlowVideo({ page, projectId, mediaId, signal, }) {
    const response = await callVeo3FlowRpc(page, {
        rpcId: 'jwpduf',
        sourcePath: `/project/${projectId}`,
        payload: [null, null, [[mediaId]]],
        signal,
    });
    if (response.status >= 400) {
        throw new Error(`Flow video status check failed: HTTP ${response.status}`);
    }
    const payload = response.calls.find((call) => call.rpcId === 'jwpduf')?.payload;
    const result = parseVeo3FlowVideoPollPayload(payload);
    if (!result)
        throw new Error('Flow video status check did not return media status.');
    return result;
}
export async function getVeo3FlowAssetDetail({ page, projectId, mediaId, signal, }) {
    const response = await callVeo3FlowRpc(page, {
        rpcId: 'as29s',
        sourcePath: `/project/${projectId}`,
        payload: [mediaId],
        signal,
    });
    if (response.status >= 400) {
        throw new Error(`Flow asset detail failed: HTTP ${response.status}`);
    }
    const payload = response.calls.find((call) => call.rpcId === 'as29s')?.payload;
    return parseVeo3FlowAssetDetailPayload(payload, mediaId);
}
