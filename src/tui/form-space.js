import {readControlPaintProperties} from '../rendering/invalidation.js';
import {mnemonic} from './cells.js';

/** A uniform presentation-space expansion: no twips/property/layout mutation,
 * no per-control repositioning, and no second hit-test tree. All cells keep
 * their requested display pitch, while native controls and designer overlays
 * share the same invertible transform. Authored mode is available explicitly. */
export function readableFormScale(captions, {cellWidth=8,cellHeight=16}={}) {
  if(!Array.isArray(captions)||captions.length>10000)throw new RangeError('Invalid caption inventory');
  let x=1, y=1;
  for(const {text,width,height,padding=0} of captions){
    if(typeof text!=='string'||!Number.isFinite(width)||width<=0||!Number.isFinite(height)||height<=0)continue;
    let length=0,current=0;
    for(const c of mnemonic(text.slice(0,65536)).text){if(c==='\n'||c==='\r'){length=Math.max(length,current);current=0;}else current++;}
    length=Math.max(length,current);
    // Authors can deliberately supply a caption longer than a whole screen.
    // Bound expansion; retain the original title/accessible name in that case.
    x=Math.max(x,Math.min(3,(length+padding)*cellWidth/width));
    y=Math.max(y,Math.min(2,cellHeight/height));
  }
  return {x:Math.ceil(x*8)/8,y:Math.ceil(y*8)/8};
}
const leases=new WeakMap();
export function formCellMetrics(node,settings){
  const form=node.matches?.('.vb-form')?node:node.closest?.('.vb-form');
  const scale=leases.get(form)?.scale||{x:1,y:1};
  return {...settings,cellWidth:settings.cellWidth/scale.x,cellHeight:settings.cellHeight/scale.y};
}
export class TuiFormSpace {
  constructor(owner){this.owner=owner;this.entries=new Map();this.dirty=true;}
  configure(){this.dirty=true;}
  flush(){
    if(!this.dirty)return;this.dirty=false;
    const owner=this.owner,enabled=owner.settings.formLayout==='readable';
    const roots=[owner.root,...owner.portals.keys()];
    const forms=roots.flatMap(root=>[...(root.matches('.vb-form')?[root]:[]),...root.querySelectorAll('.vb-form')]).filter(n=>owner.owns(n));
    for(const form of [...this.entries.keys()])if(!enabled||!form.isConnected||!forms.includes(form))this.remove(form);
    if(!enabled)return;
    for(const form of forms){
      let entry=this.entries.get(form);
      if(!entry){
        entry={scale:{x:1,y:1},styles:new Map(),marker:form.getAttribute('data-tui-form-space'),plane:form.closest('.designer-plane'),window:form.closest('.mdi-window')};
        this.entries.set(form,entry);leases.set(form,entry);
      }
      const captions=[];
      for(const node of form.querySelectorAll('.vb-control')){
        if(node.closest('.vb-form')!==form||node.closest('[hidden]'))continue;
        const type=node.dataset.type;
        if(!['CommandButton','CheckBox','OptionButton','Label'].includes(type))continue;
        const p=readControlPaintProperties(node,['Caption']);
        const input=node.querySelector('input');
        captions.push({text:p.Caption||node.getAttribute('aria-label')||'',width:node.clientWidth,height:node.clientHeight,
          padding:type==='CheckBox'||type==='OptionButton'?4:type==='CommandButton'?2:0});
      }
      const scale=readableFormScale(captions,owner.settings),changed=scale.x!==entry.scale.x||scale.y!==entry.scale.y;
      entry.scale=scale;form.setAttribute('data-tui-form-space','');
      this.set(entry,form,'scale',`${scale.x} ${scale.y}`);
      this.set(entry,form,'transform-origin','top left');
      this.set(entry,form,'--dos-cell-width',owner.settings.cellWidth/scale.x+'px');
      this.set(entry,form,'--dos-line',owner.settings.cellHeight/scale.y+'px');
      if(entry.window){
        const parent=entry.window.parentElement;
        const desiredWidth=form.offsetWidth*scale.x+40,desiredHeight=form.offsetHeight*scale.y+56;
        this.set(entry,entry.window,'--tui-form-window-width',Math.min(Math.max(320,parent.clientWidth-32),desiredWidth)+'px');
        this.set(entry,entry.window,'--tui-form-window-height',Math.min(Math.max(240,parent.clientHeight-32),desiredHeight)+'px');
      }
      if(entry.plane){
        const rect=form.getBoundingClientRect(),plane=entry.plane.getBoundingClientRect();
        this.set(entry,entry.plane,'min-width',Math.ceil(rect.right-plane.left+24)+'px');
        this.set(entry,entry.plane,'min-height',Math.ceil(rect.bottom-plane.top+24)+'px');
      }
      if(changed){
        for(const node of owner.controls.keys())if(form.contains(node))owner.dirty.add(node);
        owner.chrome.invalidate(form);
        form.dispatchEvent(new owner.view.CustomEvent('vb-presentation-geometry',{bubbles:true}));
      }
    }
  }
  set(entry,node,key,value){
    let keys=entry.styles.get(node);if(!keys)entry.styles.set(node,keys=new Map());
    if(!keys.has(key))keys.set(key,[node.style.getPropertyValue(key),node.style.getPropertyPriority(key)]);
    if(node.style.getPropertyValue(key)!==value)node.style.setProperty(key,value);
  }
  remove(form){
    const entry=this.entries.get(form);if(!entry)return;
    for(const[node,keys]of entry.styles)for(const[key,[value,priority]]of keys)value?node.style.setProperty(key,value,priority):node.style.removeProperty(key);
    entry.marker===null?form.removeAttribute('data-tui-form-space'):form.setAttribute('data-tui-form-space',entry.marker);
    if(leases.get(form)===entry)leases.delete(form);
    this.entries.delete(form);form.dispatchEvent(new this.owner.view.CustomEvent('vb-presentation-geometry',{bubbles:true}));
  }
  dispose(){for(const form of [...this.entries.keys()])this.remove(form);}
}
