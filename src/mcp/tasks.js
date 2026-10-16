import {McpError, MCP_META, MCP_LIMIT, isRecord, randomToken, utf8Length, errorResponse, awaitAbort} from './protocol.js';

export const TASK_EXTENSION = MCP_META + 'tasks';
export const DEFAULT_TASK_TOOLS = Object.freeze(['vb6.agent.wait','vb6.project.compile','vb6.build.create']);
export function requireTasks(params) {
  if (!isRecord(params._meta?.[MCP_META + 'clientCapabilities']?.extensions?.[TASK_EXTENSION]))
    throw new McpError(-32021, 'Missing required client capability.', {requiredCapabilities: {extensions: {[TASK_EXTENSION]: {}}}});
}
const quietly = callback => { try { Promise.resolve(callback()).catch(()=>{}); } catch {} };
function taskError(error) {
  if (error instanceof McpError && error.code === -32002) error = new McpError(-32602,error.message,error.data);
  const source = errorResponse(null,error).error;
  const result = {code:Number.isSafeInteger(source.code)?source.code:-32603,message:String(source.message||'Internal MCP error.').slice(0,2000)};
  try { if (source.data !== undefined) { const text=JSON.stringify(source.data); if (utf8Length(text)<=65536) result.data=JSON.parse(text); } } catch {}
  return result;
}
/** Bounded, ephemeral tasks. Auth identity is supplied by the transport, never clientInfo. */
export class McpTasks {
  constructor({now=()=>Date.now(),ttlMs=120000,limit=32,perPrincipal=16,maxResultBytes=MCP_LIMIT*2,changed=()=>{}}={}) {
    for (const [name,value] of Object.entries({ttlMs,limit,perPrincipal,maxResultBytes}))
      if (!Number.isSafeInteger(value)||value<1) throw new TypeError('Invalid task limit: '+name);
    this.now=now;this.ttlMs=ttlMs;this.limit=limit;this.perPrincipal=perPrincipal;this.maxResultBytes=maxResultBytes;
    this.changed=changed;this.entries=new Map();this.observers=new Set();this.resultBytes=0;
  }
  onChange(fn) { this.observers.add(fn);return()=>this.observers.delete(fn); }
  notify() { for (const fn of this.observers) quietly(fn); }
  statusChanged(entry) { quietly(()=>this.changed(structuredClone(entry.task),entry.principal));this.notify(); }
  // Local owner tooling only: never expose handles, arguments or results as tasks/list.
  inspect() {
    this.purge();return [...this.entries.values()].map(e=>({taskId:e.task.taskId,toolName:e.toolName,
      status:e.task.status,createdAt:e.task.createdAt,lastUpdatedAt:e.task.lastUpdatedAt,expiresAt:e.expiresAt,
      ...(e.progress<0?{}:{progress:e.progress,...(e.total===undefined?{}:{total:e.total})})}));
  }
  stats() { this.purge();return {retained:this.entries.size,resultBytes:this.resultBytes,limit:this.limit,perPrincipal:this.perPrincipal,maxResultBytes:this.maxResultBytes,ttlMs:this.ttlMs}; }
  cancelLocal(id) { this.purge();const entry=this.entries.get(id);if (!entry) return false;this.cancelEntry(entry);return true; }
  clearFinished() { for (const [id,e] of this.entries) if (['completed','failed','cancelled'].includes(e.task.status)) this.remove(id); }
  principal(ctx) {
    const principal=ctx.principal||ctx.sessionKey;
    if (typeof principal!=='string'||!principal||principal.length>512) throw new McpError(-32602,'A transport identity is required for tasks.');
    return principal;
  }
  purge() { for (const [id,entry] of this.entries) if (this.now()>=entry.expiresAt) this.remove(id); }
  remove(id) {
    const entry=this.entries.get(id);if (!entry) return;
    this.entries.delete(id);this.resultBytes-=entry.bytes;clearTimeout(entry.timer);
    entry.authority?.removeEventListener('abort',entry.revoke);entry.controller.abort();entry.discard();this.notify();
  }
  clear(principal) { for (const [id,entry] of this.entries) if (principal===undefined||entry.principal===principal) this.remove(id); }
  create(run,ctx,authority,{toolName='Tool call'}={}) {
    this.purge();const principal=this.principal(ctx);
    if (this.entries.size>=this.limit||[...this.entries.values()].filter(entry=>entry.principal===principal).length>=this.perPrincipal)
      throw new McpError(-32000,'Too many retained tasks; retry after task expiry.');
    if (authority?.aborted||ctx.signal?.aborted) throw new McpError(-32800,'Request cancelled.');
    const taskId=randomToken(24),createdAt=new Date(this.now()).toISOString(),controller=new AbortController();
    const entry={principal,controller,authority,toolName:String(toolName).slice(0,200),expiresAt:this.now()+this.ttlMs,bytes:0,
      progress:-1,total:undefined,discards:new Set(),task:{taskId,status:'working',createdAt,lastUpdatedAt:createdAt,ttlMs:this.ttlMs,pollIntervalMs:250}};
    entry.discard=()=>{const callbacks=[...entry.discards];entry.discards.clear();for (const fn of callbacks) quietly(fn);};
    entry.revoke=()=>this.remove(taskId);entry.timer=setTimeout(entry.revoke,this.ttlMs);entry.timer.unref?.();
    this.entries.set(taskId,entry);authority?.addEventListener('abort',entry.revoke,{once:true});this.notify();
    const live=()=>{
      if (this.now()>=entry.expiresAt) this.remove(taskId);
      return this.entries.get(taskId)===entry&&entry.task.status==='working'&&!controller.signal.aborted;
    };
    const settle=(status,value,bytes=0)=>{
      if (!live()) return;
      entry.bytes=bytes;this.resultBytes+=bytes;
      entry.task={...entry.task,status,lastUpdatedAt:new Date(this.now()).toISOString(),...value};
      if (status==='completed'&&!value.result?.isError) entry.discards.clear();else entry.discard();
      this.statusChanged(entry);
    };
    const reportProgress=(value,total,message)=>{
      if (!live()||!Number.isFinite(value)||value<0||value<=entry.progress||total!==undefined&&(!Number.isFinite(total)||total<value)) return;
      entry.progress=value;entry.total=total;
      entry.task={...entry.task,lastUpdatedAt:new Date(this.now()).toISOString(),statusMessage:String(message||'Progress '+value+(total===undefined?'':' / '+total)).slice(0,1000)};
      this.statusChanged(entry);
    };
    const onTaskDiscard=callback=>{
      if (typeof callback!=='function'||entry.discards.size>=32) throw new McpError(-32603,'Invalid task cleanup registration.');
      if (!live()) quietly(callback);else entry.discards.add(callback);
    };
    // A returned handle owns its lifetime independently of the initiating HTTP request.
    // Rollbacks release artifacts when cancellation wins between creation and settlement.
    Promise.resolve().then(()=>{
      if (!live()||authority?.aborted) throw new McpError(-32800,'Task cancelled.');
      return awaitAbort(run({...ctx,signal:controller.signal,emit:()=>{},notify:()=>{},reportProgress,log:()=>{},onTaskDiscard}),controller.signal);
    }).then(result=>{
      if (!live()) return;
      const text=JSON.stringify(result);
      if (typeof text!=='string') throw new McpError(-32603,'Task result must be JSON data.');
      const bytes=utf8Length(text);
      if (bytes>MCP_LIMIT/2||this.resultBytes+bytes>this.maxResultBytes) throw new McpError(-32603,'Task result exceeds the retained byte limit.');
      settle('completed',{result:JSON.parse(text)},bytes);
    }).catch(error=>settle('failed',{error:taskError(error)}));
    return {resultType:'task',...entry.task};
  }
  find(id,ctx) {
    this.purge();const entry=typeof id==='string'?this.entries.get(id):null;
    if (!entry||entry.principal!==this.principal(ctx)) throw new McpError(-32602,'Task not found or expired.');return entry;
  }
  get(id,ctx) { return structuredClone(this.find(id,ctx).task); }
  cancel(id,ctx) { this.cancelEntry(this.find(id,ctx));return {}; }
  cancelEntry(entry) {
    if (entry.task.status==='working') {
      entry.task={...entry.task,status:'cancelled',lastUpdatedAt:new Date(this.now()).toISOString()};
      entry.controller.abort();entry.discard();this.statusChanged(entry);
    }
  }
  update(id,responses,ctx) {
    this.find(id,ctx);if (!isRecord(responses)) throw new McpError(-32602,'inputResponses must be an object.');
    // These read-only tasks never elicit. Stale keys cannot approve IDE operations.
    return {};
  }
}
