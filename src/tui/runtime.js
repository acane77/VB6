import {DOMTuiRenderer} from './dom.js';
import {normalizeDOSSettings} from './cells.js';
const sessions = new WeakMap();

/** Stage-scoped ownership: a classic or disposed application must not turn off
 * another application's TUI renderer in the same document. Native and nested
 * ApplicationHosts also establish boundaries, even when not cell-painted. */
export function installRuntimeTUI(container, options = {}) {
  const document = container.ownerDocument, root = document.documentElement;
  const requested = options.presentation ?? (root.hasAttribute('data-vb-dos') ? {
    mode: 'dos', profile: root.getAttribute('data-vb-dos'),
    cellWidth: Number(root.getAttribute('data-dos-cell-width')),
    cellHeight: Number(root.getAttribute('data-dos-cell-height'))
  } : {});
  const settings = normalizeDOSSettings(requested);
  let session = sessions.get(container);
  if (!session) {
    session = {renderer: null, boundary: container.getAttribute('data-tui-boundary')};
    container.setAttribute('data-tui-boundary', ''); sessions.set(container, session);
  }
  if (settings.mode !== 'dos') {
    session.renderer?.dispose(); session.renderer = null;
  } else if (session.renderer && !session.renderer.disposed) session.renderer.configure(settings);
  else session.renderer = new DOMTuiRenderer(document, {root: container, shell: false, settings});
  return session.renderer;
}

export function disposeRuntimeTUI(container) {
  const session = sessions.get(container); if (!session) return;
  sessions.delete(container); session.renderer?.dispose();
  if (session.boundary === null) container.removeAttribute('data-tui-boundary');
  else container.setAttribute('data-tui-boundary', session.boundary);
}
