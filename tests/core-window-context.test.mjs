import test from 'node:test';
import assert from 'node:assert/strict';
import {getEventListeners} from 'node:events';
import {registerUIDocument, uiDocument, uiDocuments, hasUIDialog} from '../src/core/window-context.js';
class View extends EventTarget { closed = false; }
class Doc extends EventTarget {
  nodeType = 9; active = false; dialog = false;
  constructor() { super(); this.defaultView = new View(); this.defaultView.document = this; }
  createElement() {}
  hasFocus() { return this.active; }
  querySelector() { return this.dialog ? {} : null; }
}
function fixture(t) {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'document'), root = new Doc(), releases = [];
  Object.defineProperty(globalThis, 'document', {value: root, configurable: true});
  t.after(() => { for (const off of releases) off(); if (prior) Object.defineProperty(globalThis, 'document', prior); else delete globalThis.document; });
  return {root, register(doc, options) { const off = registerUIDocument(doc, options); releases.push(off); return off; }};
}

test('UI context supports headless imports without a ReferenceError', () => {
  assert.deepEqual(uiDocuments(), []); assert.equal(uiDocument(), null); assert.equal(hasUIDialog(), false);
  assert.throws(() => registerUIDocument(null), /Document/);
});

test('UI context uses explicit Document/node/Window and otherwise the focused document', t => {
  const f = fixture(t), doc = new Doc(); f.register(doc); doc.active = true;
  assert.equal(uiDocument(), doc); assert.equal(uiDocument(f.root), f.root);
  assert.equal(uiDocument({ownerDocument: f.root}), f.root); assert.equal(uiDocument(doc.defaultView), doc);
  assert.deepEqual(uiDocuments(), [f.root, doc]);
});

test('UI document registration shares native listeners and reference-counts owners', t => {
  const f = fixture(t), doc = new Doc(), a = f.register(doc), b = f.register(doc);
  assert.equal(getEventListeners(doc, 'focusin').length, 1); assert.equal(getEventListeners(doc, 'pointerdown').length, 1);
  assert.equal(getEventListeners(doc.defaultView, 'pagehide').length, 1);
  assert.equal(a(), true); assert.equal(a(), false); assert.ok(uiDocuments().includes(doc));
  assert.equal(b(), true); assert.deepEqual(uiDocuments(), [f.root]);
  for (const type of ['focusin', 'pointerdown']) assert.equal(getEventListeners(doc, type).length, 0);
  assert.equal(getEventListeners(doc.defaultView, 'pagehide').length, 0);
});

test('UI stale disposer cannot release a new registration', t => {
  const f = fixture(t), doc = new Doc(), old = f.register(doc); old(); f.register(doc);
  old(); assert.ok(uiDocuments().includes(doc)); assert.equal(getEventListeners(doc, 'focusin').length, 1);
});

test('UI abort releases only its own registration and all abort listeners', t => {
  const f = fixture(t), doc = new Doc(), a = new AbortController(), b = new AbortController();
  f.register(doc, {signal: a.signal}); f.register(doc, {signal: b.signal});
  a.abort(); assert.ok(uiDocuments().includes(doc)); b.abort(); assert.deepEqual(uiDocuments(), [f.root]);
  assert.equal(getEventListeners(a.signal, 'abort').length, 0); assert.equal(getEventListeners(b.signal, 'abort').length, 0);
  f.register(doc, {signal: a.signal}); assert.deepEqual(uiDocuments(), [f.root]);
  assert.throws(() => f.register(doc, {signal: {}}), TypeError);
});

test('UI closed/navigated documents are pruned, including inaccessible WindowProxy cleanup', t => {
  const f = fixture(t);
  for (const mode of ['closed', 'navigated', 'inaccessible']) {
    const doc = new Doc(); f.register(doc); doc.dispatchEvent(new Event('pointerdown'));
    assert.equal(uiDocument(), doc);
    if (mode === 'closed') doc.defaultView.closed = true;
    else if (mode === 'navigated') doc.defaultView.document = new Doc();
    else {
      Object.defineProperty(doc.defaultView, 'document', {get() { throw new Error('cross-origin'); }});
      Object.defineProperty(doc.defaultView, 'removeEventListener', {get() { throw new Error('cross-origin'); }});
    }
    assert.equal(uiDocument(), f.root); assert.deepEqual(uiDocuments(), [f.root]);
  }
});

test('UI pagehide disposes owners except persisted BFCache pages', t => {
  const f = fixture(t), doc = new Doc(), controller = new AbortController(); f.register(doc, {signal: controller.signal});
  const hide = new Event('pagehide'); Object.defineProperty(hide, 'persisted', {value: true}); doc.defaultView.dispatchEvent(hide);
  assert.ok(uiDocuments().includes(doc)); doc.active = true; doc.defaultView.dispatchEvent(new Event('pageshow')); assert.equal(uiDocument(), doc);
  doc.defaultView.dispatchEvent(new Event('pagehide')); assert.deepEqual(uiDocuments(), [f.root]);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('UI focus prefers active nested document when root also reports focus', t => {
  const f = fixture(t), doc = new Doc(); f.register(doc); doc.active = f.root.active = true;
  doc.dispatchEvent(new Event('focusin')); assert.equal(uiDocument(), doc);
  doc.active = false; assert.equal(uiDocument(), f.root);
});

test('UI dialogs across live documents disappear when their owner closes', t => {
  const f = fixture(t), doc = new Doc(); f.register(doc); doc.dialog = true;
  assert.equal(hasUIDialog(), true); doc.defaultView.closed = true; assert.equal(hasUIDialog(), false);
});

test('UI accepts explicitly registered DOM-only documents without a Window', t => {
  const f = fixture(t), doc = new Doc(); doc.defaultView = null; f.register(doc);
  assert.equal(uiDocument(doc), doc); doc.dispatchEvent(new Event('pointerdown')); assert.equal(uiDocument(), doc);
});
