import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Signal,History} from '../src/core/core.js';
import {newProject,normalizeProject} from '../src/project/model.js';
import {createIdeAdapter} from '../src/mcp/ide-adapter.js';
import {McpServer} from '../src/mcp/server.js';
import {McpSkillCatalog,SKILLS_EXTENSION} from '../src/mcp/skill-catalog.js';
import {McpTasks,TASK_EXTENSION} from '../src/mcp/tasks.js';
import {MCP_META,MCP_VERSION,McpError} from '../src/mcp/protocol.js';
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const meta=tasks=>({[MCP_META+'protocolVersion']:MCP_VERSION,[MCP_META+'clientCapabilities']:tasks?{extensions:{[TASK_EXTENSION]:{}}}:{}});
function fixture(t) {
  const ide=new Signal();Object.assign(ide,{project:newProject('Capabilities'),runState:'design',history:new History(),breakpoints:[],output:[],docs:[],stack:[],
    markDirty(){this.dirty=true;},record(before,label){this.history.record(before,this.project,label);this.markDirty();},
    loadProject(p){this.project=normalizeProject(p);this.history.reset();},syncBreakpoints(){}});
  const adapter=createIdeAdapter(ide,{approve:async()=>true}),server=new McpServer(adapter);adapter.setEnabled(true);let sequence=0;
  t.after(()=>{server.close();adapter.dispose();});
  const request=(method,params={},principal='A',tasks=false)=>server.dispatch({jsonrpc:'2.0',id:++sequence,method,params:{...params,_meta:meta(tasks)}},{principal,sessionKey:'req-'+sequence});
  const call=(name,args={},principal='A',tasks=false)=>request('tools/call',{name:'vb6.'+name,arguments:args},principal,tasks);
  const finish=async id=>{for(let i=0;i<100;i++){const response=await request('tasks/get',{taskId:id},'A',true);assert.equal(response.error,undefined);if(response.result.status!=='working')return response.result;await tick();}assert.fail('Task did not settle');};
  return {ide,adapter,server,request,call,finish};
}
test('real IDE advertises and serves six standard Skills with verified resource bytes',async t=>{
  const f=fixture(t),discovery=await f.request('server/discover');
  assert.deepEqual(discovery.result.capabilities.extensions[SKILLS_EXTENSION],{directoryRead:true});
  const listed=await f.request('skills/list');assert.equal(listed.result.skills.length,6);
  assert.equal(listed.result.resultType,'complete');assert.equal(listed.result.ttlMs,0);assert.equal(listed.result.cacheScope,'private');
  for(const entry of listed.result.skills){
    const get=await f.request('skills/get',{uri:entry.uri});assert.deepEqual(get.result.skill,entry);
    for(const file of entry.resources){const r=await f.request('resources/read',{uri:file.uri});assert.equal(r.error,undefined);const bytes=Buffer.from(r.result.contents[0].text,'utf8');assert.equal(bytes.length,file.size);assert.equal('sha256:'+hash(bytes),file.digest);}
    const directory=await f.request('resources/directory/read',{uri:entry.uri.slice(0,-9)});
    assert.deepEqual(directory.result.resources.map(r=>r.uri.split('/').at(-1)).sort(),['SKILL.md','references']);assert.equal(directory.result.cacheScope,'private');
  }
  assert.equal((await f.request('skills/get',{uri:'skill://missing/SKILL.md'})).error.code,-32602);
  assert.equal((await f.request('resources/directory/read',{uri:listed.result.skills[0].uri})).error.code,-32602);
  assert.equal(f.ide.history.undoStack.length,0);assert.equal(f.server.tasks.inspect().length,0);assert.equal(f.adapter.permissions.snapshot(f.ide.project.id).active,false);
});
test('Skills directory cursors cannot be replayed against a different directory or caller',async t=>{
  const f=fixture(t),files=Object.fromEntries(Array.from({length:101},(_,i)=>['a/f'+i+'.txt','x']));
  f.adapter.skills=new McpSkillCatalog([{path:'large',frontmatter:{name:'large',description:'Large catalog'},body:'Read only',files,directories:['b']}]);
  const first=await f.request('resources/directory/read',{uri:'skill://large/a'});assert.equal(first.result.resources.length,100);
  const cursor=first.result.nextCursor;assert.ok(cursor);
  assert.equal((await f.request('resources/directory/read',{uri:'skill://large/b',cursor})).error.code,-32602);
  assert.equal((await f.request('resources/directory/read',{uri:'skill://large/a',cursor},'B')).error.code,-32602);
  assert.equal((await f.request('resources/directory/read',{uri:'skill://large/a',cursor})).result.resources.length,1);
});
test('legacy resources can read skills but do not falsely negotiate modern Skills methods',async t=>{
  const f=fixture(t),ctx={sessionKey:'legacy',principal:'legacy'};
  const request=(id,method,params={})=>f.server.dispatch({jsonrpc:'2.0',id,method,params},ctx);
  const init=await request(1,'initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'legacy',version:'1'}});assert.equal(init.result.capabilities.extensions,undefined);
  await f.server.dispatch({jsonrpc:'2.0',method:'notifications/initialized'},ctx);
  assert.match((await request(2,'resources/read',{uri:'skill://vb6/edit-source/SKILL.md'})).result.contents[0].text,/expectedRevision/);
  assert.equal((await request(3,'skills/list')).error.code,-32601);
});
test('source resources reassemble Unicode using revision-pinned UTF-16 ranges',async t=>{
  const f=fixture(t),source='Option Explicit\r\n'+"'漢🙂x\n".repeat(500);f.ide.project.modules[0].code=source;
  let uri='vb6://module/Form1/source?count=37',text='';
  do {const response=await f.request('resources/read',{uri});assert.equal(response.error,undefined);const value=response.result.contents[0],range=value._meta['io.vb6/range'];assert.equal(range.unit,'utf-16');assert.equal(range.total,source.length);text+=value.text;uri=range.nextUri;}while(uri);
  assert.equal(text,source);
  const first=(await f.request('resources/read',{uri:'vb6://module/Form1/source?count=7'})).result.contents[0];f.ide.markDirty();
  assert.equal((await f.request('resources/read',{uri:first._meta['io.vb6/range'].nextUri})).error.code,-32602);
});
for(const query of ['offset=1','count=0','count=262145','count=01','count=3&count=4','x=1','revision=-1','offset=9007199254740992'])test('source resource rejects invalid query '+query,async t=>{
  const f=fixture(t);assert.equal((await f.request('resources/read',{uri:'vb6://module/Form1/source?'+query})).error.code,-32602);
});
test('build results link to protected manifests and byte resources reproduce checksum',async t=>{
  const f=fixture(t),build=await f.call('build.create',{target:'project',expectedRevision:f.adapter.revision});assert.equal(build.error,undefined);
  const artifact=build.result.structuredContent.artifact,uri=artifact.manifestUri;
  assert.equal(build.result.content[0].type,'resource_link');assert.equal(build.result.content[0].uri,uri);
  const manifestText=(await f.request('resources/read',{uri})).result.contents[0].text;
  const manifest=JSON.parse(manifestText);assert.equal(manifest.sha256,artifact.sha256);assert.equal(manifest.chunks.maxCount,262144);
  assert.equal(manifest.revision,undefined);assert.equal(manifest.eventSequence,undefined);
  f.ide.markDirty();
  assert.equal((await f.request('resources/read',{uri})).result.contents[0].text,manifestText,'Manifest bytes must not change with live revision/event counters');
  assert.equal((await f.request('resources/read',{uri},'B')).error.code,-32602);
  let next=uri+'/bytes?count=113',chunks=[];
  do{const reply=await f.request('resources/read',{uri:next});assert.equal(reply.error,undefined);const value=reply.result.contents[0];chunks.push(Buffer.from(value.blob,'base64'));next=value._meta['io.vb6/range'].nextUri;}while(next);
  const bytes=Buffer.concat(chunks);assert.equal(bytes.length,artifact.size);assert.equal(hash(bytes),artifact.sha256);assert.deepEqual(JSON.parse(bytes),f.ide.project);
  await f.call('build.release',{artifactId:artifact.artifactId});assert.equal((await f.request('resources/read',{uri})).error.code,-32602);
});
test('ranged resources cannot bypass an embedded coding-agent authorization policy',async t=>{
  const f=fixture(t),artifact=(await f.call('build.create',{target:'project',expectedRevision:f.adapter.revision})).result.structuredContent.artifact;
  let names=[];f.adapter.permissions.usePolicy({revoke(){},signal:new AbortController().signal,snapshot(){return{};},
    async authorize(){assert.fail('Denied operations must not prompt');},assertTool(name){names.push(name);throw new McpError(-32001,'Denied by test policy');}});
  for(const uri of ['vb6://module/Form1/source?count=4',artifact.manifestUri,artifact.manifestUri+'/bytes'])assert.equal((await f.request('resources/read',{uri})).error.code,-32001);
  assert.deepEqual(names,['vb6.code.read','vb6.build.read','vb6.build.read']);
});
for(const name of ['project.compile','build.create'])test('read-only '+name+' tasks return the full modern result after disconnect',async t=>{
  const f=fixture(t),args=name==='build.create'?{target:'project',expectedRevision:f.adapter.revision}:{};
  const created=await f.call(name,args,'A',true);assert.equal(created.result.resultType,'task');f.server.closeSession('req-1');
  const task=await f.finish(created.result.taskId);assert.equal(task.status,'completed');assert.equal(task.result.resultType,'complete');assert.equal(task.result.isError,false);assert.ok(task.result._meta[MCP_META+'serverInfo']);
  assert.equal(task.result.structuredContent.valid,true);assert.equal((await f.request('tasks/get',{taskId:task.taskId},'B',true)).error.code,-32602);
  const local=f.server.tasks.inspect()[0];assert.equal(local.progress,1);assert.equal(local.total,1);assert.equal(local.result,undefined);
});
test('task capability does not defer mutations even with an erroneous embedder allowlist',async t=>{
  const f=fixture(t);f.server.taskTools.add('vb6.module.write');
  const result=await f.call('module.write',{module:'Form1',code:'Option Explicit',expectedRevision:f.adapter.revision},'A',true);
  assert.equal(result.result.resultType,'complete');assert.equal(f.server.tasks.inspect().length,0);assert.equal(f.ide.history.undoStack.length,1);
});
test('cancellation between build allocation and task settlement releases the orphan artifact',async t=>{
  const f=fixture(t);let cancellations=0;
  const off=f.adapter.onArtifactsChange(()=>{if(f.adapter.inspectArtifacts().length){for(const task of f.server.tasks.inspect())if(task.status==='working'){f.server.tasks.cancelLocal(task.taskId);cancellations++;}}});t.after(off);
  const created=await f.call('build.create',{target:'project',expectedRevision:f.adapter.revision},'A',true);const task=await f.finish(created.result.taskId);await tick();
  assert.equal(task.status,'cancelled');assert.equal(cancellations,1);assert.deepEqual(f.adapter.inspectArtifacts(),[]);
});
test('Apps tool result carries readable fallback and resource metadata without altering typed data',async t=>{
  const f=fixture(t),result=await f.call('ui.present',{source:'<text>Meaningful MCP result</text>'});
  assert.equal(result.error,undefined);assert.equal(result.result.isError,false);assert.match(result.result.content[0].text,/Meaningful MCP result/);
  assert.equal(result.result._meta.ui.resourceUri,'ui://vb6/intelligent-ui');assert.equal(result.result.structuredContent.fallbackMarkdown,result.result.content[0].text);
});
test('task quotas isolate callers, count UTF-8 result bytes and preserve settled data',async t=>{
  const tasks=new McpTasks({limit:3,perPrincipal:1,maxResultBytes:80});t.after(()=>tasks.clear());
  const original={text:'🙂'.repeat(12)},a=tasks.create(async()=>original,{principal:'A'});await tick();
  assert.equal(tasks.get(a.taskId,{principal:'A'}).status,'completed');original.text='changed';assert.equal(tasks.stats().resultBytes,Buffer.byteLength(JSON.stringify({text:'🙂'.repeat(12)})));
  assert.throws(()=>tasks.create(async()=>1,{principal:'A'}),/Too many/);
  const b=tasks.create(async()=>({text:'🙂'.repeat(12)}),{principal:'B'});await tick();assert.equal(tasks.get(b.taskId,{principal:'B'}).status,'failed');assert.match(tasks.get(b.taskId,{principal:'B'}).error.message,/byte limit/);
  tasks.clear('A');assert.equal(tasks.stats().resultBytes,0);
});
test('task progress is monotone; failure, cancel, expiry and successful cleanup differ',async t=>{
  let now=1;const tasks=new McpTasks({now:()=>now,ttlMs:1000});t.after(()=>tasks.clear());let cleaned=0,resolve;
  const a=tasks.create(async ctx=>{ctx.onTaskDiscard(()=>cleaned++);ctx.reportProgress(2,10,'two');ctx.reportProgress(1,10,'backwards');ctx.reportProgress(3,2,'invalid total');await new Promise(r=>resolve=r);return {ok:true};},{principal:'A'});await tick();
  assert.equal(tasks.inspect()[0].progress,2);assert.equal(tasks.get(a.taskId,{principal:'A'}).statusMessage,'two');resolve();await tick();tasks.clear('A');assert.equal(cleaned,0);
  const b=tasks.create(async ctx=>{ctx.onTaskDiscard(()=>cleaned++);throw new McpError(-32603,'failure');},{principal:'B'});await tick();assert.equal(tasks.get(b.taskId,{principal:'B'}).status,'failed');assert.equal(cleaned,1);
  const c=tasks.create(async ctx=>{ctx.onTaskDiscard(()=>cleaned++);await new Promise(()=>{});},{principal:'C'});await tick();now=1002;tasks.purge();assert.equal(cleaned,2);assert.equal(tasks.stats().retained,0);assert.throws(()=>tasks.get(c.taskId,{principal:'C'}),/expired/);
});
