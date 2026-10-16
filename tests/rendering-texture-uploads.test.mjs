import test from 'node:test';
import assert from 'node:assert/strict';
import {markTextureDirty} from '../src/rendering/texture-updates.js';
import {WebGPUPainter} from '../src/rendering/webgpu.js';
import {WebGLPainter} from '../src/rendering/webgl2.js';
function page() { return {width: 128, height: 64, canvas: {}, revision: 0}; }
function cursor(p) { return {width: p.width, height: p.height, source: p.canvas, revision: p.revision}; }
for (const backend of ['webgpu', 'webgl2']) test(`${backend} uploads only revised rectangles and counts transferred bytes`, () => {
  const p = page(), operations = [], state = new Map(); let fail = false;
  const painter = Object.create(backend === 'webgpu' ? WebGPUPainter.prototype : WebGLPainter.prototype);
  const record = {...cursor(p), texture: {}, group: {}};
  painter.textures = new Map([[p, record]]); painter.stats = {uploadedBytes: 0};
  if (backend === 'webgpu') painter.device = {queue: {copyExternalImageToTexture(source, destination, size) {
    if (fail) throw Error('upload'); operations.push({source, destination, size});
  }}};
  else painter.gl = {UNPACK_SKIP_PIXELS: 1, UNPACK_SKIP_ROWS: 2,
    bindTexture() {}, pixelStorei(k, v) { state.set(k, v); }, texImage2D() { throw Error('unexpected full upload'); },
    texSubImage2D(...args) { if (fail) throw Error('upload'); operations.push(args); }};
  markTextureDirty(p, [7, 9, 11, 13]); painter.image(p); painter.image(p);
  assert.equal(operations.length, 1); assert.equal(painter.stats.uploadedBytes, 11 * 13 * 4);
  assert.equal(painter.stats.partialTextureUploads, 1);
  if (backend === 'webgpu') {
    assert.deepEqual(operations[0].source.origin, [7,9]); assert.deepEqual(operations[0].destination.origin, [7,9]);
    assert.deepEqual(operations[0].size, [11,13]);
  } else {
    assert.deepEqual(operations[0].slice(2,6), [7,9,11,13]); assert.equal(state.get(1), 0); assert.equal(state.get(2), 0);
  }
  markTextureDirty(p, [2,3,4,5]); fail = true;
  assert.throws(() => painter.image(p), /upload/); assert.equal(record.revision, p.revision - 1);
  if (backend === 'webgl2') { assert.equal(state.get(1), 0); assert.equal(state.get(2), 0); }
  fail = false; painter.image(p); assert.equal(record.revision, p.revision);
});
