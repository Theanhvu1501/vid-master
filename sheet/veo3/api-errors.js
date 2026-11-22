// Stubbed external imports - these functions are inlined/simplified
function translateVeo3ErrorMessage(message) {
    return message; // Pass through - can be enhanced later
}
function createLogger(name) {
    return {
        warn: (...args) => console.warn(`[${name}]`, ...args),
        info: (...args) => console.info(`[${name}]`, ...args),
        error: (...args) => console.error(`[${name}]`, ...args),
    };
}

import { formatVeo3QuotaSuggestion } from './constants.js';
import { isVeo3PublicErrorCode, parseFlowBatchResponse } from './flow-batch-parsing.js';

const log = createLogger('Veo 3');
const MINOR_POLICY_REASONS = new Set(['public_error_minor', 'public_error_minor_input_image']);
const TERMINAL_POLICY_REASONS = new Set([
    ...MINOR_POLICY_REASONS,
    'public_error_model_access_denied',
    'public_error_prominent_people_filter_failed',
    'public_error_sexual',
    'public_error_unusual_activity',
    'public_error_unusual_activity_too_much_traffic',
]);
const MINOR_POLICY_MESSAGE = [
    'Không cho tạo nội dung gây hại liên quan đến trẻ vị thành niên.',
    'Cách khắc phục: Loại bỏ mô tả hoặc ảnh tham chiếu có trẻ em, em bé, người chưa thành niên và chỉ sử dụng nhân vật trưởng thành.',
].join('\n');
const MODEL_ACCESS_DENIED_MESSAGE = [
    'Tài khoản hoặc gói Veo 3 hiện tại không hỗ trợ model hoặc tính năng này.',
    'Cách khắc phục: Chọn model phù hợp với gói hiện tại hoặc đổi sang tài khoản có quyền truy cập.',
].join('\n');
const UNUSUAL_ACTIVITY_MESSAGE = [
    'Google Labs phát hiện hoạt động bất thường và yêu cầu xác minh.',
    'Cách khắc phục: Xoá tài khoản Veo 3 hiện tại trong ứng dụng, sau đó thêm và đăng nhập lại tài khoản.',
].join('\n');
const TOO_MUCH_TRAFFIC_MESSAGE = [
    'Google Flow phát hiện hoạt động bất thường do gửi quá nhiều yêu cầu.',
    'Vui lòng thử lại sau ít phút. Nếu vẫn lỗi, hãy đặt Delay giữa prompt thành 0–10 giây; hoặc xoá tài khoản Veo3 khỏi ứng dụng rồi thêm và đăng nhập lại; hoặc bật VPN trên máy.',
].join('\n');
const HIJACK_ERROR_MESSAGE = [
    'Yêu cầu bị từ chối tạm thời do lỗi hệ thống, không phải lỗi tài khoản.',
    'Cách khắc phục: Vui lòng thử lại sau ít giây.',
].join('\n');
export const VEO3_DANGER_FILTER_MESSAGE = 'Google Flow từ chối câu lệnh vì có thể vi phạm chính sách về nội dung gây hại. Hãy chỉnh sửa câu lệnh rồi thử lại.';
export function formatVeo3UnknownPublicError(code) {
    return `Google Flow trả về lỗi ${code}. Vui lòng liên hệ admin và gửi mã lỗi này.`;
}
export class Veo3ApiError extends Error {
    status;
    responseBody;
    rpcId;
    constructor(message, status, responseBody = '', rpcId) {
        super(message);
        this.status = status;
        this.responseBody = responseBody;
        this.rpcId = rpcId;
    }
}
export function isVeo3AuthError(error) {
    return error instanceof Veo3ApiError && isVeo3AuthApiError(error.status, error.responseBody);
}
export function parseGoogleApiError(body) {
    try {
        const parsed = JSON.parse(body);
        return parsed.error ?? null;
    }
    catch {
        return null;
    }
}
export function getGoogleApiErrorReason(error) {
    return error?.details?.find((detail) => typeof detail.reason === 'string')?.reason ?? '';
}
export function getVeo3ApiErrorReason(responseBody) {
    const apiError = parseGoogleApiError(responseBody);
    return getGoogleApiErrorReason(apiError) || responseBody.match(/PUBLIC_ERROR_[A-Z0-9_]+/i)?.[0] || '';
}
export function getVeo3StructuredPublicErrorCode(responseBody, rpcId) {
    const apiDetails = parseGoogleApiError(responseBody)?.details;
    const apiReason = Array.isArray(apiDetails)
        ? apiDetails.find((detail) => detail && isVeo3PublicErrorCode(detail.reason))?.reason
        : undefined;
    if (apiReason)
        return apiReason;
    if (!rpcId)
        return undefined;
    const row = parseFlowBatchResponse(responseBody)
        .find((call) => call.rpcId === rpcId && call.payload === null)?.raw;
    const error = row?.[5];
    const details = Array.isArray(error) ? error[2] : undefined;
    if (!Array.isArray(details))
        return undefined;
    for (const detail of details) {
        if (!Array.isArray(detail) || detail[0] !== 'type.googleapis.com/google.rpc.ErrorInfo')
            continue;
        const reason = Array.isArray(detail[1]) ? detail[1][0] : undefined;
        if (isVeo3PublicErrorCode(reason))
            return reason;
    }
    return undefined;
}
export function isVeo3TooMuchTrafficError(status, responseBody) {
    const reason = getVeo3ApiErrorReason(responseBody).toLowerCase();
    return (status === 403 || status === 405) && reason === 'public_error_unusual_activity_too_much_traffic';
}
export function isVeo3AuthApiError(status, responseBody) {
    if (status === 401)
        return true;
    if (status !== 403)
        return false;
    const apiError = parseGoogleApiError(responseBody);
    const reason = getGoogleApiErrorReason(apiError).toLowerCase();
    const apiStatus = String(apiError?.status ?? '').toLowerCase();
    const message = String(apiError?.message ?? responseBody ?? '').toLowerCase();
    const combined = `${apiStatus} ${reason} ${message}`;
    if (combined.includes('recaptcha') ||
        combined.includes('captcha') ||
        combined.includes('unusual_activity') ||
        combined.includes('public_error_unusual_activity') ||
        combined.includes('quota') ||
        combined.includes('resource_exhausted') ||
        combined.includes('public_error_user_quota_reached')) {
        return false;
    }
    return (combined.includes('unauthorized') ||
        (combined.includes('permission_denied') && (combined.includes('token') || combined.includes('auth'))) ||
        combined.includes('login') ||
        combined.includes('session') ||
        combined.includes('access token') ||
        combined.includes('accesstoken'));
}
export function isVeo3QuotaApiError(status, responseBody) {
    const apiError = parseGoogleApiError(responseBody);
    const reason = getGoogleApiErrorReason(apiError).toLowerCase();
    const apiStatus = String(apiError?.status ?? '').toLowerCase();
    const message = String(apiError?.message ?? responseBody ?? '').toLowerCase();
    const combined = `${apiStatus} ${reason} ${message}`;
    return (status === 429 ||
        apiStatus.includes('resource_exhausted') ||
        reason.includes('public_error_user_quota_reached') ||
        reason.includes('public_error_per_model_daily_quota_reached') ||
        combined.includes('quota') ||
        combined.includes('too many requests') ||
        combined.includes('resource has been exhausted'));
}
export function isVeo3HijackError(responseBody) {
    return responseBody.toLowerCase().includes('extension_hijack');
}
export function describeVeo3ApiError(status, responseBody, currentModel, isVideo = false, rpcId) {
    const apiError = parseGoogleApiError(responseBody);
    const reason = getVeo3ApiErrorReason(responseBody);
    const normalizedReason = reason.toLowerCase();
    const apiStatus = apiError?.status ?? '';
    const message = apiError?.message ?? '';
    const structuredCode = isVideo ? getVeo3StructuredPublicErrorCode(responseBody, rpcId) : undefined;
    if (structuredCode === 'PUBLIC_ERROR_DANGER_FILTER') {
        return VEO3_DANGER_FILTER_MESSAGE;
    }
    if (MINOR_POLICY_REASONS.has(normalizedReason)) {
        return MINOR_POLICY_MESSAGE;
    }
    if (normalizedReason === 'public_error_sexual') {
        return 'Không cho tạo nội dung nhạy cảm.';
    }
    if (normalizedReason === 'public_error_model_access_denied') {
        return MODEL_ACCESS_DENIED_MESSAGE;
    }
    if (normalizedReason === 'public_error_unusual_activity_too_much_traffic') {
        return TOO_MUCH_TRAFFIC_MESSAGE;
    }
    if (isVeo3HijackError(responseBody)) {
        return HIJACK_ERROR_MESSAGE;
    }
    if (normalizedReason === 'public_error_unusual_activity') {
        return UNUSUAL_ACTIVITY_MESSAGE;
    }
    if (isVideo && normalizedReason === 'public_error_prominent_people_filter_failed') {
        return 'Không cho tạo video về người nổi tiếng.';
    }
    if (status === 400 &&
        (normalizedReason === 'public_error_unsafe_generation' ||
            (!structuredCode && apiStatus.toLowerCase() === 'invalid_argument'))) {
        return normalizedReason === 'public_error_unsafe_generation'
            ? 'Prompt bị Google Labs từ chối vì không an toàn hoặc không hợp lệ. Vui lòng mô tả rõ ràng hơn và tránh nội dung nhạy cảm.'
            : 'Prompt không hợp lệ với Google Labs. Vui lòng nhập mô tả có nghĩa và cụ thể hơn.';
    }
    if (isVeo3QuotaApiError(status, responseBody)) {
        return isVideo
            ? 'Veo 3 đã hết quota hoặc vượt giới hạn lượt tạo cho model hiện tại.'
            : formatVeo3QuotaSuggestion(currentModel);
    }
    if (structuredCode)
        return formatVeo3UnknownPublicError(structuredCode);
    return message
        ? translateVeo3ErrorMessage(message)
        : 'Google Labs đang bận hoặc chưa phản hồi ổn định. Vui lòng thử lại sau.';
}
export function describeVeo3ImageUpsampleError(status, responseBody) {
    const apiError = parseGoogleApiError(responseBody);
    const apiStatus = String(apiError?.status ?? '').toLowerCase();
    if (status === 400 && apiStatus === 'invalid_argument') {
        return 'Google Labs không chấp nhận yêu cầu tăng chất lượng ảnh lên 2K. Vui lòng thử lại; nếu vẫn lỗi, hãy tạo lại ảnh rồi tải 2K.';
    }
    return describeVeo3ApiError(status, responseBody);
}
export function isVeo3AutoRetryableSubmitError(status, responseBody) {
    const apiError = parseGoogleApiError(responseBody);
    const reason = getVeo3ApiErrorReason(responseBody).toLowerCase();
    const apiStatus = String(apiError?.status ?? '').toLowerCase();
    const message = String(apiError?.message ?? responseBody ?? '').toLowerCase();
    const combined = `${apiStatus} ${reason} ${message}`;
    if (isVeo3HijackError(responseBody))
        return true;
    if (isVeo3QuotaApiError(status, responseBody))
        return false;
    if (TERMINAL_POLICY_REASONS.has(reason))
        return false;
    if (status === 400 && apiStatus.includes('invalid_argument'))
        return true;
    if (reason.includes('public_error_unsafe_generation'))
        return true;
    if (combined.includes('unsafe_generation'))
        return true;
    if (combined.includes('không an toàn') || combined.includes('không hợp lệ'))
        return true;
    return false;
}
export function shouldRetryRecaptcha(status, responseBody) {
    if (isVeo3HijackError(responseBody))
        return true;
    if (isVeo3TooMuchTrafficError(status, responseBody))
        return false;
    const apiError = parseGoogleApiError(responseBody);
    const reason = getVeo3ApiErrorReason(responseBody).toLowerCase();
    const message = `${apiError?.status ?? ''} ${apiError?.message ?? responseBody ?? ''} ${reason}`.toLowerCase();
    const captchaLike = message.includes('captcha') ||
        message.includes('recaptcha') ||
        message.includes('unusual_activity') ||
        message.includes('unusual activity');
    if (reason.includes('unsafe_generation') ||
        reason.includes('quota_reached') ||
        reason.includes('resource_exhausted') ||
        message.includes('public_error_unsafe_generation') ||
        message.includes('public_error_user_quota_reached') ||
        message.includes('public_error_per_model_daily_quota_reached') ||
        message.includes('resource_exhausted') ||
        message.includes('quota')) {
        return false;
    }
    if (reason.includes('invalid_argument') || message.includes('invalid_argument')) {
        return captchaLike;
    }
    if (status === 401)
        return captchaLike;
    if (isVeo3AuthApiError(status, responseBody))
        return false;
    if (status === 403)
        return true;
    if (status === 400) {
        return captchaLike;
    }
    return captchaLike;
}
export function isVeo3UnusualActivityError(status, responseBody) {
    const reason = getVeo3ApiErrorReason(responseBody).toLowerCase();
    if (reason === 'public_error_unusual_activity_too_much_traffic')
        return true;
    if (status !== 403)
        return false;
    const apiError = parseGoogleApiError(responseBody);
    const message = `${apiError?.status ?? ''} ${apiError?.message ?? responseBody ?? ''} ${reason}`.toLowerCase();
    return (reason.includes('public_error_unusual_activity') ||
        reason.includes('unusual_activity') ||
        message.includes('public_error_unusual_activity') ||
        message.includes('unusual activity'));
}
export function logVeo3ApiError(status, responseBody, contextValue, contextLabel = 'prompt') {
    const apiError = parseGoogleApiError(responseBody);
    const reason = getVeo3ApiErrorReason(responseBody);
    const details = [
        `http=${status}`,
        apiError?.status ? `status=${apiError.status}` : null,
        reason ? `reason=${reason}` : null,
        apiError?.message ? `message="${apiError.message}"` : null,
        `${contextLabel}="${contextValue.slice(0, 120)}"`,
    ].filter(Boolean);
    log.warn(`[Veo3] API rejected request: ${details.join(' | ')}`);
}
