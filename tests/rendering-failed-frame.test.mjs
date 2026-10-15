import test from 'node:test';
import assert from 'node:assert/strict';
import {WebGLPainter} from '../src/rendering/webgl2.js';
import {WebGPUPainter} from '../src/rendering/webgpu.js';
import {UIRenderer} from '../src/rendering/renderer.js';
import {PaintScene} from '../src/rendering/scene.js';
import {RetainedScene} from '../src/rendering/retained-scene.js';

function scene(color = [1, 0, 0, 1], page = null) {
  const s = new PaintScene(20, 20);
  s.add(s.clip, color, {page});
  return s.seal();
}
function webgl() {
  const calls = [], fault = {at: null}, state = {error: 0};
  const operation = name => (...args) => {
    calls.push({name, args});
    if (fault.at === name) { state.error = 1285; fault.at = null; }
  };
  const gl = {
    NO_ERROR: 0, isContextLost: () => false, getError() { const e = state.error; state.error = 0; return e; },
    viewport() {}, disable() {}, enable() {}, clearColor() {}, clear() {}, useProgram() {}, uniform4f() {},
    bindVertexArray() {}, bindBuffer() {}, blendFunc() {}, bindTexture() {}, pixelStorei() {}, vertexAttribPointer() {},
    bufferData: operation('allocate'), bufferSubData: operation('upload'),
    texImage2D: operation('texture'), drawArraysInstanced: operation('draw'), flush: operation('flush'),
    deleteTexture: operation('deleteTexture')
  };
  const painter = Object.assign(Object.create(WebGLPainter.prototype), {
    gl, canvas: {width: 0, height: 0}, maxTextureSize: 8192, textures: new Map(),
    stats: {frames: 0, drawCalls: 0, uploadedBytes: 0, bufferAllocations: 0, geometryPacks: 0, instanceUploads: 0}
  });
  return {painter, calls, fault};
}
for (const at of ['allocate', 'upload', 'draw']) test(`WebGL ${at} errors invalidate failed-frame geometry before retry`, () => {
  const {painter, calls, fault} = webgl(), s = scene(); fault.at = at;
  assert.throws(() => painter.render(s), /WebGL2 rendering error/);
  assert.equal(painter.stats.frames, 0); calls.length = 0;
  painter.render(s);
  assert.ok(calls.some(c => c.name === 'allocate'), 'retry must allocate validated backing storage');
  assert.ok(calls.some(c => c.name === 'upload'), 'retry must not reuse failed instance data');
  assert.equal(painter.stats.frames, 1);
  calls.length = 0; painter.render(s);
  assert.equal(calls.filter(c => c.name === 'upload').length, 0, 'successful frames still reuse geometry');
});
test('WebGL texture upload errors cannot advance a reusable resource cursor', () => {
  const {painter, calls, fault} = webgl(), page = {canvas: {}, width: 2, height: 2, revision: 1};
  painter.texture = () => ({});
  const s = scene([1, 1, 1, 1], page); fault.at = 'texture';
  assert.throws(() => painter.render(s), /WebGL2 rendering error/); calls.length = 0;
  painter.render(s);
  assert.equal(calls.filter(c => c.name === 'texture').length, 1, 'retry must upload the lost texture pixels');
});
test('disposed WebGL painters do not prune textures or access a lost context', () => {
  const {painter, calls} = webgl(); painter.textures.set({}, {texture: {}}); painter.disposed = true;
  assert.throws(() => painter.render(scene()), /context lost/);
  assert.equal(calls.length, 0); assert.equal(painter.textures.size, 1);
});
function webgpu() {
  const calls = [], state = {fail: false}, view = {GPUBufferUsage: {VERTEX: 1, COPY_DST: 2}};
  const painter = new WebGPUPainter({width: 0, height: 0, ownerDocument: {defaultView: view}}, () => {});
  painter.uniform = {};
  painter.device = {
    limits: {maxTextureDimension2D: 8192, maxBufferSize: 1 << 24},
    createBuffer() { calls.push('allocate'); return {destroy() { calls.push('destroy'); }}; },
    queue: {writeBuffer(buffer) { calls.push(buffer === painter.uniform ? 'uniform' : 'upload'); },
      submit() { if (state.fail) throw Error('submission failed'); calls.push('submit'); }},
    createCommandEncoder() { return {beginRenderPass() { return {setBindGroup() {}, setVertexBuffer() {},
      setPipeline() {}, draw() {}, end() {}}; }, finish() { return {}; }}; }
  };
  painter.context = {getCurrentTexture: () => ({createView: () => ({})})};
  return {painter, calls, state};
}
test('synchronous WebGPU submission failure invalidates geometry and uniforms for retry', () => {
  const {painter, calls, state} = webgpu(), s = scene(); state.fail = true;
  assert.throws(() => painter.render(s), /submission failed/); assert.equal(painter.stats.frames, 0);
  state.fail = false; calls.length = 0; painter.render(s);
  assert.ok(calls.includes('upload')); assert.ok(calls.includes('uniform'));
  assert.equal(painter.stats.frames, 1);
  calls.length = 0; painter.render(s); assert.deepEqual(calls, ['submit']);
});
test('failed direct UI render does not retain a frame that was never presented', () => {
  const r = Object.create(UIRenderer.prototype), s = scene(); let attempts = 0, fail = true;
  Object.assign(r, {document: {hidden: false, getAnimations: () => []}, disposed: false,
    view: {performance: {now: () => 0}}, canvas: {width: 20, height: 20, style: {visibility: 'visible'}},
    driver: {render() { attempts++; if (fail) throw Error('presentation failed'); }},
    sceneFactory: () => s, retained: new RetainedScene(), atlas: {}, adapter: {invalidateStyles() {}},
    metrics: {frames: 0, sceneBuilds: 0, unchangedFrames: 0, builds: [], submissions: []},
    cancelFrame() {}, syncResizeTargets() {}});
  assert.throws(() => r.renderNow(), /presentation failed/);
  assert.equal(r.retained.scene, null); assert.equal(r.canvas.style.visibility, 'hidden');
  fail = false; r.renderNow(); assert.equal(attempts, 2); assert.equal(r.metrics.frames, 1);
  assert.equal(r.canvas.style.visibility, 'visible'); r.renderNow(); assert.equal(attempts, 2);
});
