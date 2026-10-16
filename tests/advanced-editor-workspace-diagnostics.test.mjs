import test from 'node:test';
import assert from 'node:assert/strict';
import {MessageChannel} from 'node:worker_threads';
import {JsonRpcPeer,messagePortTransport,RpcError} from '../src/editor/advanced/rpc.js';
import {LanguageClient} from '../src/editor/advanced/client.js';
import {PullDiagnostics} from '../src/editor/advanced/pull-diagnostics.js';

const uri='vb6-editor://workspace/one.bas',other='vb6-editor://workspace/two.bas';
const marker={range:{start:{line:0,character:0},end:{line:0,character:1}},message:'Expected value',severity:1};
const full=(uri,items=[marker],version=null,resultId='one')=>({uri,kind:'full',items,version,resultId});
const tick=()=>new Promise(r=>setTimeout(r,2));
async function until(check){const end=Date.now()+2500;while(!check()){if(Date.now()>end)assert.fail('Timed out waiting for protocol state.');await tick();}}
async function fixture(t,handler,capability={identifier:'test',interFileDependencies:true,workspaceDiagnostics:true}){
  const {port1,port2}=new MessageChannel(),server=new JsonRpcPeer(messagePortTransport(port1)),client=new LanguageClient(messagePortTransport(port2));
  server.onRequest('initialize',()=>({capabilities:{textDocumentSync:2,diagnosticProvider:capability}}));
  server.onRequest('workspace/diagnostic',handler);await client.initialize();
  const published=[],errors=[];client.on('diagnostics',p=>published.push(p));
  const pull=new PullDiagnostics(client,{delay:3,onError:e=>errors.push(e)});
  t.after(()=>{pull.dispose();client.dispose();server.close();});return {server,client,pull,workspace:pull.workspace,published,errors};
}
test('workspace pulls batch open files and cache full/unchanged reports including empty IDs',async t=>{
  const calls=[],f=await fixture(t,p=>{calls.push(p);return {items:calls.length===1?[full(uri,[],1,''),full(other,[marker],1,'b')]:[
    {uri,kind:'unchanged',version:2,resultId:''},{uri:other,kind:'unchanged',version:null,resultId:'b'}]};});
  f.client.open(uri,'vb6','a');f.client.open(other,'vb6','b');await until(()=>f.published.length===2);
  assert.equal(calls.length,1);assert.equal(calls[0].identifier,'test');assert.deepEqual(calls[0].previousResultIds,[]);
  assert.equal(f.pull.states.size,0);assert.ok(f.client.capability('workspace/diagnostic'));
  f.client.change(uri,[{text:'c'}],2);await until(()=>f.published.length===4);
  assert.deepEqual(calls[1].previousResultIds,[{uri,value:''},{uri:other,value:'b'}]);assert.equal(f.published[2].version,2);
  assert.deepEqual(f.published[3].diagnostics,[marker]);assert.deepEqual(f.errors,[]);
});
test('partial reports are staged and published only after a valid final result',async t=>{
  let request;const f=await fixture(t,p=>new Promise(resolve=>request={p,resolve}));f.client.open(uri,'vb6','a');f.client.open(other,'vb6','b');
  await until(()=>request);f.server.notify('$/progress',{token:request.p.partialResultToken,value:{items:[full(uri)]}});
  await tick();assert.equal(f.published.length,0);
  f.server.notify('$/progress',{token:'unrelated',value:{items:[full(other)]}});
  request.resolve({items:[full(other)]});await until(()=>f.published.length===2);assert.deepEqual(f.errors,[]);
});
test('any workspace edit cancels a partial batch and old final responses never publish',async t=>{
  const calls=[],f=await fixture(t,(p,{signal})=>new Promise(resolve=>calls.push({p,signal,resolve})));
  f.client.open(uri,'vb6','a');await until(()=>calls.length===1);
  f.server.notify('$/progress',{token:calls[0].p.partialResultToken,value:{items:[full(uri)]}});await tick();
  f.client.open(other,'vb6','b');await until(()=>calls.length===2&&calls[0].signal.aborted);
  calls[0].resolve({items:[]});calls[1].resolve({items:[full(uri,[]),full(other,[])]});await until(()=>f.published.length===2);
  assert.ok(f.published.every(p=>p.diagnostics.length===0));assert.deepEqual(f.errors,[]);
});
test('unknown URIs are ignored without opening files or touching unrelated markers',async t=>{
  const f=await fixture(t,()=>({items:[full('file:///outside/private.bas'),full(uri)]}));f.client.open(uri,'vb6','a');await until(()=>f.published.length===1);
  assert.equal(f.published[0].uri,uri);assert.equal(f.client.documents.size,1);
});
test('malformed final batches are atomic and preserve previous markers',async t=>{
  let calls=0;const f=await fixture(t,()=>({items:++calls===1?[full(uri),full(other)]:[full(uri,[]),{uri:other,kind:'full',version:1,items:null}]}));
  f.client.open(uri,'vb6','a');f.client.open(other,'vb6','b');await until(()=>f.published.length===2);
  await f.server.request('workspace/diagnostic/refresh');await until(()=>f.errors.length===1);
  assert.equal(f.published.length,2);assert.deepEqual(f.workspace.groups.get('test').results.get(uri).items,[marker]);
});
test('malformed partial reports cancel the request and report the error once',async t=>{
  let request;const f=await fixture(t,(p,{signal})=>new Promise(resolve=>request={p,signal,resolve}));f.client.open(uri,'vb6','a');await until(()=>request);
  f.server.notify('$/progress',{token:request.p.partialResultToken,value:{items:[full(uri,[{message:'bad'}])]}});
  await until(()=>request.signal.aborted&&f.errors.length===1);request.resolve({items:[]});await tick();assert.equal(f.published.length,0);
});
for(const [name,report]of [
  ['missing previous result',{uri,kind:'unchanged',version:null,resultId:'bad'}],
  ['wrong version',full(uri,[],7)],['missing version',{uri,kind:'full',items:[]}],
  ['invalid ID',full(uri,[],1,123)],['invalid message',full(uri,[{...marker,message:7}])],
  ['reversed range',full(uri,[{...marker,range:{start:{line:1,character:0},end:{line:0,character:0}}}])],
])test('workspace rejects '+name,async t=>{
  const f=await fixture(t,()=>({items:[report]}));f.client.open(uri,'vb6','a');await until(()=>f.errors.length===1);assert.equal(f.published.length,0);
});
test('duplicate partial document reports are rejected rather than replacing an earlier result',async t=>{
  let request;const f=await fixture(t,p=>new Promise(resolve=>request={p,resolve}));f.client.open(uri,'vb6','a');await until(()=>request);
  f.server.notify('$/progress',{token:request.p.partialResultToken,value:{items:[full(uri)]}});request.resolve({items:[full(uri,[])]});
  await until(()=>f.errors.length===1);assert.match(f.errors[0].message,/Duplicate/);assert.equal(f.published.length,0);
});
test('closing and reopening a URI resets its result ID and captured identity',async t=>{
  const calls=[],f=await fixture(t,p=>{calls.push(p);return {items:[full(uri,[],1,'id'+calls.length)]};});
  f.client.open(uri,'vb6','a');await until(()=>f.published.length===1);f.client.close(uri);f.client.open(uri,'vb6','b');
  await until(()=>calls.length===2&&f.published.at(-1).version===1);
  assert.deepEqual(calls[1].previousResultIds,[]);assert.equal(f.workspace.groups.get('test').results.get(uri).resultId,'id2');
});
test('document selectors separate providers and leave unsupported documents to document pulls',async t=>{
  const calls=[],f=await fixture(t,p=>{calls.push(p);return {items:[full(uri,[])]};},false);
  const xaml='vb6-editor://workspace/form.xaml';let docCalls=0;
  f.server.onRequest('textDocument/diagnostic',p=>{docCalls++;assert.equal(p.textDocument.uri,xaml);return {kind:'full',items:[]};});
  await f.server.request('client/registerCapability',{registrations:[
    {id:'vb',method:'textDocument/diagnostic',registerOptions:{identifier:'vb',workspaceDiagnostics:true,documentSelector:[{language:'vb6'}]}},
    {id:'xaml',method:'textDocument/diagnostic',registerOptions:{identifier:'xaml',workspaceDiagnostics:false,documentSelector:[{language:'xaml'}]}}
  ]});
  f.client.open(uri,'vb6','a');f.client.open(xaml,'xaml','<a/>');await until(()=>calls.length===1&&docCalls===1);
  assert.equal(calls[0].identifier,'vb');assert.equal(f.pull.states.has(uri),false);assert.equal(f.pull.states.has(xaml),true);
});
test('multiple diagnostic identifiers are pulled separately with bounded serial execution',async t=>{
  const calls=[],f=await fixture(t,(p,{signal})=>new Promise(resolve=>calls.push({p,signal,resolve})),false);
  await f.server.request('client/registerCapability',{registrations:['vb6','xaml'].map(language=>({id:language,method:'textDocument/diagnostic',registerOptions:{identifier:language,workspaceDiagnostics:true,documentSelector:[{language}]}}))});
  const xaml='vb6-editor://workspace/form.xaml';f.client.open(uri,'vb6','a');f.client.open(xaml,'xaml','<a/>');await until(()=>calls.length===1);
  await tick();assert.equal(calls.length,1);calls[0].resolve({items:[full(uri,[])]});await until(()=>calls.length===2);
  assert.equal(calls[1].p.identifier,'xaml');calls[1].resolve({items:[full(xaml,[])]});await until(()=>f.published.length===2);
});
test('capability removal cancels work and disposal removes progress listeners',async t=>{
  let request;const f=await fixture(t,(p,{signal})=>new Promise(resolve=>request={p,signal,resolve}),false);
  await f.server.request('client/registerCapability',{registrations:[{id:'test',method:'textDocument/diagnostic',registerOptions:{workspaceDiagnostics:true}}]});
  f.client.open(uri,'vb6','a');await until(()=>request);await f.server.request('client/unregisterCapability',{unregisterations:[{id:'test',method:'textDocument/diagnostic'}]});
  await until(()=>request.signal.aborted&&!f.workspace.running);assert.equal(f.workspace.groups.size,0);assert.equal(f.client.listeners.get('$/progress')?.size||0,0);
  request.resolve({items:[full(uri)]});f.pull.dispose();f.pull.dispose();assert.equal(f.workspace.listeners.length,0);
});
test('workspace cancellation retries are bounded and explicit refresh resets the budget',async t=>{
  let calls=0;const f=await fixture(t,()=>{calls++;throw new RpcError(-32802,'Indexing',{retriggerRequest:true});});f.client.open(uri,'vb6','a');
  await until(()=>f.errors.length===1);assert.equal(calls,4);await f.server.request('workspace/diagnostic/refresh');await until(()=>calls===5);
});
test('bounded partial report and diagnostic totals stop oversized batches',async t=>{
  let request;const f=await fixture(t,(p,{signal})=>new Promise(resolve=>request={p,signal,resolve}));
  f.workspace.maxDiagnostics=1;f.client.open(uri,'vb6','a');await until(()=>request);
  f.server.notify('$/progress',{token:request.p.partialResultToken,value:{items:[full(uri,[marker,marker])]}});
  await until(()=>f.errors.length===1&&request.signal.aborted);assert.match(f.errors[0].message,/limit/);assert.equal(f.published.length,0);request.resolve({items:[]});
});
