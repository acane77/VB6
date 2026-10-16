import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeDataValue} from '../src/data/native-values.js';
import {dataObject,dataDefault} from '../src/data/defaults.js';
import {VBArray} from '../src/runtime/values.js';

test('only registered data objects acquire native Byte-array result conversion',()=>{
  const bytes=new Uint8Array([1,255]);assert.equal(nativeDataValue({__type:'ADODB.Recordset'},bytes),bytes);
  for(const owner of [dataObject({}),dataDefault({})]){const converted=nativeDataValue(owner,bytes);assert(converted instanceof VBArray);assert.equal(converted.type,'Byte');assert.deepEqual([...converted],[1,255]);converted.set([0],99);assert.equal(bytes[0],1);}
});
test('empty and bounded Byte-array results preserve a zero-based allocated array',()=>{
  const owner=dataObject({}),empty=nativeDataValue(owner,new Uint8Array());assert.deepEqual(empty.bounds,[[0,-1]]);assert.equal(empty.type,'Byte');assert.deepEqual([...empty],[]);
  assert.throws(()=>nativeDataValue(owner,new Uint8Array(1000001)),e=>e.number===7);
});
test('GetRows conversion preserves dimensions and scalar values without mutating original arrays',()=>{
  const owner=dataObject({}),rows=new VBArray([[1,2],[3,3]]);rows.set([1,3],new Uint8Array([7]));rows.set([2,3],'text');
  const result=nativeDataValue(owner,rows);assert.deepEqual(result.bounds,rows.bounds);assert(result.get(1,3) instanceof VBArray);assert.equal(result.get(2,3),'text');assert(rows.get(1,3) instanceof Uint8Array);
});
test('result conversion bounds aggregate nested storage and safely preserves array cycles',()=>{
  const owner=dataObject({}),rows=VBArray.from([new Uint8Array(600000),new Uint8Array(600000)]);assert.throws(()=>nativeDataValue(owner,rows),e=>e.number===7);
  // Construct a provider-owned cyclic container directly: VB assignment copies arrays.
  const cycle=VBArray.from([0]);cycle.data[0]=cycle;const result=nativeDataValue(owner,cycle);assert.notEqual(result,cycle);assert.equal(result.get(0),result);
});
test('scalar and nonarray object results retain identity and require no array marshalling',()=>{
  const owner=dataObject({});for(const value of [null,undefined,0,'text',new Date(),{x:1}])assert.equal(nativeDataValue(owner,value),value);
});
