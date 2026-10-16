/** Owned LSP 3.17 workspace pulls. Partial reports are staged until the final
 * response, and published only against the captured workspace. Never opens a
 * URI supplied by a server. Document selectors and provider identifiers are
 * respected; providers without workspace support keep using document pulls. */
export class WorkspaceDiagnostics {
  constructor(client,{delay=200,onError=()=>{},maxReports=8192,maxDiagnostics=100000}={}) {
    this.client=client;this.delay=delay;this.onError=onError;this.maxReports=maxReports;this.maxDiagnostics=maxDiagnostics;
    this.groups=new Map();this.queue=new Set();this.running=false;this.serial=0;this.disposed=false;
    this.listeners=[client.on('document',()=>this.refresh()),client.on('refresh',name=>{if(name==='diagnostic')this.refresh();}),
      client.on('capabilities',()=>this.refresh(true)),client.on('closed',()=>this.dispose())];
    this.refresh();
  }
  capability(document) {
    const value=this.client.state==='ready'&&document&&this.client.capability('textDocument/diagnostic',document);
    return value?.workspaceDiagnostics===true?value:null;
  }
  refresh(clear=false) {
    if(this.disposed)return;
    const wanted=new Map();
    for(const [uri,document]of this.client.documents){
      const capability=this.capability(document);if(!capability)continue;
      const id=typeof capability.identifier==='string'?capability.identifier:null;
      let group=wanted.get(id);if(!group)wanted.set(id,group=new Map());group.set(uri,document);
    }
    for(const [id,state]of this.groups)if(!wanted.has(id)){
      this.remove(id);for(const uri of state.results.keys())this.client.emit('diagnostics',{uri,diagnostics:[]});
    }
    for(const [id,documents]of wanted){
      let state=this.groups.get(id);if(!state)this.groups.set(id,state={generation:0,results:new Map(),documents});
      for(const [uri,result]of state.results)if(clear||documents.get(uri)!==result.document)state.results.delete(uri);
      state.documents=documents;this.schedule(id,state);
    }
  }
  schedule(id,state,delay=this.delay,retry=false) {
    if(this.disposed)return;
    if(!retry)state.retries=0;
    ++state.generation;clearTimeout(state.timer);state.abort?.abort();this.queue.delete(id);
    state.timer=setTimeout(()=>{state.timer=null;if(!this.disposed&&this.groups.get(id)===state){this.queue.add(id);this.drain();}},delay);
  }
  remove(id) {
    const state=this.groups.get(id);if(!state)return;
    ++state.generation;clearTimeout(state.timer);state.abort?.abort();this.groups.delete(id);this.queue.delete(id);
  }
  drain() {
    if(this.disposed||this.running||!this.queue.size)return;
    const id=this.queue.values().next().value;this.queue.delete(id);
    const state=this.groups.get(id);if(!state){this.drain();return;}
    const generation=state.generation,revision=this.client.revision,abort=new AbortController();state.abort=abort;this.running=true;
    const snapshots=new Map([...state.documents].map(([uri,document])=>[uri,{document,version:document.version}]));
    const current=()=>!this.disposed&&!abort.signal.aborted&&this.groups.get(id)===state&&state.generation===generation&&this.client.revision===revision&&
      [...snapshots].every(([uri,s])=>this.client.documents.get(uri)===s.document&&s.document.version===s.version);
    const partialResultToken='vb6-workspace-diagnostics-'+(++this.serial),staged=new Map();let reportCount=0,diagnosticCount=0,invalid=null;
    const collect=report=>{
      if(!report||!Array.isArray(report.items))throw new Error('Workspace diagnostics must contain an items array.');
      reportCount+=report.items.length;if(reportCount>this.maxReports)throw new Error('Workspace diagnostic report limit exceeded.');
      for(const item of report.items){
        if(!item||typeof item.uri!=='string'||!['full','unchanged'].includes(item.kind)||!(item.version===null||Number.isSafeInteger(item.version)&&item.version>=0))throw new Error('Invalid workspace diagnostic report.');
        if(item.kind==='full'){
          if(!Array.isArray(item.items))throw new Error('A full workspace diagnostic report must contain items.');
          diagnosticCount+=item.items.length;if(diagnosticCount>this.maxDiagnostics)throw new Error('Workspace diagnostic item limit exceeded.');
          for(const d of item.items){
            const a=d?.range?.start,b=d?.range?.end;
            if(typeof d?.message!=='string'||!a||!b||![a.line,a.character,b.line,b.character].every(v=>Number.isSafeInteger(v)&&v>=0)||a.line>b.line||a.line===b.line&&a.character>b.character)throw new Error('Invalid workspace diagnostic range or message.');
          }
        }
        if(item.resultId!==undefined&&typeof item.resultId!=='string')throw new Error('Invalid workspace diagnostic result ID.');
        const snapshot=snapshots.get(item.uri);if(!snapshot)continue;
        if(item.version!==null&&item.version!==snapshot.version)throw new Error('Workspace diagnostics refer to a different document version.');
        if(staged.has(item.uri))throw new Error('Duplicate document in workspace diagnostic reports.');
        const previous=state.results.get(item.uri);
        if(item.kind==='unchanged'&&(!previous||typeof item.resultId!=='string'))throw new Error('An unchanged workspace diagnostic has no corresponding previous result.');
        staged.set(item.uri,{document:snapshot.document,resultId:item.resultId,items:item.kind==='full'?item.items:previous.items});
      }
    };
    const unlisten=this.client.on('$/progress',p=>{
      if(p?.token!==partialResultToken||!current()||invalid)return;
      try{collect(p.value);}catch(error){invalid=error;abort.abort();}
    });
    const previousResultIds=[...state.results].filter(([uri,r])=>snapshots.has(uri)&&typeof r.resultId==='string').map(([uri,r])=>({uri,value:r.resultId}));
    this.client.request('workspace/diagnostic',{...(id!==null?{identifier:id}:{}),previousResultIds,partialResultToken},{signal:abort.signal,workspace:true}).then(report=>{
      if(!current())return;collect(report);if(!current())return;
      // Validate every report before publishing any of this batch. A malformed
      // later item cannot clear otherwise valid markers from an earlier item.
      state.retries=0;
      for(const [uri,result]of staged){
        if(!current())break;
        state.results.set(uri,result);this.client.emit('diagnostics',{uri,version:snapshots.get(uri).version,diagnostics:result.items});
      }
    }).catch(error=>{
      if(invalid){if(!this.disposed&&this.groups.get(id)===state&&state.generation===generation)this.onError(invalid);return;}
      if(!current())return;
      if(error.code===-32802&&error.data?.retriggerRequest===true){
        state.retries=(state.retries||0)+1;
        if(state.retries<=3)this.schedule(id,state,Math.max(this.delay,100)*2**(state.retries-1),true);
        else this.onError(new Error('Workspace diagnostics repeatedly cancelled; edit or refresh to retry.'));
      }else if(![-32800,-32801,-32802].includes(error.code))this.onError(error);
    }).finally(()=>{
      unlisten();if(state.abort===abort)state.abort=null;this.running=false;this.drain();
    });
  }
  dispose() {
    if(this.disposed)return;this.disposed=true;for(const id of [...this.groups.keys()])this.remove(id);
    for(const unlisten of this.listeners)unlisten();this.listeners=[];
  }
}
