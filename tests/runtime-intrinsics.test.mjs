import test from 'node:test';
import assert from 'node:assert/strict';
import {randomLibrary} from '../src/runtime/random.js';
import {numberFormatLibrary} from '../src/runtime/number-format.js';
import {settingsLibrary} from '../src/runtime/settings-library.js';
import {VBCurrency,VBDecimal} from '../src/runtime/values.js';
import {run,main,pause,finish,error} from './helpers/compiler-runtime.mjs';

const initial=[0.7055475115776062,0.5334240198135376,0.5795186161994934,0.289562463760376,0.30194801092147827];
test('VB Rnd default state and published 24-bit sequence',()=>{
  const r=randomLibrary();assert.equal(r.Rnd(0),0.01953125);
  for(const value of initial){assert.equal(r.Rnd(),value);assert.equal(r.Rnd(0),value);}
});
test('Rnd negative Single seed and independent VM state',()=>{
  const r=randomLibrary(),other=randomLibrary();
  assert.equal(r.Rnd(-1),0.2240070104598999);r.Rnd();assert.equal(r.Rnd(-1),0.2240070104598999);
  assert.equal(other.Rnd(),initial[0]);assert.equal(r.Rnd(-1.00000001),r.Rnd(-1));
});
test('Rnd multiplier agrees with exact integer arithmetic for 10000 steps',()=>{
  const r=randomLibrary();let state=0x50000n;
  for(let i=0;i<10000;i++){state=(state*0x43fd43fdn+0xc39ec3n)&0xffffffn;assert.equal(r.Rnd(),Number(state)/16777216);}
});
test('Randomize merges Double bits and preserves low seed byte',()=>{
  const r=randomLibrary();r.Rnd(-1);r.Randomize(42);
  assert.equal(r.Rnd(0),0.2510608434677124);assert.equal(r.Rnd(),0.907809317111969);
  r.Rnd(-1);r.Randomize(42);assert.equal(r.Rnd(),0.907809317111969);
  r.Randomize(42);assert.notEqual(r.Rnd(),0.907809317111969);
});
test('Randomize without argument uses Single timer seconds and leaves Rnd(0) observable',()=>{
  const r=randomLibrary(()=>new Date(2000,0,1,0,0,0,0));r.Randomize();assert.equal(r.Rnd(0),0);assert.equal(r.Rnd(),0xc39ec3/16777216);
});
test('Invalid random parameters do not change the generator',()=>{
  const r=randomLibrary();error(()=>r.Rnd(null),94);error(()=>r.Rnd(1e39),6);error(()=>r.Randomize('not a number'),13);assert.equal(r.Rnd(),initial[0]);
});

const f=numberFormatLibrary();
for(const [name,args,expected] of [
 ['FormatNumber',[1234.5],'1,234.50'],['FormatNumber',[1234.5,-1,-2,-2,0],'1234.50'],
 ['FormatNumber',[-.125,2,0,-1],'(.13)'],['FormatNumber',[-.125,2,0,0],'-.13'],
 ['FormatNumber',[.999,2,0],'1.00'],['FormatNumber',[0,0,0],'0'],
 ['FormatCurrency',[-1234.5],'($1,234.50)'],['FormatCurrency',[-1234.5,1,-2,0,0],'-$1234.5'],
 ['FormatCurrency',[.125,2,0],'$.13'],['FormatPercent',[12.5,1],'1,250.0%'],
 ['FormatPercent',[-.00125,2,0,-1],'(.13%)'],['FormatNumber',[2.25,1],'2.3'],
 ['FormatNumber',[new VBCurrency('922337203685477.5807'),4],'922,337,203,685,477.5807'],
 ['FormatNumber',[new VBDecimal('79228162514264337593543950335'),0,0,0,0],'79228162514264337593543950335'],
])test(name+' '+args.map(String).join(', '),()=>assert.equal(f[name](...args),expected));
for(const args of [[1,-2],[1,100],[1,2,1],[1,2,-2,2],[1,2,-2,-2,-3]])test('Formatting rejects invalid options '+args,()=>error(()=>f.FormatNumber(...args),5));
test('Formatting maps null, type and overflow errors to VB errors',()=>{
  error(()=>f.FormatCurrency(null),94);error(()=>f.FormatNumber('abc'),13);error(()=>f.FormatPercent(Infinity),6);
});
test('Explicit host regional defaults and localized leading digit',()=>{
  const de=numberFormatLibrary({locale:'de-DE',currency:'EUR',numberDigits:3});assert.equal(de.FormatNumber(1234.5),'1.234,500');assert.equal(de.FormatCurrency(2),'2,00\u00a0€');
  const arabic=numberFormatLibrary({locale:'ar-EG'});assert.ok(arabic.FormatNumber(12.5,2,0).includes('١٢'));assert.ok(!arabic.FormatNumber(.5,2,0).startsWith('٠'));
});
test('Formatting works through named, omitted and typed arguments in source',async()=>{
  assert.deepEqual((await run(main(`Debug.Print FormatNumber(expression:=1234.5, groupdigits:=vbFalse), FormatCurrency(-.5, , vbFalse, vbTrue)
Debug.Print FormatPercent(.0125, 1, , , vbFalse), TypeName(Rnd())
Debug.Print FormatNumber(CCur("922337203685477.5807"), 4)`))).output,['1234.50 ($.50)','1.3% Single','922,337,203,685,477.5807']);
});
for(const style of [-1,5])test('FormatDateTime rejects invalid named format '+style,async()=>{
 assert.deepEqual((await run(main(`On Error Resume Next\nDim x\nx = FormatDateTime(Now, ${style})\nDebug.Print Err.Number`))).output,['5']);
});

test('Settings enumeration is zero-based typed 2D and case insensitive',()=>{
 const vm={settings:{},host:{}};const s=settingsLibrary(vm);s.SaveSetting('App','Window','Left',12);s.SaveSetting('app','WINDOW','left',34);s.SaveSetting('APP','Window','Top',56);
 assert.equal(s.GetSetting('aPP','window','LEFT'), '34');const all=s.GetAllSettings('APP','window');assert.equal(all.type,'String');assert.deepEqual(all.bounds,[[0,1],[0,1]]);assert.equal(all.get(0,0),'Left');assert.equal(all.get(0,1),'34');
 all.set([0,1],'changed');assert.equal(s.GetSetting('App','Window','Left'),'34');
});
test('Settings snapshots retain legacy literal percent names and separate slash components',()=>{
 const vm={settings:{'old/s/%2F':'legacy'},host:{}};const s=settingsLibrary(vm);
 assert.equal(s.GetSetting('old','s','%2F'),'legacy');s.SaveSetting('a/b','c','d','first');s.SaveSetting('a','b/c','d','second');
 const restored=settingsLibrary({settings:JSON.parse(JSON.stringify(vm.settings)),host:{}});
 assert.equal(restored.GetSetting('a/b','c','d'),'first');assert.equal(restored.GetSetting('a','b/c','d'),'second');
});
test('Settings missing sections, deletion errors, prototype safety and persistence',()=>{
 let persisted=0;const vm={settings:Object.create({'inherited/s/k':'secret'}),host:{persist(){persisted++;}}},s=settingsLibrary(vm);
 assert.equal(s.GetAllSettings('none','none'),undefined);assert.equal(s.GetSetting('inherited','s','k','default'),'default');
 error(()=>s.DeleteSetting('none','none'),5);error(()=>s.SaveSetting('a','','k','v'),5);error(()=>s.SaveSetting('a','s','k',null),94);assert.equal(persisted,0);
 s.SaveSetting('__proto__','constructor','prototype','safe');s.DeleteSetting('__proto__','CONSTRUCTOR','PROTOTYPE');assert.equal(persisted,2);assert.equal(s.GetAllSettings('__proto__','constructor'),undefined);
});
test('Settings compile, enumerate and delete without losing string subtype',async()=>{
 assert.deepEqual((await run(`Option Base 1
Sub Main()
Dim values
SaveSetting "App", "S", "A", 1
SaveSetting "app", "s", "B", 2
values = GetAllSettings(section:="S", appname:="APP")
Debug.Print TypeName(values), LBound(values, 1), LBound(values, 2), values(1, 0), values(1, 1)
DeleteSetting "aPP", "s"
Debug.Print IsEmpty(GetAllSettings("App", "S"))
End Sub`)).output,['String() 0 0 B 2','True']);
});
test('Automatic debugger formatting uses full signature without running user code',async()=>{
 const p=await pause(main('Debug.Print "done"'),3);
 try{assert.equal(p.vm.debugInspector.evaluate('FormatNumber(1234.5, 2, vbUseDefault, vbUseDefault, vbFalse)'),'1234.50');}finally{await finish(p);}
});
