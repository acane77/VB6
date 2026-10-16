import test from 'node:test';
import assert from 'node:assert/strict';
import {TextAtlas} from '../src/rendering/atlas.js';
import {markTextureDirty, textureUploadRegion, rememberTextureUpload} from '../src/rendering/texture-updates.js';
const style = {font: '8px sans-serif', fontSize: '8px', color: 'rgb(0, 0, 0)', direction: 'ltr'};
function fixture(options = {size: 32, maxPages: 1}) {
  const calls = {measures: 0, copies: 0, clears: 0, paints: 0, saves: 0};
  const document = {createElement() {
    const context = {measureText() { calls.measures++; return {width: 8, fontBoundingBoxAscent: 6, fontBoundingBoxDescent: 2}; },
      clearRect() { calls.clears++; }, drawImage() { calls.copies++; },
      save() { calls.saves++; }, restore() { calls.saves--; }, beginPath() {}, rect() {}, clip() {}, translate() {}, scale() {},
      fillText() { calls.paints++; }};
    return {width: 0, height: 0, getContext: () => context};
  }};
  return {atlas: new TextAtlas(document, options), calls};
}
const request = (atlas, text, rect = [0, 0, 8, 8]) => atlas.text(text, style, rect);

test('warm atlas lookups skip both shaping measurements and pixel writes', () => {
  const {atlas, calls} = fixture(); atlas.begin(); const first = request(atlas, 'a');
  for (let i = 0; i < 100; i++) assert.deepEqual(request(atlas, 'a'), first);
  assert.equal(calls.measures, 1); assert.equal(calls.paints, 1); assert.equal(atlas.getStats().hits, 100);
  assert.equal(calls.saves, 0);
});
test('subpixel phases are not rounded into colliding atlas cache keys', () => {
  const {atlas, calls} = fixture(); atlas.begin();
  request(atlas, 'a', [0.0001, 0, 8, 8]); request(atlas, 'a', [0.0002, 0, 8, 8]);
  assert.equal(calls.measures, 2);
});
test('saturated atlas never overwrites a glyph emitted in the current build', () => {
  const {atlas} = fixture(); atlas.begin();
  const items = ['a', 'b', 'c', 'd'].map(text => request(atlas, text));
  assert.ok(items.every(Boolean)); const revision = items[0].page.revision;
  assert.equal(request(atlas, 'e'), null); assert.equal(items[0].page.revision, revision);
  assert.equal(atlas.getStats().evictions, 0); assert.equal(atlas.end(), false);
});
test('changing content recycles old pages without exceeding its memory budget', () => {
  const {atlas} = fixture();
  for (let frame = 0; frame < 1000; frame++) {
    atlas.begin(); assert.ok(request(atlas, String(frame))); atlas.end();
    assert.ok(atlas.getStats().allocatedBytes <= atlas.getStats().budgetBytes);
  }
  assert.ok(atlas.getStats().evictions > 100); assert.equal(atlas.getStats().capacityMisses, 0);
  assert.ok(atlas.entries.size <= 4);
});
test('pinned glyphs across full pages compact between builds, not during one', () => {
  const {atlas, calls} = fixture({size: 32, maxPages: 2}); atlas.begin();
  for (const text of ['a','b','c','d','e','f','g','h']) assert.ok(request(atlas, text));
  atlas.begin(); const a = request(atlas, 'a'), e = request(atlas, 'e');
  assert.equal(request(atlas, 'new'), null); assert.equal(atlas.end(), true);
  const measures = calls.measures; atlas.begin();
  assert.equal(calls.measures, measures); assert.equal(calls.copies, 2);
  assert.ok(request(atlas, 'a')); assert.ok(request(atlas, 'e')); assert.ok(request(atlas, 'new'));
  assert.equal(atlas.end(), false); assert.equal(atlas.getStats().compactions, 1);
  assert.equal(a.page.canvas.width, 1); assert.equal(e.page.canvas.width, 1);
});
test('all-live working sets larger than capacity do not cause compaction loops', () => {
  const {atlas} = fixture();
  for (let i = 0; i < 10; i++) {
    atlas.begin(); for (const text of ['a','b','c','d']) assert.ok(request(atlas, text));
    assert.equal(request(atlas, 'e'), null); assert.equal(atlas.end(), false);
  }
  assert.equal(atlas.getStats().compactions, 0);
});
test('oversized glyphs, invalid budgets and absent Canvas2D stay bounded', () => {
  const {atlas} = fixture(); atlas.begin();
  assert.equal(atlas.text('a', style, [0, 0, 8, 8], 20), null); assert.equal(atlas.pages.length, 0);
  for (const options of [{size: 0}, {size: 32.5}, {maxPages: 0}, {size: 4096, maxPages: 2}]) {
    assert.throws(() => fixture(options), RangeError);
  }
  const missing = new TextAtlas({createElement: () => ({getContext: () => null})});
  assert.equal(request(missing, 'a'), null);
});
test('reset and disposal release retained backing canvases and cache keys', () => {
  const {atlas} = fixture(); atlas.begin(); const {page} = request(atlas, 'a');
  atlas.reset(); assert.equal(page.canvas.width, 1); assert.equal(page.canvas.height, 1);
  assert.equal(atlas.getStats().allocatedBytes, 0); assert.equal(atlas.entries.size, 0);
  atlas.dispose(); atlas.dispose(); assert.equal(request(atlas, 'a'), null);
});
function page() { return {width: 128, height: 64, canvas: {}, revision: 0}; }
function cursor(p) { return {width: p.width, height: p.height, source: p.canvas, revision: p.revision}; }
test('texture dirty history preserves independent painter cursors', () => {
  const p = page(), first = cursor(p), second = cursor(p);
  markTextureDirty(p, [4, 8, 10, 12]);
  assert.deepEqual(textureUploadRegion(p, first), {x: 4, y: 8, width: 10, height: 12, full: false});
  rememberTextureUpload(first, p, textureUploadRegion(p, first), {uploadedBytes: 0});
  markTextureDirty(p, [30, 2, 4, 5]);
  assert.deepEqual(textureUploadRegion(p, first), {x: 30, y: 2, width: 4, height: 5, full: false});
  assert.deepEqual(textureUploadRegion(p, second), {x: 4, y: 2, width: 30, height: 18, full: false});
});
test('overflowed, discontinuous, new-source and resized resources upload fully', () => {
  const p = page(), previous = cursor(p);
  for (let i = 0; i < 100; i++) markTextureDirty(p, [1, 1, 2, 2]);
  assert.equal(p.changes.length, 64); assert.equal(textureUploadRegion(p, previous).full, true);
  previous.revision = p.revision; assert.equal(textureUploadRegion(p, previous), null);
  p.revision++; assert.equal(textureUploadRegion(p, previous).full, true);
  previous.revision = p.revision; p.canvas = {}; assert.equal(textureUploadRegion(p, previous).full, true);
  previous.source = p.canvas; p.width++; assert.equal(textureUploadRegion(p, previous).full, true);
});
test('invalid dirty rectangles cannot corrupt upload cursors', () => {
  for (const r of [[-1,0,1,1], [0,0,0,1], [127,0,2,1], [0,63,1,2], [0.5,0,1,1], [0,0,NaN,1]]) {
    const p = page(); assert.throws(() => markTextureDirty(p, r), RangeError); assert.equal(p.revision, 0);
  }
});
