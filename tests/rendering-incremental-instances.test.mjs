import test from 'node:test';
import assert from 'node:assert/strict';
import {PaintScene} from '../src/rendering/scene.js';
import {physicalSize} from '../src/rendering/policy.js';
import {encodeInstances, instanceUpdateRange, rememberInstances, recordInstanceUpload} from '../src/rendering/instances.js';
function scene(count = 10, change = -1, page = null) {
  const result = new PaintScene(1024, 1024);
  for (let i = 0; i < count; i++) result.add([i % 100 * 10, Math.floor(i / 100) * 10, 8, 8],
    i === change ? [1, 0, 0, 1] : [.2, .4, .8, 1], {page});
  return result.seal();
}
function prepared(s) {
  const size = physicalSize(s.width, s.height, s.dpr), painter = {data: new Float32Array(24 * 12000)};
  encodeInstances(s.commands, painter.data, size.scaleX, size.scaleY); rememberInstances(painter, s, size);
  return {painter, size};
}
test('one edit in 10,000 commands uploads exactly one 96-byte instance', () => {
  const original = scene(10000), {painter, size} = prepared(original), next = scene(10000, 5000);
  const update = instanceUpdateRange(painter, next, size); assert.deepEqual(update, {first: 5000, end: 5001});
  encodeInstances(next.commands, painter.data, size.scaleX, size.scaleY, update.first, update.end);
  const expected = new Float32Array(painter.data.length); encodeInstances(next.commands, expected, size.scaleX, size.scaleY);
  assert.deepEqual(painter.data, expected);
  const stats = {instanceUploads: 0, uploadedBytes: 0}; recordInstanceUpload(stats, update.first, update.end);
  assert.equal(stats.instanceUploadedBytes, 96); assert.equal(stats.uploadedBytes, 96);
});
test('unchanged geometry, tail removals, appends and empty scenes have minimal ranges', () => {
  const {painter, size} = prepared(scene());
  for (const [next, expected] of [[scene(),[10,10]], [scene(9),[9,9]], [scene(12),[10,12]], [scene(0),[0,0]]]) {
    const range = instanceUpdateRange(painter, next, size); assert.deepEqual([range.first,range.end], expected);
  }
});
test('a page rebind rebuilds draw bindings but not identical instance bytes', () => {
  const {painter, size} = prepared(scene(10, -1, {}));
  assert.deepEqual(instanceUpdateRange(painter, scene(10, -1, {}), size), {first:10,end:10});
  assert.deepEqual(instanceUpdateRange(painter, scene(), size), {first:0,end:10});
});
test('reallocated CPU/GPU storage and DPR changes invalidate incremental reuse', () => {
  const original = scene(), {painter, size} = prepared(original);
  assert.deepEqual(instanceUpdateRange(painter, original, size), {first:0,end:0});
  painter.data = new Float32Array(painter.data.length);
  assert.deepEqual(instanceUpdateRange(painter, original, size), {first:0,end:10});
  rememberInstances(painter, original, size);
  assert.deepEqual(instanceUpdateRange(painter, original, physicalSize(1024,1024,2)), {first:0,end:10});
});
test('mutable public scenes always encode and changes to any encoded field are observed', () => {
  const original = scene(), {painter, size} = prepared(original);
  for (const key of ['rect','clip','color','color2','uv','hole','vertical','page']) {
    const next = new PaintScene(1024,1024);
    next.commands = original.commands.map(c=>({...c}));
    next.commands[3][key] = Array.isArray(next.commands[3][key]) ? next.commands[3][key].map(v=>v+.01) : true;
    assert.deepEqual(instanceUpdateRange(painter, next, size), {first:0,end:10}); next.seal();
    assert.deepEqual(instanceUpdateRange(painter, next, size), {first:3,end:4});
  }
});
test('incremental encoding matches complete packing through 500 deterministic mutations', () => {
  let seed = 123456789; const random = () => (seed = (Math.imul(seed,1664525)+1013904223)>>>0) / 4294967296;
  let current = scene(50); const {painter,size} = prepared(current);
  for (let step=0;step<500;step++) {
    const next = new PaintScene(1024,1024);
    next.commands = current.commands.map(c=>({...c}));
    const index = Math.floor(random()*Math.max(1,next.commands.length));
    if (step%7===0) next.add([random()*900,random()*900,10,10],[random(),random(),random(),1]);
    else if(step%11===0 && next.commands.length>1) next.commands.splice(index,1);
    else if(next.commands.length) next.commands[index].rect = [random()*900,random()*900,10,10];
    next.seal(); const update=instanceUpdateRange(painter,next,size);
    encodeInstances(next.commands,painter.data,size.scaleX,size.scaleY,update.first,update.end);
    const full=new Float32Array(next.commands.length*24);encodeInstances(next.commands,full,size.scaleX,size.scaleY);
    assert.deepEqual(painter.data.slice(0,full.length),full,`step ${step}`);
    rememberInstances(painter,next,size);current=next;
  }
});
