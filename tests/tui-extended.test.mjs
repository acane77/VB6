import {TuiControlRegistry} from '../src/tui/controls.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {TUI} from '../src/tui/api.js';
import {paintTuiGlyph} from '../src/tui/raster.js';
import {letterformMask,TUI_ASCII_REPERTOIRE} from '../src/tui/letterforms.js';
import {captureChrome,paintChrome} from '../src/tui/chrome.js';
import {registerPresentationRoot,bindPresentationPortal} from '../src/rendering/presentation-portals.js';
const {CellBuffer,layoutText,paintText,projectPixels,nearestEGA,serializeScreen,deserializeScreen,serializeANSI,serializeB800,composeCellLayers,CP437,TUI_PROFILES,normalizeDOSSettings}=TUI;

for(const code of TUI_ASCII_REPERTOIRE)test(`deterministic ASCII U+${code.toString(16)}`,()=>{
  const mask=letterformMask(code);assert.equal(mask.length,128);assert.ok(mask.every(value=>value===0||value===1));
  if(code!==32)assert.ok(mask.some(Boolean));
  const pixels=[];assert.equal(paintTuiGlyph({fillRect(...args){pixels.push(args);}},code,9,18),true);
  assert.ok(pixels.every(([x,y,w,h])=>[x,y,w,h].every(Number.isSafeInteger)&&x>=0&&y>=0&&x+w<=9&&y+h<=18));
});
for(const text of ['ĄąĆćĘęŁłŃńÓóŚśŹźŻż','ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ','αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²'])test('extended letter recipe coverage '+text,()=>{
  for(const char of text)assert.ok(letterformMask(char.codePointAt(0)),char);
});
test('CP437 character/attribute dump is exactly 256 mappings and preserves packed attributes',()=>{
  assert.equal(Array.from(CP437).length,256);
  const b=new CellBuffer(3,1);b.text(0,0,'A╔é',{foreground:14,background:1});
  assert.deepEqual(Array.from(serializeB800(b)),[65,30,201,30,130,30]);
  b.put(0,0,'😀');assert.equal(serializeB800(b)[0],63);assert.throws(()=>serializeB800(b,{unmappable:'error'}));
});
test('cell snapshot roundtrip, versioning and detached ownership',()=>{
  const b=new CellBuffer(3,2);b.text(0,1,'A&B',{foreground:2,background:4});const s=serializeScreen(b),r=deserializeScreen(s);
  assert.deepEqual(r.snapshot(),b.snapshot());r.glyphs[0]=65;assert.equal(b.glyphs[0],32);
  assert.throws(()=>deserializeScreen(s.replace('"version":1','"version":2')));
});
for(const value of [27,0x9b,0xd800,Infinity,-1,0x110000])test('snapshot import rejects non-display scalar '+value,()=>{
  const b=new CellBuffer(1,1),v=JSON.parse(serializeScreen(b));v.glyphs[0]=value;
  assert.throws(()=>deserializeScreen(JSON.stringify(v)));
});
test('snapshot import rejects malformed lengths, dimensions and EGA attributes',()=>{
  for(const edit of [v=>v.columns=0,v=>v.rows=2049,v=>v.rows=.5,v=>v.glyphs=[],v=>v.colors=[256],v=>v.colors=['7']]){
    const v=JSON.parse(serializeScreen(new CellBuffer(1,1)));edit(v);assert.throws(()=>deserializeScreen(JSON.stringify(v)));
  }
});
test('ANSI uses EGA-to-ANSI ordering, bright backgrounds, bounded generated sequences and reset',()=>{
  const b=new CellBuffer(2,1);b.put(0,0,'A',1,14);b.put(1,0,'B',12,0);
  assert.equal(serializeANSI(b),'\x1b[0m\x1b[H\x1b[34;103mA\x1b[91;40mB\x1b[0m');
  b.text(0,0,'\x1bX');assert.ok(!serializeANSI(b).includes('\x1bX'));
  b.glyphs[0]=27;assert.throws(()=>serializeANSI(b));
});
test('layer composition clips negative/offscreen coordinates and preserves transparent frame interiors',()=>{
  const a=new CellBuffer(4,2);a.fill(0,0,4,2,'A',2,1);
  const f=new CellBuffer(3,2);f.put(1,0,'│',14,7);
  const screen=composeCellLayers(3,2,[{x:-1,y:0,buffer:a},{x:0,y:0,buffer:f,transparent:true}]);
  assert.equal(screen.toText(),'A│A\nAAA');assert.equal(screen.colors[1]>>4,1);
  assert.doesNotThrow(()=>composeCellLayers(1,1,[{x:10**12,y:10**12,buffer:a}]));
});
test('text selection uses UTF-16 offsets without splitting supplementary scalars',()=>{
  const p=layoutText('A😀BC',{columns:6,rows:1,focused:true,selectionStart:1,selectionEnd:3});
  assert.deepEqual(p.cells.filter(c=>c.selected).map(c=>c.glyph),['😀']);assert.equal(p.caret,null);
  assert.deepEqual(layoutText('A😀BC',{columns:6,rows:1,focused:true,selectionStart:3,selectionEnd:3}).caret,{x:2,y:0});
});
test('CRLF, wrapping, tabs and scrolled selections retain source indices',()=>{
  const p=layoutText('a\tb\r\ncdef',{columns:5,rows:2,tabSize:4,focused:true,selectionStart:3,selectionEnd:7,scrollRow:1});
  assert.equal(p.cells.map(c=>c.glyph).join(''),'cdef');assert.equal(p.cells.filter(c=>c.selected).map(c=>c.glyph).join(''),'cd');
  const wrap=layoutText('abcdef',{columns:3,rows:2,wrap:true});assert.deepEqual(wrap.cells.map(c=>[c.x,c.y]),[[0,0],[1,0],[2,0],[0,1],[1,1],[2,1]]);
});
test('password projection never retains the secret in a paint cell, including selected text',()=>{
  const p=layoutText('private-secret',{columns:6,rows:1,password:true,focused:true,selectionStart:0,selectionEnd:5});
  assert.ok(p.cells.every(c=>c.glyph==='•'));assert.ok(!JSON.stringify(p).includes('private'));
});
test('read-only fields show a selection but never a writable caret',()=>{
  const p=TUI_PROFILES.turbo,b=new CellBuffer(4,1);
  paintText(b,{text:'test',cellEditing:true,readOnly:true,selectionStart:0,selectionEnd:2},p);
  assert.equal(b.colors[0]>>4,p.selection);
  const blank=new CellBuffer(4,1,{foreground:p.foreground,background:p.background});
  paintText(blank,{text:'test',cellEditing:true,readOnly:true,selectionStart:1,selectionEnd:1},p);assert.equal(blank.colors[1]>>4,p.background);
});
test('text paint budgets fail closed and a steady caret is repeatable',()=>{
  assert.throws(()=>layoutText('x',{columns:0,rows:1}));assert.throws(()=>layoutText('12345',{columns:2,rows:1,maxCodeUnits:4}));
  const a=new CellBuffer(4,1),b=new CellBuffer(4,1),s={text:'ABC',cellEditing:true,selectionStart:1,selectionEnd:1};
  paintText(a,s,TUI_PROFILES.turbo);paintText(b,s,TUI_PROFILES.turbo);assert.deepEqual(a.snapshot(),b.snapshot());
});
test('all 16 palette colors quantize without drift',()=>{
  TUI.EGA.forEach((hex,index)=>assert.equal(nearestEGA(...[1,3,5].map(n=>parseInt(hex.slice(n,n+2),16))),index));
});
test('half block projection preserves top/bottom colors and explicit alpha composition',()=>{
  const b=new CellBuffer(2,1),data=new Uint8ClampedArray([170,0,0,255,0,0,0,0,0,0,170,255,0,0,0,0]);
  projectPixels(b,{width:2,height:2,data},{background:14});
  assert.equal(b.toText(),'▀ ');assert.equal(b.colors[0],4|1<<4);assert.equal(b.colors[1],14|14<<4);
});
test('Braille projection uses Unicode dot numbering rather than row-major bits',()=>{
  const data=new Uint8ClampedArray(2*4*4);for(let n=3;n<data.length;n+=4)data[n]=255;
  data[0]=data[1]=data[2]=255;data[24]=data[25]=data[26]=255;
  const b=new CellBuffer(1,1);projectPixels(b,{width:2,height:4,data},{mode:'braille'});
  assert.equal(b.glyphs[0],0x2841);assert.equal(b.colors[0],15);
  const mask=letterformMask(b.glyphs[0]);assert.equal(mask.reduce((a,b)=>a+b,0),8);
});
test('bad raster inputs are rejected before any buffer writes',()=>{
  const b=new CellBuffer(1,1),before=b.snapshot();assert.throws(()=>projectPixels(b,{width:2,height:3,data:new Uint8Array(24)}));assert.deepEqual(b.snapshot(),before);
});
test('chrome honors checked, disabled, submenu and literal data values',()=>{
  const b=new CellBuffer(20,3);paintChrome(b,{items:[{x:0,y:0,width:20,height:1,kind:'menu',text:'&Open',checked:true,selected:true,submenu:true},
    {x:0,y:1,width:20,height:1,kind:'field',text:'A&B',disabled:true},{x:0,y:2,width:20,height:1,kind:'separator'}]},'turbo');
  assert.equal(b.toText().split('\n')[0][0],'√');assert.equal(b.toText().split('\n')[0].at(-1),'►');assert.equal(b.toText().split('\n')[1].trim(),'A&B');assert.equal(b.colors[20]&15,8);
});
test('presentation portal registration is scoped, idempotent and respects native boundaries',()=>{
  const root={parentElement:null,hasAttribute:()=>false,nodeType:1},child={parentElement:root,hasAttribute:()=>false,nodeType:1};
  let added=0,removed=0;const unregister=registerPresentationRoot(root,()=>{added++;return()=>removed++;});
  const portal={},off=bindPresentationPortal(child,portal);assert.equal(added,1);off();off();assert.equal(removed,1);
  child.hasAttribute=()=>true;bindPresentationPortal(child,{});assert.equal(added,1);unregister();unregister();
});
test('presentation settings only transport supported modes; legacy settings stay valid',()=>{
  assert.equal(normalizeDOSSettings({graphics:'braille',editing:'cells'}).graphics,'braille');
  const v=normalizeDOSSettings({graphics:'<script>',editing:'__proto__'});assert.ok(!('graphics'in v));assert.ok(!('editing'in v));
});

// Optional adapter keys must not resolve Object.prototype as a capability.
test('adapter registry and palette selectors reject inherited object names',()=>{
  const registry=new TuiControlRegistry();
  for(const name of ['constructor','__proto__','toString'])assert.equal(registry.capability(name),'native');
  const buffer=new CellBuffer(5,1);paintChrome(buffer,{items:[]},'constructor');
  assert.equal(buffer.colors[0]>>4,7);
});
test('tab-start caret belongs to the first expanded cell',()=>{
  const layout=layoutText('\tX',{columns:16,rows:1,focused:true,selectionStart:0,selectionEnd:0});
  assert.deepEqual(layout.caret,{x:0,y:0});
});

test('every printable CP437 display character has an authored deterministic mask',()=>{
  for(const char of Array.from(CP437).slice(1))assert.equal(paintTuiGlyph({fillRect(){}},char.codePointAt(0),8,16),true,char);
});

test('text paint regions leave sibling rows and palette cells intact',()=>{
  const b=new CellBuffer(8,3);b.fill(0,0,8,3,'X',2,1);
  paintText(b,{text:'ab',cellEditing:true,selectionStart:1,selectionEnd:1},TUI_PROFILES.turbo,{x:2,y:1,width:3,height:1});
  assert.equal(b.toText(),'XXXXXXXX\nXXabXXXX\nXXXXXXXX');
  assert.throws(()=>paintText(b,{text:''},TUI_PROFILES.turbo,{x:-1}));
});


test('public atlas arguments fail before allocating, evicting or changing metrics',()=>{
  let allocated=0;const document={createElement(){allocated++;return {getContext:()=>({fillRect(){},fillText(){}})};}};
  const atlas=new TUI.CellGlyphAtlas(document,{maxGlyphs:1});
  const first=atlas.glyph(65,7,8,16,TUI.EGA),before={...atlas.metrics};
  for(const args of [[27,7,8,16,TUI.EGA],[65,256,8,16,TUI.EGA],[65,7,NaN,16,TUI.EGA],
    [65,7,8,-1,TUI.EGA],[65,7,8,16,[]],[65,7,8,16,Array(16).fill('invalid')]])
    assert.throws(()=>atlas.glyph(...args));
  assert.equal(allocated,1);assert.equal(first.width,8);assert.equal(atlas.cache.size,1);
  assert.deepEqual(atlas.metrics,before);atlas.clear();
});
test('surface dimension preflight rejects malformed projections before resizing',()=>{
  const canvas={width:300,height:150,ownerDocument:{},getContext:()=>({})};
  const renderer=new TUI.CanvasCellRenderer(canvas);
  for(const value of [null,{}, {columns:NaN,rows:1},{columns:1,rows:0},{columns:1.5,rows:2},{columns:2049,rows:1}])
    assert.throws(()=>renderer.dimensions(value));
  assert.equal(canvas.width,300);assert.equal(canvas.height,150);renderer.dispose();
});
test('disabled chrome takes precedence over focus and pressed selection',()=>{
  const b=new CellBuffer(8,2),profile=TUI_PROFILES.turbo;
  paintChrome(b,{items:[{x:0,y:0,width:8,height:1,kind:'button',text:'Off',disabled:true,selected:true,pressed:true},
    {x:0,y:1,width:8,height:1,kind:'button',text:'On',pressed:true}]});
  assert.equal(b.colors[0]&15,8);assert.equal(b.colors[0]>>4,profile.background);
  assert.equal(b.colors[8]>>4,profile.selection);
});
