/** Map wrapped DOM text to cell runs, with one Range probe per Unicode scalar.
 * Used for generic dialogs, not large source files (their token/line renderer is
 * already virtualized). A shared hard work budget bounds hostile DOM content. */
export function captureTextRuns(textNode, grid, columns, rows, budget) {
  const result=[],doc=textNode.ownerDocument,range=doc.createRange(),text=textNode.textContent||'';
  range.selectNodeContents(textNode);
  const whole=range.getBoundingClientRect();
  if(!whole.width||!whole.height||whole.bottom<=grid.y||whole.top>=grid.y+rows*grid.pitchY||whole.right<=grid.x||whole.left>=grid.x+columns*grid.pitchX)return result;
  let current=null;
  for(let at=0;at<text.length;){
    if(--budget.remaining<0)throw new RangeError('Text capture exceeds visible-source budget');
    const glyph=String.fromCodePoint(text.codePointAt(at)),start=at;at+=glyph.length;
    range.setStart(textNode,start);range.setEnd(textNode,at);const rect=range.getBoundingClientRect();
    if(!rect.width||!rect.height){current=null;continue;}
    const x=Math.round((rect.left-grid.x)/grid.pitchX),y=Math.floor((rect.top+rect.height/2-grid.y)/grid.pitchY);
    if(y<0||y>=rows||x<0||x>=columns){current=null;continue;}
    if(current&&current.y===y&&Math.abs(x-(current.x+Array.from(current.text).length))<=0){current.text+=glyph;current.width++;}
    else {current={x,y,width:1,height:1,text:glyph,kind:'text',mnemonics:false};result.push(current);}
  }
  return result;
}
