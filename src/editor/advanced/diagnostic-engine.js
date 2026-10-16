import {RpcError,RPC_CONTENT_MODIFIED} from './rpc.js';
import {diagnosticSnapshot} from '../../language/diagnostics.js';

const yieldTask=()=>new Promise(resolve=>setTimeout(resolve,0));
const key=value=>String(value||'').toLowerCase();
function diagnostic(item,document) {
  const severity=({error:1,warning:2,information:3,hint:4})[item.severity]||1;
  const start=item.range?.start||{line:Math.max(0,(item.line||1)-1),character:Math.max(0,(item.column||1)-1)};
  const offset=document.offsetAt(start);
  return {range:item.range||document.range(offset,Math.min(offset+1,document.text.length)),severity,code:item.code||item.number,source:'VB6',message:item.message};
}

/** Serializes access to the incremental compiler cache, coalesces requests for
 * the same revision, and supplies stable LSP full/unchanged result identities.
 * Failure or cancellation never fabricates an empty, successful report. */
export class DiagnosticEngine {
  constructor(server){this.server=server;this.completed=-1;this.results=new Map();this.serial=0;this.tail=null;this.pending=null;}
  current(revision){return this.server.revision===revision&&!this.server.stopped&&!this.server.peer.closed;}
  compute() {
    const revision=this.server.revision;
    if(this.completed===revision&&this.current(revision))return Promise.resolve();
    if(this.pending?.revision===revision)return this.pending.promise;
    // A stale compiler iterator must unwind before a newer revision can use the
    // same mutable cache. Coalescing only equal revisions is not sufficient.
    const promise=Promise.resolve(this.tail).catch(()=>{}).then(()=>this.calculate(revision));
    this.pending={revision,promise};this.tail=promise;
    const clear=()=>{if(this.pending?.promise===promise)this.pending=null;if(this.tail===promise)this.tail=null;};
    promise.then(clear,clear);return promise;
  }
  requireCurrent(revision){if(!this.current(revision))throw new RpcError(RPC_CONTENT_MODIFIED,'Workspace changed during diagnostic analysis.');}
  async calculate(revision) {
    this.requireCurrent(revision);
    const server=this.server,project=server.project,documents=new Map(server.documents),results=new Map([...documents].map(([uri])=>[uri,[]]));
    const steps=server.diagnosticCache.steps(diagnosticSnapshot(project));let step;
    try {
      do{step=steps.next();if(!step.done){await yieldTask();this.requireCurrent(revision);}}while(!step.done);
      const modules=new Map(project.modules.map(m=>[key(m.name),m]));
      for(const item of step.value.diagnostics){
        const module=modules.get(key(item.source)),uri=module&&server.moduleUris.get(module.id),document=documents.get(uri);
        if(document)results.get(uri).push(diagnostic(item,document));
      }
      for(const [uri,document]of documents)if(document.languageId==='xaml')results.set(uri,server.xaml.diagnostics(uri).map(item=>({...diagnostic(item,document),source:'XAML'})));
    } finally {steps.return?.();}
    this.requireCurrent(revision);
    for(const [uri,items]of results){
      const serialized=JSON.stringify(items),previous=this.results.get(uri);
      this.results.set(uri,{items,serialized,resultId:previous?.serialized===serialized?previous.resultId:'vb6-'+(++this.serial)});
    }
    for(const uri of this.results.keys())if(!documents.has(uri))this.results.delete(uri);
    this.completed=revision;server.diagnostics=results;
    for(const [uri,items]of results){
      if(!this.current(revision))break;
      server.peer.notify('textDocument/publishDiagnostics',{uri,version:documents.get(uri).version,diagnostics:items});
    }
  }
  validateIdentifier(params){if(params.identifier!==undefined&&params.identifier!=='vb6-studio')throw new RpcError(-32602,'Unknown diagnostic provider identifier.');}
  report(uri,previousResultId){
    const result=this.results.get(uri);
    if(!result)throw new RpcError(RPC_CONTENT_MODIFIED,'Diagnostics are not available for this document snapshot.');
    return typeof previousResultId==='string'&&previousResultId===result.resultId?{kind:'unchanged',resultId:result.resultId}:{kind:'full',resultId:result.resultId,items:result.items};
  }
  async document(params){this.validateIdentifier(params);await this.compute();return this.report(params.textDocument.uri,params.previousResultId);}
  async workspace(params){
    this.validateIdentifier(params);
    if(!Array.isArray(params.previousResultIds)||params.previousResultIds.length>4096||params.previousResultIds.some(p=>typeof p?.uri!=='string'||typeof p.value!=='string'))throw new RpcError(-32602,'Invalid previous workspace diagnostic results.');
    const previous=new Map(params.previousResultIds.map(p=>[p.uri,p.value]));await this.compute();
    return {items:[...this.server.documents].map(([uri,document])=>({uri,version:document.version,...this.report(uri,previous.get(uri))}))};
  }
  forget(uri){this.results.delete(uri);}
  dispose(){this.results.clear();this.completed=-1;}
}
