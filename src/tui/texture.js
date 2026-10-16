import {EGA} from './cells.js';
import {tuiAttribute} from './appearance.js';
const cache=new Map();
/** A four-pixel geometric screen texture; no fonts, images or remote assets.
 * Every texel is an opaque EGA value, rather than an antialiased CSS gradient. */
export function desktopPattern(profile='turbo') {
  const key=['turbo','commander','win31','monochrome'].includes(profile)?profile:'turbo';
  if(cache.has(key))return cache.get(key);
  const a=tuiAttribute(key,'desktop');
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4" shape-rendering="crispEdges"><path fill="${EGA[a.background]}" d="M0 0h4v4H0z"/><path fill="${EGA[a.foreground]}" d="M0 0h1v1H0zM2 2h1v1H2z"/></svg>`;
  const value=`url("data:image/svg+xml,${encodeURIComponent(svg)}")`;cache.set(key,value);return value;
}
