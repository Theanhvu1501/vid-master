/**
 * Reference media utilities for Veo3 Flow
 */

function validateImageTagTokens(prompt, imageTags, filenames) {
  // Simple implementation - find image tag references in prompt
  const matches = [];
  for (const tag of imageTags) {
    const pattern = new RegExp(`@${tag.filename}\\b`, 'g');
    let match;
    while ((match = pattern.exec(prompt)) !== null) {
      if (filenames.includes(tag.filename)) {
        matches.push({
          ...tag,
          start: match.index,
          end: match.index + match[0].length,
        });
      }
    }
  }
  return matches.sort((a, b) => a.start - b.start);
}

export function readVeo3UploadImageResult(value, fallbackHandle) {
  const response = value;
  const mediaId = response.media?.name;
  if (typeof mediaId !== 'string' || !mediaId.trim()) return null;
  const displayName = response.workflow?.metadata?.displayName;
  const handle =
    typeof displayName === 'string' && displayName.trim()
      ? displayName.trim()
      : fallbackHandle;
  return { mediaId: mediaId.trim(), handle };
}

export function buildVeo3StructuredPromptParts(
  prompt,
  references,
  imageTags = []
) {
  const referenceByFilename = new Map(
    references.map((reference) => [reference.filename, reference])
  );
  const matches = validateImageTagTokens(
    prompt,
    imageTags,
    references.map((reference) => reference.filename)
  ).map((tag) => ({ ...tag, reference: referenceByFilename.get(tag.filename) }));

  if (matches.length === 0) return [{ text: prompt }];

  const parts = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.start < cursor) continue;
    if (match.start > cursor) parts.push({ text: prompt.slice(cursor, match.start) });
    parts.push({
      reference: {
        filename: match.reference.filename,
        mediaId: match.reference.mediaId,
      },
    });
    cursor = match.end;
  }
  if (cursor < prompt.length) parts.push({ text: prompt.slice(cursor) });
  return parts;
}
