import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {paintTuiGlyph, tuiGlyphMask, TUI_PRIMITIVE_GLYPHS} from '../src/tui/raster.js';
import {CellBuffer, CellGlyphAtlas, CanvasCellRenderer, EGA} from '../src/tui/cells.js';

function fakeDocument() {
  const document = {canvases: [], createElement(name) {
    assert.equal(name, 'canvas');
    const context = {fills: [], draws: [], texts: [],
      fillRect(...args) { this.fills.push(args); },
      fillText(...args) { this.texts.push(args); },
      drawImage(canvas, x, y) { this.draws.push({x, y, width: canvas.width, height: canvas.height}); }
    };
    const canvas = {ownerDocument: document, width: 300, height: 150, context, getContext: () => context};
    document.canvases.push(canvas); return canvas;
  }};
  return document;
}

for (const code of TUI_PRIMITIVE_GLYPHS) test(`deterministic primitive ${String.fromCodePoint(code)} is bounded and detached`, () => {
  const a = tuiGlyphMask(code), b = tuiGlyphMask(code);
  assert.equal(a.length, 128); assert.ok(a.some(Boolean));
  assert.ok(a.every(n => n === 0 || n === 1)); a.fill(9);
  assert.ok(b.every(n => n === 0 || n === 1));
  const context = {fillRect(x, y, width, height) {
    assert.ok([x, y, width, height].every(Number.isSafeInteger));
    assert.ok(x >= 0 && y >= 0 && width > 0 && height > 0 && x + width <= 11 && y + height <= 23);
  }};
  assert.equal(paintTuiGlyph(context, code, 11, 23), true);
});

test('single and double line joins reach their adjacent cell edges exactly', () => {
  const right = code => Array.from(tuiGlyphMask(code)).filter((_, i) => i % 8 === 7);
  const left = code => Array.from(tuiGlyphMask(code)).filter((_, i) => i % 8 === 0);
  const top = code => Array.from(tuiGlyphMask(code).slice(0, 8));
  const bottom = code => Array.from(tuiGlyphMask(code).slice(-8));
  for (const [a, b] of [['┌', '─'], ['─', '┐'], ['╔', '═'], ['═', '╗'], ['╠', '═'], ['═', '╣']]) assert.deepEqual(right(a), left(b));
  for (const [a, b] of [['┌', '│'], ['│', '└'], ['╔', '║'], ['║', '╚'], ['╦', '║'], ['║', '╩']]) assert.deepEqual(bottom(a), top(b));
});

test('block and shade densities are exact and independent of a system font', () => {
  const count = char => tuiGlyphMask(char).reduce((a, b) => a + b, 0);
  assert.equal(count('█'), 128);
  for (const char of ['▀', '▄', '▌', '▐', '▒']) assert.equal(count(char), 64);
  assert.equal(count('░'), 32); assert.equal(count('▓'), 96);
  assert.equal(tuiGlyphMask('A'), null);
  assert.equal(paintTuiGlyph({}, 'A'.codePointAt(0), 8, 16), false);
});

test('fractional DPR uses rounded absolute edges without accumulating per-cell drift', () => {
  for (const dpr of [1, 1.25, 1.5, 1.75, 2, 3, 4]) {
    const document = fakeDocument(), canvas = document.createElement('canvas');
    const renderer = new CanvasCellRenderer(canvas, {cellWidth: 9, cellHeight: 18});
    const buffer = new CellBuffer(13, 3); buffer.text(0, 0, '╔═══════════╗');
    renderer.render(buffer, dpr);
    assert.equal(canvas.width, Math.round(13 * 9 * dpr)); assert.equal(canvas.height, Math.round(3 * 18 * dpr));
    for (let row = 0; row < 3; row++) {
      const draws = canvas.context.draws.slice(row * 13, (row + 1) * 13);
      assert.equal(draws[0].x, 0);
      for (let column = 1; column < 13; column++) assert.equal(draws[column].x, draws[column - 1].x + draws[column - 1].width);
      assert.equal(draws.at(-1).x + draws.at(-1).width, canvas.width);
      assert.equal(draws[0].y, Math.round(row * 18 * dpr));
    }
    const count = canvas.context.draws.length; renderer.render(buffer, dpr);
    assert.equal(canvas.context.draws.length, count, 'unchanged cells repainted'); renderer.dispose();
  }
});

test('atlas LRU is bounded by both entries and pixel area, and releases evicted surfaces', () => {
  const document = fakeDocument(), atlas = new CellGlyphAtlas(document, {maxGlyphs: 2, maxPixels: 256});
  const a = atlas.glyph(65, 7, 8, 16, EGA), b = atlas.glyph(66, 7, 8, 16, EGA);
  assert.equal(atlas.glyph(65, 7, 8, 16, EGA), a); // B is now least recently used.
  atlas.glyph(67, 7, 8, 16, EGA);
  assert.equal(b.width, 1); assert.equal(atlas.cache.size, 2); assert.equal(atlas.pixels, 256);
  assert.equal(atlas.metrics.hits, 1); assert.equal(atlas.metrics.evictions, 1);
  atlas.clear(); assert.equal(atlas.cache.size, 0); assert.equal(atlas.pixels, 0); assert.equal(a.width, 1);
});

test('a shared atlas outlives individual canvases and includes actual palette values in its key', () => {
  const document = fakeDocument(), atlas = new CellGlyphAtlas(document), colors = [...EGA]; colors[7] = '#123456';
  const a = new CanvasCellRenderer(document.createElement('canvas'), {atlas});
  const b = new CanvasCellRenderer(document.createElement('canvas'), {atlas, palette: colors});
  a.render(new CellBuffer(1, 1)); b.render(new CellBuffer(1, 1));
  assert.equal(atlas.cache.size, 2); a.dispose(); assert.equal(atlas.cache.size, 2);
  b.render(new CellBuffer(1, 1)); assert.equal(atlas.metrics.hits, 1);
  b.dispose(); atlas.clear();
});

test('allocation and palette validation fail before consuming damage or resizing the canvas', () => {
  const document = fakeDocument(), canvas = document.createElement('canvas'), buffer = new CellBuffer(20, 20);
  const renderer = new CanvasCellRenderer(canvas, {maxPixels: 128});
  assert.throws(() => renderer.render(buffer), /budget/);
  assert.equal(canvas.width, 300); assert.equal(canvas.height, 150); assert.equal(buffer.takeDamage().length, 20);
  assert.throws(() => new CellGlyphAtlas(document, {maxGlyphs: Infinity}));
  assert.throws(() => new CellGlyphAtlas(document, {maxPixels: -1}));
  assert.throws(() => new CanvasCellRenderer(canvas, {palette: ['red']}));
  renderer.dispose(); assert.throws(() => renderer.render(buffer), /disposed/);
});

// Regression golden for these authored primitives, NOT a vendor/VGA reference.
test('integer primitive mask regression fingerprint', () => {
  const hash = createHash('sha256');
  for (const code of TUI_PRIMITIVE_GLYPHS) { hash.update(String(code)); hash.update(tuiGlyphMask(code)); }
  assert.equal(hash.digest('hex'), 'fba24b68e6b91372c55b01ae187061607a737d11c7a218021cdc657120a5115b');
});
