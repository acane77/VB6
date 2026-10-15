/** Bounded, per-resource change history. Each painter owns its upload cursor;
 * one canvas/window must not consume another painter's dirty rectangles.
 * Source: https://www.w3.org/TR/webgpu/#dom-gpuqueue-copyexternalimagetotexture
 * Source: https://registry.khronos.org/webgl/specs/latest/2.0/#DOM_UPLOAD_UNPACK_PARAMS
 */
const HISTORY = 64;
export function markTextureDirty(page, rect) {
  if (!Number.isSafeInteger(page.revision) || page.revision < 0 ||
      !Array.isArray(rect) || rect.length !== 4 || !rect.every(Number.isInteger) ||
      rect[0] < 0 || rect[1] < 0 || rect[2] <= 0 || rect[3] <= 0 ||
      rect[0] + rect[2] > page.width || rect[1] + rect[3] > page.height) {
    throw new RangeError('Invalid texture update.');
  }
  // Reset history on a caller-managed revision discontinuity, never assume that
  // the unreported pixels stayed unchanged. Revisions are monotonic per canvas.
  const changes = page.changes || (page.changes = []);
  if (changes.length && changes.at(-1).revision !== page.revision) changes.length = 0;
  page.revision++;
  changes.push({revision: page.revision, rect: [...rect]});
  if (changes.length > HISTORY) changes.splice(0, changes.length - HISTORY);
}
export function textureUploadRegion(page, previous) {
  const full = () => ({x: 0, y: 0, width: page.width, height: page.height, full: true});
  if (!previous || previous.source !== page.canvas || previous.width !== page.width ||
      previous.height !== page.height || !Number.isSafeInteger(previous.revision)) return full();
  if (previous.revision === page.revision) return null;
  const changes = page.changes;
  if (!changes?.length || previous.revision < changes[0].revision - 1 ||
      previous.revision >= page.revision || changes.at(-1).revision !== page.revision) return full();
  let x = page.width, y = page.height, right = 0, bottom = 0, expected = previous.revision + 1;
  for (const change of changes) {
    if (change.revision <= previous.revision) continue;
    if (change.revision !== expected++) return full();
    const r = change.rect;
    x = Math.min(x, r[0]); y = Math.min(y, r[1]);
    right = Math.max(right, r[0] + r[2]); bottom = Math.max(bottom, r[1] + r[3]);
  }
  if (expected !== page.revision + 1 || right <= x || bottom <= y) return full();
  return {x, y, width: right - x, height: bottom - y,
    full: x === 0 && y === 0 && right === page.width && bottom === page.height};
}
export function rememberTextureUpload(record, page, region, stats) {
  record.revision = page.revision; record.source = page.canvas;
  record.width = page.width; record.height = page.height;
  const bytes = region.width * region.height * 4;
  stats.uploadedBytes += bytes;
  stats.textureUploadedBytes = (stats.textureUploadedBytes || 0) + bytes;
  stats.textureUploads = (stats.textureUploads || 0) + 1;
  if (!region.full) stats.partialTextureUploads = (stats.partialTextureUploads || 0) + 1;
}
