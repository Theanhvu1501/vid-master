import crypto from 'crypto';
import { buildVeo3StructuredPromptParts } from './reference-media.js';
function makeVeo3FlowClientContext(projectId, recaptchaToken) {
    return [null, 22, null, null, null, projectId, null, null, null, null, [recaptchaToken, 1]];
}
function makeVeo3FlowImageUpscaleContext(recaptchaToken) {
    return [null, 22, null, null, null, null, null, null, null, null, [recaptchaToken, 1]];
}
export function getVeo3FlowVideoAspectRatio(value) {
    const ratios = {
        '16:9': 2,
        landscape: 2,
        '9:16': 1,
        portrait: 1,
    };
    return ratios[value || ''] ?? ratios['9:16'];
}
export function buildVeo3FlowTextVideoPayload({ projectId, prompt, modelKey, aspectRatio, recaptchaToken, }) {
    return [
        [
            [
                [null, null, [[[prompt]]]],
                modelKey,
                aspectRatio,
                null,
                [null, null, null, null, crypto.randomUUID().toUpperCase(), crypto.randomUUID().toUpperCase()],
            ],
        ],
        makeVeo3FlowClientContext(projectId, recaptchaToken),
        [crypto.randomUUID().toUpperCase(), 2],
    ];
}
export function buildVeo3FlowReferenceVideoPayload({ projectId, prompt, modelKey, aspectRatio, recaptchaToken, referenceMedia = [], imageTags = [], }) {
    const structuredPrompt = buildVeo3StructuredPromptParts(prompt, referenceMedia, imageTags).map((part) => 'text' in part ? [part.text] : [null, [[part.reference.mediaId, part.reference.filename]]]);
    return [
        [
            [
                [null, null, [structuredPrompt]],
                referenceMedia.map((reference) => [null, reference.mediaId]),
                modelKey,
                aspectRatio,
                null,
                [null, null, null, null, crypto.randomUUID().toUpperCase(), crypto.randomUUID().toUpperCase()],
            ],
        ],
        makeVeo3FlowClientContext(projectId, recaptchaToken),
        [crypto.randomUUID().toUpperCase(), 2],
    ];
}
function makeVeo3FlowVideoInputFrame({ mediaId, crop }) {
    return [null, mediaId, null, null, null, crop ?? [0, null, 1, 1]];
}
export function buildVeo3FlowStartVideoPayload({ projectId, prompt, modelKey, aspectRatio, recaptchaToken, startFrame, }) {
    return [
        [
            [
                [null, null, [[[prompt]]]],
                modelKey,
                aspectRatio,
                null,
                makeVeo3FlowVideoInputFrame(startFrame),
                [null, null, null, null, crypto.randomUUID().toUpperCase(), crypto.randomUUID().toUpperCase()],
            ],
        ],
        makeVeo3FlowClientContext(projectId, recaptchaToken),
        [crypto.randomUUID().toUpperCase(), 2],
    ];
}
export function buildVeo3FlowStartEndVideoPayload({ projectId, prompt, modelKey, aspectRatio, recaptchaToken, startFrame, endFrame, }) {
    return [
        [
            [
                [null, null, [[[prompt]]]],
                modelKey,
                aspectRatio,
                null,
                makeVeo3FlowVideoInputFrame(startFrame),
                makeVeo3FlowVideoInputFrame(endFrame),
                [null, null, null, null, crypto.randomUUID().toUpperCase(), crypto.randomUUID().toUpperCase()],
            ],
        ],
        makeVeo3FlowClientContext(projectId, recaptchaToken),
        [crypto.randomUUID().toUpperCase(), 2],
    ];
}
export function buildVeo3FlowVideoUpscalePayload({ projectId, baseVideoId, workflowId, modelKey, aspectRatio, recaptchaToken, }) {
    return [
        [
            [
                [null, baseVideoId],
                null,
                aspectRatio,
                null,
                [null, workflowId, null, null, crypto.randomUUID().toUpperCase()],
                null,
                2,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                modelKey,
            ],
        ],
        makeVeo3FlowClientContext(projectId, recaptchaToken),
        [crypto.randomUUID().toUpperCase()],
    ];
}
export function buildVeo3FlowImageUpscalePayload({ mediaId, recaptchaToken, }) {
    return [mediaId, 1, makeVeo3FlowImageUpscaleContext(recaptchaToken)];
}
export function buildVeo3FlowImagePayload({ projectId, prompt, referenceMedia = [], imageTags = [], modelKey, aspectRatio, seed, outputCount = 1, recaptchaToken, batchId, promptRequestId = crypto.randomUUID().toUpperCase(), clientRunId = crypto.randomUUID().toUpperCase(), }) {
    if (!Number.isInteger(outputCount) || outputCount < 1 || outputCount > 4) {
        throw new RangeError('Flow image outputCount must be between 1 and 4.');
    }
    const context = makeVeo3FlowClientContext(projectId, recaptchaToken);
    const structuredPrompt = buildVeo3StructuredPromptParts(prompt, referenceMedia, imageTags).map((part) => 'text' in part ? [part.text] : [null, [[part.reference.mediaId, part.reference.filename]]]);
    const usedSeeds = new Set([seed]);
    const imageRows = Array.from({ length: outputCount }, (_, index) => {
        let rowSeed = seed;
        if (index > 0) {
            do {
                rowSeed = crypto.randomInt(0, 2_147_483_648);
            } while (usedSeeds.has(rowSeed));
            usedSeeds.add(rowSeed);
        }
        return [
            null,
            null,
            referenceMedia.length ? referenceMedia.map((reference) => [reference.mediaId, null, null, null, 1]) : null,
            rowSeed,
            aspectRatio,
            modelKey,
            null,
            context,
            [structuredPrompt],
            null,
            null,
            null,
            index === 0 ? promptRequestId : crypto.randomUUID().toUpperCase(),
            index === 0 ? clientRunId : crypto.randomUUID().toUpperCase(),
        ];
    });
    return [
        null,
        imageRows,
        1,
        context,
        [batchId],
    ];
}
