/** Shared WebGPU/WebGL2 instance encoder. Colors remain unpremultiplied sRGB.
 * Clip against physical pixel centers, not CSS coordinates divided in a shader:
 * division introduced edge disagreements at fractional DPI.
 * Source: WebGPU fragment position and pixel-coordinate conventions:
 * https://gpuweb.github.io/gpuweb/#coordinate-systems
 * Original implementation; no third-party code copied.
 */
export const INSTANCE_FLOATS = 24;
export const INSTANCE_BYTES = INSTANCE_FLOATS * 4;
export function encodeInstances(commands, data, scaleX, scaleY, first = 0, end = commands.length) {
  let at = first * INSTANCE_FLOATS;
  for (let index = first; index < end; index++) {
    const c = commands[index];
    data.set(c.rect, at);
    const [x, y, w, h] = c.clip;
    const left = Math.ceil(x * scaleX - .5), top = Math.ceil(y * scaleY - .5);
    const right = Math.ceil((x + w) * scaleX - .5), bottom = Math.ceil((y + h) * scaleY - .5);
    data[at + 4] = left; data[at + 5] = top;
    data[at + 6] = right - left; data[at + 7] = bottom - top;
    data.set(c.color, at + 8); data.set(c.color2, at + 12); data.set(c.uv, at + 16);
    data[at + 20] = c.hole ? 2 : c.page ? 1 : 0;
    data[at + 21] = c.vertical ? 1 : 0;
    data[at + 22] = data[at + 23] = 0;
    at += INSTANCE_FLOATS;
  }
  return at;
}
/** Only sealed scenes can reuse encoded geometry; mutable public command arrays
 * continue to be observed on every draw. Image pixels are revisioned separately.
 */
export function canReuseInstances(painter, scene, size) {
  return scene.sealed === true && painter.encodedScene === scene &&
    painter.encodedWidth === size.width && painter.encodedHeight === size.height &&
    painter.encodedData === painter.data;
}
export function rememberInstances(painter, scene, size) {
  painter.encodedScene = scene.sealed ? scene : null;
  painter.encodedWidth = size.width; painter.encodedHeight = size.height;
  painter.encodedScaleX = size.scaleX; painter.encodedScaleY = size.scaleY; painter.encodedData = painter.data;
}

/** Ordered batches keep page identities, not GPU handles, so a resized/revised
 * atlas page can refresh its texture without repacking immutable geometry. */
export function prepareBatches(painter, scene) {
  if (scene.sealed && painter.batchedScene === scene) return painter.batches;
  const groups = [], pages = new Set();
  for (let index = 0; index < scene.commands.length; index++) {
    const command = scene.commands[index], page = command.page || null;
    if (page) pages.add(page);
    const previous = groups.at(-1), hole = Boolean(command.hole);
    if (previous && previous.page === page && previous.hole === hole) previous.count++;
    else groups.push({first: index, count: 1, page, hole});
  }
  painter.batches = {groups, pages}; painter.batchedScene = scene.sealed ? scene : null;
  painter.stats.batchBuilds = (painter.stats.batchBuilds || 0) + 1;
  return painter.batches;
}

/** Compare only fields that are encoded into the instance buffer. A texture
 * identity change rebuilds ordered bindings, but does not change a quad's bytes.
 * Prefix/suffix comparison keeps changed commands at their original offsets;
 * removing a tail never requires uploading the unchanged surviving prefix.
 */
function sameInstance(a, b) {
  if (!a || !b || Boolean(a.hole) !== Boolean(b.hole) || Boolean(a.page) !== Boolean(b.page) ||
      Boolean(a.vertical) !== Boolean(b.vertical)) return false;
  for (const key of ['rect', 'clip', 'color', 'color2', 'uv']) {
    const x = a[key], y = b[key];
    if (x === y) continue;
    if (!x || !y || x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) if (!Object.is(x[i], y[i])) return false;
  }
  return true;
}
export function instanceUpdateRange(painter, scene, size) {
  const end = scene.commands.length;
  if (canReuseInstances(painter, scene, size)) return {first: 0, end: 0};
  const previous = painter.encodedScene;
  if (!scene.sealed || !previous?.sealed || painter.encodedData !== painter.data ||
      painter.encodedScaleX !== size.scaleX || painter.encodedScaleY !== size.scaleY) return {first: 0, end};
  let first = 0, last = end;
  while (first < end && sameInstance(previous.commands[first], scene.commands[first])) first++;
  while (last > first && sameInstance(previous.commands[last - 1], scene.commands[last - 1])) last--;
  return {first, end: last};
}
export function recordInstanceUpload(stats, first, end) {
  const bytes = (end - first) * INSTANCE_BYTES;
  stats.instanceUploads++; stats.uploadedBytes += bytes;
  stats.instanceUploadedBytes = (stats.instanceUploadedBytes || 0) + bytes;
}
