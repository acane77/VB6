import test from 'node:test';
import assert from 'node:assert/strict';
import {subscribeStyleActivity} from '../src/rendering/style-activity.js';
import {timingSummary, PassTimer, benchmarkRendering} from '../src/rendering/benchmark.js';
import {renderingCandidates} from '../src/rendering/policy.js';
function realm() {
  class CSSStyleSheet {
    insertRule(rule) { if (!(this instanceof CSSStyleSheet)) throw new TypeError('brand'); if (rule === 'bad') throw new SyntaxError('rule'); this.rule=rule;return 3; }
    replace() { return this.pending; }
  }
  class CSSStyleDeclaration { constructor(rule) { this.parentRule=rule; } set color(value) { this.value=value; } setProperty(name,value){this.value=value;} }
  class Animation { play(){this.playState='running';} set currentTime(t){this.time=t;} }
  return {CSSStyleSheet, CSSStyleDeclaration, Animation};
}
test('CSSOM observation preserves returns, brand errors and exceptions',()=>{
  const view=realm(),values=[],native=view.CSSStyleSheet.prototype.insertRule;
  const release=subscribeStyleActivity(view,k=>values.push(k)),sheet=new view.CSSStyleSheet();
  assert.equal(sheet.insertRule('a{}'),3);assert.deepEqual(values,['stylesheet']);
  assert.throws(()=>sheet.insertRule('bad'),SyntaxError);
  assert.throws(()=>view.CSSStyleSheet.prototype.insertRule.call({},'a{}'),TypeError);
  assert.equal(values.length,1);release();release();assert.equal(view.CSSStyleSheet.prototype.insertRule,native);
});
test('generated rule setters notify but inline setters do not double invalidate',()=>{
  const view=realm(),events=[],release=subscribeStyleActivity(view,k=>events.push(k));
  const inline=new view.CSSStyleDeclaration(null),rule=new view.CSSStyleDeclaration({});
  inline.color='red';inline.setProperty('color','blue');assert.equal(events.length,0);
  rule.color='red';rule.setProperty('color','blue');assert.equal(events.length,2);release();
});
test('shared subscriptions restore only on last release, preserving foreign patches',()=>{
  const view=realm(),events=[],first=subscribeStyleActivity(view,()=>events.push(1)),wrapper=view.Animation.prototype.play;
  const second=subscribeStyleActivity(view,()=>events.push(2));
  assert.equal(view.Animation.prototype.play,wrapper);first();new view.Animation().play();assert.deepEqual(events,[2]);
  const foreign=function(){};view.Animation.prototype.play=foreign;second();assert.equal(view.Animation.prototype.play,foreign);
});
test('async stylesheet replacement preserves promise identity and notifies only success',async()=>{
  const view=realm(),events=[],release=subscribeStyleActivity(view,()=>events.push(1)),sheet=new view.CSSStyleSheet();
  let resolve;sheet.pending=new Promise(r=>resolve=r);assert.equal(sheet.replace(),sheet.pending);assert.equal(events.length,0);
  resolve();await Promise.resolve();assert.equal(events.length,1);
  sheet.pending=Promise.reject(Error('bad'));await assert.rejects(sheet.replace());assert.equal(events.length,1);
  sheet.pending=Promise.resolve();sheet.replace();release();await Promise.resolve();assert.equal(events.length,1);
});
test('paused animation scrubbing notifies and observers cannot break native operations',()=>{
  const view=realm(),release=subscribeStyleActivity(view,()=>{throw Error('observer');});const a=new view.Animation();
  a.currentTime=15;assert.equal(a.time,15);assert.doesNotThrow(()=>a.play());release();
});
test('locked browser APIs are reported rather than overwritten',()=>{
  const view=realm();Object.defineProperty(view.Animation.prototype,'play',{configurable:false});
  const release=subscribeStyleActivity(view,()=>{});assert.ok(release.capabilities.unavailable.includes('play'));release();
});
test('timing summaries preserve raw samples and mark missing GPU timestamps',()=>{
  assert.equal(timingSummary([]),null);const samples=[3,1,2];const summary=timingSummary(samples);
  assert.equal(summary.p50Ms,2);assert.equal(summary.p95Ms,3);assert.deepEqual(summary.samples,samples);assert.notEqual(summary.samples,samples);
});
test('benchmarks reject unbounded workloads and invalid backends',async()=>{
  for(const options of [{frames:0},{frames:1000},{quads:10001},{backends:['html']},{backends:[]}]) await assert.rejects(benchmarkRendering({},options));
});
test('GPU timestamps convert nanoseconds, unmap and dispose all resources',async()=>{
  let unmaps=0,destroys=0,t=0;const data=new BigUint64Array([1000n,251000n]);
  const buffer=()=>({mapAsync:async()=>{},getMappedRange:()=>data.buffer,unmap(){unmaps++},destroy(){destroys++}});
  const painter={device:{features:new Set(['timestamp-query']),createQuerySet:()=>({destroy(){destroys++}}),createBuffer:buffer},view:{performance:{now:()=>t++},GPUBufferUsage:{},GPUMapMode:{READ:1}},render(scene,{timing}){assert.ok(timing.querySet)}};
  const timer=new PassTimer(painter);assert.deepEqual(await timer.measure({}),{cpuMs:1,gpuMs:.25});assert.equal(unmaps,1);
  timer.dispose();timer.dispose();assert.equal(destroys,3);
});
test('backend fallback ordering accepts any distinct canvas backend with terminal HTML',()=>{
  assert.deepEqual(renderingCandidates({backend:'canvas2d',fallbacks:['webgpu','webgl2','webgpu']}),['canvas2d','webgpu','webgl2','html']);
});

test('adopted stylesheet arrays preserve identity, return values and native errors',()=>{
  const view=realm();
  class Document { constructor(){this.sheets=[];} get adoptedStyleSheets(){return this.sheets;} set adoptedStyleSheets(v){this.sheets=v;} }
  view.Document=Document;
  const doc=new Document(),array=doc.adoptedStyleSheets,events=[];
  const release=subscribeStyleActivity(view,kind=>events.push(kind));
  assert.equal(doc.adoptedStyleSheets,array);events.length=0;
  assert.equal(array.push('a','b'),2);assert.equal(events.length,1);
  assert.deepEqual(array.splice(0,1,'c'),['a']);assert.equal(events.length,2);
  assert.equal(array.reverse(),array);assert.deepEqual([...array],['b','c']);
  assert.throws(()=>array.sort(()=>{throw Error('comparator')}),/comparator/);
  const n=events.length;assert.equal(doc.adoptedStyleSheets,array);array[0]='d';assert.equal(events.length,n+1);
  const foreign=function(){};array.pop=foreign;release();
  assert.equal(array.pop,foreign);assert.equal(Object.hasOwn(array,'push'),false);
  assert.equal(Object.hasOwn(array,'reverse'),false);assert.equal(doc.adoptedStyleSheets,array);
});
test('closed shadow hosts stay native after subscription teardown and restart',async()=>{
  const {requiresNativeShadowPaint}=await import('../src/rendering/style-activity.js');
  const view=realm();
  class Element { constructor(){this.ownerDocument={defaultView:view};this.localName='div';} attachShadow(){return {host:this,mode:'closed'};} }
  view.Element=Element;const host=new Element(),events=[],native=Element.prototype.attachShadow;
  assert.equal(requiresNativeShadowPaint(host),false);
  const release=subscribeStyleActivity(view,kind=>events.push(kind));
  const root=host.attachShadow({mode:'closed'});assert.equal(root.host,host);
  assert.equal(requiresNativeShadowPaint(host),true);assert.deepEqual(events,['shadow']);release();
  assert.equal(Element.prototype.attachShadow,native);assert.equal(requiresNativeShadowPaint(host),true);
  host.localName='my-editor';assert.equal(requiresNativeShadowPaint(host),true);
});

test('geometry style snapshots do not serialize fonts until atlas text needs them',async()=>{
  const {DOMScene}=await import('../src/rendering/dom-scene.js');
  const {FONT_STYLE_KEYS}=await import('../src/rendering/text-style.js');
  const expectedFonts=FONT_STYLE_KEYS.filter(key=>key.startsWith('font')).length;
  const scene=Object.create(DOMScene.prototype);let fonts=0,computed=0;
  Object.assign(scene,{styles:new WeakMap(),view:{getComputedStyle(){computed++;return new Proxy({},{get(_,key){if(String(key).startsWith('font'))fonts++;return String(key)}})}}});
  const node={},style=scene.style(node);assert.equal(fonts,0);assert.equal(computed,1);
  assert.equal(scene.style(node),style);assert.equal(computed,1);
  assert.equal(scene.fontStyle(node,style),style);assert.equal(fonts,expectedFonts);assert.equal(computed,2);
  scene.fontStyle(node,style);assert.equal(fonts,expectedFonts);assert.equal(computed,2);
});

test('teardown restores a wrapped setter without undoing a later foreign getter',()=>{
  const view=realm();class Document { get adoptedStyleSheets(){return this.array || (this.array=[])} set adoptedStyleSheets(value){this.array=value} }
  view.Document=Document;const prototype=Document.prototype,native=Object.getOwnPropertyDescriptor(prototype,'adoptedStyleSheets');
  const release=subscribeStyleActivity(view,()=>{}),foreign=function(){return ['foreign']};
  Object.defineProperty(prototype,'adoptedStyleSheets',{...Object.getOwnPropertyDescriptor(prototype,'adoptedStyleSheets'),get:foreign});
  release();const restored=Object.getOwnPropertyDescriptor(prototype,'adoptedStyleSheets');
  assert.equal(restored.get,foreign);assert.equal(restored.set,native.set);
});

test('teardown restores a wrapped rule getter without undoing a later foreign setter',()=>{
  const view=realm();class CSSStyleRule { get style(){return this.declaration || (this.declaration={});} }
  view.CSSStyleRule=CSSStyleRule;const prototype=CSSStyleRule.prototype,native=Object.getOwnPropertyDescriptor(prototype,'style');
  const release=subscribeStyleActivity(view,()=>{}),foreign=function(value){this.foreign=value;};
  Object.defineProperty(prototype,'style',{...Object.getOwnPropertyDescriptor(prototype,'style'),set:foreign});
  release();const restored=Object.getOwnPropertyDescriptor(prototype,'style');
  assert.equal(restored.get,native.get);assert.equal(restored.set,foreign);
  const rule=new CSSStyleRule();rule.style='kept';assert.equal(rule.foreign,'kept');
});
