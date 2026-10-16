/** Native Line endpoints in parent-relative twips. Reads never normalize the
 * document. Legacy browser lines without endpoints remain horizontal. */
export const LINE_ENDPOINTS = ['X1', 'Y1', 'X2', 'Y2'];
export const LINE_BOUNDS = ['Left', 'Top', 'Width', 'Height'];
export const isLineGeometry = key => LINE_ENDPOINTS.includes(key) || LINE_BOUNDS.includes(key);
const finite = (value, name) => {
  const n = Number(value);
  if (!Number.isFinite(n) || Math.abs(n) > 300000) throw new RangeError(`Invalid Line ${name} (twips).`);
  return n;
};
export function lineEndpoints(p = {}) {
  if (LINE_ENDPOINTS.some(key => Object.hasOwn(p, key))) return Object.fromEntries(LINE_ENDPOINTS.map(key => [key, Number(p[key] ?? 0)]));
  const X1 = Number(p.X1 ?? p.Left ?? 0), Y1 = Number(p.Y1 ?? p.Top ?? 0);
  return {X1, Y1, X2: Number(p.X2 ?? X1 + Number(p.Width ?? 1440)), Y2: Number(p.Y2 ?? Y1)};
}
export function lineBounds(p) {
  const {X1, Y1, X2, Y2} = lineEndpoints(p);
  return {Left: Math.min(X1, X2), Top: Math.min(Y1, Y2), Width: Math.abs(X2 - X1), Height: Math.abs(Y2 - Y1)};
}
/** Return both native endpoints and the derived editor rectangle atomically.
 * Rectangle resizing preserves direction, including reversed/zero-size lines. */
export function editLineGeometry(p, changes) {
  const endpoints = lineEndpoints(p), bounds = lineBounds(p);
  const endpointEdit = LINE_ENDPOINTS.some(key => Object.hasOwn(changes, key));
  if (endpointEdit && LINE_BOUNDS.some(key => Object.hasOwn(changes, key))) throw new Error('Edit Line endpoints separately from its bounds.');
  if (endpointEdit) {
    for (const key of LINE_ENDPOINTS) if (Object.hasOwn(changes, key)) endpoints[key] = finite(changes[key], key);
  } else {
    for (const [position, size, start, end] of [['Left', 'Width', 'X1', 'X2'], ['Top', 'Height', 'Y1', 'Y2']]) {
      const at = finite(changes[position] ?? bounds[position], position), length = finite(changes[size] ?? bounds[size], size);
      if (length < 0) throw new RangeError(`Invalid Line ${size} (twips).`);
      const reverse = endpoints[start] > endpoints[end];
      endpoints[start] = at + (reverse ? length : 0); endpoints[end] = at + (reverse ? 0 : length);
    }
  }
  for (const key of LINE_ENDPOINTS) endpoints[key] = finite(endpoints[key], key);
  const nextBounds = lineBounds(endpoints);
  for (const key of LINE_BOUNDS) finite(nextBounds[key], key);
  return {...endpoints, ...nextBounds};
}
export function lineDistance(p, x, y) {
  const {X1, Y1, X2, Y2} = lineEndpoints(p), dx = X2 - X1, dy = Y2 - Y1;
  const t = dx || dy ? Math.max(0, Math.min(1, ((x - X1) * dx + (y - Y1) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(x - X1 - t * dx, y - Y1 - t * dy);
}
