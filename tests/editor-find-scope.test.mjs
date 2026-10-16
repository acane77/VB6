import test from 'node:test';
import assert from 'node:assert/strict';
import {FindIndex,mapFindScope,replaceMatches} from '../src/editor/find-index.js';

for(const name of ['café','Zażółć','变量','value$','value%','value&','value!','value#','value@','[Class]'])
  test('whole-word search follows source identifier boundaries: '+name,()=>{
    const source=`${name} ${name}Other other${name} (${name})`;
    assert.deepEqual(new FindIndex().search(source,name,{wholeWord:true}).map(m=>m.start),[0,source.lastIndexOf(name)]);
  });
test('untyped name does not partially match a typed identifier or a Unicode suffix',()=>{
  assert.equal(new FindIndex().search('value value$ valueΩ value_ value2 value','value',{wholeWord:true}).length,2);
});
test('scoped search caches scope as well as query and keeps global UTF-16 offsets',()=>{
  const f=new FindIndex(),source='😀 abc abc abc';
  const scope={start:7,end:10};assert.deepEqual(f.search(source,'abc',{scope}),[{start:7,end:10}]);
  const found=f.matches;assert.equal(f.search(source,'abc',{scope:{...scope}}),found);assert.equal(f.scans,1);
  assert.equal(f.search(source,'abc',{scope:{start:0,end:6}})[0].start,3);assert.equal(f.scans,2);
  assert.equal(f.next(0).start,3);assert.equal(f.next(99,-1).start,3);
});
test('scope never clips a match or manufactures a word boundary',()=>{
  const f=new FindIndex();assert.deepEqual(f.search('a cat cata','cat',{scope:{start:3,end:8}}),[]);
  assert.deepEqual(f.search('XcatY','cat',{wholeWord:true,scope:{start:1,end:4}}),[]);
  assert.deepEqual(f.search('abc','abc',{scope:{start:0,end:0}}),[]);
});
test('invalid scopes fail before changing the last successful index',()=>{
  const f=new FindIndex();f.search('abc','a');const previous=f.matches;
  for(const scope of [{start:-1,end:2},{start:2,end:1},{start:0,end:4},{start:0.5,end:1},{start:NaN,end:2},{start:0,end:Infinity}]){
    assert.throws(()=>f.search('abc','b',{scope}),RangeError);assert.equal(f.matches,previous);
  }
});
test('selection scope tracks edits before, within, after, and across both edges',()=>{
  const scope={start:3,end:8},map=(start,oldEnd,newEnd,length=20)=>mapFindScope(scope,{start,oldEnd,newEnd,delta:newEnd-oldEnd},length);
  assert.deepEqual(map(0,0,2),{start:5,end:10});assert.deepEqual(map(4,6,9),{start:3,end:11});
  assert.deepEqual(map(10,10,12),scope);assert.deepEqual(map(3,8,5),{start:3,end:5});
  assert.deepEqual(map(1,6,2),{start:1,end:4});assert.deepEqual(map(7,10,7),{start:3,end:7});
  assert.deepEqual(map(0,10,0,0),{start:0,end:0});assert.equal(mapFindScope(null,{},0),null);
});
test('a selected range replace is literal, non-overlapping and does not touch outside text',()=>{
  const text='outside old\nold 😀 old\noutside old',scope={start:12,end:22},f=new FindIndex();
  const matches=f.search(text,'old',{scope}),next=replaceMatches(text,matches,'$1');
  assert.equal(matches.length,2);assert.equal(next,'outside old\n$1 😀 $1\noutside old');
});
test('scoped search scales to large modules without changing surrounding content',()=>{
  const source='a\n'.repeat(100000),scope={start:99998,end:100006},f=new FindIndex();
  const matches=f.search(source,'a',{scope});assert.equal(matches.length,4);
  const next=replaceMatches(source,matches,'long');assert.equal(next.slice(0,scope.start),source.slice(0,scope.start));
  assert.equal(next.slice(scope.end+12),source.slice(scope.end));
});
