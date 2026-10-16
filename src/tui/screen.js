import {CellBuffer} from './cells.js';
/** Canonical IBM code-page character mapping, not glyph/font data. */
export const CP437 = '\0☺☻♥♦♣♠•◘○◙♂♀♪♫☼►◄↕‼¶§▬↨↑↓→←∟↔▲▼' +
  Array.from({length:95},(_,i)=>String.fromCharCode(32+i)).join('')+'⌂'+
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';
const encoding=new Map(Array.from(CP437,(c,i)=>[c.codePointAt(0),i]));
const ansi=[0,4,2,6,1,5,3,7];
function validBuffer(value) {
  const {columns,rows,glyphs,colors,styles}=value||{};
  if(!Number.isSafeInteger(columns)||!Number.isSafeInteger(rows)||columns<1||rows<1||columns>2048||rows>2048||columns*rows>1048576)throw new RangeError('Screen exceeds cell budget');
  if(glyphs?.length!==columns*rows||colors?.length!==glyphs.length)throw new RangeError('Invalid screen payload lengths');
  if(styles!==undefined&&(styles.length!==glyphs.length||Array.from(styles).some(n=>!Number.isInteger(n)||n<0||n>15)))throw new TypeError('Invalid screen styles');
  for(let i=0;i<glyphs.length;i++){
    const c=glyphs[i];if(!Number.isInteger(c)||c<32||c>0x10ffff||c>=127&&c<160||c>=0xd800&&c<=0xdfff)throw new TypeError('Screen contains a control code or invalid scalar');
    if(!Number.isInteger(colors[i])||colors[i]<0||colors[i]>255)throw new TypeError('Invalid EGA attribute');
  }
  return value;
}
export function serializeScreen(buffer) {
  validBuffer(buffer);
  return JSON.stringify({format:'vb6-tui-screen',version:1,columns:buffer.columns,rows:buffer.rows,glyphs:Array.from(buffer.glyphs),colors:Array.from(buffer.colors),...(buffer.styles?.some(Boolean)?{styles:Array.from(buffer.styles)}:{})});
}
export function deserializeScreen(input) {
  if(typeof input!=='string'||input.length>16777216)throw new RangeError('Screen JSON exceeds import budget');
  const value=JSON.parse(input);
  if(value?.format!=='vb6-tui-screen'||value.version!==1||!Array.isArray(value.glyphs)||!Array.isArray(value.colors))throw new TypeError('Unsupported screen snapshot');
  validBuffer(value);const buffer=new CellBuffer(value.columns,value.rows);buffer.glyphs.set(value.glyphs);buffer.colors.set(value.colors);if(value.styles)buffer.styles.set(value.styles);return buffer;
}
/** UTF-8-compatible ANSI text. All escape sequences are generated here from
 * bounded numeric attributes; input text can never inject terminal commands. */
export function serializeANSI(buffer,{home=true}={}) {
  validBuffer(buffer);let text=home?'\x1b[0m\x1b[H':'\x1b[0m',previous=-1,previousStyle=0;
  for(let y=0;y<buffer.rows;y++){
    if(y)text+='\r\n';
    for(let x=0;x<buffer.columns;x++){
      const i=y*buffer.columns+x,color=buffer.colors[i],fg=color&15,bg=color>>4;
      const style=buffer.styles?.[i]||0;
      if(style!==previousStyle){text+='\x1b[0m';previous=-1;if(style)text+=`\x1b[${[style&1?1:0,style&2?3:0,style&4?4:0,style&8?9:0].filter(Boolean).join(';')}m`;previousStyle=style;}
      if(color!==previous){text+=`\x1b[${(fg<8?30:90)+ansi[fg&7]};${(bg<8?40:100)+ansi[bg&7]}m`;previous=color;}
      text+=String.fromCodePoint(buffer.glyphs[i]);
    }
  }
  return text+'\x1b[0m';
}
/** VGA-style character/attribute byte pairs. Non-CP437 Unicode requires an
 * explicit replacement or throws; this is a screen dump, not a DOS program. */
export function serializeB800(buffer,{unmappable='replace',styles='discard'}={}) {
  validBuffer(buffer);if(!['discard','error'].includes(styles))throw new TypeError('Invalid style policy');
  if(styles==='error'&&buffer.styles?.some(Boolean))throw new TypeError('B800 cannot represent text styles');
  if(!['replace','error'].includes(unmappable))throw new TypeError('Invalid encoding policy');
  const bytes=new Uint8Array(buffer.glyphs.length*2);
  for(let i=0;i<buffer.glyphs.length;i++){
    const byte=encoding.get(buffer.glyphs[i]);
    if(byte===undefined&&unmappable==='error')throw new TypeError('Screen contains non-CP437 text');
    bytes[i*2]=byte??63;bytes[i*2+1]=buffer.colors[i];
  }
  return bytes;
}
/** Layers are paint-order snapshots. Clip before iterating, so huge offscreen
 * offsets cannot turn a tiny destination into an unbounded copy operation. */
export function composeCellLayers(columns,rows,layers,{foreground=7,background=0}={}) {
  if(!Array.isArray(layers)||layers.length>20000)throw new RangeError('Screen layer budget exceeded');
  const result=new CellBuffer(columns,rows,{foreground,background});
  for(const layer of layers){
    const {x,y,buffer,clip={x:0,y:0,width:columns,height:rows}}=layer;
    validBuffer(buffer);
    if(![x,y,clip.x,clip.y,clip.width,clip.height].every(Number.isSafeInteger)||clip.width<0||clip.height<0)throw new RangeError('Invalid screen layer geometry');
    const left=Math.max(0,x,clip.x),top=Math.max(0,y,clip.y),right=Math.min(columns,x+buffer.columns,clip.x+clip.width),bottom=Math.min(rows,y+buffer.rows,clip.y+clip.height);
    for(let py=top;py<bottom;py++)for(let px=left;px<right;px++){const i=(py-y)*buffer.columns+px-x;if(layer.transparent&&buffer.glyphs[i]===32)continue;result.put(px,py,buffer.glyphs[i],buffer.colors[i]&15,layer.transparent?result.colors[py*columns+px]>>4:buffer.colors[i]>>4,buffer.styles?.[i]||0);}
  }
  return result;
}
