/**
 * Veo3 image artifacts helpers
 * Adapted from phoma - image writing is handled by the adapter/saveFn
 */

export function stripDataUrlPrefix(value) {
  const commaIndex = value.indexOf(',');
  return commaIndex >= 0 ? value.slice(commaIndex + 1) : value;
}

function isUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function extractUuidFromUrl(value) {
  if (typeof value !== 'string') return undefined;
  const match = value.match(/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[/?#]|$)/i);
  return match?.[1];
}

export function collectImageArtifacts(obj) {
  const seenUrls = new Set();
  const artifacts = [];
  const addArtifact = (url, mediaId) => {
    if (seenUrls.has(url)) return;
    seenUrls.add(url);
    artifacts.push({ url, mediaId });
  };
  const mediaItems = obj?.media;
  if (Array.isArray(mediaItems) && mediaItems.length > 0) {
    mediaItems.forEach((item) => {
      const media = item;
      const generated = media.image?.generatedImage ?? {};
      const url =
        generated.fifeUrl ??
        generated.imageUri ??
        generated.downloadUrl ??
        generated.uri ??
        media.fifeUrl ??
        media.imageUri ??
        media.downloadUrl ??
        media.uri;
      if (typeof url !== 'string' || !url) return;
      const mediaId =
        (isUuid(media.name) && media.name) ||
        (isUuid(generated.mediaId) && generated.mediaId) ||
        extractUuidFromUrl(url);
      addArtifact(url, mediaId);
    });
    if (artifacts.length > 0) return artifacts;
  }
  const collect = (value) => {
    if (typeof value === 'string') {
      if (/^(https?:)?\/\//.test(value)) addArtifact(value, extractUuidFromUrl(value));
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(collect);
      return;
    }
    const o = value;
    const url = o.downloadUrl ?? o.uri ?? o.fifeUrl ?? o.imageUri;
    if (typeof url === 'string' && url) {
      addArtifact(url, (isUuid(o.name) && o.name) || (isUuid(o.mediaId) && o.mediaId) || extractUuidFromUrl(url));
    }
    Object.values(o).forEach(collect);
  };
  collect(obj);
  return artifacts;
}
