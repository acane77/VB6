import test from 'node:test';
import assert from 'node:assert/strict';
import {UIWorkbenchModel,WORKBENCH_LIMITS,sourceLocation} from '../src/intelligent-ui/workbench-model.js';

test('drafts support new, rename, duplication, selection and independent history',()=>{
  const m=new UIWorkbenchModel(),a=m.create({source:'A'});m.edit({title:'First',source:'AB'});m.checkpoint();m.edit({source:'ABC'});
  assert.equal(m.canUndo,true);m.undo();assert.equal(a.source,'AB');m.undo();assert.equal(a.source,'A');m.redo();assert.equal(a.source,'AB');
  const b=m.duplicate();assert.equal(b.source,'AB');assert.notEqual(a.id,b.id);m.edit({source:'B'});m.select(a.id);assert.equal(m.active.source,'AB');
  m.select(b.id);m.undo();assert.equal(b.source,'AB');
});
test('typing is coalesced until a checkpoint, and a new edit invalidates redo',()=>{
  const m=new UIWorkbenchModel();m.create();for(const source of ['a','ab','abc'])m.edit({source});
  m.undo();assert.equal(m.active.source,'');m.redo();assert.equal(m.active.source,'abc');m.undo();m.edit({source:'x'});assert.equal(m.canRedo,false);
});
test('JSON drafts preserve invalid intermediate edits but do not become runtime data',()=>{
  const m=new UIWorkbenchModel();m.create({dataText:'{"x":'});assert.throws(()=>m.data(),/Invalid preview JSON/);
  m.edit({dataText:'{"x":3}'});assert.equal(m.data().x,3);m.data().x=99;assert.equal(m.data().x,3);
});
for(const value of ['null','[]','"text"','{"__proto__":{}}','{"x":1e999}'])test('unsafe or non-object data rejected: '+value,()=>{
  const m=new UIWorkbenchModel();m.create({dataText:value});assert.throws(()=>m.data());
});
test('document import is bounded, transactional and does not accept policy or state',()=>{
  const m=new UIWorkbenchModel();const a=m.create({title:'A',source:'hello',dataText:'{"x":1}'}),exported=m.exportDocument();
  const b=m.importDocument(exported);assert.equal(b.title,'A');assert.notEqual(a.id,b.id);assert.equal(m.dirty(),false);
  const before=m.documents.size;assert.throws(()=>m.importDocument(exported.replace('"version": 1','"version": 2')));
  for(const extra of ['grant','snapshot','sandboxUrl']){const input=JSON.parse(exported);input[extra]={};assert.throws(()=>m.importDocument(JSON.stringify(input)));}
  assert.equal(m.documents.size,before);assert.equal(m.active,b);
});
test('plain source import does not parse code as a JSON document',()=>{
  const m=new UIWorkbenchModel(),doc=m.importDocument('<text>Hello</text>',{sourceOnly:true,name:'hello.dil'});
  assert.equal(doc.source,'<text>Hello</text>');assert.equal(m.dirty(),true);
});
test('save/export revision guards cannot mark newer edits saved or discard them',()=>{
  const m=new UIWorkbenchModel(),doc=m.create();const revision=doc.revision;m.edit({source:'changed'});
  assert.equal(m.markSaved(doc.id,revision),false);assert.throws(()=>m.close(doc.id,{discard:true,expectedRevision:revision}),/changed/);
  assert.throws(()=>m.close(),/unsaved/);m.markSaved();assert.equal(m.dirty(),false);m.close();assert.equal(m.active,null);
});
test('history trimming stays bounded and retains the latest edit',()=>{
  const m=new UIWorkbenchModel();m.create();for(let i=0;i<100;i++){m.edit({source:'x'.repeat(40000)+i});m.checkpoint();}
  assert.ok(m.active.undo.length<=WORKBENCH_LIMITS.history);assert.ok(JSON.stringify(m.active.undo).length*2<=WORKBENCH_LIMITS.historyBytes);
  m.undo();assert.equal(m.active.source,'x'.repeat(40000)+98);
});
test('document count, source sizes and unsupported edits fail without mutation',()=>{
  const m=new UIWorkbenchModel();for(let i=0;i<16;i++)m.create();assert.throws(()=>m.create(),/limit 16/);
  const before=m.active.source;assert.throws(()=>m.edit({source:'x'.repeat(100001)}));assert.throws(()=>m.edit({enabled:true}));assert.equal(m.active.source,before);
});
test('preview state is copied, immutable, bounded and excluded from document export',()=>{
  const m=new UIWorkbenchModel();m.create();const value={state:{count:7}};m.setSnapshot(value);value.state.count=9;
  assert.equal(m.active.snapshot.state.count,7);assert.throws(()=>m.active.snapshot.state.count=1);assert.doesNotMatch(m.exportDocument(),/state|snapshot/);
  assert.throws(()=>m.setSnapshot({state:[]}));m.clearSnapshots();assert.equal(m.active.snapshot,null);
});
test('observers cannot corrupt successful edits and unsubscribe/dispose release the model',()=>{
  const m=new UIWorkbenchModel();let count=0;m.onChange(()=>{throw new Error('observer');});const off=m.onChange(()=>count++);
  m.create();off();m.edit({source:'x'});assert.equal(count,1);m.dispose();m.dispose();assert.throws(()=>m.create(),/disposed/);assert.equal(m.documents.size,0);
});
test('diagnostic locations clamp invalid offsets and retain UTF-16 columns',()=>{
  assert.deepEqual(sourceLocation('a\r\n😀x',5),{offset:5,line:2,column:3});
  assert.deepEqual(sourceLocation('abc',-1),{offset:0,line:1,column:1});assert.deepEqual(sourceLocation('abc',99),{offset:3,line:1,column:4});
});

test('literal replace bounds expansion before allocating and never interprets regex or dollar tokens',async()=>{
  const {replaceAllLiteral}=await import('../src/intelligent-ui/workbench-model.js');
  assert.equal(replaceAllLiteral('a.a.a','.','$&'),'a$&a$&a');
  assert.equal(replaceAllLiteral('aaa','aa','b'),'ba');
  assert.equal(replaceAllLiteral('hello','','ignored'),'hello');
  assert.throws(()=>replaceAllLiteral('a'.repeat(100000),'a','b'.repeat(1000)),/limit/);
  assert.equal(replaceAllLiteral('aaaa','aa','',4),'');
});
