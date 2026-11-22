export const FLOW_BATCH_PATH = '/_/AiSandboxAngularFrontend/data/batchexecute';
export const FLOW_RPC_SOURCE_PATH = '/';
export const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
export const UUID_EXACT_PATTERN = new RegExp(`^${UUID_PATTERN.source}$`, 'i');
export const FLOW_MEDIA_ID_PATTERN = new RegExp(`${UUID_PATTERN.source}(?:_upsampled)?`, 'i');
export const FLOW_MEDIA_ID_EXACT_PATTERN = new RegExp(`^${FLOW_MEDIA_ID_PATTERN.source}$`, 'i');
