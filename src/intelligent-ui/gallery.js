import {el,download} from '../core/core.js';
import {boundedData} from '../../packages/intelligent-ui/src/safety.js';
import {UISurface} from '../../packages/intelligent-ui/src/surface.js';
import {pinUIActionContext} from './action-context.js';

/** Local inspection only. Every effect stays pinned to its original adapter, owner and UI revision. */
export class IntelligentUIGallery {
  constructor(ide,host,{onEdit=()=>{},onError=()=>{}}={}){
    this.ide=ide;this.host=host;this.onEdit=onEdit;this.onError=onError;this.items=new Map();this.disposed=false;
    this.filter=el('input',{type:'search',maxLength:200,'aria-label':'Filter live UI documents',placeholder:'Filter title, owner or document ID',oninput:()=>this.filterItems()});
    this.count=el('span',{role:'status'});this.list=el('div',{class:'iui-gallery'});
    this.root=el('section',{class:'iui-gallery-panel'},el('h3',{},'Live MCP and agent tool results'),el('p',{},'Caller-private documents. Filtering or collapsing releases renderers; it does not close the remote document.'),el('div',{class:'agent-toolbar'},this.filter,this.count),this.list);
    this.off=[ide.mcp.adapter,host.adapter].map(adapter=>{
      const api=adapter.intelligentUI;
      for(const [owner,bucket] of api.service.owners)for(const result of bucket.documents.values())this.changed({type:'present',owner,result},adapter);
      return api.onChange(event=>this.changed(event,adapter));
    });
    this.offHost=host.onChange(event=>{for(const item of this.items.values()){this.release(item);if(event?.type==='workspace')item.snapshot=null;this.mount(item);}this.filterItems();});this.filterItems();
  }
  attempt(action){try{Promise.resolve(action()).catch(this.onError);}catch(error){this.onError(error);}}
  current(item){if(this.disposed||item.closed)throw new Error('This UI document was closed.');return item.adapter.intelligentUI.service.run('read',{id:item.ui.id},{principal:item.owner}).ui;}
  changed(event,adapter){
    if(this.disposed||!event.result?.ui)return;const ui=event.result.ui,key=JSON.stringify([adapter===this.host.adapter?'agent':'mcp',event.owner,ui.id]);
    let item=this.items.get(key);
    if(event.type==='close'){if(item){item.closed=true;this.release(item);item.node.remove();this.items.delete(key);}this.filterItems();return;}
    if(!item){
      const body=el('div'),appView=el('div'),title=el('summary'),meta=el('pre',{class:'iui-document-metadata',tabindex:0}),details=el('details',{},el('summary',{},'Data and provenance'),meta),node=el('details',{class:'iui-gallery-item',open:this.items.size<4});
      item={key,node,title,body,appView,meta,adapter,owner:event.owner,ui,generation:0,closed:false};
      const button=(name,fn)=>el('button',{type:'button',onclick:()=>this.attempt(fn)},name);
      node.append(title,el('div',{class:'agent-toolbar'},
        button('Edit a local copy',()=>{const current=this.current(item);this.onEdit(current);}),
        button('Save UI source',()=>download('intelligent-ui-'+ui.id+'.dil',this.current(item).source,'text/plain')),
        button('Close UI document',()=>{const current=this.current(item);adapter.intelligentUI.service.run('close',{id:ui.id,expectedUIRevision:current.revision},{principal:item.owner});}),
        button('Open as MCP App',()=>this.openApp(item)),button('Close MCP App',()=>this.closeApp(item)),
        ...['pip','fullscreen','inline'].map(mode=>button(mode==='pip'?'Float MCP App':mode==='fullscreen'?'Full-screen MCP App':'Inline MCP App',()=>{if(!item.app?.ready)throw new Error('Open and initialize this MCP App first.');item.app.setDisplayMode(mode);}))),body,details,appView);
      node.addEventListener('toggle',()=>{if(node.open)this.mount(item);else this.release(item);});
      this.list.prepend(node);this.items.set(key,item);
    }
    item.ui=ui;item.title.textContent=ui.title+' · revision '+ui.revision+' · '+(adapter===this.host.adapter?'Agent':'MCP');
    item.meta.textContent=JSON.stringify({id:ui.id,owner:item.owner,revision:ui.revision,data:ui.data,provenance:ui.provenance,references:ui.references},null,2);
    // Superseded app frames cannot outlive their immutable tool result.
    this.closeApp(item);const mounted=!!item.surface;this.filterItems();if(mounted)this.mount(item,true);
  }
  filterItems(){
    const query=this.filter.value.toLocaleLowerCase();let shown=0;
    for(const item of this.items.values()){
      const match=[item.ui.title,item.owner,item.ui.id].join(' ').toLocaleLowerCase().includes(query);item.node.hidden=!match;
      if(match){shown++;this.mount(item);}else this.release(item);
    }
    this.count.textContent=shown+' of '+this.items.size+' documents';
  }
  mount(item,update=false){
    if(this.disposed||item.closed||!this.host.enabled||!item.node.open||item.node.hidden)return;
    if(!item.surface){
      const pinned=pinUIActionContext(this.host,{adapter:item.adapter,owner:item.owner});
      const assertLive=()=>{pinned.assertLive();if(this.disposed||item.closed||!item.surface||item.surface.disposed)throw new Error('This UI view was closed.');};
      item.surface=new UISurface(item.body,{...this.host.surfaceOptions({adapter:item.adapter,owner:item.owner,getUI:()=>this.current(item),assertLive}),snapshot:item.snapshot,
        onDispose:()=>this.host.conversations.tasks.get(pinned.taskId)?.agent.uiContexts.delete('tool:'+item.ui.id),
        onAction:(action,surface,context)=>{assertLive();const current=this.current(item),revision=item.renderedRevision;
          if(current.revision!==revision)throw new Error('UI changed. Review its current result.');
          return this.host.action(action,{...pinned,viewId:'tool:'+item.ui.id,signal:context.signal,origin:current.title,assertLive:()=>{assertLive();if(this.current(item).revision!==revision)throw new Error('The UI changed while review was pending.');}});},onError:this.onError});update=true;
    }
    if(update){const surface=item.surface,revision=item.ui.revision;item.renderedRevision=null;
      void surface.update(item.ui.source,{data:item.ui.data}).then(()=>{if(item.surface===surface&&item.ui.revision===revision)item.renderedRevision=revision;}).catch(error=>{if(item.surface===surface&&!surface.disposed)this.onError(error);});
    }
  }
  closeApp(item){item.generation++;item.opening?.abort();item.opening=null;item.app?.dispose();item.app=null;item.appView.replaceChildren();}
  async openApp(item){
    this.closeApp(item);const generation=item.generation,ui=this.current(item);
    const opening=item.opening=new AbortController();let app;
    try{app=await this.host.extensions.openMcpApp(item.appView,item.adapter,item.owner,ui,{signal:opening.signal});}
    catch(error){if(opening.signal.aborted)return;throw error;}finally{if(item.opening===opening)item.opening=null;}
    if(this.disposed||item.closed||generation!==item.generation||!item.node.open||item.node.hidden){app.dispose();return;}
    item.app=app;
  }
  release(item){
    this.closeApp(item);if(item.surface){try{item.snapshot=boundedData(item.surface.snapshot(),128000);}catch{item.snapshot=null;}item.surface.dispose();item.surface=null;}item.body.replaceChildren();
    if(!this.host.enabled)item.body.textContent='Interactive UI is disabled. Source and inspected data remain available.';
  }
  dispose(){if(this.disposed)return;this.disposed=true;for(const item of this.items.values()){item.closed=true;this.release(item);}this.items.clear();for(const off of this.off)off();this.offHost();this.root.replaceChildren();}
}
