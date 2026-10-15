import {CellBuffer,CanvasCellRenderer,TUI_PROFILES,normalizeDOSSettings} from './cells.js';
import {TuiControlRegistry} from './controls.js';
import {applyTUIStyle} from './styles.js';
const SELECTOR='.vb-control';
const finite=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
const own=(node,selector)=>[...node.querySelectorAll(selector)].filter(child=>child.closest(SELECTOR)===node);
/** Read the already-materialized, clipped DOM. Never recreate a collection or
 * route input to a shadow model: the original target still receives the event. */
export function captureControl(node,columns,rows) {
  const type=node.dataset.type||'',input=own(node,'input,textarea,select,[contenteditable]')[0];
  const rect=node.getBoundingClientRect(),sx=columns/Math.max(1,rect.width),sy=rows/Math.max(1,rect.height);
  const value=input?.value??input?.textContent??'',caption=own(node,'.vb-frame-legend,.vb-command-caption,span:not(.vb-tree-icon):not(.icon)')[0]?.textContent||node.getAttribute('aria-label')||node.dataset.control||'';
  const state={type,mnemonics:false,name:node.dataset.control||type,caption,text:String(value),checked:!!input?.checked,indeterminate:!!input?.indeterminate,password:input?.type==='password',disabled:node.classList.contains('disabled')||!!input?.disabled,focused:node.contains(node.ownerDocument.activeElement),pressed:node.matches(':active'),min:finite(input?.min),max:finite(input?.max,100),value:finite(input?.value),vertical:type==='VScrollBar',rows:[]};
  if(type==='Label')state.caption=node.textContent;
  if(type==='ProgressBar'){const fill=node.querySelector('.vb-progress-fill'),track=fill?.parentElement;state.min=0;state.max=100;state.value=fill&&track?fill.getBoundingClientRect().width/Math.max(1,track.getBoundingClientRect().width)*100:0;}
  if(type==='HScrollBar'||type==='VScrollBar'){const range=node.matches('[role=scrollbar]')?node:node.querySelector('[role=scrollbar]');state.min=finite(range?.getAttribute('aria-valuemin'));state.max=finite(range?.getAttribute('aria-valuemax'),100);state.value=finite(range?.getAttribute('aria-valuenow'));}
  if(input?.tagName==='SELECT') {
    state.text=input.selectedOptions?.[0]?.textContent||'';
    const height=rect.height/rows,top=Math.floor(input.scrollTop/height);
    for(let i=top;i<Math.min(input.options.length,top+rows);i++){const option=input.options[i];state.rows.push({x:0,y:i-top,width:columns,height:1,text:option.textContent,selected:option.selected});}
  } else {
    const selectors='td:not(.vb-grid-spacer),th,.vb-tree-row,.vb-lv-row,.vb-lv-header>div,.vb-status-panel,.vb-toolbar-button,.vb-month-header,button[role=tab]';
    for(const element of own(node,selectors)) {
      if(element.closest('[hidden]')||!element.getClientRects().length)continue;
      const r=element.getBoundingClientRect();if(r.bottom<=rect.top||r.top>=rect.bottom||r.right<=rect.left||r.left>=rect.right)continue;
      const x=Math.max(0,Math.round((r.left-rect.left)*sx)),y=Math.max(0,Math.floor((r.top-rect.top)*sy));
      let text=element.textContent||'';if(element.classList.contains('vb-tree-row'))text=' '.repeat(Math.max(0,finite(element.getAttribute('aria-level'),1)-1)*2)+(element.getAttribute('aria-expanded')===null?'├─':element.getAttribute('aria-expanded')==='true'?'[-]':'[+]')+(element.querySelector('.vb-tree-label')?.textContent||text);
      state.rows.push({x,y,width:Math.max(0,Math.min(columns-x,Math.ceil(r.width*sx))),height:Math.max(1,Math.round(r.height*sy)),text,selected:element.classList.contains('selected')||element.classList.contains('active')||element.getAttribute('aria-selected')==='true',separator:element.matches('td,th')});
    }
  }
  return state;
}
/** Incremental presentation host. Observers are connected only while mounted;
 * changes coalesce to a frame and only dirty, visible controls are repainted. */
export class DOMTuiRenderer {
  constructor(document,{settings={},registry=new TuiControlRegistry(),onError=()=>{}}={}) {
    this.document=document;this.view=document.defaultView;this.settings=normalizeDOSSettings(settings);this.registry=registry;this.onError=onError;
    this.controls=new Map();this.dirty=new Set();this.listeners=[];this.frame=0;this.disposed=false;this.metrics={frames:0,painted:0,failures:0};
    this.previousProfile=document.documentElement.getAttribute('data-vb-dos');this.previousLine=document.documentElement.style.getPropertyValue('--dos-line');
    this.observer=new this.view.MutationObserver(records=>this.mutations(records));
    this.resize=typeof this.view.ResizeObserver==='function'?new this.view.ResizeObserver(entries=>{for(const entry of entries)this.invalidate(entry.target);}):null;
    applyTUIStyle(document,this.settings);this.scan(document.body);
    this.observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['style','class','hidden','aria-selected','aria-valuenow','aria-expanded','disabled','checked','value']});
    const invalidate=event=>{const node=event.target?.closest?.(SELECTOR);if(node)this.invalidate(node);else if(event.type==='resize'||event.type==='scroll')this.invalidateAll();};
    for(const type of ['input','change','focusin','focusout','pointerdown','pointerup','pointercancel','keydown','keyup','scroll','load'])this.listen(document,type,invalidate,true);
    this.listen(this.view,'resize',()=>this.invalidateAll());
    this.listen(document,'visibilitychange',()=>{if(document.hidden){this.view.cancelAnimationFrame(this.frame);this.frame=0;}else this.invalidateAll();});
    this.listen(this.view,'pagehide',event=>{if(!event.persisted)this.dispose();});
    this.listen(this.view,'pageshow',()=>this.invalidateAll());
    this.listen(document.fonts,'loadingdone',()=>{for(const entry of this.controls.values()){entry.painter?.cache.clear();entry.buffer?.invalidate();}this.invalidateAll();});
  }
  listen(target,type,fn,capture=false){target?.addEventListener(type,fn,capture);this.listeners.push(()=>target?.removeEventListener(type,fn,capture));}
  scan(root){if(!root?.querySelectorAll)return;if(root.matches?.(SELECTOR))this.add(root);for(const node of root.querySelectorAll(SELECTOR))this.add(node);}
  add(node){if(this.controls.has(node))return;const capability=this.registry.capability(node.dataset.type);if(capability!=='cells')return;this.controls.set(node,{canvas:null,painter:null,buffer:null,next:null});this.resize?.observe(node);this.invalidate(node);}
  mutations(records){
    for(const record of records){const element=record.target.nodeType===1?record.target:record.target.parentElement;if(element?.closest?.('.vb-tui-surface'))continue;
      const node=element?.closest?.(SELECTOR);if(node)this.invalidate(node);
      if(record.type==='childList')for(const added of record.addedNodes)if(added.nodeType===1&&!added.classList.contains('vb-tui-surface'))this.scan(added);
      if(record.type==='attributes'&&element&&!node)for(const child of element.querySelectorAll?.(SELECTOR)||[])this.invalidate(child);
    }
    // Retire removed controls even when a form is closed without another paint.
    for(const node of this.controls.keys())if(!node.isConnected)this.remove(node);
  }
  invalidate(node){if(this.disposed||!this.controls.has(node))return;this.dirty.add(node);if(!this.frame&&!this.document.hidden)this.frame=this.view.requestAnimationFrame(()=>this.flush());}
  invalidateAll(){for(const node of this.controls.keys())this.invalidate(node);}
  configure(settings){this.settings=normalizeDOSSettings(settings);applyTUIStyle(this.document,this.settings);for(const entry of this.controls.values()){entry.painter?.dispose();entry.painter=null;entry.buffer=null;entry.next=null;}this.invalidateAll();}
  flush(){
    this.frame=0;if(this.disposed)return;this.metrics.frames++;const dirty=[...this.dirty];this.dirty.clear();
    for(const node of dirty){if(!node.isConnected){this.remove(node);continue;}const entry=this.controls.get(node);if(!entry)continue;
      try {
        if(!node.getClientRects().length||node.closest('[hidden]'))continue;
        const width=node.clientWidth,height=node.clientHeight;if(width<=0||height<=0)continue;
        const columns=Math.min(256,Math.max(1,Math.round(width/this.settings.cellWidth))),rows=Math.min(256,Math.max(1,Math.round(height/this.settings.cellHeight)));
        if(!entry.canvas){entry.canvas=this.document.createElement('canvas');entry.canvas.className='vb-tui-surface';entry.canvas.setAttribute('aria-hidden','true');}
        // Some controls legitimately replace all children on refresh.
        if(entry.canvas.parentNode!==node)node.append(entry.canvas);
        if(!entry.painter)entry.painter=new CanvasCellRenderer(entry.canvas,{cellWidth:this.settings.cellWidth,cellHeight:this.settings.cellHeight});
        if(!entry.buffer||entry.buffer.columns!==columns||entry.buffer.rows!==rows){const p=TUI_PROFILES[this.settings.profile];entry.buffer=new CellBuffer(columns,rows,{foreground:p.foreground,background:p.background});entry.next=new CellBuffer(columns,rows,{foreground:p.foreground,background:p.background});}
        const state=captureControl(node,columns,rows);this.registry.paint(entry.next,state,this.settings.profile);entry.buffer.blit(entry.next,0,0);entry.painter.render(entry.buffer,this.view.devicePixelRatio);node.setAttribute('data-tui-paint','cells');
        // Keep the browser caret, IME, selection, clipboard, date picker and
        // accessible editable text. Never synthesize keyboard or pointer events.
        const editing=['TextBox','RichTextBox','ComboBox','DTPicker','DriveListBox'].includes(state.type)&&state.focused&&!node.closest('.designer-form');
        node.toggleAttribute('data-tui-editing',editing);this.metrics.painted++;
      } catch(error){this.metrics.failures++;this.remove(node);this.onError(error,node);}
    }
  }
  remove(node){const entry=this.controls.get(node);if(!entry)return;entry.painter?.dispose();entry.canvas?.remove();node.removeAttribute('data-tui-paint');node.removeAttribute('data-tui-editing');this.resize?.unobserve(node);this.controls.delete(node);this.dirty.delete(node);}
  snapshot(){return [...this.controls].filter(([,e])=>e.buffer).map(([node,e])=>({id:node.dataset.controlId,name:node.dataset.control,type:node.dataset.type,...e.buffer.snapshot()}));}
  dispose(){if(this.disposed)return;this.disposed=true;this.view.cancelAnimationFrame(this.frame);this.frame=0;this.observer.disconnect();this.resize?.disconnect();for(const off of this.listeners)off();this.listeners=[];for(const node of [...this.controls.keys()])this.remove(node);this.dirty.clear();const root=this.document.documentElement;if(this.previousProfile===null)root.removeAttribute('data-vb-dos');else root.setAttribute('data-vb-dos',this.previousProfile);if(this.previousLine)root.style.setProperty('--dos-line',this.previousLine);else root.style.removeProperty('--dos-line');}
}
