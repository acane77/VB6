import test from 'node:test';
import assert from 'node:assert/strict';
import {MessageChannel} from 'node:worker_threads';
import {LanguageClient} from '../src/editor/advanced/client.js';
import {messagePortTransport} from '../src/editor/advanced/rpc.js';
import {BuiltinLanguageServer} from '../src/editor/advanced/builtin-server.js';

const uri='file:///workspace/One.bas',other='file:///workspace/Two.bas';
const source='Option Explicit\nSub Main()\nFor missing = 1 To 2\nNext\nEnd Sub\n';
const tick=()=>new Promise(resolve=>setTimeout(resolve,2));
async function fixture(t){
  const {port1,port2}=new MessageChannel(),server=new BuiltinLanguageServer(messagePortTransport(port1),{diagnosticDelay:60000}),client=new LanguageClient(messagePortTransport(port2));
  t.after(()=>{client.dispose();server.dispose();});await client.initialize();return {server,client};
}
test('built-in document diagnostics return stable full/unchanged IDs and refresh after edits',async t=>{
  const {client}=await fixture(t);client.open(uri,'vb6',source);
  const params={textDocument:{uri},identifier:'vb6-studio'},first=await client.request('textDocument/diagnostic',params);
  assert.equal(first.kind,'full');assert.equal(typeof first.resultId,'string');assert.ok(first.items.some(d=>/missing/i.test(d.message)));
  const second=await client.request('textDocument/diagnostic',{...params,previousResultId:first.resultId});assert.deepEqual(second,{kind:'unchanged',resultId:first.resultId});
  client.change(uri,[{text:'Option Explicit\nSub Main()\nDim missing As Long\nFor missing = 1 To 2\nNext\nEnd Sub\n'}],2);
  const third=await client.request('textDocument/diagnostic',{...params,previousResultId:first.resultId});assert.equal(third.kind,'full');assert.notEqual(third.resultId,first.resultId);assert.deepEqual(third.items,[]);
});
test('built-in workspace reports contain every open VB6/XAML document with exact versions',async t=>{
  const {client}=await fixture(t),xaml='file:///workspace/Form.xaml';client.open(uri,'vb6',source,3);client.open(xaml,'xaml','<vb:Form xmlns:vb="urn:vb6:forms" Name="Form1" />',7);
  assert.equal(client.capabilities.diagnosticProvider.workspaceDiagnostics,true);
  const first=await client.request('workspace/diagnostic',{identifier:'vb6-studio',previousResultIds:[]});
  assert.deepEqual(first.items.map(i=>[i.uri,i.version,i.kind]),[[uri,3,'full'],[xaml,7,'full']]);
  const second=await client.request('workspace/diagnostic',{previousResultIds:first.items.map(i=>({uri:i.uri,value:i.resultId}))});
  assert.ok(second.items.every(i=>i.kind==='unchanged'));assert.deepEqual(second.items.map(i=>i.resultId),first.items.map(i=>i.resultId));
});
test('many concurrent document/workspace requests share one compiler traversal and push batch',async t=>{
  const {client,server}=await fixture(t);let scans=0;const steps=server.diagnosticCache.steps.bind(server.diagnosticCache);
  server.diagnosticCache.steps=(...args)=>{scans++;return steps(...args);};
  let pushes=0;client.on('diagnostics',()=>pushes++);client.open(uri,'vb6',source);client.open(other,'vb6','Option Explicit');
  const reports=await Promise.all(Array.from({length:20},(_,i)=>i%2?client.request('workspace/diagnostic',{previousResultIds:[]}):client.request('textDocument/diagnostic',{textDocument:{uri}})));
  assert.equal(scans,1);assert.equal(pushes,2);assert.equal(reports.length,20);
  await client.request('workspace/diagnostic',{previousResultIds:[]});assert.equal(scans,1);assert.equal(pushes,2);
});
test('compiler traversals of different revisions never overlap and stale results do not publish',async t=>{
  const {server}=await fixture(t);let active=0,peak=0,closed=0;
  const original=server.diagnosticCache.steps.bind(server.diagnosticCache);
  server.diagnosticCache.steps=function*(...args){active++;peak=Math.max(peak,active);try{for(let i=0;i<5;i++)yield {};return yield* original(...args);}finally{active--;closed++;}};
  server.open({uri,languageId:'vb6',text:source,version:1});const first=server.computeDiagnostics();
  // Attach rejection handlers before invalidating the first task.
  const observed=first.then(()=>null,error=>error);await tick();
  server.change({uri,version:2},[{text:'Option Explicit'}]);const second=server.computeDiagnostics();
  assert.equal((await observed).code,-32801);await second;
  assert.equal(peak,1);assert.equal(active,0);assert.equal(closed,2);assert.deepEqual(server.diagnostics.get(uri),[]);
  assert.equal(server.diagnosticEngine.completed,server.revision);
});
test('a compiler failure does not turn previous diagnostics into a successful empty report',async t=>{
  const {client,server}=await fixture(t);client.open(uri,'vb6',source);const initial=await client.request('textDocument/diagnostic',{textDocument:{uri}});
  const previous=server.diagnosticEngine.results.get(uri),steps=server.diagnosticCache.steps;
  server.diagnosticCache.steps=function*(){throw new Error('Injected compiler failure');};client.change(uri,[{text:'Option Explicit'}],2);
  await assert.rejects(client.request('textDocument/diagnostic',{textDocument:{uri}}),/Injected compiler failure/);
  assert.equal(server.diagnosticEngine.results.get(uri),previous);assert.equal(previous.resultId,initial.resultId);
  server.diagnosticCache.steps=steps;const repaired=await client.request('textDocument/diagnostic',{textDocument:{uri}});assert.equal(repaired.kind,'full');assert.deepEqual(repaired.items,[]);
});
test('closing/reopening a URI removes old result identity even when text is identical',async t=>{
  const {client}=await fixture(t);client.open(uri,'vb6',source);const first=await client.request('textDocument/diagnostic',{textDocument:{uri}});
  client.close(uri);client.open(uri,'vb6',source);const second=await client.request('textDocument/diagnostic',{textDocument:{uri},previousResultId:first.resultId});
  assert.equal(second.kind,'full');assert.notEqual(second.resultId,first.resultId);
});
test('unknown provider IDs and malformed previous workspace results fail explicitly',async t=>{
  const {client}=await fixture(t);client.open(uri,'vb6','Option Explicit');
  for(const params of [{identifier:'unknown',previousResultIds:[]},{},{previousResultIds:{}},{previousResultIds:[{uri,value:7}]}]){
    await assert.rejects(client.request('workspace/diagnostic',params),error=>error.code===-32602);
  }
});
test('cancelling one request does not cancel diagnostics required by another consumer',async t=>{
  const {client,server}=await fixture(t),steps=server.diagnosticCache.steps.bind(server.diagnosticCache);
  server.diagnosticCache.steps=function*(...args){for(let i=0;i<5;i++)yield {};return yield* steps(...args);};
  client.open(uri,'vb6',source);const abort=new AbortController();const cancelled=client.request('textDocument/diagnostic',{textDocument:{uri}},{signal:abort.signal});
  const check=assert.rejects(cancelled,error=>error.code===-32800);const shared=client.request('workspace/diagnostic',{previousResultIds:[]});await tick();abort.abort();
  await check;assert.equal((await shared).items[0].kind,'full');
});
