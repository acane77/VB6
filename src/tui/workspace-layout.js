import {commandLabel, partitionTracks} from './appearance.js';

const REGIONS='.object-toolbar,.object-search,.dock-workspace,.dock-zone,.dock-group,.command-bars-host,.command-bar,.panel-toolbar,.menubar,.toolbox-grid';
const BUTTONS='.object-toolbar button,.object-search button,.command-bar .tool-button,.panel-toolbar .tool-button,.toolbox-grid button,.menubar>button';
const explicit = (node,key) => Math.max(0,parseFloat(node.style.getPropertyValue(key))||0);

/** A reversible shell-only layout lease. Canonical docking state, authored form
 * twips and runtime client rectangles are never edited. Existing dock resize and
 * drag handlers keep writing their normal state; this projection reads it and
 * places presentation tracks on the selected cell lattice. */
export class TuiWorkspaceLayout {
  constructor(owner){this.owner=owner;this.entries=new Map();this.sizes=new Set();this.dirty=false;}
  set(node,key,value){
    let keys=this.entries.get(node);if(!keys)this.entries.set(node,keys=new Map());
    if(!keys.has(key))keys.set(key,[node.style.getPropertyValue(key),node.style.getPropertyPriority(key)]);
    if(node.style.getPropertyValue(key)!==value)node.style.setProperty(key,value);
  }
  scan(root){
    if(!this.owner.shell||!root?.querySelectorAll)return;
    const regions=[...(root.matches?.(REGIONS)?[root]:[]),...root.querySelectorAll(REGIONS)];
    for(const node of regions)if(this.owner.owns(node)&&!this.sizes.has(node)){
      this.sizes.add(node);this.owner.observeSize(node);this.dirty=true;
    }
    if(regions.length||root.matches?.('button,input,select')||root.querySelector(BUTTONS))this.dirty=true;
  }
  invalidate(node){
    if(this.owner.shell&&(!node||node===this.owner.root||node.matches?.(REGIONS)||node.matches?.(BUTTONS)))this.dirty=true;
  }
  configure(){if(this.owner.shell)this.dirty=true;}
  flush(){
    if(!this.dirty||!this.owner.shell)return;
    this.dirty=false;
    const {cellWidth:c,cellHeight:r}=this.owner.settings;
    for(const node of [...this.sizes])if(!node.isConnected||!this.owner.owns(node)){
      this.owner.unobserveSize(node);this.sizes.delete(node);this.restore(node);
    }
    // Replaced captions/toolbars must not remain strongly retained until the
    // entire workspace closes. Their native CSS is restored on retirement.
    for(const node of [...this.entries.keys()])if(!node.isConnected||!this.owner.owns(node))this.restore(node);
    for(const workspace of this.owner.root.querySelectorAll('.dock-workspace')){
      if(!this.owner.owns(workspace))continue;
      const width=workspace.clientWidth;
      // Keep collapsed sides at zero. Responsive caps reserve at least 36 text
      // columns for documents, without silently hiding any docked tool.
      const available=Math.max(0,width-36*c-2*c),leftOn=explicit(workspace,'--dock-left')>0,rightOn=explicit(workspace,'--dock-right')>0;
      const preferredLeft=leftOn?Math.max(24*c,explicit(workspace,'--dock-left')):0;
      const preferredRight=rightOn?Math.max(40*c,explicit(workspace,'--dock-right')):0;
      const total=preferredLeft+preferredRight,scale=total>available?available/Math.max(1,total):1;
      const left=Math.floor(preferredLeft*scale/c)*c,right=Math.floor(preferredRight*scale/c)*c;
      this.set(workspace,'--tui-dock-left',left+'px');this.set(workspace,'--tui-dock-right',right+'px');
      this.set(workspace,'--tui-gap-left',leftOn?c+'px':'0px');this.set(workspace,'--tui-gap-right',rightOn?c+'px':'0px');
      for(const side of ['top','bottom']){
        const height=explicit(workspace,'--dock-'+side);
        this.set(workspace,'--tui-dock-'+side,(height>0?Math.max(6*r,Math.round(height/r)*r):0)+'px');
        this.set(workspace,'--tui-gap-'+side,(height>0?r:0)+'px');
      }
    }
    for(const zone of this.owner.root.querySelectorAll('.dock-zone')){
      if(!this.owner.owns(zone)||!zone.getClientRects().length)continue;
      const horizontal=zone.matches('.dock-zone-top,.dock-zone-bottom');
      const groups=[...zone.children].filter(n=>n.matches('.dock-group')&&!n.hidden);
      const weights=groups.map(n=>Math.max(.01,parseFloat(n.style.flexGrow||n.style.flex)||1));
      const tracks=partitionTracks(horizontal?zone.clientWidth:zone.clientHeight,weights,horizontal?c:r,horizontal?c:r);
      groups.forEach((n,i)=>this.set(n,'--tui-group-size',tracks[i]+'px'));
    }
    for(const button of this.owner.root.querySelectorAll(BUTTONS)){
      if(!this.owner.owns(button))continue;
      const label=button.closest('.menubar')?button.textContent.trim():button.closest('.toolbox-grid')?button.dataset.controlType||button.title||'Pointer':commandLabel(button.dataset.command,button.getAttribute('aria-label')||button.title||button.textContent.trim());
      this.set(button,'--tui-label-width',Math.max(5,Math.min(28,Array.from(label).length+(button.closest('.menubar')?2:4)))*c+'px');
    }
  }
  restore(node){
    const keys=this.entries.get(node);if(!keys)return;
    for(const[key,[value,priority]]of keys)value?node.style.setProperty(key,value,priority):node.style.removeProperty(key);
    this.entries.delete(node);
  }
  dispose(){
    for(const node of this.sizes)this.owner.unobserveSize(node);
    this.sizes.clear();for(const node of [...this.entries.keys()])this.restore(node);this.dirty=false;
  }
}
