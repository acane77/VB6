import {projectionGrid} from './projection.js';
import {tuiAttribute} from './appearance.js';
import {nearestEGA} from './graphics.js';
const color=(value,fallback)=>{const m=/rgba?\(\s*(\d+)[, ]+\s*(\d+)[, ]+\s*(\d+)/.exec(value||'');return m?nearestEGA(+m[1],+m[2],+m[3]):fallback;};

/** Project actual materialized rich-text runs and browser selection rectangles.
 * The RichTextController alone still owns RTF, formatting, edits and history.
 * Browser line wrapping and per-run font geometry are measured, not simulated. */
export function paintRichText(buffer,node,settings){
  const root=node.querySelector('[contenteditable]');if(!root)return false;
  const document=node.ownerDocument,view=document.defaultView,grid=projectionGrid(node,buffer.columns,buffer.rows,settings),base=tuiAttribute(settings.profile,'field'),selected=tuiAttribute(settings.profile,'selected');
  buffer.fill(0,0,buffer.columns,buffer.rows,' ',base.foreground,base.background);
  const selection=document.getSelection(),range=selection?.rangeCount?selection.getRangeAt(0):null,focused=node.contains(document.activeElement);
  const walker=document.createTreeWalker(root,4),styles=new Map();let text,budget=32768;
  while((text=walker.nextNode())&&budget>0){
    const parent=text.parentElement;if(!parent||parent.closest('[hidden]'))continue;
    const bounds=parent.getBoundingClientRect();if(bounds.bottom<grid.y||bounds.top>grid.rect.bottom)continue;
    let style=styles.get(parent);if(!style)styles.set(parent,style=view.getComputedStyle(parent));
    const fg=color(style.color,base.foreground),flags=(+style.fontWeight>=600?1:0)|(style.fontStyle==='italic'?2:0)|(style.textDecorationLine.includes('underline')?4:0)|(style.textDecorationLine.includes('line-through')?8:0);
    for(let offset=0;offset<text.length&&budget-->0;){
      const glyph=String.fromCodePoint(text.textContent.codePointAt(offset)),end=offset+glyph.length;
      const r=document.createRange();r.setStart(text,offset);r.setEnd(text,end);const box=r.getBoundingClientRect();
      const x=Math.floor((box.left-grid.x)/grid.pitchX),y=Math.floor((box.top+box.height*.5-grid.y)/grid.pitchY);
      let marked=false;if(focused&&range&&!range.collapsed){marked=range.compareBoundaryPoints(view.Range.END_TO_START,r)<0&&range.compareBoundaryPoints(view.Range.START_TO_END,r)>0;}
      if(box.width&&x>=0&&y>=0&&x<buffer.columns&&y<buffer.rows)buffer.put(x,y,glyph,marked?selected.foreground:fg,marked?selected.background:base.background,flags);
      offset=end;
    }
  }
  if(focused&&range?.collapsed&&root.contains(range.startContainer)){
    const rect=range.getBoundingClientRect(),fallback=range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement;
    const box=rect.height?rect:fallback.getBoundingClientRect(),x=Math.floor((box.left-grid.x)/grid.pitchX),y=Math.floor((box.top+Math.min(box.height,grid.pitchY)*.5-grid.y)/grid.pitchY);
    if(x>=0&&y>=0&&x<buffer.columns&&y<buffer.rows){const i=y*buffer.columns+x;buffer.put(x,y,buffer.glyphs[i],base.background,base.foreground,buffer.styles[i]);}
  }
  return true;
}
