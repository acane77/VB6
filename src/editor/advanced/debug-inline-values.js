import {tokenize} from '../../language/lexer.js';
import {KEYWORDS} from '../language-service.js';
import {debugExpression} from './debug-hover.js';
import {safeMarkdown} from './protocol-converters.js';

const keywords=new Set(KEYWORDS.map(word=>word.toLowerCase()));
const lower=value=>String(value||'').toLowerCase();
const plain=value=>String(value??'').replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g,' ').slice(0,256);

/** The inline-value expression arm is deliberately storage-only. A server may
 * suggest a call or getter, but implicit presentation never evaluates code. */
export function inspectionPath(value,{variable=false}={}) {
  if(typeof value!=='string'||!value.length||value.length>256||/[\r\n]/.test(value))return null;
  let tokens;try{tokens=tokenize(value).filter(t=>t.type!=='eof');}catch{return null;}
  if(!tokens.length||tokens.length%2!==1||variable&&tokens.length!==1)return null;
  for(let i=0;i<tokens.length;i++)if(i%2?tokens[i].value!=='.':tokens[i].type!=='id')return null;
  // The lexer may stop at a comment. All original non-whitespace text must be
  // accounted for; an ignored suffix cannot be smuggled into a debug request.
  if(value.slice(0,tokens[0].start).trim()||value.slice(tokens.at(-1).end).trim())return null;
  return tokens.map(t=>t.raw).join('');
}

/** Invalid responses are rejected as a batch, not partly displayed. */
export function normalizeInlineValues(document,items) {
  if(items===null)return [];
  if(!Array.isArray(items)||items.length>4096)throw new Error('Invalid or oversized inline-value response.');
  const result=[];
  for(const item of items){
    const range=item?.range,a=range?.start,b=range?.end;
    if(!a||!b||![a.line,a.character,b.line,b.character].every(v=>Number.isSafeInteger(v)&&v>=0))throw new Error('Invalid inline-value range.');
    const start=document.offsetAt(a,true),end=document.offsetAt(b,true);if(end<start)throw new Error('Reversed inline-value range.');
    if(Object.hasOwn(item,'text')){
      if(typeof item.text!=='string')throw new Error('Invalid inline-value text.');
      result.push({range,text:plain(item.text)});continue;
    }
    const variable=Object.hasOwn(item,'caseSensitiveLookup');
    if(variable&&typeof item.caseSensitiveLookup!=='boolean')throw new Error('Invalid inline-value lookup mode.');
    const original=variable?item.variableName:item.expression;
    if(original!==undefined&&typeof original!=='string')throw new Error('Invalid inline-value expression.');
    const expression=inspectionPath(original??document.text.slice(start,end),{variable});
    if(expression)result.push({range,expression,caseSensitive:variable&&item.caseSensitiveLookup});
  }
  return result;
}

/** At most two physical inspections are in flight across all enhanced panes.
 * Superseded jobs are discarded before dispatch; disposing does not pretend an
 * already-dispatched runtime request has been physically cancelled. */
export class InlineInspectionPool {
  constructor({maxConcurrent=2,maxQueue=64}={}){this.maxConcurrent=maxConcurrent;this.maxQueue=maxQueue;this.queue=[];this.active=new Set();}
  inspect(snapshot,expression,current){
    if(this.disposed||!current()||this.queue.length>=this.maxQueue)return Promise.resolve(null);
    return new Promise(resolve=>{this.queue.push({snapshot,expression,current,resolve});this.drain();});
  }
  drain(){
    while(!this.disposed&&this.active.size<this.maxConcurrent&&this.queue.length){
      const job=this.queue.shift();if(!job.current()){job.resolve(null);continue;}this.active.add(job);
      Promise.resolve().then(()=>job.current()?job.snapshot.workbench.inspect(job.expression):null).then(value=>{
        const s=job.snapshot,c=value?.context;
        job.resolve(!this.disposed&&job.current()&&c&&c.pauseId===s.pauseId&&c.frameIndex===s.frameIndex&&lower(c.module)===lower(s.frame.module)&&lower(c.procedure)===lower(s.frame.procedure)?value:null);
      }).catch(()=>job.resolve(null)).finally(()=>{this.active.delete(job);this.drain();});
    }
  }
  dispose(){if(this.disposed)return;this.disposed=true;for(const job of [...this.queue,...this.active])job.resolve(null);this.queue=[];}
}

function localCandidates(model,ranges) {
  const result=[],seen=new Set();let budget=256;
  for(const range of ranges)for(let line=range.startLineNumber;line<=range.endLineNumber&&budget>0;line++,budget--){
    if(seen.has(line))continue;seen.add(line);const text=model.getLineContent(line);if(text.length>16384)continue;
    let tokens;try{tokens=tokenize(text);}catch{continue;}
    for(let i=0;i<tokens.length;i++){
      const token=tokens[i];if(token.type!=='id'||keywords.has(lower(token.value))||['.','('].includes(tokens[i+1]?.value))continue;
      const expression=debugExpression(text,token.start+1);if(!expression)continue;
      result.push({range:{start:{line:line-1,character:expression.startColumn-1},end:{line:line-1,character:expression.endColumn-1}},expression:expression.expression});
      if(result.length===128)return result;
    }
  }
  return result;
}

/** Owned end-of-line values in one Monaco view. Model text/undo are untouched.
 * Every response is tied to the selected frame, pause, source and viewport. */
export class DebugInlineValues {
  constructor(surface,view,{delay=80}={}) {
    this.surface=surface;this.runtime=surface.runtime;this.record=surface.record;this.view=view;this.delay=delay;this.generation=0;this.last=[];
    this.decorations=view.createDecorationsCollection();this.disposables=[];
    for(const event of ['onDidScrollChange','onDidLayoutChange','onDidChangeModelContent'])if(view[event])this.disposables.push(view[event](()=>this.refresh()));
    const client=this.record.client;
    this.disposables.push({dispose:client.on('refresh',name=>{if(name==='inlineValue')this.refresh(true);})},{dispose:client.on('capabilities',()=>this.refresh(true))},{dispose:client.on('closed',()=>this.refresh(true))});
    this.refresh();
  }
  context(){
    const {runtime,record,view,surface}=this,ide=runtime.ide,model=record.model;
    if(this.disposed||surface.disposed||surface.composing||runtime.settings.inlineValues!==true||!surface.host.isConnected||!surface.host.clientHeight||model.isDisposed())return null;
    const index=ide.debuggerWindows?.frameIndex??((ide.stack?.length||0)-1),frame=ide.stack?.[index],line=frame?.line;
    if(!Number.isSafeInteger(line)||line<1||line>model.getLineCount())return null;
    const text=model.getLineContent(line),column=text.search(/\S/)+1;
    const snapshot=column>0?runtime.debugHover.snapshot(model,{lineNumber:line,column}):null;if(!snapshot)return null;
    const ranges=view.getVisibleRanges().filter(r=>r.endLineNumber>=1&&r.startLineNumber<=model.getLineCount()).map(r=>({startLineNumber:Math.max(1,r.startLineNumber),endLineNumber:Math.min(model.getLineCount(),r.endLineNumber)}));
    if(!ranges.length)return null;
    return {snapshot,ranges,locals:ide.locals,watchValues:ide.watchValues,key:ranges.map(r=>r.startLineNumber+':'+r.endLineNumber).join(',')};
  }
  current(state,generation){return !this.disposed&&generation===this.generation&&!this.surface.composing&&this.runtime.settings.inlineValues===true&&this.surface.host.isConnected&&!!this.surface.host.clientHeight&&this.runtime.debugHover.current(state.snapshot)&&this.runtime.ide.locals===state.locals&&this.runtime.ide.watchValues===state.watchValues;}
  refresh(force=false){
    if(this.disposed)return;const state=this.context();
    if(!force&&state&&this.state&&this.current(this.state,this.generation)&&state.key===this.state.key)return;
    ++this.generation;clearTimeout(this.timer);this.abort?.abort();this.decorations.clear();this.last=[];this.state=state;
    if(!state)return;
    const generation=this.generation;this.timer=setTimeout(()=>{this.timer=null;this.render(state,generation).catch(error=>{if(this.current(state,generation)&&![-32800,-32801,-32802].includes(error.code))this.runtime.report(error);});},this.delay);
  }
  async render(state,generation){
    const {runtime,record}=this,model=record.model,client=record.client,current=()=>this.current(state,generation);
    if(!current())return;const abort=new AbortController();this.abort=abort;let items;
    const document=client.documents.get(record.uri);
    if(client.state==='ready'&&document&&client.capability('textDocument/inlineValue',document)){
      const first=state.ranges[0].startLineNumber,last=Math.min(model.getLineCount(),state.ranges.at(-1).endLineNumber),frame=state.snapshot.frame;
      const line=frame.line-1,column=Math.max(0,(frame.column||1)-1),end=Math.max(column,(frame.endColumn||frame.column||1)-1);
      const start=document.offsetAt({line,character:column}),stop=document.offsetAt({line,character:end});
      const response=await client.request('textDocument/inlineValue',{textDocument:{uri:record.uri},range:{start:{line:first-1,character:0},end:{line:last-1,character:model.getLineMaxColumn(last)-1}},context:{frameId:Number.isSafeInteger(frame.id)?frame.id:state.snapshot.frameIndex,stoppedLocation:document.range(start,stop)}},{signal:abort.signal,workspace:true});
      if(!current())return;items=normalizeInlineValues(document,response);
    }else items=localCandidates(model,state.ranges);
    const values=[],seen=new Set(),cache=new Map();
    for(const item of items){
      const line=item.range.end.line+1;
      if(!state.ranges.some(r=>line>=r.startLineNumber&&line<=r.endLineNumber))continue;
      const snapshot=runtime.debugHover.snapshot(model,{lineNumber:item.range.start.line+1,column:item.range.start.character+1});
      if(!snapshot||snapshot.frame!==state.snapshot.frame)continue;
      const key=line+':'+(item.expression||item.text);if(seen.has(key))continue;seen.add(key);
      // A case-sensitive variable lookup must match the stored locals inventory
      // exactly. VB's case-insensitive resolver is not a substitute for that flag.
      if(item.caseSensitive&&!state.locals?.some(row=>row.name===item.expression))continue;
      const task=async()=>{
        let text=item.text;
        if(item.expression){
          let pending=cache.get(item.expression);if(!pending){pending=runtime.inlineInspections.inspect(snapshot,item.expression,current);cache.set(item.expression,pending);}
          const result=await pending;if(!result||!current())return null;text=item.expression+' = '+plain(result.value);
        }
        return text?{line,text:plain(text)}:null;
      };
      values.push(task());if(values.length===32)break;
    }
    const resolved=await Promise.all(values);if(!current())return;
    const lines=new Map();for(const value of resolved)if(value){let row=lines.get(value.line);if(!row)lines.set(value.line,row=[]);if(row.length<3)row.push(value.text);}
    this.last=[...lines].map(([line,parts])=>({line,text:parts.join(' · ').slice(0,384)}));
    this.decorations.set(this.last.map(({line,text})=>({range:new runtime.monaco.Range(line,model.getLineMaxColumn(line),line,model.getLineMaxColumn(line)),options:{description:'vb6-inline-debug-value',showIfCollapsed:true,after:{content:'  '+text,inlineClassName:'advanced-inline-debug-value',cursorStops:runtime.monaco.editor.InjectedTextCursorStops?.None},hoverMessage:safeMarkdown({kind:'plaintext',value:text})}})));
  }
  dispose(){if(this.disposed)return;this.disposed=true;++this.generation;clearTimeout(this.timer);this.abort?.abort();this.decorations.clear();this.last=[];for(const item of this.disposables)item.dispose();this.disposables=[];}
}
