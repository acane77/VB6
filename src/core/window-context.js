/** Documents belonging to one live IDE session. No DOM monkey-patching.
 * Registrations are reference counted; a popup/navigation cannot leave its
 * document selected after it closes. Documents without a Window are supported.
 */
const documents = new Map();
let current = null;
function live(doc) {
  if (!doc || typeof doc.createElement !== 'function') return false;
  try {
    const view = doc.defaultView;
    return !view || (!view.closed && view.document === doc);
  } catch { return false; }
}
function focused(doc) { try { return !!doc.hasFocus?.(); } catch { return false; } }
function release(record) { for (const off of [...record.owners]) off(); }

export function registerUIDocument(doc, {signal} = {}) {
  if (!live(doc) || typeof doc.addEventListener !== 'function' || typeof doc.removeEventListener !== 'function')
    throw new TypeError('A live UI Document is required.');
  if (signal != null && (typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function' || typeof signal.aborted !== 'boolean'))
    throw new TypeError('signal must be an AbortSignal.');
  if (signal?.aborted) return () => false;
  let record = documents.get(doc);
  if (!record) {
    const view = doc.defaultView;
    const activate = () => { if (live(doc)) current = doc; };
    record = {owners: new Set(), cleanup: null};
    const pagehide = event => {
      if (current === doc) current = null;
      // BFCache freezes the same document; preserve registration for pageshow.
      if (!event.persisted) release(record);
    };
    const pageshow = () => { if (focused(doc)) activate(); };
    record.cleanup = () => {
      if (documents.get(doc) === record) documents.delete(doc);
      if (current === doc) current = null;
      // A navigated WindowProxy may already be cross-origin. Release our own
      // references even when the old realm no longer permits listener access.
      for (const remove of [
        () => doc.removeEventListener('focusin', activate, {capture: true}),
        () => doc.removeEventListener('pointerdown', activate, {capture: true}),
        () => view?.removeEventListener('pagehide', pagehide),
        () => view?.removeEventListener('pageshow', pageshow)
      ]) { try { remove(); } catch {} }
    };
    doc.addEventListener('focusin', activate, {capture: true});
    doc.addEventListener('pointerdown', activate, {capture: true});
    view?.addEventListener('pagehide', pagehide);
    view?.addEventListener('pageshow', pageshow);
    documents.set(doc, record);
  }
  let active = true;
  const off = () => {
    if (!active) return false;
    active = false;
    signal?.removeEventListener('abort', off);
    record.owners.delete(off);
    if (!record.owners.size) record.cleanup();
    return true;
  };
  record.owners.add(off);
  signal?.addEventListener('abort', off, {once: true});
  if (signal?.aborted) off();
  return off;
}

export function uiDocuments() {
  for (const [doc, record] of documents) if (!live(doc)) release(record);
  const root = globalThis.document;
  return [...new Set([...(live(root) ? [root] : []), ...documents.keys()])];
}
export function uiDocument(node) {
  // Accept a Document as well as a node (including ShadowRoot) or Window.
  let explicit;
  try { explicit = node?.nodeType === 9 ? node : node?.ownerDocument ?? node?.document; } catch {}
  if (live(explicit)) return explicit;
  const available = uiDocuments();
  if (current && !available.includes(current)) current = null;
  return (current && focused(current) ? current : available.find(focused)) ?? current ?? (live(globalThis.document) ? globalThis.document : available[0]) ?? null;
}
export function hasUIDialog() {
  return uiDocuments().some(doc => {
    try { return !!doc.querySelector('.ide-modal-cover'); } catch { return false; }
  });
}
