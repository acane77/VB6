import test from 'node:test';
import assert from 'node:assert/strict';
import {observeControlPaint, notifyControlPaint} from '../src/rendering/invalidation.js';
import {projectionGrid} from '../src/tui/projection.js';
import {CellBuffer} from '../src/tui/cells.js';
import {paintControl} from '../src/tui/controls.js';

test('materialization notifications are optional, isolated and removable', () => {
  const a = {}, b = {}, calls = [];
  notifyControlPaint(a);
  const release = observeControlPaint(a, element => calls.push(element));
  notifyControlPaint(b); assert.deepEqual(calls, []);
  notifyControlPaint(a); assert.deepEqual(calls, [a]);
  release(); release(); notifyControlPaint(a); assert.deepEqual(calls, [a]);
  assert.throws(() => observeControlPaint(null, () => {}));
  assert.throws(() => observeControlPaint({}, null));
});

test('separate subscriptions to one callback have separate lifetimes', () => {
  const node = {}; let calls = 0;
  const fn = () => calls++;
  const a = observeControlPaint(node, fn), b = observeControlPaint(node, fn);
  notifyControlPaint(node); assert.equal(calls, 2);
  a(); notifyControlPaint(node); assert.equal(calls, 3);
  b(); notifyControlPaint(node); assert.equal(calls, 3);
});

test('delivery does not invoke removed listeners or newly added listeners in the same turn', () => {
  const node = {}; let calls = 0, releaseSecond;
  const added = [];
  const release = observeControlPaint(node, () => {
    releaseSecond(); added.push(observeControlPaint(node, () => calls++));
  });
  releaseSecond = observeControlPaint(node, () => assert.fail('removed subscription called'));
  notifyControlPaint(node); assert.equal(calls, 0);
  notifyControlPaint(node); assert.equal(calls, 1);
  release(); added.forEach(off => off());
});

test('projection recovers layout coordinates through border offsets and nonuniform scaling', () => {
  const node = {clientWidth: 133, clientHeight: 29, offsetWidth: 137, offsetHeight: 33,
    clientLeft: 2, clientTop: 2, getBoundingClientRect: () => ({left: 10, top: 20, width: 274, height: 99})};
  const grid = projectionGrid(node, 17, 2, {cellWidth: 8, cellHeight: 16});
  assert.equal(grid.pitchX, 16); assert.equal(grid.pitchY, 48);
  assert.deepEqual(grid.project({left: 14, top: 26, right: 30, bottom: 74}), {x: 0, y: 0, width: 1, height: 1});
  assert.deepEqual(grid.project({left: -2, top: -22, right: 30, bottom: 74}), {x: -1, y: -1, width: 2, height: 2});
});

test('partially clipped rows crop text rather than shifting invisible characters into view', () => {
  const buffer = new CellBuffer(6, 3);
  paintControl(buffer, {type: 'ListView', rows: [{x: -2, y: 1, width: 6, height: 1, text: 'ABCDEF', selected: true}]});
  assert.equal(buffer.toText().split('\n')[1], 'CDEF  ');
  assert.equal(buffer.colors[6] >> 4, 3);
  assert.equal(buffer.colors[10] >> 4, 7);
});

test('invalid extension row geometry cannot corrupt clipping state', () => {
  const buffer = new CellBuffer(5, 2);
  paintControl(buffer, {type: 'Toolbar', rows: [
    {x: 0, y: NaN, width: 5, text: 'bad'}, {x: 0.5, y: 0, width: 5, text: 'bad'},
    {x: 0, y: 0, width: -1, text: 'bad'}, {x: 0, y: 1, width: 5, text: 'good'}
  ]});
  assert.equal(buffer.toText(), '     \ngood '); assert.equal(buffer.clips.length, 1);
});

test('scrolling text and password masking are bounded by the visible cell area', () => {
  const buffer = new CellBuffer(5, 2);
  paintControl(buffer, {type: 'TextBox', text: 'abcdef\nghijkl\nmnopqr', scrollColumn: 1, scrollRow: 1});
  assert.equal(buffer.toText(), 'hijkl\nnopqr');
  paintControl(buffer, {type: 'TextBox', text: 'secret'.repeat(10000), password: true});
  assert.equal(buffer.toText(), '•••••\n     ');
});

test('vertical native ranges reverse their thumb, horizontal ranges do not', () => {
  const buffer = new CellBuffer(7, 9);
  paintControl(buffer, {type: 'Slider', vertical: true, reverse: true, min: 0, max: 100, value: 100});
  assert.equal(buffer.glyphs[1 * 7 + 3], '█'.codePointAt(0));
  paintControl(buffer, {type: 'Slider', vertical: true, reverse: true, min: 0, max: 100, value: 0});
  assert.equal(buffer.glyphs[7 * 7 + 3], '█'.codePointAt(0));
});
