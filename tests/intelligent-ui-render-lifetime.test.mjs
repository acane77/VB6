import test from 'node:test';
import assert from 'node:assert/strict';
import {createAppBlockFactory} from '../packages/intelligent-ui/src/app-block.js';
import {createReferenceFactories} from '../packages/intelligent-ui/src/reference-renderer.js';

// DOM contract fixture only: these tests assert cancellation/ownership, not browser isolation.
function documentFixture(){
  const created=[],observers=[];
  const node=tag=>({tag,children:[],style:{},append(...children){this.children.push(...children);},
    replaceChildren(...children){this.children=children;},replaceWith(other){this.replacement=other;}});
  const document={documentElement:node('html'),defaultView:{location:{origin:'https://ide.example'},
    MutationObserver:class {constructor(){observers.push(this);}observe(){this.observing=true;}disconnect(){this.observing=false;}}},
    createElement(tag){const value=node(tag);created.push(value);return value;}};
  const button=text=>created.find(value=>value.tag==='button'&&value.textContent===text);
  return {document,created,observers,button};
}
const turn=()=>new Promise(resolve=>setImmediate(resolve));
for(const change of ['source','lifecycle','dispose'])test('AppBlock '+change+' aborts pending approval and cannot mount after late consent',async()=>{
  const f=documentFixture();let consent,signal,lifecycle,unsubscribed=0;
  const factory=createAppBlockFactory({proxyUrl:'https://sandbox.example/proxy',
    approveApp:(_app,context)=>{signal=context.signal;return new Promise(resolve=>consent=resolve);},
    subscribeLifecycle:listener=>{lifecycle=listener;return()=>unsubscribed++;}});
  const view=factory({document:f.document});view.update({html:'<p>Before</p>'});
  const pending=f.button('Run isolated app').onclick();assert.equal(signal.aborted,false);
  if(change==='source')view.update({html:'<p>After</p>'});else if(change==='lifecycle')lifecycle();else view.dispose();
  assert.equal(signal.aborted,true);consent(true);await pending;
  assert.equal(f.created.some(n=>n.tag==='iframe'),false);assert.equal(f.button('Run isolated app').disabled,false);
  if(change!=='dispose')view.dispose();assert.equal(unsubscribed,1);assert.equal(f.observers[0].observing,false);
});
for(const change of ['update','dispose'])test('external image '+change+' cancels approval without assigning an image URL',async()=>{
  const f=documentFixture();let consent,signal;
  const view=createReferenceFactories({approveResource:(_url,context)=>{signal=context.signal;return new Promise(resolve=>consent=resolve);}}).image({document:f.document});
  view.update({src:'https://images.example/before.png'});
  const pending=f.button('Load external image').onclick();assert.equal(signal.aborted,false);
  if(change==='update')view.update({src:'https://images.example/after.png'});else view.dispose();
  assert.equal(signal.aborted,true);consent(true);await pending;
  assert.equal(f.created.some(n=>n.tag==='img'),false);if(change!=='dispose')view.dispose();
});
test('queued reference intent cannot inherit the replacement reference signal',async()=>{
  const f=documentFixture();let calls=0,record={kind:'citation',title:'Before',url:'https://source.example/before',provenance:{source:'Trusted fixture'}};
  const view=createReferenceFactories({resolveReference:async()=>record,onAction:()=>{calls++;}}).Cite({document:f.document});
  view.update({ref:'before'});await turn();
  f.button('Open cited source').onclick();
  record={...record,title:'After',url:'https://source.example/after'};view.update({ref:'after'});
  await turn();assert.equal(calls,0);assert.equal(f.created.some(n=>n.textContent?.includes('changed before')),false);
  view.dispose();
});
test('current reference intents carry the owning signal and disposal revokes it',async()=>{
  const f=documentFixture();let action,signal;
  const view=createReferenceFactories({resolveReference:async()=>({kind:'citation',title:'Inspected',url:'https://source.example/current',provenance:{source:'Trusted fixture'}}),
    onAction:(value,context)=>{action=value;signal=context.signal;}}).Cite({document:f.document});
  view.update({ref:'current'});await turn();f.button('Open cited source').onclick();await turn();
  assert.deepEqual(action,{type:'link',args:['https://source.example/current']});assert.equal(signal.aborted,false);
  view.dispose();assert.equal(signal.aborted,true);
});
