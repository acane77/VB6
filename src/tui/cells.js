/** Character-cell presentation primitives. No dependency on the DOM or VB6. */
export const EGA = Object.freeze(['#000000','#0000aa','#00aa00','#00aaaa','#aa0000','#aa00aa','#aa5500','#aaaaaa','#555555','#5555ff','#55ff55','#55ffff','#ff5555','#ff55ff','#ffff55','#ffffff']);
export const TUI_PROFILES = Object.freeze({
  turbo: Object.freeze({name:'Borland / Turbo Vision',foreground:0,background:7,desktop:1,accent:14,selection:3,border:15,button:2}),
  commander: Object.freeze({name:'Norton-style Commander',foreground:14,background:1,desktop:1,accent:15,selection:3,border:11,button:3}),
  win31: Object.freeze({name:'Windows 3.1-inspired TUI',foreground:0,background:7,desktop:3,accent:15,selection:1,border:0,button:7}),
  monochrome: Object.freeze({name:'Monochrome',foreground:7,background:0,desktop:0,accent:15,selection:7,border:7,button:0})
});
export const DOS_SETTINGS_KEY = 'vb6-studio-web.dos-workspace.v1';
export function normalizeDOSSettings(value = {}) {
  return {mode:value?.mode === 'dos' ? 'dos' : 'classic',profile:Object.hasOwn(TUI_PROFILES,value?.profile) ? value.profile : 'turbo',cellWidth:[8,9,10,12].includes(value?.cellWidth) ? value.cellWidth : 8,cellHeight:[14,16,18,20,24].includes(value?.cellHeight) ? value.cellHeight : 16};
}
export function loadDOSSettings(storage) {
  try {const text=storage?.getItem(DOS_SETTINGS_KEY);return normalizeDOSSettings(text && text.length<4096 ? JSON.parse(text) : {});} catch {return normalizeDOSSettings();}
}
const integer = (n, name) => {if (!Number.isSafeInteger(n)) throw new TypeError(`${name} must be an integer`);return n;};
const paletteIndex = n => {if(!Number.isInteger(n)||n<0||n>15)throw new RangeError('EGA color must be in [0, 15]');return n;};
export function cellRect(rect, width=8, height=16) {
  if(![rect.x,rect.y,rect.width,rect.height,width,height].every(Number.isFinite)||width<=0||height<=0||rect.width<0||rect.height<0)throw new RangeError('Invalid cell geometry');
  const x=Math.floor(rect.x/width),y=Math.floor(rect.y/height);
  return {x,y,width:Math.ceil((rect.x+rect.width)/width)-x,height:Math.ceil((rect.y+rect.height)/height)-y};
}
export function mnemonic(text) {
  const chars=[],hotkeys=[];text=String(text??'');
  for(let i=0;i<text.length;) {const c=String.fromCodePoint(text.codePointAt(i));i+=c.length;if(c==='&'&&i<text.length){const next=String.fromCodePoint(text.codePointAt(i));i+=next.length;if(next!=='&')hotkeys.push(chars.length);chars.push(next);}else chars.push(c);}
  return {text:chars.join(''),hotkeys};
}
/** Bounded dense buffers; damage is tracked as one span per row. */
export class CellBuffer {
  constructor(columns,rows,{foreground=7,background=0}={}) {
    integer(columns,'columns');integer(rows,'rows');
    if(columns<1||rows<1||columns>2048||rows>2048||columns*rows>1048576)throw new RangeError('Cell buffer exceeds its budget');
    this.columns=columns;this.rows=rows;this.foreground=paletteIndex(foreground);this.background=paletteIndex(background);
    this.glyphs=new Uint32Array(columns*rows).fill(32);this.colors=new Uint8Array(columns*rows).fill(foreground|(background<<4));
    this.damageLeft=new Int32Array(rows).fill(0);this.damageRight=new Int32Array(rows).fill(columns);
    this.clips=[{x:0,y:0,width:columns,height:rows}];
  }
  pushClip(x,y,width,height) {
    [x,y,width,height].forEach(n=>integer(n,'clip'));if(width<0||height<0)throw new RangeError('Negative clip');
    const p=this.clips.at(-1),left=Math.max(x,p.x),top=Math.max(y,p.y);
    this.clips.push({x:left,y:top,width:Math.max(0,Math.min(x+width,p.x+p.width)-left),height:Math.max(0,Math.min(y+height,p.y+p.height)-top)});return this;
  }
  popClip() {if(this.clips.length===1)throw new Error('Cannot remove the root clip');this.clips.pop();return this;}
  put(x,y,glyph,foreground=this.foreground,background=this.background) {
    integer(x,'x');integer(y,'y');const c=this.clips.at(-1);
    if(x<c.x||y<c.y||x>=c.x+c.width||y>=c.y+c.height)return this;
    let code=typeof glyph==='number'?glyph:String(glyph??' ').codePointAt(0)??32;
    if(!Number.isInteger(code)||code<32||code>0x10ffff||(code>=0xd800&&code<=0xdfff)||(code>=127&&code<160))code=32;
    const color=paletteIndex(foreground)|(paletteIndex(background)<<4),i=y*this.columns+x;
    if(this.glyphs[i]!==code||this.colors[i]!==color){this.glyphs[i]=code;this.colors[i]=color;this.damageLeft[y]=Math.min(this.damageLeft[y],x);this.damageRight[y]=Math.max(this.damageRight[y],x+1);}return this;
  }
  fill(x,y,width,height,glyph=' ',foreground=this.foreground,background=this.background) {
    [x,y,width,height].forEach(n=>integer(n,'fill'));if(width<0||height<0)throw new RangeError('Negative fill');
    const c=this.clips.at(-1),right=Math.min(x+width,c.x+c.width),bottom=Math.min(y+height,c.y+c.height);
    for(let row=Math.max(y,c.y);row<bottom;row++)for(let col=Math.max(x,c.x);col<right;col++)this.put(col,row,glyph,foreground,background);return this;
  }
  text(x,y,text,{foreground=this.foreground,background=this.background,width=this.columns-x,hotkey=foreground,mnemonics=false}={}) {
    integer(width,'text width');if(width<=0)return this;
    const value=mnemonics?mnemonic(text):{text:String(text??''),hotkeys:[]},keys=new Set(value.hotkeys);let col=0,index=0;
    for(const ch of value.text){if(ch==='\n'||ch==='\r'||col>=width)break;this.put(x+col++,y,ch,keys.has(index++)?hotkey:foreground,background);}return this;
  }
  frame(x,y,width,height,{double=false,foreground=this.foreground,background=this.background,title=''}={}) {
    if(width<1||height<1)return this;
    const [tl,tr,bl,br,h,v]=double?['╔','╗','╚','╝','═','║']:['┌','┐','└','┘','─','│'];
    this.fill(x,y,width,1,h,foreground,background);if(height>1)this.fill(x,y+height-1,width,1,h,foreground,background);
    this.fill(x,y,1,height,v,foreground,background);if(width>1)this.fill(x+width-1,y,1,height,v,foreground,background);
    this.put(x,y,tl,foreground,background);if(width>1)this.put(x+width-1,y,tr,foreground,background);
    if(height>1){this.put(x,y+height-1,bl,foreground,background);if(width>1)this.put(x+width-1,y+height-1,br,foreground,background);}
    if(title&&width>4)this.text(x+2,y,title,{width:width-4,foreground,background,mnemonics:true});return this;
  }
  blit(source,dx,dy) {
    integer(dx,'dx');integer(dy,'dy');const glyphs=source===this?source.glyphs.slice():source.glyphs,colors=source===this?source.colors.slice():source.colors;
    for(let y=0;y<source.rows;y++)for(let x=0;x<source.columns;x++){const i=y*source.columns+x;this.put(x+dx,y+dy,glyphs[i],colors[i]&15,colors[i]>>4);}return this;
  }
  takeDamage() {const result=[];for(let y=0;y<this.rows;y++){if(this.damageRight[y]>this.damageLeft[y])result.push({y,x:this.damageLeft[y],width:this.damageRight[y]-this.damageLeft[y]});this.damageLeft[y]=this.columns;this.damageRight[y]=0;}return result;}
  invalidate() {this.damageLeft.fill(0);this.damageRight.fill(this.columns);}
  toText() {const lines=[];for(let y=0;y<this.rows;y++){let line='';for(let x=0;x<this.columns;x++)line+=String.fromCodePoint(this.glyphs[y*this.columns+x]);lines.push(line);}return lines.join('\n');}
  snapshot() {return {columns:this.columns,rows:this.rows,glyphs:Array.from(this.glyphs),colors:Array.from(this.colors)};}
}
/** Device-scaled cached glyphs. The caller owns the canvas; no event interception. */
export class CanvasCellRenderer {
  constructor(canvas,{cellWidth=8,cellHeight=16,palette=EGA,maxGlyphs=2048}={}) {
    if(!Number.isFinite(cellWidth)||!Number.isFinite(cellHeight)||cellWidth<1||cellHeight<1||cellWidth>64||cellHeight>128)throw new RangeError('Invalid cell metrics');
    this.canvas=canvas;this.context=canvas.getContext('2d',{alpha:true});if(!this.context)throw new Error('Canvas2D unavailable');
    this.cellWidth=cellWidth;this.cellHeight=cellHeight;this.palette=palette;this.maxGlyphs=maxGlyphs;this.cache=new Map();this.key='';
  }
  render(buffer,dpr=1) {
    dpr=Number.isFinite(dpr)?Math.min(4,Math.max(1,dpr)):1;
    const w=Math.max(1,Math.round(this.cellWidth*dpr)),h=Math.max(1,Math.round(this.cellHeight*dpr)),key=[w,h,buffer.columns,buffer.rows].join(':');
    if(key!==this.key){this.key=key;this.cache.clear();this.canvas.width=w*buffer.columns;this.canvas.height=h*buffer.rows;buffer.invalidate();}
    const ctx=this.context;ctx.imageSmoothingEnabled=false;
    for(const span of buffer.takeDamage())for(let x=span.x;x<span.x+span.width;x++){
      const i=span.y*buffer.columns+x,color=buffer.colors[i],code=buffer.glyphs[i],cacheKey=`${code}:${color}`;let glyph=this.cache.get(cacheKey);
      if(!glyph){glyph=this.canvas.ownerDocument.createElement('canvas');glyph.width=w;glyph.height=h;const g=glyph.getContext('2d');g.fillStyle=this.palette[color>>4];g.fillRect(0,0,w,h);g.fillStyle=this.palette[color&15];g.font=`${Math.round(h*.88)}px monospace`;g.textBaseline='middle';g.textAlign='center';g.fillText(String.fromCodePoint(code),w/2,h/2,w);if(this.cache.size>=this.maxGlyphs)this.cache.delete(this.cache.keys().next().value);this.cache.set(cacheKey,glyph);}
      ctx.drawImage(glyph,x*w,span.y*h);
    }
  }
  dispose() {this.cache.clear();this.canvas.width=this.canvas.height=1;}
}
