import {splitCSS} from './scene.js';
/** Conservative native paint bounds, in CSS pixels. A four-pixel halo clipped
 * large shadows and offset focus rings. Parse computed lengths, account for
 * multiple shadows, and preserve the whole clip for unknown filter geometry.
 * CSS blur approximates a Gaussian; a two-radius halo plus two CSS pixels is
 * deliberately conservative rather than pretending to be an exact blur kernel.
 * https://www.w3.org/TR/css-backgrounds-3/#shadow-blur
 */
function tokens(value) {
  let depth = 0, start = 0; const parts = [];
  for (let i = 0; i <= value.length; i++) {
    if (value[i] === '(') depth++;
    if (value[i] === ')') depth--;
    if (i === value.length || (!depth && /\s/.test(value[i]))) {
      if (i > start) parts.push(value.slice(start, i)); start = i + 1;
    }
  }
  return parts;
}
const px = value => /^-?(?:\d*\.)?\d+(?:px)?$/.test(value) ? Number.parseFloat(value) : NaN;
export function nativePaintBounds(rect, style, clip, scaleX = 1, scaleY = 1) {
  if (style.filter && style.filter !== 'none') return [...clip];
  let [x, y, width, height] = rect, left = x - 1, top = y - 1, right = x + width + 1, bottom = y + height + 1;
  if (style.outlineStyle && style.outlineStyle !== 'none' && style.outlineStyle !== 'hidden') {
    const extent = Math.max(0, (Number.parseFloat(style.outlineWidth) || 0) + (Number.parseFloat(style.outlineOffset) || 0)) + 2;
    left -= extent * scaleX; right += extent * scaleX; top -= extent * scaleY; bottom += extent * scaleY;
  }
  if (style.boxShadow && style.boxShadow !== 'none') for (const shadow of splitCSS(style.boxShadow)) {
    const parts = tokens(shadow); if (parts.includes('inset')) continue;
    const lengths = parts.map(px).filter(Number.isFinite);
    if (lengths.length < 2 || lengths.length > 4 || parts.some(part => /(?:calc|var)\(/.test(part))) return [...clip];
    const [dx, dy, blur = 0, spread = 0] = lengths;
    if (blur < 0) return [...clip];
    const pad = Math.max(0, spread) + blur * 2 + 2;
    left = Math.min(left, x + (dx - pad) * scaleX); right = Math.max(right, x + width + (dx + pad) * scaleX);
    top = Math.min(top, y + (dy - pad) * scaleY); bottom = Math.max(bottom, y + height + (dy + pad) * scaleY);
  }
  return [left, top, right - left, bottom - top];
}
