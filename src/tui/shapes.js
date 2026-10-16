import {nearestEGA} from './graphics.js';

export function shapeInk(value, fallback) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffff) return fallback;
  return nearestEGA(value & 255, (value >>> 8) & 255, (value >>> 16) & 255);
}
/** Bounded cell-space projection of the six intrinsic Shape kinds and eight
 * VB fill patterns. The existing control remains the owner of hit geometry. */
export function paintShape(buffer, state, attributes) {
  const w=buffer.columns,h=buffer.rows,shape=Number(state.shape)||0;
  const fg=state.disabled?attributes.foreground:shapeInk(state.borderColor,attributes.foreground);
  const fill=state.disabled?attributes.foreground:shapeInk(state.fillColor,attributes.foreground),bg=attributes.background;
  const pattern=state.fillStyle===undefined?1:Number(state.fillStyle),border=state.borderStyle===undefined?1:Number(state.borderStyle);
  // Display cells are approximately twice as tall as they are wide. Squares
  // and circles preserve that physical aspect without changing model bounds.
  const aspect=Number.isFinite(state.cellAspect)&&state.cellAspect>0?state.cellAspect:2;
  const square=[1,3,5].includes(shape),width=square?Math.min(w,Math.max(1,Math.round(aspect*h))):w,height=square?Math.min(h,Math.max(1,Math.round(w/aspect))):h;
  const left=Math.floor((w-width)/2),top=Math.floor((h-height)/2),oval=shape===2||shape===3,rounded=shape===4||shape===5;
  const inside=(x,y)=>{
    if(x<0||y<0||x>=width||y>=height)return false;
    if(oval){const dx=(x+.5-width/2)/(width/2),dy=(y+.5-height/2)/(height/2);return dx*dx+dy*dy<=1;}
    if(rounded&&width>=6&&height>=3)return !(y===0||y===height-1)||x>0&&x<width-1;
    return true;
  };
  const edge=(x,y)=>inside(x,y)&&(!inside(x-1,y)||!inside(x+1,y)||!inside(x,y-1)||!inside(x,y+1));
  const styleAt=(x,y)=>{
    // Follow the perimeter so vertical sides receive the same dash/gap
    // treatment as horizontal edges instead of becoming solid columns.
    const distance=y===0?x:x===width-1?width-1+y:y===height-1?2*(width-1)+height-1-x:2*(width+height-2)-y;
    return border===2?distance%4<3:border===3?distance%2===0:border===4?distance%6!==3:border===5?distance%8!==3&&distance%8!==5:true;
  };
  const patterns=['█',' ','─','│','/','\\','┼','X'];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    if(!inside(x,y))continue;
    if(edge(x,y)&&border!==0&&styleAt(x,y)){
      let glyph;
      if(oval||rounded){
        const north=!inside(x,y-1),south=!inside(x,y+1),west=!inside(x-1,y),east=!inside(x+1,y);
        glyph=(north||south)&&(west||east)?north?(west?'╭':'╮'):(west?'╰':'╯'):north||south?'─':'│';
        // CP437-compatible curve corners have deterministic single-line masks.
        glyph=({'╭':'┌','╮':'┐','╰':'└','╯':'┘'})[glyph]||glyph;
      }else glyph=y===0?(x===0?'┌':x===width-1?'┐':'─'):y===height-1?(x===0?'└':x===width-1?'┘':'─'):x===0||x===width-1?'│':'─';
      buffer.put(left+x,top+y,glyph,fg,bg);
    }else if(pattern!==1){const glyph=patterns[pattern]||'█';buffer.put(left+x,top+y,glyph,fill,bg);}
  }
  return buffer;
}
