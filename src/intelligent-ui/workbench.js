import {el,download} from '../core/core.js';
import {modal} from '../ide/ui.js';
import {UISurface} from '../../packages/intelligent-ui/src/surface.js';
import {compile} from '../../packages/intelligent-ui/src/compiler.js';
import {catalogDescription} from '../../packages/intelligent-ui/src/catalog.js';
import {pinUIActionContext} from './action-context.js';
import {IntelligentUIGallery} from './gallery.js';
import {WORKBENCH_LIMITS,sourceLocation,replaceAllLiteral} from './workbench-model.js';
import {UI_EXAMPLES} from './examples.js';

const field=(label,input)=>el('label',{class:'iui-field'},el('span',{},label),input);
const nameOf=doc=>(doc?.title||'intelligent-ui').replace(/[^\p{L}\p{N}_. -]/gu,'_').slice(0,100);
export class IntelligentUIPanel {
  constructor(ide,host){
    this.ide=ide;this.host=host;this.model=host.workbench;this.key='tool:intelligent-ui';this.title='Intelligent UI';this.glyph='form';this.width=980;this.height=780;this.previewId=null;this.renderedRevision=null;
    this.root=el('div',{class:'iui-workbench'});this.notice=el('p',{class:'iui-workbench-notice',role:'status'},'Drafts and preview state stay in memory. Export a document to keep your work.');
    const button=(label,action)=>el('button',{type:'button',onclick:()=>this.attempt(action)},label);this.button=button;
    this.enable=el('input',{type:'checkbox','aria-label':'Enable interactive agent UI',checked:host.enabled,onchange:()=>host.setEnabled(this.enable.checked)});
    this.examples=el('select',{'aria-label':'Intelligent UI example'},...Object.entries(UI_EXAMPLES).map(([value,v])=>el('option',{value},v.title)));this.examples.value='calculator';
    this.documentSelect=el('select',{'aria-label':'Intelligent UI document',onchange:()=>this.attempt(()=>this.model.select(this.documentSelect.value))});
    this.documentTitle=el('input',{'aria-label':'UI document title',maxLength:100,onchange:()=>this.attempt(()=>{this.model.edit({title:this.documentTitle.value});this.model.checkpoint();})});
    this.undoButton=button('Undo',()=>this.model.undo());this.redoButton=button('Redo',()=>this.model.redo());
    this.file=el('input',{type:'file',accept:'.dil,.txt,.json',hidden:true,'aria-label':'Import Intelligent UI document',onchange:()=>this.attempt(()=>this.importFile())});
    this.source=el('textarea',{'aria-label':'Intelligent UI editor',spellcheck:'false',rows:10,maxLength:WORKBENCH_LIMITS.source});
    this.data=el('textarea',{'aria-label':'Intelligent UI JSON data',spellcheck:'false',rows:7,maxLength:WORKBENCH_LIMITS.dataText});
    this.projectData=el('input',{type:'checkbox',checked:true,'aria-label':'Include current project snapshot',onchange:()=>this.renderPreview()});
    this.live=el('input',{type:'checkbox',checked:true,'aria-label':'Live UI preview',onchange:()=>{if(this.live.checked)this.renderPreview();else clearTimeout(this.timer);}});
    this.viewport=el('select',{'aria-label':'UI preview viewport',onchange:()=>this.resizePreview()},...Object.entries({auto:'Responsive',375:'Phone · 375 px',768:'Tablet · 768 px',1024:'Desktop · 1024 px'}).map(([value,label])=>el('option',{value},label)));this.viewport.value='auto';
    this.preview=el('div',{class:'iui-playground-preview'});this.previewScroll=el('div',{class:'iui-preview-scroll'},this.preview);
    const ResizeObserver=ide.root.ownerDocument.defaultView.ResizeObserver;if(ResizeObserver){this.resizeObserver=new ResizeObserver(()=>this.updateViewport());this.resizeObserver.observe(this.preview);}
    this.diagnosticList=el('div',{class:'iui-diagnostic-list'});this.diagnosticCount=el('span',{role:'status'},'No diagnostics');this.compiled=el('pre',{tabindex:0,class:'iui-compiled','aria-label':'Compiled UI program'});
    this.position=el('span',{class:'iui-source-position'});
    this.find=el('input',{type:'search',maxLength:1000,'aria-label':'Find in UI source',placeholder:'Find literal text'});this.replacement=el('input',{maxLength:1000,'aria-label':'Replace in UI source',placeholder:'Replacement'});
    this.galleryView=new IntelligentUIGallery(ide,host,{onEdit:ui=>this.model.create({title:ui.title,source:ui.source,dataText:JSON.stringify(ui.data,null,2)}),onError:error=>this.error(error)});
    this.root.append(
      el('div',{class:'agent-toolbar'},field('Interactive agent UI',this.enable),this.examples,button('Load example',()=>this.load()),button('Render',()=>this.renderPreview()),button('Save source',()=>this.saveSource()),button('Clear tool views',()=>{for(const adapter of [ide.mcp.adapter,host.adapter])adapter.intelligentUI.service.clear();})),
      el('div',{class:'agent-toolbar'},this.documentSelect,this.documentTitle,button('New document',()=>this.model.create()),button('Duplicate document',()=>this.model.duplicate()),button('Close document',()=>this.closeDocument()),button('Import document',()=>{this.file.value='';this.file.click();}),button('Export document',()=>this.exportDocument()),this.undoButton,this.redoButton,this.file),
      this.notice,
      el('div',{class:'iui-editors'},field('DIL source',this.source),el('div',{},field('Preview data (JSON object)',this.data),field('Include current project as data.project',this.projectData),button('Format JSON',()=>{this.model.edit({dataText:JSON.stringify(this.model.data(),null,2)});this.model.checkpoint();}),button('Capture project in JSON',()=>{const data=this.model.data();data.project=host.adapter.snapshot();this.model.edit({dataText:JSON.stringify(data,null,2)});this.projectData.checked=false;this.model.checkpoint();}))),
      el('div',{class:'agent-toolbar'},this.find,this.replacement,button('Find next',()=>this.findNext()),button('Replace selection',()=>this.replace(false)),button('Replace all',()=>this.replace(true)),this.position),
      el('div',{class:'agent-toolbar'},field('Live preview',this.live),this.viewport,button('Reset preview state',()=>{this.dropPreview();this.model.setSnapshot(null);this.renderPreview();}),button('Clear reviewed UI context',()=>{host.conversations.active.agent.uiContexts.clear();this.notice.textContent='Reviewed context cleared for the active task.';}),this.diagnosticCount),
      this.previewScroll,el('details',{class:'iui-workbench-inspector'},el('summary',{},'Diagnostics and compiled program'),this.diagnosticList,this.compiled),this.catalog(),this.sandbox(),this.galleryView.root);
    for(const [editor,key] of [[this.source,'source'],[this.data,'dataText']]){
      editor.addEventListener('input',()=>this.attempt(()=>{this.model.edit({[key]:editor.value});clearTimeout(this.historyTimer);this.historyTimer=setTimeout(()=>this.model.checkpoint(),500);}));
      editor.addEventListener('blur',()=>this.model.checkpoint());
    }
    for(const type of ['click','keyup','select'])this.source.addEventListener(type,()=>this.updatePosition());
    this.root.addEventListener('keydown',event=>this.keydown(event));
    this.offModel=this.model.onChange(event=>this.modelChanged(event));
    this.offHost=host.onChange(event=>{this.enable.checked=host.enabled;this.dropPreview(event?.type!=='workspace');this.renderPreview();});
    if(!this.model.active){const example=UI_EXAMPLES.calculator;this.model.create({title:example.title,source:example.source});}
    else this.modelChanged({type:'select'});
  }
  attempt(fn){try{Promise.resolve(fn()).catch(error=>this.error(error));}catch(error){this.error(error);}}
  error(error){if(!this.disposed){this.noticeError=true;this.notice.textContent=error.message||String(error);}}
  modelChanged(event){
    if(this.disposed)return;const doc=this.model.active;this.noticeError=false;
    if(this.previewId!==doc?.id)this.dropPreview();
    this.documentSelect.replaceChildren(...[...this.model.documents.values()].map(d=>el('option',{value:d.id},(this.model.dirty(d)?'• ':'')+d.title)));this.documentSelect.value=doc?.id||'';
    this.documentTitle.value=doc?.title||'';if(this.source.value!==(doc?.source||''))this.source.value=doc?.source||'';if(this.data.value!==(doc?.dataText||''))this.data.value=doc?.dataText||'';
    this.source.disabled=this.data.disabled=this.documentTitle.disabled=!doc;this.undoButton.disabled=!this.model.canUndo;this.redoButton.disabled=!this.model.canRedo;this.updatePosition();
    if(event.type==='saved')return;
    this.surface?.actionScope.invalidate();this.renderedRevision=null;clearTimeout(this.timer);
    if(this.live.checked||event.type==='select'||event.type==='create')this.timer=setTimeout(()=>this.renderPreview(event.type==='edit'),event.type==='edit'?150:0);
    else this.notice.textContent='Draft changed. Render to update the preview.';
  }
  load(){const example=UI_EXAMPLES[this.examples.value];this.model.create({title:example.title,source:example.source});}
  updatePosition(){const position=sourceLocation(this.source.value,this.source.selectionStart);this.position.textContent='Ln '+position.line+', Col '+position.column+' · '+this.source.value.length+' characters';}
  dropPreview(preserve=true){
    if(this.surface){try{if(preserve)this.model.setSnapshot(this.surface.snapshot(),this.previewId);}catch{}this.surface.dispose();this.surface=null;}
    this.previewId=null;this.renderedRevision=null;this.preview.replaceChildren();
  }
  resizePreview(){const width=this.viewport.value==='auto'?null:Number(this.viewport.value);this.preview.style.width=width?width+'px':'';this.preview.style.minWidth=width?width+'px':'';this.updateViewport();}
  updateViewport(){if(!this.surface||this.disposed)return;const width=this.viewport.value==='auto'?Math.max(1,this.preview.getBoundingClientRect().width):Number(this.viewport.value);this.surface.setViewport({width:Math.min(16384,width),height:768});}
  async renderPreview(partial=false){
    clearTimeout(this.timer);this.timer=null;if(this.disposed)return;const doc=this.model.active,token=this.renderToken=(this.renderToken||0)+1;if(!partial)this.noticeError=false;
    if(!doc){this.dropPreview();this.preview.textContent='Create or import a document to begin.';return;}
    if(!this.host.enabled){this.dropPreview();this.preview.textContent='Interactive UI is disabled. Editing and export remain available.';return;}
    try{
      const data=this.model.data(doc),project=this.projectData.checked?this.host.adapter.snapshot():null;if(project)data.project=project;
      if(project)this.host.extensions.references.put('preview-project',{kind:'citation',title:project.name,details:project,provenance:{source:'Local IDE project snapshot',revision:project.revision}});
      if(!this.surface){const pinned=pinUIActionContext(this.host),id=doc.id;this.previewId=id;
        const live=()=>{pinned.assertLive();if(this.disposed||this.previewId!==id||this.model.activeId!==id||this.surface?.disposed||this.renderedRevision!==doc.revision)throw new Error('The preview changed. Render and review the current document.');};
        this.surface=new UISurface(this.preview,{...this.host.surfaceOptions({assertLive:()=>pinned.assertLive()}),snapshot:doc.snapshot,responsive:false,
          onDispose:()=>this.host.conversations.tasks.get(pinned.taskId)?.agent.uiContexts.delete('preview:'+id),onError:error=>this.error(error),
          onAction:(action,surface,context)=>{live();return this.host.action(action,{...pinned,viewId:'preview:'+id,signal:context.signal,origin:doc.title,assertLive:live});}});
        this.resizePreview();
      }
      const surface=this.surface,revision=doc.revision,started=performance.now();this.renderedRevision=null;
      const result=await surface.update(doc.source,{partial,data});
      if(this.disposed||this.surface!==surface||doc.revision!==revision)return;this.renderedRevision=revision;
      const diagnostics=[...result.diagnostics,...result.recoveryDiagnostics];this.showDiagnostics(diagnostics,doc.source);
      this.compiled.textContent=JSON.stringify(compile(doc.source,{partial}),null,2);
      if(!this.noticeError)this.notice.textContent=(partial?'Streaming preview':'Preview rendered')+' · '+surface.client.backend+' · '+Math.round(performance.now()-started)+' ms · '+result.operations.length+' operations. No model request was made.';
    }catch(error){if(!this.disposed&&this.model.active===doc&&token===this.renderToken){this.error(error);this.showDiagnostics([{code:error.code||'preview',message:error.message,offset:error.offset}],doc.source);}}
  }
  showDiagnostics(diagnostics,source){this.diagnosticCount.textContent=diagnostics.length?diagnostics.length+' diagnostics':'No diagnostics';this.diagnosticList.replaceChildren(...diagnostics.slice(0,100).map(d=>{const location=sourceLocation(source,d.offset);return this.button('Ln '+location.line+':'+location.column+' · '+d.code+' · '+d.message,()=>{this.source.focus();this.source.setSelectionRange(location.offset,Math.min(source.length,location.offset+1));this.updatePosition();});}));}
  saveSource(){if(!this.model.active)return;download(nameOf(this.model.active)+'.dil',this.source.value,'text/plain');this.notice.textContent='Source download requested. Export document also includes your JSON data.';}
  exportDocument(){const doc=this.model.active;if(!doc)return;download(nameOf(doc)+'.iui.json',this.model.exportDocument(doc),'application/json');this.notice.textContent='Document download requested; verify that your browser saved it before closing this draft.';}
  async importFile(){const file=this.file.files?.[0];if(!file)return;if(file.size>WORKBENCH_LIMITS.fileBytes)throw new Error('Import file exceeds 1 MB.');const value=await file.text();if(this.disposed)return;this.model.importDocument(value,{name:file.name,sourceOnly:/\.(dil|txt)$/i.test(file.name)});}
  async closeDocument(){const doc=this.model.active;if(!doc)return;const revision=doc.revision;
    if(this.model.dirty(doc)){const accepted=await modal('Intelligent UI — Close document',{content:el('p',{},'Discard the in-memory draft “'+doc.title+'”? Export it first to keep source and JSON data.'),buttons:[{label:'Cancel',value:false,primary:true},{label:'Discard draft',value:true}]});if(!accepted||this.disposed)return;}
    this.model.close(doc.id,{discard:true,expectedRevision:revision});
  }
  findNext(){const query=this.find.value;if(!query)return;const text=this.source.value,start=this.source.selectionEnd;let at=text.indexOf(query,start);if(at<0)at=text.indexOf(query);if(at<0){this.notice.textContent='Text not found.';return;}this.source.focus();this.source.setSelectionRange(at,at+query.length);this.updatePosition();}
  replace(all){const query=this.find.value;if(!query||!this.model.active)return;let source=this.source.value;
    if(all)source=replaceAllLiteral(source,query,this.replacement.value);
    else {const {selectionStart:start,selectionEnd:end}=this.source;if(source.slice(start,end)!==query){this.findNext();return;}source=source.slice(0,start)+this.replacement.value+source.slice(end);}
    this.model.checkpoint();this.model.edit({source});this.model.checkpoint();
  }
  keydown(event){
    if(!(event.ctrlKey||event.metaKey)||event.altKey)return;const key=event.key.toLowerCase();let action;
    if(key==='enter')action=()=>this.renderPreview();else if(key==='s')action=()=>this.exportDocument();else if(key==='f')action=()=>this.find.focus();
    else if(key==='z'&&[this.source,this.data,this.documentTitle].includes(event.target))action=()=>event.shiftKey?this.model.redo():this.model.undo();
    else if(key==='y'&&[this.source,this.data,this.documentTitle].includes(event.target))action=()=>this.model.redo();
    if(action){event.preventDefault();event.stopPropagation();this.attempt(action);}
  }
  catalog(){
    const filter=el('input',{type:'search','aria-label':'Filter UI components',maxLength:100,placeholder:'Component or property'}),list=el('div',{class:'iui-component-catalog'});
    const render=()=>{const query=filter.value.toLowerCase();list.replaceChildren(...catalogDescription().filter(c=>(c.name+' '+Object.keys(c.properties).join(' ')).toLowerCase().includes(query)).map(c=>el('details',{},el('summary',{},c.name),el('pre',{},Object.entries(c.properties).map(([key,value])=>key+': '+(Array.isArray(value)?value.join(' | '):value)).join('\n')),this.button('Insert '+c.name,()=>{const snippet='<'+c.name+' />',start=this.source.selectionStart,end=this.source.selectionEnd;this.model.checkpoint();this.model.edit({source:this.source.value.slice(0,start)+snippet+this.source.value.slice(end)});this.model.checkpoint();this.source.focus();this.source.setSelectionRange(start,start+snippet.length);}))))};filter.oninput=render;render();
    return el('details',{class:'iui-catalog'},el('summary',{},'Component catalog'),el('p',{},'Properties come from the runtime catalog. Insertions are editable markup; they do not grant capabilities.'),filter,list);
  }
  sandbox(){const host=this.host,sandbox=el('input',{type:'url','aria-label':'Separate-origin sandbox URL',placeholder:'http://127.0.0.1:47231/intelligent-ui-sandbox.html',value:host.extensions.sandboxUrl}),apps=el('input',{type:'checkbox',checked:host.extensions.appsEnabled,'aria-label':'Enable reviewed AppBlocks'});
    return el('details',{class:'iui-sandbox-settings'},el('summary',{},'Isolated apps (optional)'),el('p',{},'Run npm run ui:sandbox on a separate origin. Set VB6_UI_PARENT_ORIGIN to the exact HTTP(S) IDE origin. Each app requires explicit approval.'),field('Sandbox URL',sandbox),field('Enable reviewed AppBlocks',apps),this.button('Apply sandbox settings',()=>{host.extensions.configure({url:sandbox.value.trim(),enabled:apps.checked});this.notice.textContent='Sandbox settings applied for this IDE session.';}));
  }
  onActivated(){}focus(){this.source.focus();}
  dispose(){if(this.disposed)return;this.disposed=true;clearTimeout(this.timer);clearTimeout(this.historyTimer);this.model.checkpoint();this.resizeObserver?.disconnect();this.dropPreview();this.galleryView.dispose();this.offModel();this.offHost();}
}
