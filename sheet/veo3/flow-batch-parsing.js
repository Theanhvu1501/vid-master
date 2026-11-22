import { FLOW_MEDIA_ID_EXACT_PATTERN, FLOW_MEDIA_ID_PATTERN, UUID_EXACT_PATTERN, } from './flow-batch-types.js';
function parseRpcPayload(value) {
    if (typeof value !== 'string')
        return value;
    try {
        return JSON.parse(value);
    }
    catch {
        return value;
    }
}
export function parseFlowBatchResponse(text) {
    const calls = [];
    for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === ")]}'" || /^\d+$/.test(trimmed))
            continue;
        let parsed;
        try {
            parsed = JSON.parse(trimmed);
        }
        catch {
            continue;
        }
        if (!Array.isArray(parsed))
            continue;
        for (const row of parsed) {
            if (!Array.isArray(row) || row[0] !== 'wrb.fr' || typeof row[1] !== 'string')
                continue;
            calls.push({
                rpcId: row[1],
                payload: parseRpcPayload(row[2]),
                raw: row,
            });
        }
    }
    return calls;
}
export function parseFlowBatchErrorCode(text) {
    for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === ")]}'" || /^\d+$/.test(trimmed))
            continue;
        let parsed;
        try {
            parsed = JSON.parse(trimmed);
        }
        catch {
            continue;
        }
        if (!Array.isArray(parsed))
            continue;
        for (const row of parsed) {
            if (Array.isArray(row) && row[0] === 'e' && typeof row[1] === 'number')
                return row[1];
        }
    }
    return undefined;
}
export function parseFlowBatchRpcError(text, rpcId) {
    for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === ")]}'" || /^\d+$/.test(trimmed))
            continue;
        let parsed;
        try {
            parsed = JSON.parse(trimmed);
        }
        catch {
            continue;
        }
        if (!Array.isArray(parsed))
            continue;
        const rpcError = parsed.find((row) => Array.isArray(row) && row[0] === 'wrb.fr' && row[1] === rpcId && row[2] === null && row[5]);
        if (!Array.isArray(rpcError))
            continue;
        const reason = findStringByPattern(rpcError[5], /^PUBLIC_ERROR_[A-Z0-9_]+$/i);
        const statusRow = parsed.find((row) => Array.isArray(row) &&
            (row[0] === 'di' || row[0] === 'af.httprm') &&
            typeof row[1] === 'number' &&
            row[1] >= 400);
        return {
            status: Array.isArray(statusRow) ? statusRow[1] : undefined,
            reason,
        };
    }
    return null;
}
export function findUuid(value) {
    if (typeof value === 'string' && isUuid(value)) {
        return value;
    }
    if (!value || typeof value !== 'object')
        return undefined;
    if (Array.isArray(value)) {
        for (const item of value) {
            const found = findUuid(item);
            if (found)
                return found;
        }
        return undefined;
    }
    for (const item of Object.values(value)) {
        const found = findUuid(item);
        if (found)
            return found;
    }
    return undefined;
}
export function findStringByPattern(value, pattern) {
    if (typeof value === 'string' && pattern.test(value))
        return value;
    if (!value || typeof value !== 'object')
        return undefined;
    const items = Array.isArray(value) ? value : Object.values(value);
    for (const item of items) {
        const found = findStringByPattern(item, pattern);
        if (found)
            return found;
    }
    return undefined;
}
export function redactFlowDebugText(value) {
    try {
        return JSON.stringify(value)
            .replace(/0c[A-Za-z0-9_-]{24,}/g, '[recaptcha]')
            .replace(/AIQ-[A-Za-z0-9._:-]+/g, '[at]')
            .replace(/Signature\\?u003d[^"',\\]+|Signature=[^"',&]+/g, 'Signature=[redacted]')
            .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
            .slice(0, 700);
    }
    catch {
        return '[unserializable]';
    }
}
export function collectGenerationIds(value) {
    const ids = [];
    const visit = (item) => {
        if (isUuid(item)) {
            ids.push(item);
            return;
        }
        if (!item || typeof item !== 'object')
            return;
        (Array.isArray(item) ? item : Object.values(item)).forEach(visit);
    };
    visit(value);
    return {
        generationId: ids[0],
        mediaId: ids[1] ?? ids[0],
    };
}
export function parseVeo3FlowImageSubmitPayload(payload) {
    if (!Array.isArray(payload) || !Array.isArray(payload[0]))
        return null;
    const row = payload[0][0];
    if (!Array.isArray(row) || !isUuid(row[0]))
        return null;
    return { mediaId: row[0], generationId: isUuid(row[2]) ? row[2] : undefined };
}
export function parseVeo3FlowImageSubmitRows(payload) {
    if (!Array.isArray(payload) || !Array.isArray(payload[0]))
        return [];
    const seen = new Set();
    return payload[0].flatMap((row, index) => {
        if (!Array.isArray(row) || !isUuid(row[0]) || seen.has(row[0]))
            return [];
        seen.add(row[0]);
        const imageData = row[6];
        const url = Array.isArray(imageData) && Array.isArray(imageData[0]) ? imageData[0][13] : undefined;
        return [{
                index,
                mediaId: row[0],
                imageUrl: typeof url === 'string' && /^https?:\/\//.test(url) ? url : undefined,
            }];
    });
}
export function collectUuids(value) {
    const ids = [];
    const seen = new Set();
    const visit = (item) => {
        if (isUuid(item)) {
            const id = item.trim();
            if (!seen.has(id)) {
                seen.add(id);
                ids.push(id);
            }
            return;
        }
        if (!item || typeof item !== 'object')
            return;
        (Array.isArray(item) ? item : Object.values(item)).forEach(visit);
    };
    visit(value);
    return ids;
}
function collectFlowMediaIds(value) {
    const ids = [];
    const seen = new Set();
    const visit = (item) => {
        if (isFlowMediaId(item)) {
            const id = item.trim();
            if (!seen.has(id)) {
                seen.add(id);
                ids.push(id);
            }
            return;
        }
        if (!item || typeof item !== 'object')
            return;
        (Array.isArray(item) ? item : Object.values(item)).forEach(visit);
    };
    visit(value);
    return ids;
}
function pickFlowMediaId(ids) {
    return ids.find((id) => id.endsWith('_upsampled')) ?? ids[0];
}
function findUpscaledFlowMediaId(value) {
    return collectFlowMediaIds(value).find((id) => id.endsWith('_upsampled'));
}
export function isUuid(value) {
    return typeof value === 'string' && UUID_EXACT_PATTERN.test(value);
}
export function isFlowMediaId(value) {
    return typeof value === 'string' && FLOW_MEDIA_ID_EXACT_PATTERN.test(value);
}
export function getFlowContentMediaId(url, mediaType) {
    if (!url)
        return undefined;
    const match = url.match(new RegExp(`flow-content\\.google\\/${mediaType}\\/(${FLOW_MEDIA_ID_PATTERN.source})`, 'i'));
    return match?.[1];
}
function readFlowVideoRows(payload) {
    if (!Array.isArray(payload))
        return [];
    const submitRows = payload[3];
    if (Array.isArray(submitRows) && submitRows.every(Array.isArray))
        return submitRows;
    const directRows = payload[2];
    if (Array.isArray(directRows) && directRows.every(Array.isArray))
        return directRows;
    return [];
}
export function describeFlowSubmitMiss(response, rpcId) {
    const payload = response.calls.find((call) => call.rpcId === rpcId)?.payload;
    const payloadShape = Array.isArray(payload)
        ? payload.map((item) => (Array.isArray(item) ? `array(${item.length})` : typeof item)).join(',')
        : typeof payload;
    return [
        `HTTP ${response.status}`,
        `rpcIds=${response.debug.rpcIds.join(',') || 'none'}`,
        `batchexecuteError=${response.debug.batchexecuteErrorCode ?? 'none'}`,
        `hasAt=${response.debug.hasAt}`,
        `hasFSid=${response.debug.hasFSid}`,
        `hasBuildLabel=${response.debug.hasBuildLabel}`,
        `sourcePath=${response.debug.sourcePath ?? 'none'}`,
        `payloadShape=${payloadShape}`,
        `payloadPreview=${redactFlowDebugText(payload)}`,
    ].join(' ');
}
function readFlowVideoStatusCode(row) {
    const metadata = row[5];
    if (!Array.isArray(metadata))
        return undefined;
    const status = metadata[8];
    if (!Array.isArray(status))
        return undefined;
    return typeof status[0] === 'number' ? status[0] : undefined;
}
export function isVeo3PublicErrorCode(value) {
    return typeof value === 'string' && /^PUBLIC_ERROR_[A-Z0-9_]+$/.test(value);
}
function readFlowVideoFailureReason(row) {
    const metadata = row[5];
    if (!Array.isArray(metadata))
        return undefined;
    const status = metadata[8];
    if (!Array.isArray(status) || !Array.isArray(status[1]))
        return undefined;
    const reason = status[1][1];
    return isVeo3PublicErrorCode(reason) ? reason : undefined;
}
function readFlowVideoPayloadIds(payload) {
    const row = readFlowVideoRows(payload)[0];
    if (!row && Array.isArray(payload) && isFlowMediaId(payload[0])) {
        return {
            mediaId: payload[0],
            projectId: isUuid(payload[1]) ? payload[1] : undefined,
            workflowId: isUuid(payload[2]) ? payload[2] : undefined,
        };
    }
    if (!row) {
        const mediaIds = collectFlowMediaIds(payload);
        const ids = collectUuids(payload);
        return { mediaId: pickFlowMediaId(mediaIds) ?? ids[0], projectId: ids[1], workflowId: ids[2] };
    }
    return {
        mediaId: isFlowMediaId(row[0]) ? row[0] : undefined,
        projectId: isUuid(row[1]) ? row[1] : undefined,
        workflowId: isUuid(row[2]) ? row[2] : undefined,
    };
}
function findFlowContentUrl(payload, mediaType) {
    return findStringByPattern(payload, new RegExp(`^https?:\\/\\/flow-content\\.google\\/${mediaType}\\/${FLOW_MEDIA_ID_PATTERN.source}`, 'i'));
}
function decodeGoogleEscapedText(value) {
    return value
        .replace(/\\\\u003d|\\u003d/g, '=')
        .replace(/\\\\u0026|\\u0026/g, '&')
        .replace(/\\\\u003f|\\u003f/g, '?')
        .replace(/\\\\\//g, '/');
}
export function findFlowContentUrlInText(text, mediaType) {
    const decoded = decodeGoogleEscapedText(text);
    return decoded.match(new RegExp(`https?:\\/\\/flow-content\\.google\\/${mediaType}\\/${FLOW_MEDIA_ID_PATTERN.source}[^"',\\]\\s]+`, 'i'))?.[0];
}
export function parseVeo3FlowVideoSubmitPayload(payload, fallbackProjectId) {
    const ids = readFlowVideoPayloadIds(payload);
    if (!ids.mediaId)
        return null;
    return {
        mediaId: ids.mediaId,
        projectId: ids.projectId || fallbackProjectId,
        workflowId: ids.workflowId,
        payload,
    };
}
export function parseVeo3FlowVideoUpscaleSubmitPayload(payload, fallbackProjectId, fallbackWorkflowId) {
    const result = parseVeo3FlowVideoSubmitPayload(payload, fallbackProjectId);
    const mediaId = findUpscaledFlowMediaId(payload);
    if (!result || !mediaId)
        return null;
    return {
        ...result,
        mediaId,
        workflowId: result.workflowId || fallbackWorkflowId,
    };
}
export function parseVeo3FlowVideoPollPayload(payload) {
    const row = readFlowVideoRows(payload)[0];
    const ids = readFlowVideoPayloadIds(payload);
    if (!ids.mediaId)
        return null;
    const statusCode = row ? readFlowVideoStatusCode(row) : undefined;
    const state = statusCode === 3 ? 'success' : statusCode === 4 || statusCode === 5 ? 'failed' : 'pending';
    return {
        state,
        mediaId: ids.mediaId,
        projectId: ids.projectId,
        workflowId: ids.workflowId,
        statusCode,
        failureReason: state === 'failed' && row ? readFlowVideoFailureReason(row) : undefined,
        payload,
    };
}
export function parseVeo3FlowAssetDetailPayload(payload, fallbackMediaId) {
    const ids = readFlowVideoPayloadIds(payload);
    const videoUrl = findFlowContentUrl(payload, 'video');
    const imageUrl = findFlowContentUrl(payload, 'image');
    return {
        mediaId: getFlowContentMediaId(videoUrl, 'video') || ids.mediaId || fallbackMediaId,
        projectId: ids.projectId,
        workflowId: ids.workflowId,
        imageUrl,
        videoUrl,
        payload,
    };
}
export function parseVeo3FlowImageUpscalePayload(payload, fallbackProjectId) {
    if (!Array.isArray(payload))
        return null;
    const row = payload[0];
    const encodedImage = payload[1];
    if (!Array.isArray(row) || typeof encodedImage !== 'string' || !encodedImage)
        return null;
    const mediaId = isFlowMediaId(row[0]) ? row[0] : undefined;
    if (!mediaId)
        return null;
    return {
        mediaId,
        projectId: isUuid(row[1]) ? row[1] : fallbackProjectId,
        workflowId: isUuid(row[2]) ? row[2] : undefined,
        base64: encodedImage,
        mime: 'image/jpeg',
        payload,
    };
}
