import test from 'node:test';
import assert from 'node:assert/strict';
import {CellBuffer,cellRect,mnemonic,normalizeDOSSettings,loadDOSSettings,TUI_PROFILES,CanvasCellRenderer} from '../src/tui/cells.js';
import {TuiControlRegistry,TUI_CONTROL_CAPABILITIES,paintControl} from '../src/tui/controls.js';

test('bounded settings reject prototype keys, corruption, invalid metrics and non-opt-in values',()=>{
  for(const value of [null,[],false,1,'dos',{}, {mode:'figma'},{profile:'__proto__',cellWidth:Infinity}])assert.equal(normalizeDOSSettings(value).mode,'classic');
  assert.deepEqual(normalizeDOSSettings({mode:'dos',profile:'commander',cellWidth:9,cellHeight:20}),{mode:'dos',profile:'commander',cellWidth:9,cellHeight:20});
  assert.equal(loadDOSSettings({getItem(){throw Error('denied');}}).mode,'classic');
  assert.equal(loadDOSSettings({getItem(){return '{invalid';}}).mode,'classic');
});
test('dense buffers validate integer coordinates and bounded allocations',()=>{
  for(const dimensions of [[0,2],[2,0],[NaN,3],[3.1,3],[2048,2048],[2,-3]])assert.throws(()=>new CellBuffer(...dimensions));
  const b=new CellBuffer(2,2);assert.throws(()=>b.put(.5,0,'x'));assert.throws(()=>b.put(0,0,'x',16));assert.throws(()=>b.popClip());
});
test('damage is exact, consumed, and unchanged writes are silent',()=>{
  const b=new CellBuffer(5,3);assert.equal(b.takeDamage().length,3);b.put(2,1,'X');assert.deepEqual(b.takeDamage(),[{y:1,x:2,width:1}]);b.put(2,1,'X');assert.deepEqual(b.takeDamage(),[]);
  b.put(1,0,'a').put(3,0,'b');assert.deepEqual(b.takeDamage(),[{y:0,x:1,width:3}]);
});
test('clip intersections never leak, including negative and disjoint rectangles',()=>{
  const b=new CellBuffer(5,3);b.pushClip(1,1,3,1).fill(-100,-100,200,200,'x');assert.equal(b.toText(),'     \n xxx \n     ');
  b.pushClip(30,30,20,20).fill(0,0,100,100,'Q').popClip().popClip();assert.equal(b.toText(),'     \n xxx \n     ');
});
test('integer quantization covers negative coordinates and fractional bounds',()=>{
  assert.deepEqual(cellRect({x:-1,y:1,width:10,height:16}),{x:-1,y:0,width:3,height:2});assert.throws(()=>cellRect({x:0,y:0,width:-1,height:1}));
});
test('mnemonics preserve literal ampersands and supplementary Unicode',()=>{
  assert.deepEqual(mnemonic('Save && E&xit &😀'),{text:'Save & Exit 😀',hotkeys:[8,12]});
  const b=new CellBuffer(5,1);b.text(0,0,'&A&&B',{mnemonics:true,hotkey:14});assert.equal(b.toText(),'A&B  ');assert.equal(b.colors[0]&15,14);
});
test('control codes cannot reach text or terminal snapshots',()=>{
  const b=new CellBuffer(5,1);b.text(0,0,'\x1b[31m');assert.equal(b.toText(),' [31m');b.put(0,0,0xd800);assert.equal(b.glyphs[0],32);
});
test('blit is clipped and overlapping self-blit uses a snapshot',()=>{
  const b=new CellBuffer(5,1);b.text(0,0,'abcde').blit(b,1,0);assert.equal(b.toText(),'aabcd');
});
test('frame degenerate sizes and clipped titles remain bounded',()=>{
  const b=new CellBuffer(10,3);b.frame(0,0,10,3,{double:true,title:'Hi'});assert.equal(b.toText(),'╔═Hi═════╗\n║        ║\n╚════════╝');assert.doesNotThrow(()=>b.frame(0,0,1,1));
});
test('snapshots are detached from live typed arrays',()=>{
  const b=new CellBuffer(2,2),copy=b.snapshot();copy.glyphs[0]=65;assert.equal(b.glyphs[0],32);
});
test('extension registry has scoped, idempotent disposal',()=>{
  const registry=new TuiControlRegistry();assert.equal(registry.capability('UntrustedOCX'),'native');const off=registry.register('Sample',b=>b.text(0,0,'yes'));assert.equal(registry.capability('Sample'),'cells');assert.throws(()=>registry.register('Sample',()=>{}));off();off();assert.equal(registry.capability('Sample'),'native');
});
for(const [profile]of Object.entries(TUI_PROFILES))for(const [type,capability]of Object.entries(TUI_CONTROL_CAPABILITIES))if(capability==='cells')test(`${profile}: ${type} bounded cell painting`,()=>{
  const b=new CellBuffer(16,4);paintControl(b,{type,name:type,caption:'&Test',text:'Hello',checked:true,min:0,max:100,value:25,rows:[{x:0,y:0,width:16,text:'Item',selected:true}]},profile);
  assert.equal(b.glyphs.length,64);assert.equal(b.colors.length,64);assert.ok(b.toText().trim());
});
test('CanvasCellRenderer rejects invalid metrics before acquiring a context',()=>{
  assert.throws(()=>new CanvasCellRenderer(null,{cellWidth:NaN}));assert.throws(()=>new CanvasCellRenderer(null,{cellHeight:0}));
});

test('data text never interprets ampersands as caption mnemonics',()=>{
  const b=new CellBuffer(12,2);paintControl(b,{type:'TextBox',text:'A&B && C'});assert.equal(b.toText().split('\n')[0].trim(),'A&B && C');
  paintControl(b,{type:'ListBox',rows:[{x:0,y:0,width:12,text:'A&B'}]});assert.equal(b.toText().split('\n')[0].trim(),'A&B');
});
test('retained composition exposes only final cell differences',()=>{
  const front=new CellBuffer(20,3),back=new CellBuffer(20,3),state={type:'CommandButton',caption:'&OK'};
  paintControl(back,state);front.blit(back,0,0);front.takeDamage();paintControl(back,state);front.blit(back,0,0);assert.deepEqual(front.takeDamage(),[]);
});
