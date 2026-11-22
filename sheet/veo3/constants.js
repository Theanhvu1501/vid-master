export const FLOW_URL = 'https://flow.google.com/';
export const LEGACY_LABS_FLOW_URL = 'https://labs.google/fx/vi/tools/flow';
export const LABS_FLOW_URL = FLOW_URL;
export const VEO3_RECAPTCHA_SITE_KEY = '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV';
export const VEO3_API_RETRY_MAX_ATTEMPTS = 4;
export const VEO3_API_RETRY_DELAY_MS = 2000;
export const VEO3_IMAGE_UPSCALE_CONCURRENCY = 5;
export const VEO3_UI_MESSAGES = {
    retrySoft: 'Hệ thống đang thử lại yêu cầu, vui lòng chờ...',
    reconnectSoft: 'Kết nối đang được làm mới, vui lòng đợi trong giây lát...',
    blockedSoft: 'Yêu cầu tạm thời chưa xử lý được, hệ thống đang tự khắc phục...',
    resumeSoft: 'Đang tiếp tục xử lý từ bước gần nhất...',
};
export const VEO3_MODELS = {
    'Nano Banana pro': 'GEM_PIX_2',
    'Nano Banana 2.1': 'BELUGA',
    'Nano Banana 2': 'BELUGA',
    'Nano Banana 2 Lite': 'HARBOR_SEAL',
};
export const VEO3_IMAGE_MODEL_LABELS = ['Nano Banana pro', 'Nano Banana 2.1', 'Nano Banana 2 Lite'];
export const VEO3_MODEL_LABELS = VEO3_IMAGE_MODEL_LABELS;
export function getVeo3AlternativeImageModels(currentModel = 'Nano Banana pro') {
    return VEO3_IMAGE_MODEL_LABELS.filter((model) => model !== currentModel).slice(0, 2);
}
export function formatVeo3QuotaSuggestion(currentModel = 'Nano Banana pro') {
    const alternatives = getVeo3AlternativeImageModels(currentModel);
    const fallback = VEO3_IMAGE_MODEL_LABELS.filter((model) => model !== currentModel).slice(0, 2);
    const suggestions = alternatives.length > 0 ? alternatives : fallback;
    return [
        'Veo 3 đã hết quota hoặc vượt giới hạn lượt tạo cho model hiện tại.',
        '',
        `1. Đổi sang model khác: hãy thử ${suggestions.join(' hoặc ')}.`,
        '2. Đổi account: chọn tài khoản Google Labs khác rồi tạo lại.',
    ].join('\n');
}
export const VEO3_ASPECT_RATIOS = {
    '16:9': 'IMAGE_ASPECT_RATIO_LANDSCAPE',
    '4:3': 'IMAGE_ASPECT_RATIO_LANDSCAPE_FOUR_THREE',
    '1:1': 'IMAGE_ASPECT_RATIO_SQUARE',
    '3:4': 'IMAGE_ASPECT_RATIO_PORTRAIT_THREE_FOUR',
    '9:16': 'IMAGE_ASPECT_RATIO_PORTRAIT',
    landscape: 'IMAGE_ASPECT_RATIO_LANDSCAPE',
    portrait: 'IMAGE_ASPECT_RATIO_PORTRAIT',
    square: 'IMAGE_ASPECT_RATIO_SQUARE',
};
export const VEO3_VIDEO_ASPECT_RATIOS = {
    '16:9': 'VIDEO_ASPECT_RATIO_LANDSCAPE',
    '9:16': 'VIDEO_ASPECT_RATIO_PORTRAIT',
    landscape: 'VIDEO_ASPECT_RATIO_LANDSCAPE',
    portrait: 'VIDEO_ASPECT_RATIO_PORTRAIT',
};
export const VEO3_UPSCALE_MODELS = {
    VIDEO_RESOLUTION_1080P: 'veo_3_1_upsampler_1080p',
    VIDEO_RESOLUTION_4K: 'veo_3_1_upsampler_4k',
};
// Hardcoded API key (removed process.env dependency)
export const GOOGLE_FLOW_API_KEY = 'AIzaSyBtrm0o5ab1c-Ec8ZuLcGt3oJAA5VWt3pY';
export const VEO3_DOWNLOAD_QUALITIES = ['720', '1080', '4k'];
export function isVeo3PageUrl(url) {
    try {
        const { hostname } = new URL(url);
        return hostname === 'flow.google.com' || hostname === 'labs.google';
    }
    catch {
        return false;
    }
}
export function isVeo3FlowAboutUrl(url) {
    try {
        const { hostname, pathname } = new URL(url);
        return hostname === 'flow.google.com' && (pathname === '/about' || pathname.startsWith('/about/'));
    }
    catch {
        return false;
    }
}
export function isVeo3LoginUrl(url) {
    return url.includes('accounts.google.com') || url.includes('/signin');
}
