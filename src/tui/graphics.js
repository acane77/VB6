import {EGA} from './cells.js';
const rgb=EGA.map(c=>[1,3,5].map(i=>parseInt(c.slice(i,i+2),16)));
const bayer=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];
export function nearestEGA(r,g,b) {
  let best=0,distance=Infinity;
  for(let i=0;i<16;i++){const c=rgb[i],d=2*(r-c[0])**2+4*(g-c[1])**2+(b-c[2])**2;if(d<distance){distance=d;best=i;}}
  return best;
}
/** Caller downsamples to 1x2 (half blocks) or 2x4 (Braille) samples per cell.
 * Alpha is composited explicitly before palette quantization. */
export function projectPixels(buffer,image,{mode='blocks',background=0,dither=false}={}) {
  if(!['blocks','braille'].includes(mode)||!Number.isInteger(background)||background<0||background>15)throw new TypeError('Invalid raster projection mode');
  const sx=mode==='braille'?2:1,sy=mode==='braille'?4:2,{width,height,data}=image||{};
  if(width!==buffer.columns*sx||height!==buffer.rows*sy||!ArrayBuffer.isView(data)||data.BYTES_PER_ELEMENT!==1||data.length!==width*height*4)throw new RangeError('RGBA projection dimensions do not match cells');
  const at=(x,y)=>{const i=(y*width+x)*4,a=data[i+3]/255,base=rgb[background],shift=dither?(bayer[(y%4)*4+x%4]-7.5)*3:0;
    return nearestEGA(data[i]*a+base[0]*(1-a)+shift,data[i+1]*a+base[1]*(1-a)+shift,data[i+2]*a+base[2]*(1-a)+shift);};
  for(let y=0;y<buffer.rows;y++)for(let x=0;x<buffer.columns;x++) {
    if(mode==='blocks'){const top=at(x,y*2),bottom=at(x,y*2+1);buffer.put(x,y,top===bottom?' ':'▀',top,bottom);}
    else {
      const samples=[];for(let py=0;py<4;py++)for(let px=0;px<2;px++)samples.push(at(x*2+px,y*4+py));
      const count=new Uint8Array(16);for(const c of samples)count[c]++;
      let bg=0;for(let n=1;n<16;n++)if(count[n]>count[bg])bg=n;
      let fg=bg,dist=0;for(const c of samples){const d=rgb[c].reduce((sum,v,i)=>sum+(v-rgb[bg][i])**2,0);if(d>dist){dist=d;fg=c;}}
      let bits=0;const order=[0,3,1,4,2,5,6,7];
      samples.forEach((c,n)=>{const d1=rgb[c].reduce((s,v,i)=>s+(v-rgb[fg][i])**2,0),d0=rgb[c].reduce((s,v,i)=>s+(v-rgb[bg][i])**2,0);if(d1<d0)bits|=1<<order[n];});
      buffer.put(x,y,0x2800+bits,fg,bg);
    }
  }
  return buffer;
}
/** A bounded readback scratch surface, never the source image or GPU buffer.
 * SecurityError (tainted images) propagates to native fallback. */
export class TuiImageProjector {
  constructor(document){this.canvas=document.createElement('canvas');this.context=this.canvas.getContext('2d',{willReadFrequently:true});if(!this.context)throw new Error('Image projection context unavailable');}
  paint(buffer,source,options={}){
    const mode=options.mode||'blocks',width=buffer.columns*(mode==='braille'?2:1),height=buffer.rows*(mode==='braille'?4:2);
    if(width*height>524288)throw new RangeError('Raster projection exceeds pixel budget');
    if(this.canvas.width!==width)this.canvas.width=width;if(this.canvas.height!==height)this.canvas.height=height;
    const ctx=this.context;ctx.clearRect(0,0,width,height);ctx.imageSmoothingEnabled=true;
    const fit=options.fit||'fill',targetWidth=options.width||width,targetHeight=options.height||height;
    const sourceWidth=source.naturalWidth||source.videoWidth||source.width,sourceHeight=source.naturalHeight||source.videoHeight||source.height;
    if(!['fill','contain','cover','none','scale-down'].includes(fit)||!Number.isFinite(targetWidth)||!Number.isFinite(targetHeight)||targetWidth<=0||targetHeight<=0||!sourceWidth||!sourceHeight)throw new RangeError('Invalid image projection geometry');
    if(fit==='fill')ctx.drawImage(source,0,0,width,height);
    else{
      let scale=fit==='cover'?Math.max(targetWidth/sourceWidth,targetHeight/sourceHeight):Math.min(targetWidth/sourceWidth,targetHeight/sourceHeight);
      if(fit==='none')scale=1;else if(fit==='scale-down')scale=Math.min(1,scale);
      const dw=sourceWidth*scale/targetWidth*width,dh=sourceHeight*scale/targetHeight*height;
      ctx.drawImage(source,(width-dw)/2,(height-dh)/2,dw,dh);
    }
    return projectPixels(buffer,ctx.getImageData(0,0,width,height),options);
  }
  dispose(){this.canvas.width=this.canvas.height=1;}
}
