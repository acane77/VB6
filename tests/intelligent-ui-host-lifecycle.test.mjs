import test from 'node:test';
import assert from 'node:assert/strict';
import {observeUIHost} from '../src/intelligent-ui/host-lifecycle.js';
import {pinUIActionContext} from '../src/intelligent-ui/action-context.js';
import {createUIActionHandler} from '../src/intelligent-ui/actions.js';
function fixture(){const listeners=new Set(),changes=[],source={onChange(fn){listeners.add(fn);return()=>listeners.delete(fn);}};
  const task={id:'a',agent:{thread:{},sessionKey:'a'}},host={enabled:true,contextRevision:0,adapter:{...source,workspaceEpoch:1},conversations:{active:task,tasks:new Map([['a',task]])},workbench:{clearSnapshots(){changes.push('snapshots');}}};
  const observer=observeUIHost(host,source,event=>changes.push(event.type));return {host,observer,changes,listeners,task,emit:()=>{for(const fn of listeners)fn();}};
}
test('stream tokens do not invalidate the owning context',()=>{const f=fixture();for(let i=0;i<100;i++)f.emit();assert.equal(f.host.contextRevision,0);assert.deepEqual(f.changes,[]);});
for(const kind of ['disable','task','reset','workspace'])test('lifecycle invalidates old action pins across '+kind+' and restoration',()=>{
  const f=fixture(),pin=pinUIActionContext(f.host);pin.assertLive();
  if(kind==='disable'){f.host.enabled=false;f.observer.check();f.host.enabled=true;}
  else if(kind==='task'){f.host.conversations.active={};f.emit();f.host.conversations.active=f.task;}
  else if(kind==='reset'){f.task.agent.thread={};f.emit();f.task.agent.thread=pin.thread;}
  else {f.host.adapter.workspaceEpoch++;f.emit();f.host.adapter.workspaceEpoch--;}
  f.emit();assert.throws(pin.assertLive);pinUIActionContext(f.host).assertLive();assert.equal(f.host.contextRevision,2);
  if(kind==='workspace')assert.equal(f.changes.filter(c=>c==='snapshots').length,2);
});
test('host watcher disposal releases both subscriptions idempotently',()=>{const f=fixture();f.observer.dispose();f.observer.dispose();assert.equal(f.listeners.size,0);f.host.enabled=false;f.observer.check();assert.equal(f.host.contextRevision,0);});
test('direct host reviews cannot revive after disable/re-enable',async()=>{
  const f=fixture();let approve,queued=0;f.task.followups={add(){queued++;}};f.host.conversations.activeId='a';
  const action=createUIActionHandler(f.host,{review:()=>new Promise(resolve=>approve=resolve)}),pending=action({type:'message',args:['test']});
  f.host.enabled=false;f.observer.check();f.host.enabled=true;f.observer.check();approve(true);
  await assert.rejects(pending,/changed/);assert.equal(queued,0);
});
