import test from 'node:test';
import assert from 'node:assert/strict';
import {DebugInlineValues,InlineInspectionPool,inspectionPath,normalizeInlineValues} from '../src/editor/advanced/debug-inline-values.js';
import {DebugHoverProvider} from '../src/editor/advanced/debug-hover.js';
import {EditorIntelligence} from '../src/editor/intelligence.js';
import {LspTextDocument} from '../src/editor/advanced/text-document.js';
const source='Public Sub Run()\n  Dim value As Long\n  value = 42\n  Debug.Print value, obj.Value\nEnd Sub\nPrivate Sub Other()\n  Dim other As Long\nEnd Sub\n';
const range=(line=3,a=14,b=19)=>({start:{line,character:a},end:{line,character:b}});
const tick=()=>new Promise(resolve=>setTimeout(resolve,2));
async function until(check){for(let i=0;i<1000;i++){if(check())return;await tick();}assert.fail('Timed out waiting for inline values.');}
function fixture(t,{external=false,inspect,response}={}){
  const module={id:'main',name:'Main',kind:'module',code:source},document=new LspTextDocument('vb6-editor://workspace/Main.bas','vb6',source,1);
  let version=1,visible=[{startLineNumber:1,endLineNumber:8}],disposed=false;
  const lines=source.split('\n'),model={uri:{toString:()=>document.uri},getVersionId:()=>version,isDisposed:()=>disposed,getOffsetAt:p=>document.offsetAt({line:p.lineNumber-1,character:p.column-1}),getLineContent:line=>lines[line-1],getLineCount:()=>lines.length,getLineMaxColumn:line=>lines[line-1].length+1};
  const listeners=new Map(),calls=[],requests=[],errors=[],decorations={items:[],set(items){this.items=items;},clear(){this.items=[];}},events=new Map();
  const client={state:'ready',documents:new Map([[document.uri,document]]),on(name,cb){let set=listeners.get(name);if(!set)listeners.set(name,set=new Set());set.add(cb);return()=>set.delete(cb);},capability:()=>external,async request(method,params,options){requests.push({method,params,options});return response?response(params,options):[{range:range(),text:'server text'}];}};
  const record={uri:document.uri,moduleId:module.id,language:'vb6',model,client,legacy:{intelligence:new EditorIntelligence()}},ide={runState:'paused',runtimeFrame:{},project:{modules:[module],settings:{}},stack:[{module:'Main',procedure:'Run',line:4,column:3,endColumn:33,id:99}],bridgeToken:'runtime',editRevision:1,locals:[{name:'value'},{name:'obj'}],watchValues:[]};
  const reply=value=>({value,type:'Long',context:{module:'Main',procedure:'Run',frameIndex:0,pauseId:5}});
  ide.debuggerWindows={pauseId:5,frameIndex:0,refreshSerial:3,inspect:async expression=>{calls.push(expression);if(inspect)return inspect(expression);return ['value','obj.Value'].includes(expression)?reply(expression==='value'?'42':'7'):null;}};
  const runtime={ide,settings:{inlineValues:true},records:new Map([[record.uri,record]]),report:error=>errors.push(error),monaco:{Range:class{constructor(...positions){this.positions=positions;}},editor:{InjectedTextCursorStops:{None:3}}}};
  runtime.inlineInspections=new InlineInspectionPool();runtime.debugHover=new DebugHoverProvider(runtime);
  const surface={runtime,record,host:{isConnected:true,clientHeight:300}},view={createDecorationsCollection:()=>decorations,getVisibleRanges:()=>visible};
  for(const name of ['onDidScrollChange','onDidLayoutChange','onDidChangeModelContent'])view[name]=cb=>{events.set(name,cb);return{dispose:()=>events.delete(name)};};
  const controller=new DebugInlineValues(surface,view,{delay:1});
  t.after(()=>{controller.dispose();runtime.inlineInspections.dispose();runtime.debugHover.dispose();});
  return {controller,runtime,ide,model,document,record,surface,view,decorations,calls,requests,errors,reply,listeners,events,edit:()=>version++,visible:value=>visible=value,disposeModel:()=>disposed=true,emit:(name,value)=>{for(const cb of listeners.get(name)||[])cb(value);}};
}
for(const value of ['value',' value ','obj . Value','[Class].[Value]','value$','变量'])test('storage inspection accepts '+value,()=>assert.ok(inspectionPath(value)));
for(const value of ['','GetObject()','obj(1).Value','obj.Value()','obj + value','.Value','value\n','value \' ignore','"value"','obj..Value','a'.repeat(257)])test('storage inspection refuses '+JSON.stringify(value),()=>assert.equal(inspectionPath(value),null));
test('variable lookups cannot request member traversal',()=>{assert.equal(inspectionPath('obj.Value',{variable:true}),null);assert.equal(inspectionPath('value',{variable:true}),'value');});
test('three LSP inline-value forms preserve UTF-16 ranges and do not run expressions',()=>{
  const doc=new LspTextDocument('vb6://m','vb6','😀 value obj.Value',1),a={start:{line:0,character:3},end:{line:0,character:8}};
  assert.deepEqual(normalizeInlineValues(doc,[{range:a,text:'plain\u202e\ntext'},{range:a,caseSensitiveLookup:false},{range:a,expression:'obj.Value'},{range:a,expression:'SideEffect()'}]),[
    {range:a,text:'plain  text'},{range:a,expression:'value',caseSensitive:false},{range:a,expression:'obj.Value',caseSensitive:false}]);
  assert.deepEqual(normalizeInlineValues(doc,null),[]);
});
test('malformed LSP results are rejected before displaying any entries',()=>{
  const doc=new LspTextDocument('vb6://m','vb6','value',1),r={start:{line:0,character:0},end:{line:0,character:5}};
  for(const item of [{range:r,text:3},{range:r,expression:3},{range:r,caseSensitiveLookup:1},{range:{start:{line:0,character:5},end:{line:0,character:0}},text:'a'},{range:{start:{line:0,character:0},end:{line:0,character:6}},text:'a'},{range:{start:{line:1,character:0},end:{line:1,character:0}},text:'a'}])assert.throws(()=>normalizeInlineValues(doc,[{range:r,text:'ok'},item]));
  assert.throws(()=>normalizeInlineValues(doc,new Array(4097).fill({range:r,text:'a'})));assert.throws(()=>normalizeInlineValues(doc,{}));
});
test('local paused values decorate visible source without modifying text or undo',async t=>{
  const f=fixture(t);await until(()=>f.controller.last.some(row=>row.text.includes('value = 42')));
  assert.ok(f.controller.last.some(row=>row.text.includes('obj.Value = 7')));assert.equal(f.document.text,source);
  assert.equal(f.calls.includes('other'),false);assert.equal(f.requests.length,0);
  for(const d of f.decorations.items){assert.equal(d.options.hoverMessage.isTrusted,false);assert.equal(d.options.hoverMessage.supportHtml,false);assert.equal(d.options.after.cursorStops,3);assert.equal(d.options.showIfCollapsed,true);}
  const count=f.calls.length;f.controller.refresh();await tick();assert.equal(f.calls.length,count);
});
for(const [name,change]of [
  ['resume',f=>f.ide.runState='running'],['pending edits',f=>f.ide.pendingEdits=true],['evaluation',f=>f.ide.evaluating=true],
  ['retained frame',f=>f.ide.stack[0].retained=true],['disable',f=>f.runtime.settings.inlineValues=false],
  ['composition',f=>f.surface.composing=true],['hidden',f=>f.surface.host.clientHeight=0],['detached host',f=>f.surface.host.isConnected=false],
  ['disposed model',f=>f.disposeModel()],['missing frame',f=>f.ide.stack=[]]
])test('inline decorations clear on '+name,async t=>{
  const f=fixture(t);await until(()=>f.controller.last.length);change(f);f.controller.refresh();assert.equal(f.controller.last.length,0);assert.equal(f.decorations.items.length,0);
});
test('late inspections cannot paint a new source version or pause',async t=>{
  let finish;const f=fixture(t,{inspect:()=>new Promise(resolve=>finish=resolve)});await until(()=>finish);
  f.edit();f.ide.debuggerWindows.pauseId++;finish(f.reply('old'));await tick();assert.equal(f.controller.last.length,0);
});
test('viewport and locals changes invalidate the display and trigger current work',async t=>{
  const f=fixture(t);await until(()=>f.controller.last.length);f.visible([{startLineNumber:4,endLineNumber:4}]);f.events.get('onDidScrollChange')();await until(()=>f.controller.last.length);
  assert.ok(f.controller.last.every(row=>row.line===4));const count=f.calls.length;
  f.ide.locals=[...f.ide.locals];f.controller.refresh();await until(()=>f.calls.length>count);assert.deepEqual(f.errors,[]);
});
test('external inline values use a stable frame ID and preserve all supported forms',async t=>{
  const f=fixture(t,{external:true,response:()=>[{range:range(),text:'<script>not HTML</script>'},{range:range(),caseSensitiveLookup:false},{range:range(),expression:'obj.Value'},{range:range(),expression:'Danger()'}]});
  await until(()=>f.controller.last.length);const request=f.requests[0];assert.equal(request.method,'textDocument/inlineValue');assert.equal(request.params.context.frameId,99);assert.equal(request.params.context.stoppedLocation.start.line,3);
  assert.equal(request.options.workspace,true);assert.ok(f.controller.last[0].text.includes('<script>'));assert.ok(f.controller.last[0].text.includes('value = 42'));assert.ok(f.controller.last[0].text.includes('obj.Value = 7'));assert.equal(f.calls.includes('Danger()'),false);
});
test('case-sensitive external lookup requires an exact stored local name',async t=>{
  const f=fixture(t,{external:true,response:()=>[{range:range(),variableName:'VALUE',caseSensitiveLookup:true},{range:range(),variableName:'value',caseSensitiveLookup:true}]});
  await until(()=>f.controller.last.length);assert.deepEqual(f.calls,['value']);
});
test('external requests are cancelled on resume and cannot paint late text',async t=>{
  let finish;const f=fixture(t,{external:true,response:()=>new Promise(resolve=>finish=resolve)});await until(()=>finish);
  f.ide.runState='running';f.controller.refresh();assert.equal(f.requests[0].options.signal.aborted,true);
  finish([{range:range(),text:'late'}]);await tick();assert.equal(f.controller.last.length,0);
});
test('server refresh recomputes inline values and disposal removes all listeners',async t=>{
  const f=fixture(t,{external:true});await until(()=>f.controller.last.length);f.emit('refresh','inlineValue');await until(()=>f.requests.length===2);
  f.controller.dispose();f.controller.dispose();assert.equal(f.events.size,0);for(const set of f.listeners.values())assert.equal(set.size,0);assert.equal(f.decorations.items.length,0);
});
test('malformed server inline reports clear the batch and surface a bounded error',async t=>{
  const f=fixture(t,{external:true,response:()=>[{range:range(),text:'valid'},{range:range(),text:123}]});await until(()=>f.errors.length);assert.equal(f.controller.last.length,0);assert.equal(f.errors.length,1);
});
test('global inspection pool bounds physical work and skips obsolete queued jobs',async()=>{
  const pool=new InlineInspectionPool({maxQueue:3}),calls=[],pending=[],frame={module:'M',procedure:'P'},context={module:'M',procedure:'P',pauseId:1,frameIndex:0};
  const snapshot={frame,pauseId:1,frameIndex:0,workbench:{inspect:expression=>new Promise(resolve=>{calls.push(expression);pending.push(resolve);})}};
  let current=true;const a=pool.inspect(snapshot,'a',()=>true),b=pool.inspect(snapshot,'b',()=>true),c=pool.inspect(snapshot,'c',()=>current),d=pool.inspect(snapshot,'d',()=>true),e=pool.inspect(snapshot,'e',()=>true),overflow=pool.inspect(snapshot,'f',()=>true);
  await tick();assert.deepEqual(calls,['a','b']);assert.equal(await overflow,null);current=false;
  pending[0]({value:'1',context});await until(()=>calls.includes('d'));assert.equal(await c,null);assert.equal(calls.includes('c'),false);assert.equal(pool.active.size,2);
  pool.dispose();assert.equal((await a).value,'1');for(const result of await Promise.all([b,d,e]))assert.equal(result,null);assert.equal(pool.active.size,2);
  for(const resolve of pending)resolve(null);await until(()=>pool.active.size===0);
});
test('pool rejects runtime context mismatches and inspector failures',async()=>{
  const pool=new InlineInspectionPool(),snapshot={frame:{module:'M',procedure:'P'},pauseId:1,frameIndex:0,workbench:{inspect:async()=>({value:'old',context:{module:'M',procedure:'P',pauseId:2,frameIndex:0}})}};
  assert.equal(await pool.inspect(snapshot,'a',()=>true),null);snapshot.workbench.inspect=async()=>{throw new Error('No storage');};assert.equal(await pool.inspect(snapshot,'a',()=>true),null);pool.dispose();
});
