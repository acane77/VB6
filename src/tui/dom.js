import {observeRootLifetime} from './lifetime.js';
import {CellBuffer, CanvasCellRenderer, CellGlyphAtlas, TUI_PROFILES, normalizeDOSSettings} from './cells.js';
import {TuiControlRegistry} from './controls.js';
import {applyTUIStyle, retainTUIStyle} from './styles.js';
import {observeControlPaint} from '../rendering/invalidation.js';
import {captureControl} from './projection.js';
export {captureControl};

const SELECTOR = '.vb-control,.vb-form';
const owners = new WeakMap();
const roots = new WeakMap();
const surface = node => node.nodeType === 1 && node.classList.contains('vb-tui-surface');
const restoreAttribute = (node, key, value) => value === null ? node.removeAttribute(key) : node.setAttribute(key, value);

/** Demand-driven, scoped presentation over the existing control tree. Paint
 * invalidation is shared with BrowserControl, not inferred from .value setters.
 * Canvases never receive input, replace controls, or change authored geometry. */
export class DOMTuiRenderer {
  constructor(document, {root = document.documentElement, shell = root === document.documentElement,
    settings = {}, registry = new TuiControlRegistry(), onError = () => {}, onDispose = () => {}} = {}) {
    if (!root || root.ownerDocument !== document || roots.has(root)) throw new Error('TUI root must be an unowned element in its document');
    this.document = document; this.view = document.defaultView; this.root = root;
    this.settings = normalizeDOSSettings(settings); this.registry = registry; this.onError = onError; this.onDispose = onDispose;
    this.atlas = new CellGlyphAtlas(document); this.surfacePixels = 0;
    this.controls = new Map(); this.dirty = new Set(); this.listeners = [];
    this.frame = 0; this.disposed = false; this.pressed = null;
    this.metrics = {frames: 0, painted: 0, failures: 0, budgetFallbacks: 0};
    this.previous = new Map(['data-vb-dos', 'data-tui-root', 'data-tui-boundary', 'data-tui-shell'].map(key => [key, root.getAttribute(key)]));
    this.previousStyles = ['--dos-line', '--dos-cell-width'].map(key => [key, root.style.getPropertyValue(key), root.style.getPropertyPriority(key)]);
    roots.set(root, this);
    this.releaseStyle = retainTUIStyle(document);
    root.setAttribute('data-tui-root', ''); root.setAttribute('data-tui-boundary', '');
    if (shell) root.setAttribute('data-tui-shell', '');
    applyTUIStyle(root, this.settings);
    const observed = root === document.documentElement ? document.body : root;
    this.observer = new this.view.MutationObserver(records => this.mutations(records));
    this.resize = typeof this.view.ResizeObserver === 'function'
      ? new this.view.ResizeObserver(entries => { for (const entry of entries) this.invalidate(entry.target); }) : null;
    this.scan(observed);
    this.observer.observe(observed, {subtree: true, childList: true, characterData: true, attributes: true,
      attributeFilter: ['style', 'class', 'hidden', 'data-type', 'data-tui-boundary', 'aria-selected', 'aria-valuenow', 'aria-expanded', 'aria-orientation', 'disabled', 'checked', 'value']});
    const invalidate = event => {
      const node = event.target?.closest?.(SELECTOR);
      if (node) this.invalidate(node);
      else if (event.type === 'scroll') this.invalidateAll();
      if (event.type === 'pointerdown') this.pressed = node;
      if (['pointerup', 'pointercancel', 'lostpointercapture'].includes(event.type)) {
        this.invalidate(this.pressed); this.pressed = null;
      }
    };
    for (const type of ['input', 'change', 'focusin', 'focusout', 'pointerdown', 'pointerup', 'pointercancel', 'lostpointercapture', 'keydown', 'keyup', 'scroll', 'load']) this.listen(document, type, invalidate, true);
    this.listen(this.view, 'resize', () => this.invalidateAll());
    this.listen(this.view.visualViewport, 'resize', () => this.invalidateAll());
    this.listen(this.view.visualViewport, 'scroll', () => this.invalidateAll());
    this.listen(document, 'visibilitychange', () => {
      if (document.hidden) { this.view.cancelAnimationFrame(this.frame); this.frame = 0; }
      else this.invalidateAll();
    });
    this.listen(this.view, 'pagehide', event => { if (!event.persisted) this.dispose(); });
    this.listen(this.view, 'pageshow', () => this.invalidateAll());
    this.listen(document.fonts, 'loadingdone', () => this.invalidateGlyphs());
    this.watchDPR();
    this.releaseLifetime = observeRootLifetime(root, () => this.dispose());
  }
  listen(target, type, fn, capture = false) {
    target?.addEventListener(type, fn, capture);
    this.listeners.push(() => target?.removeEventListener(type, fn, capture));
  }
  watchDPR() {
    this.unwatchDPR?.();
    if (!this.view.matchMedia || this.disposed) return;
    const query = this.view.matchMedia(`(resolution: ${this.view.devicePixelRatio || 1}dppx)`);
    const changed = () => { this.invalidateGlyphs(); this.watchDPR(); };
    query.addEventListener('change', changed);
    this.unwatchDPR = () => query.removeEventListener('change', changed);
  }
  owns(node) {
    return !!node && node.ownerDocument === this.document && this.root.contains(node) &&
      node.closest('[data-tui-boundary]') === this.root;
  }
  scan(root) {
    if (!root?.querySelectorAll) return;
    if (root.matches?.(SELECTOR)) this.add(root);
    for (const node of root.querySelectorAll(SELECTOR)) this.add(node);
  }
  add(node) {
    if (this.controls.has(node) || !this.owns(node)) return;
    const capability = this.registry.capability(node.dataset.type);
    if (capability === 'native') return;
    const previousOwner = owners.get(node);
    if (previousOwner && previousOwner !== this) previousOwner.remove(node);
    const entry = {capability, canvas: null, painter: null, buffer: null, next: null, visible: false, pixels: 0, fallback: null,
      attributes: new Map(['data-tui-paint', 'data-tui-editing', 'data-tui-chrome'].map(key => [key, node.getAttribute(key)]))};
    owners.set(node, this); this.controls.set(node, entry);
    entry.unsubscribe = observeControlPaint(node, () => this.invalidate(node));
    if (capability === 'container') node.setAttribute('data-tui-chrome', '');
    this.resize?.observe(node); this.invalidate(node);
  }
  mutations(records) {
    for (const record of records) {
      const element = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      if (element?.closest?.('.vb-tui-surface')) continue;
      if (record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].every(surface)) continue;
      const node = element?.closest?.(SELECTOR);
      if (record.attributeName === 'data-type' && node) { this.remove(node); this.add(node); }
      if (node) this.invalidate(node);
      if (record.type === 'childList') {
        for (const added of record.addedNodes) if (added.nodeType === 1 && !surface(added)) this.scan(added);
      }
      if (record.type === 'attributes' && element) {
        if (record.attributeName === 'data-tui-boundary') this.scan(element);
        for (const child of element.querySelectorAll?.(SELECTOR) || []) this.invalidate(child);
      }
    }
    // Includes controls adopted into another document and newly nested hosts.
    for (const node of this.controls.keys()) if (!node.isConnected || !this.owns(node)) this.remove(node);
  }
  invalidate(node) {
    if (this.disposed || !this.controls.has(node)) return;
    this.dirty.add(node);
    if (!this.frame && !this.document.hidden) this.frame = this.view.requestAnimationFrame(() => this.flush());
  }
  invalidateAll() { for (const node of this.controls.keys()) this.invalidate(node); }
  invalidateGlyphs() {
    this.atlas.clear();
    for (const entry of this.controls.values()) entry.buffer?.invalidate();
    this.invalidateAll();
  }
  configure(settings) {
    this.settings = normalizeDOSSettings(settings); applyTUIStyle(this.root, this.settings);
    this.atlas.clear(); this.surfacePixels = 0;
    for (const entry of this.controls.values()) {
      entry.painter?.dispose(); entry.painter = null; entry.buffer = null; entry.next = null; entry.pixels = 0;
    }
    this.invalidateAll();
  }
  flush() {
    // Also safe to call synchronously from tests or a screenshot transaction.
    this.view.cancelAnimationFrame(this.frame); this.frame = 0;
    if (this.disposed) return;
    this.metrics.frames++;
    const dirty = [...this.dirty]; this.dirty.clear();
    for (const node of dirty) {
      if (!node.isConnected || !this.owns(node)) { this.remove(node); continue; }
      const entry = this.controls.get(node); if (!entry) continue;
      try {
        entry.visible = !!node.getClientRects().length && !node.closest('[hidden]');
        if (!entry.visible || entry.capability !== 'cells') continue;
        const width = node.clientWidth, height = node.clientHeight;
        if (width <= 0 || height <= 0) continue;
        const {cellWidth, cellHeight} = this.settings;
        // Preserve the actual cell pitch. A partial final cell is clipped, never
        // stretched over the control and never used to move the input geometry.
        const columns = Math.max(1, Math.ceil(width / cellWidth));
        const rows = Math.max(1, Math.ceil(height / cellHeight));
        if (columns > 256 || rows > 256) { this.fallback(node, 'budget'); continue; }
        if (!entry.canvas) {
          entry.canvas = this.document.createElement('canvas'); entry.canvas.className = 'vb-tui-surface';
          entry.canvas.setAttribute('aria-hidden', 'true');
        }
        if (entry.canvas.parentNode !== node) node.append(entry.canvas);
        entry.canvas.style.width = columns * cellWidth + 'px';
        entry.canvas.style.height = rows * cellHeight + 'px';
        entry.canvas.style.clipPath = `inset(0 ${Math.max(0, columns * cellWidth - width)}px ${Math.max(0, rows * cellHeight - height)}px 0)`;
        if (!entry.painter) entry.painter = new CanvasCellRenderer(entry.canvas, {cellWidth, cellHeight, atlas: this.atlas});
        const dimensions = entry.painter.dimensions({columns, rows}, this.view.devicePixelRatio);
        const pixels = dimensions.width * dimensions.height;
        if (this.surfacePixels - entry.pixels + pixels > 8388608) { this.fallback(node, 'budget'); continue; }
        this.surfacePixels += pixels - entry.pixels; entry.pixels = pixels;
        if (!entry.buffer || entry.buffer.columns !== columns || entry.buffer.rows !== rows) {
          const p = TUI_PROFILES[this.settings.profile];
          entry.buffer = new CellBuffer(columns, rows, p); entry.next = new CellBuffer(columns, rows, p);
        }
        node.setAttribute('data-tui-paint', 'cells');
        const state = captureControl(node, columns, rows, this.settings);
        this.registry.paint(entry.next, state, this.settings.profile);
        entry.buffer.blit(entry.next, 0, 0); entry.painter.render(entry.buffer, this.view.devicePixelRatio);
        // The original text editor/listbox/picker keeps its caret, IME,
        // selection, clipboard and native popup when focused at runtime.
        const editable = !!node.querySelector('input:not([type=checkbox]):not([type=radio]):not([type=range]),textarea,select,[contenteditable]');
        node.toggleAttribute('data-tui-editing', editable && state.focused && !node.closest('.designer-form'));
        entry.fallback = null; this.metrics.painted++;
      } catch (error) { this.fallback(node, error instanceof RangeError && /budget/.test(error.message) ? 'budget' : error.message || 'paint failure', error); }
    }
  }
  fallback(node, reason, error) {
    const entry = this.controls.get(node); if (!entry) return;
    if (entry.fallback !== reason) {
      if (reason === 'budget') this.metrics.budgetFallbacks++;
      else { this.metrics.failures++; this.onError(error, node); }
    }
    entry.fallback = reason;
    this.surfacePixels -= entry.pixels; entry.pixels = 0;
    entry.painter?.dispose(); entry.canvas?.remove();
    entry.canvas = null; entry.painter = null; entry.buffer = null; entry.next = null;
    for (const [key, value] of entry.attributes) restoreAttribute(node, key, value);
    // Keep the resize/materialization subscriptions: shrinking the control or
    // recovering the rendering context can restore cells on a later frame.
  }
  remove(node) {
    const entry = this.controls.get(node); if (!entry) return;
    this.surfacePixels -= entry.pixels; entry.pixels = 0;
    entry.unsubscribe?.(); entry.painter?.dispose(); entry.canvas?.remove();
    if (owners.get(node) === this) {
      for (const [key, value] of entry.attributes) restoreAttribute(node, key, value);
      owners.delete(node);
    }
    this.resize?.unobserve(node); this.controls.delete(node); this.dirty.delete(node);
  }
  snapshot() {
    return [...this.controls].filter(([node, entry]) => entry.buffer && entry.visible && this.owns(node))
      .map(([node, entry]) => ({id: node.dataset.controlId, name: node.dataset.control, type: node.dataset.type, ...entry.buffer.snapshot()}));
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.view.cancelAnimationFrame(this.frame); this.frame = 0;
    this.observer.disconnect(); this.resize?.disconnect(); this.unwatchDPR?.(); this.releaseLifetime?.();
    for (const off of this.listeners) off(); this.listeners = [];
    for (const node of [...this.controls.keys()]) this.remove(node);
    this.dirty.clear(); this.pressed = null;
    if (roots.get(this.root) === this) {
      roots.delete(this.root);
      for (const [key, value] of this.previous) restoreAttribute(this.root, key, value);
      for (const [key, value, priority] of this.previousStyles) {
        if (value) this.root.style.setProperty(key, value, priority); else this.root.style.removeProperty(key);
      }
    }
    this.atlas.clear(); this.releaseStyle(); this.onDispose();
  }
}
