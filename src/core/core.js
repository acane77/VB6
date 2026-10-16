import {Signal} from './signal.js';
import {History} from './history.js';
import {debounce} from './debounce.js';
import {el, download} from './dom.js';
/** Stable compatibility entry point; individual primitives can be imported alone. */
export {Signal, History, debounce, el, download};
export const clone = value => structuredClone(value);
export const lower = name => String(name).toLowerCase().replace(/[$%&!#@]$/, '');
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
/** Portable single-component filename, retaining the existing ASCII convention. */
export function safeName(name, fallback = 'Project1') {
  const sanitize = value => {
    let text = String(value ?? '').replace(/[^\w .-]/g, '_').slice(0, 100).replace(/^[ .]+|[ .]+$/g, '');
    if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(text)) text = '_' + text;
    return text.slice(0, 100).replace(/[ .]+$/g, '');
  };
  return sanitize(name) || sanitize(fallback) || 'Project1';
}
export const VERSION = '0.6.0';
