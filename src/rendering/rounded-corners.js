/** Keep exact browser antialiasing in rounded corner islands while the box
 * interior, straight borders and descendants remain eligible for GPU painting.
 * Percentage/elliptical radii resolve against the untransformed border box;
 * the CSS overlap factor scales ALL corners before the element transform.
 * https://www.w3.org/TR/css-backgrounds-3/#corner-overlap
 */
const SIDES = ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'];
function length(value, extent) {
  const match = /^(\d*\.?\d+)(px|%)?$/.exec(value);
  if (!match) throw new TypeError('native corner radius');
  return Number(match[1]) * (match[2] === '%' ? extent / 100 : 1);
}
export function roundedRadii(style, width, height, scaleX = 1, scaleY = 1) {
  const radii = SIDES.map(side => {
    const values = (style['border' + side + 'Radius'] || '0px').trim().split(/\s+/);
    if (values.length > 2) throw new TypeError('native corner radius');
    const x = length(values[0], width), y = length(values[1] || values[0], height);
    return x && y ? [x, y] : [0, 0];
  });
  const ratio = (extent, sum) => sum > 0 ? extent / sum : 1;
  const factor = Math.min(1, ratio(width, radii[0][0] + radii[1][0]), ratio(width, radii[3][0] + radii[2][0]),
    ratio(height, radii[0][1] + radii[3][1]), ratio(height, radii[1][1] + radii[2][1]));
  return radii.map(([x, y]) => [x * factor * scaleX, y * factor * scaleY]);
}
export function preserveRoundedCorners(scene, rect, radii, clip, borders = [0, 0, 0, 0]) {
  const [x, y, width, height] = rect, [t, r, b, l] = borders, pad = 2 / scene.dpr;
  let corners = 0;
  for (let index = 0; index < 4; index++) {
    const [rx, ry] = radii[index]; if (!rx || !ry) continue;
    const right = index === 1 || index === 2, bottom = index >= 2;
    // A border wider than its radius expands the corner's color transition area.
    const w = Math.max(rx, right ? r : l), h = Math.max(ry, bottom ? b : t);
    scene.native([right ? x + width - w - pad : x - pad, bottom ? y + height - h - pad : y - pad,
      w + 2 * pad, h + 2 * pad], clip, 'rounded CSS corner'); corners++;
  }
  scene.stats.roundedCornerIslands = (scene.stats.roundedCornerIslands || 0) + corners;
  return corners;
}
