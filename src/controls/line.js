import {lineBounds, lineEndpoints} from './line-geometry.js';
import {cssColor} from '../theme/theme.js';
const NS = 'http://www.w3.org/2000/svg';
export function buildLine(control) {
  const doc = control.node.ownerDocument, svg = doc.createElementNS(NS, 'svg');
  const stroke = doc.createElementNS(NS, 'path'), hit = doc.createElementNS(NS, 'path');
  svg.setAttribute('aria-hidden', 'true');
  Object.assign(svg.style, {position: 'absolute', inset: '0', width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none'});
  for (const path of [stroke, hit]) {path.setAttribute('fill', 'none'); path.setAttribute('stroke-linecap', 'round');}
  hit.setAttribute('stroke', 'transparent'); hit.style.pointerEvents = control.design ? 'stroke' : 'none';
  stroke.style.pointerEvents = control.design ? 'none' : 'stroke';
  // Do not turn the line's bounding box into an opaque hit target. The broad
  // transparent stroke makes horizontal/vertical/point lines selectable too.
  control.node.style.pointerEvents = 'none'; control.node.style.overflow = 'visible';
  svg.append(stroke, hit); control.node.append(svg); control.lineView = {svg, stroke, hit};
}
export function refreshLine(control) {
  const p = control.props, b = lineBounds(p), {X1, Y1, X2, Y2} = lineEndpoints(p), {stroke, hit} = control.lineView;
  const width = Math.max(1, Number(p.BorderWidth) || 1), style = Number(p.BorderStyle ?? 1);
  const d = `M ${(X1-b.Left)/15} ${(Y1-b.Top)/15} L ${(X2-b.Left)/15} ${(Y2-b.Top)/15}`;
  for (const path of [stroke, hit]) path.setAttribute('d', d);
  stroke.setAttribute('stroke', style === 0 ? 'transparent' : cssColor(p.BorderColor ?? 0));
  stroke.setAttribute('stroke-width', String(width)); hit.setAttribute('stroke-width', String(Math.max(8, width)));
  const dash = ({2:[6,4],3:[1,3],4:[6,3,1,3],5:[6,3,1,3,1,3]})[style];
  if (dash) stroke.setAttribute('stroke-dasharray', dash.map(n => n * width).join(' ')); else stroke.removeAttribute('stroke-dasharray');
}
