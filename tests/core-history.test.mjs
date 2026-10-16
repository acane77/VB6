import test from 'node:test';
import assert from 'node:assert/strict';
import {History} from '../src/core/history.js';
const valueApply = (model, text) => { model.text = text; return model; };
const patchApply = (model, patches, undo) => {
  for (const patch of undo ? [...patches].reverse() : patches) {
    const before = undo ? patch.after : patch.before, after = undo ? patch.before : patch.after;
    assert.equal(model.text.slice(patch.start, patch.start + before.length), before);
    model.text = model.text.slice(0, patch.start) + after + model.text.slice(patch.start + before.length);
  }
  return model;
};
const patch = (start, before, after) => ({start, before, after});

test('History snapshots, labels, no-ops and savepoint round trips', () => {
  const h = new History(); let changes = 0; h.on('change', () => changes++);
  assert.equal(h.record({text: 'a'}, {text: 'a'}), false); assert.equal(changes, 0);
  h.record({text: 'a'}, {text: 'b'}, 'Replace'); assert.equal(changes, 1);
  assert.equal(h.canUndo, true); assert.equal(h.canRedo, false); assert.equal(h.undoLabel, 'Replace');
  assert.equal(h.isDirty, true); assert.ok(h.bytes > 0);
  h.markClean(); assert.equal(h.isDirty, false);
  assert.deepEqual(h.undo({text: 'b'}), {text: 'a'}); assert.equal(h.isDirty, true);
  assert.equal(h.redoLabel, 'Replace'); assert.deepEqual(h.redo({text: 'a'}), {text: 'b'});
  assert.equal(h.isDirty, false); assert.equal(h.redo({text: 'b'}), null);
  h.reset(); assert.equal(h.bytes, 0); assert.equal(h.isDirty, false); assert.equal(h.undo(null), null);
});

test('History source merge is contiguous and removes net-zero edits', () => {
  const h = new History();
  h.recordValue('m', '', 'a', valueApply, 'Typing');
  h.recordValue('m', 'a', 'ab', valueApply, 'Typing', true);
  assert.equal(h.undoStack.length, 1); assert.equal(h.undoBytes, 4);
  assert.deepEqual(h.undo({text: 'ab'}), {text: ''}); h.redo({text: ''});
  // A replay boundary deliberately prevents merging into a replayed entry.
  h.recordValue('m', 'ab', 'abc', valueApply, 'Typing', true);
  assert.equal(h.undoStack.length, 2);
  h.recordValue('m', 'abc', 'ab', valueApply, 'Typing', true);
  assert.equal(h.undoStack.length, 1); assert.deepEqual(h.undo({text: 'ab'}), {text: ''});
});

test('History markClean and stopMerging are explicit coalescing boundaries', () => {
  const h = new History(); h.recordValue('m', '', 'a', valueApply); h.markClean();
  h.recordValue('m', 'a', 'ab', valueApply, 'Edit', true); assert.equal(h.undoStack.length, 2);
  assert.deepEqual(h.undo({text: 'ab'}), {text: 'a'}); assert.equal(h.isDirty, false);
  h.redo({text: 'a'}); h.stopMerging(); h.recordValue('m', 'ab', 'abc', valueApply, 'Edit', true);
  assert.equal(h.undoStack.length, 3);
});

test('History branch after undo never merges with pre-branch text or leaves redo', () => {
  const h = new History(); h.recordValue('m', '', 'a', valueApply); h.recordValue('m', 'a', 'b', valueApply);
  h.undo({text: 'b'}); h.recordValue('m', 'a', 'c', valueApply, 'Edit', true);
  assert.equal(h.undoStack.length, 2); assert.equal(h.redoStack.length, 0);
  assert.deepEqual(h.undo({text: 'c'}), {text: 'a'}); assert.deepEqual(h.undo({text: 'a'}), {text: ''});
});

for (const boundary of ['key', 'label', 'apply', 'continuity']) test('History does not merge across ' + boundary, () => {
  const h = new History(); h.recordValue('m', '', 'a', valueApply, 'Edit');
  h.recordValue(boundary === 'key' ? 'other' : 'm', boundary === 'continuity' ? 'external' : 'a', 'b',
    boundary === 'apply' ? (m, s) => valueApply(m, s) : valueApply, boundary === 'label' ? 'Other' : 'Edit', true);
  assert.equal(h.undoStack.length, 2);
});

test('History patch capture/replay is isolated from both caller and applier mutation', () => {
  const h = new History(), p = {...patch(0, '', 'a'), marks: [1]};
  const apply = (m, patches, undo) => { const result = patchApply(m, patches, undo); patches[0].after = 'changed'; patches[0].marks.push(5); return result; };
  h.recordPatch('m', p, apply); p.after = 'external'; p.marks.push(2);
  assert.deepEqual(h.undo({text: 'a'}), {text: ''}); assert.equal(h.undoStack.length, 0);
  assert.deepEqual(h.redo({text: ''}), {text: 'a'});
  assert.deepEqual(h.undoStack[0].patches, [{...patch(0, '', 'a'), marks: [1]}]);
});

test('History sparse patches retain at most 256 patches per merged entry', () => {
  const h = new History(), original = {text: 'x'.repeat(1000000)}; let model = structuredClone(original);
  for (let i = 0; i < 300; i++) { const p = patch(i, '', 'a'); h.recordPatch('m', p, patchApply, 'Type', true); model = patchApply(model, [p], false); }
  assert.equal(h.undoStack.length, 2); assert.equal(h.undoStack[0].patches.length, 256);
  assert.ok(h.bytes < 30000, 'history size follows changed bytes, not one-million-character document');
  model = h.undo(model); model = h.undo(model); assert.deepEqual(model, original);
  model = h.redo(model); model = h.redo(model); assert.equal(model.text, 'a'.repeat(300) + original.text);
});

test('History failed undo and redo are atomic and preserve original errors', () => {
  for (const direction of ['undo', 'redo']) {
    const h = new History(), error = new Error('replay'), model = {text: 'a', nested: {value: 1}}; let fail = direction === 'undo';
    const apply = (m, text) => { m.nested.value = 5; if (fail) throw error; m.text = text; return m; };
    h.recordValue('m', '', 'a', apply);
    if (direction === 'redo') { h.undo(model); fail = true; }
    const before = h.capture(); assert.throws(() => h[direction](model), e => e === error);
    assert.deepEqual(model, {text: 'a', nested: {value: 1}}); assert.deepEqual(h.capture(), before);
  }
});

for (const operation of ['record', 'recordValue', 'recordPatch', 'undo', 'redo', 'reset', 'markClean', 'beginTransaction', 'trim', 'capture', 'restore', 'stopMerging'])
  test('History rejects reentrant ' + operation + ' without modifying stacks', () => {
    const h = new History(); h.recordValue('m', '', 'a', () => { h[operation](); return {}; });
    const before = h.capture(); assert.throws(() => h.undo({text: 'a'}), /during replay/); assert.deepEqual(h.capture(), before);
  });

test('History rejects asynchronous replay and invalid entries before changing history', () => {
  const h = new History(); h.recordValue('m', '', 'a', async m => m);
  assert.throws(() => h.undo({text: 'a'}), /synchronous/); assert.equal(h.undoStack.length, 1);
  for (const value of [undefined, () => {}, Symbol('x')]) assert.throws(() => h.record(value, {}), TypeError);
  const cyclic = {}; cyclic.self = cyclic; assert.throws(() => h.record(cyclic, {}), TypeError);
  assert.throws(() => h.recordValue('x', 1, 2, valueApply), TypeError);
  assert.throws(() => h.recordValue('x', '', 'a', null), TypeError);
  for (const p of [null, {}, patch(-1, '', 'a'), patch(0.5, '', 'a'), patch(0, 3, 'a')]) assert.throws(() => h.recordPatch('x', p, patchApply));
  assert.equal(h.undoStack.length, 1);
});

test('History combined past/future budgets keep a contiguous replay path', () => {
  const h = new History(5); let model = {n: 0};
  for (let i = 1; i <= 10; i++) { h.record(model, {n: i}); model = {n: i}; }
  assert.equal(h.undoStack.length, 5);
  for (let i = 0; i < 5; i++) model = h.undo(model);
  assert.deepEqual(model, {n: 5}); assert.equal(h.undo(model), null);
  const bytes = h.bytes; h.limit = 2;
  assert.equal(h.redoStack.length, 2); assert.ok(h.bytes < bytes);
  model = h.redo(model); assert.deepEqual(model, {n: 6}); model = h.redo(model); assert.deepEqual(model, {n: 7});
  assert.equal(h.redo(model), null);
});

test('History explicit strict budgets and zero disable retention; legacy newest exception is visible', () => {
  const legacy = new History(120, 1); legacy.recordValue('m', '', 'a'.repeat(10), valueApply);
  assert.equal(legacy.undoStack.length, 1); assert.equal(legacy.overBudget, true);
  const strict = new History({maxBytes: 1, retainNewest: false}); strict.recordValue('m', '', 'aa', valueApply);
  assert.equal(strict.bytes, 0); assert.equal(strict.isDirty, true);
  for (const h of [new History(0), new History(120, 0)]) {
    h.record({a: 1}, {a: 2}); assert.equal(h.bytes, 0); assert.equal(h.canUndo, false); assert.equal(h.isDirty, true);
  }
  for (const value of [-1, NaN, Infinity, 1.5, '4']) assert.throws(() => new History(value), RangeError);
});

test('History nested transactions commit one atomic undo notification and label', () => {
  const h = new History(); let changes = 0; h.on('change', () => changes++);
  h.beginTransaction('Macro'); h.recordValue('m', '', 'a', valueApply);
  h.beginTransaction('Inner'); h.recordPatch('m', patch(1, '', 'b'), patchApply); h.commitTransaction();
  h.record({text: 'ab'}, {text: 'abc'}); assert.equal(changes, 0); assert.equal(h.canUndo, false);
  assert.equal(h.isDirty, true); assert.ok(h.pendingBytes > 0); assert.equal(h.commitTransaction(), true);
  assert.equal(changes, 1); assert.equal(h.undoStack.length, 1); assert.equal(h.undoLabel, 'Macro');
  assert.deepEqual(h.undo({text: 'abc'}), {text: ''}); assert.deepEqual(h.redo({text: ''}), {text: 'abc'});
});

test('History cancelled transactions restore state and retain the preexisting redo branch', () => {
  const h = new History(); h.record({text: ''}, {text: 'a'}); h.undo({text: 'a'});
  h.beginTransaction('Outer'); h.recordValue('m', '', 'b', valueApply);
  h.beginTransaction('Inner'); h.recordValue('m', 'b', 'c', valueApply);
  assert.deepEqual(h.cancelTransaction({text: 'c'}), {text: 'b'});
  assert.deepEqual(h.cancelTransaction({text: 'b'}), {text: ''});
  assert.equal(h.redoStack.length, 1); assert.deepEqual(h.redo({text: ''}), {text: 'a'});
  h.beginTransaction(); assert.equal(h.commitTransaction(), false);
});

test('History failed transaction cancellation keeps the group and caller state', () => {
  const h = new History(), error = new Error('cannot roll back'); h.beginTransaction();
  h.recordValue('m', '', 'a', () => { throw error; }); const current = {text: 'a'};
  assert.throws(() => h.cancelTransaction(current), e => e === error);
  assert.deepEqual(current, {text: 'a'}); assert.equal(h.transactionDepth, 1);
  for (const operation of ['undo', 'redo', 'reset', 'markClean', 'capture', 'restore']) assert.throws(() => h[operation](), /transaction first/);
});

test('History session capture is copy-on-write across subsequent coalescing and restores savepoints', () => {
  const h = new History(); h.recordValue('m', '', 'a', valueApply); h.markClean();
  const clean = h.capture(); h.recordValue('m', 'a', 'ab', valueApply, 'Edit', true); const dirty = h.capture();
  h.recordValue('m', 'ab', 'abc', valueApply, 'Edit', true);
  assert.equal(dirty.undo.at(-1).after, 'ab'); h.restore(clean); assert.equal(h.isDirty, false);
  assert.equal(h.undoStack.length, 1); h.restore(dirty); assert.equal(h.isDirty, true);
  assert.deepEqual(h.undo({text: 'ab'}), {text: 'a'}); assert.equal(h.isDirty, false);
  assert.throws(() => h.restore({}), TypeError); assert.equal(h.undoStack.length, 1);
});

test('History legacy stack replacement remains replayable without merging across restored sessions', () => {
  const h = new History(); h.recordValue('m', '', 'a', valueApply); const undo = h.undoStack.slice();
  h.reset(); h.undoStack = undo; h.redoStack = []; h.recordValue('m', 'a', 'ab', valueApply, 'Edit', true);
  assert.equal(h.undoStack.length, 2); assert.deepEqual(h.undo({text: 'ab'}), {text: 'a'});
});

test('History seeded model check matches an independent 2000-operation timeline', () => {
  const h = new History(5000), states = ['']; let cursor = 0, seed = 0x152a;
  const random = () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 2 ** 32);
  let current = {text: ''};
  for (let i = 0; i < 2000; i++) {
    const operation = Math.floor(random() * 4);
    if (operation < 2) {
      const after = states[cursor] + String.fromCharCode(97 + Math.floor(random() * 26));
      if (operation === 0) h.recordValue('m', current.text, after, valueApply);
      else h.recordPatch('m', patch(current.text.length, '', after.at(-1)), patchApply);
      states.splice(cursor + 1); states.push(after); cursor++; current = {text: after};
    } else if (operation === 2 && cursor > 0) { current = h.undo(current); cursor--; }
    else if (operation === 3 && cursor + 1 < states.length) { current = h.redo(current); cursor++; }
    assert.equal(current.text, states[cursor]); assert.equal(h.undoStack.length, cursor);
    assert.equal(h.redoStack.length, states.length - cursor - 1);
  }
});
