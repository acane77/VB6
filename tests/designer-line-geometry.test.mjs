import test from 'node:test';
import assert from 'node:assert/strict';
import {lineEndpoints, lineBounds, editLineGeometry, lineDistance} from '../src/controls/line-geometry.js';
const rectangle = {X1:900,Y1:300,X2:150,Y2:1050};

test('endpoint reads preserve imported direction and do not mutate', () => {
  const p = {...rectangle}, before = JSON.stringify(p);
  assert.deepEqual(lineEndpoints(p), rectangle);
  assert.deepEqual(lineBounds(p), {Left:150,Top:300,Width:750,Height:750});
  assert.equal(JSON.stringify(p), before);
});
test('legacy browser line height is a hit box, not a new diagonal', () => {
  assert.deepEqual(lineEndpoints({Left:30,Top:45,Width:90,Height:900}), {X1:30,Y1:45,X2:120,Y2:45});
  assert.deepEqual(lineEndpoints({X2:75}), {X1:0,Y1:0,X2:75,Y2:0});
});
test('endpoint updates permit crossing either axis and recompute their rectangle', () => {
  const p = editLineGeometry(rectangle, {X1:75,Y1:1200});
  assert.deepEqual(p, {X1:75,Y1:1200,X2:150,Y2:1050,Left:75,Top:1050,Width:75,Height:150});
});
test('moving and sizing a reverse diagonal preserves native endpoint orientation', () => {
  const p = editLineGeometry(rectangle, {Left:300,Top:450,Width:1500,Height:300});
  assert.deepEqual(p, {X1:1800,Y1:450,X2:300,Y2:750,Left:300,Top:450,Width:1500,Height:300});
});
test('point and axis-aligned lines remain valid and can grow again', () => {
  for (const p of [{X1:0,Y1:0,X2:0,Y2:0},{X1:15,Y1:15,X2:15,Y2:90},{X1:15,Y1:15,X2:90,Y2:15}]) {
    const zero=editLineGeometry(p,{Width:0,Height:0}); assert.equal(zero.X1,zero.X2);assert.equal(zero.Y1,zero.Y2);
    assert.equal(editLineGeometry(zero,{Width:120}).Width,120);
  }
});
test('invalid endpoint edits are atomic and mixed representations are rejected', () => {
  const p = {...rectangle}, before=JSON.stringify(p);
  for (const value of [NaN,Infinity,-Infinity,300001,-300001,'oops']) assert.throws(()=>editLineGeometry(p,{X1:value}));
  assert.throws(()=>editLineGeometry(p,{Width:-1}));assert.throws(()=>editLineGeometry(p,{X1:0,Left:0}),/separately/);
  assert.throws(()=>editLineGeometry(p,{X1:-300000,X2:300000}));assert.equal(JSON.stringify(p),before);
});
test('hit distances use the segment, not its bounding box', () => {
  const p={X1:0,Y1:0,X2:100,Y2:100};assert.equal(lineDistance(p,50,50),0);assert.ok(lineDistance(p,0,100)>70);
  assert.equal(lineDistance({X1:0,Y1:0,X2:0,Y2:0},3,4),5);
});
