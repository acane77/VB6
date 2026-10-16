import {uiDocument} from './window-context.js';

/** Construct text-safe DOM in the active IDE document (or attrs.document).
 * namespace supports explicit SVG/MathML creation; event tuples accept the same
 * listener options as addEventListener. No string is interpreted as markup.
 */
export function el(tag, attrs = {}, ...children) {
  attrs ??= {};
  const doc = attrs.document ?? uiDocument();
  if (!doc?.createElement) throw new Error('DOM construction requires a UI document.');
  const node = attrs.namespace ? doc.createElementNS(attrs.namespace, tag) : doc.createElement(tag);
  let value, hasValue = false;
  for (const [key, data] of Object.entries(attrs)) {
    if (key === 'document' || key === 'namespace' || key === 'ref' || data == null) continue;
    if (key === 'class') node.setAttribute('class', String(data));
    else if (key === 'text') node.textContent = data;
    else if (key === 'value') { value = data; hasValue = true; }
    else if (key === 'style' && typeof data === 'object') {
      for (const [name, setting] of Object.entries(data)) if (setting != null) {
        if (name.includes('-')) node.style.setProperty(name, String(setting));
        else node.style[name] = setting;
      }
    } else if (key === 'dataset' && typeof data === 'object') {
      for (const [name, setting] of Object.entries(data)) if (setting != null) node.dataset[name] = String(setting);
    } else if (key.startsWith('on') && (typeof data === 'function' || Array.isArray(data))) {
      const [listener, options] = Array.isArray(data) ? data : [data];
      if (typeof listener !== 'function' && typeof listener?.handleEvent !== 'function') throw new TypeError('Invalid DOM event listener.');
      node.addEventListener(key.slice(2).toLowerCase(), listener, options);
    } else if (key === 'indeterminate') node.indeterminate = !!data;
    else if (key.startsWith('aria-') || ['spellcheck', 'draggable', 'contenteditable'].includes(key)) node.setAttribute(key, String(data));
    else if (data !== false) node.setAttribute(key === 'htmlFor' ? 'for' : key, data === true ? '' : String(data));
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || typeof child === 'boolean') continue;
    node.append(child.nodeType ? child : doc.createTextNode(String(child)));
  }
  if (hasValue) {
    // Existing IDE textarea calls supply their initial source as child text.
    // Preserve that convention; value becomes the initializer only without it.
    node.setAttribute('value', String(value));
    if ('value' in node && (node.localName !== 'textarea' || !node.childNodes.length)) node.value = value;
  }
  if (attrs.ref != null) {
    if (typeof attrs.ref !== 'function') throw new TypeError('ref must be a function.');
    attrs.ref(node);
  }
  return node;
}

/** Start a download and return an idempotent resource-release function.
 * Timers are owned by the module's realm, not by an active detached popup.
 */
export function download(name, data, type = 'application/octet-stream', {document: doc = uiDocument(), signal, revokeAfter = 3000} = {}) {
  if (!doc?.createElement) throw new Error('Downloading requires a UI document.');
  if (!Number.isFinite(revokeAfter) || revokeAfter < 0 || revokeAfter > 0x7fffffff) throw new RangeError('Invalid object URL lifetime.');
  if (signal != null && (typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function' || typeof signal.aborted !== 'boolean'))
    throw new TypeError('signal must be an AbortSignal.');
  if (signal?.aborted) throw signal.reason;
  const BlobType = globalThis.Blob ?? doc.defaultView?.Blob;
  const urls = globalThis.URL;
  if (!BlobType || !urls?.createObjectURL) throw new Error('Object URL downloads are unavailable.');
  let isBlob = false;
  try {
    // Use the native brand check, not realm-sensitive instanceof or a spoofable
    // toStringTag; detached-window Blob/File MIME types are retained.
    Object.getOwnPropertyDescriptor(BlobType.prototype, 'size').get.call(data);
    isBlob = true;
  } catch {}
  const blob = isBlob ? data : new BlobType([data], {type});
  const url = urls.createObjectURL(blob);
  let timer, anchor, released = false;
  const cleanup = () => {
    if (released) return false;
    released = true;
    clearTimeout(timer);
    signal?.removeEventListener('abort', cleanup);
    try { doc.defaultView?.removeEventListener('pagehide', pagehide); } catch {}
    anchor?.remove();
    urls.revokeObjectURL(url);
    return true;
  };
  const pagehide = event => { if (!event.persisted) cleanup(); };
  try {
    anchor = doc.createElement('a');
    anchor.href = url; anchor.download = String(name); anchor.hidden = true;
    (doc.body ?? doc.documentElement).append(anchor);
    signal?.addEventListener('abort', cleanup, {once: true});
    doc.defaultView?.addEventListener('pagehide', pagehide);
    timer = setTimeout(cleanup, revokeAfter);
    if (signal?.aborted) { cleanup(); throw signal.reason; }
    anchor.click();
    anchor.remove();
  } catch (error) { cleanup(); throw error; }
  return cleanup;
}
