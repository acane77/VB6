import test from 'node:test';
import assert from 'node:assert/strict';
import {compileWin32} from '../src/native/compiler.js';
import {newProject} from '../src/project/model.js';
import {PE32Image} from '../src/native/pe32.js';
import {NativeX86Machine} from './support/native-x86-machine.mjs';
function machine(t,body,{optimization=1,declarations='',procedures=''}={}){
 let linked;const original=PE32Image.prototype.finish,mock=t.mock.method(PE32Image.prototype,'finish',function(...args){return linked=original.apply(this,args);});
 const code=`Option Explicit\n${declarations}\nSub Main()\nDim s As String\ns=Probe()\nEnd Sub\nFunction Probe() As String\n${body}\nEnd Function\nSub SetText(ByRef value As String,ByVal text As String)\nvalue=text\nEnd Sub\n${procedures}`;
 const p={...newProject('FixedCalls'),startup:'Sub Main',modules:[{id:'m',name:'M',kind:'module',code}]};
 const result=compileWin32(p,{optimization});mock.mock.restore();return {vm:new NativeX86Machine(linked),result,p};
}
for(const optimization of [0,1,2])for(const [value,expected]of [['','     '],['a','a    '],['123456789','12345'],['A\0Ω😀','A\0Ω😀']])test(`fixed String project references copy counted UTF16 O${optimization} ${JSON.stringify(value)}`,t=>{
 const literal=value.includes('\0')?'"A" & ChrW$(0) & ChrW$(937) & ChrW$(-10179) & ChrW$(-8704)':JSON.stringify(value);
 const {vm}=machine(t,`Dim value As String * 5\nSetText value,${literal}\nProbe=value`,{optimization});const baseline=vm.memory.regions.length;
 for(let i=0;i<10;i++){const result=vm.invoke('proc:M:Probe');assert.equal(vm.memory.bstr(result),expected);vm.memory.free(result-4);assert.equal(vm.memory.regions.length,baseline,'all bridge, local and intermediate String owners released');}
});
for(const optimization of [0,1,2])test(`inline fixed record fields copy back without touching adjacent scalar fields O${optimization}`,t=>{
 const {vm}=machine(t,'Dim row As ROW\nrow.before=123\nrow.after=456\nSetText row.text,"abcdefgh"\nProbe=ChrW$(row.before) & row.text & ChrW$(row.after)',{optimization,declarations:'Private Type ROW\n before As Long\n text As String * 5\n after As Long\nEnd Type'});
 const result=vm.invoke('proc:M:Probe');assert.equal(vm.memory.bstr(result),String.fromCharCode(123)+'abcde'+String.fromCharCode(456));vm.memory.free(result-4);
});
for(const optimization of [0,1,2])test(`project String returns survive fixed copy-back and bridge cleanup O${optimization}`,t=>{
 const {vm}=machine(t,'Dim value As String * 5\nProbe=Result(value) & value',{optimization,procedures:'Function Result(ByRef value As String) As String\nvalue="abcdefgh"\nResult="returned:"\nEnd Function'});
 const baseline=vm.memory.regions.length,result=vm.invoke('proc:M:Probe');assert.equal(vm.memory.bstr(result),'returned:abcde');vm.memory.free(result-4);assert.equal(vm.memory.regions.length,baseline);
});
for(const optimization of [0,1,2])test(`parenthesized fixed String is isolated and named references preserve source snapshots O${optimization}`,t=>{
 const {vm}=machine(t,'Dim value As String * 5\nvalue="start"\nSetText (value),"other"\nProbe=value\nSetText text:="tail",value:=value\nProbe=Probe & value',{optimization});
 const result=vm.invoke('proc:M:Probe');assert.equal(vm.memory.bstr(result),'starttail ');vm.memory.free(result-4);
});

for(const optimization of [0,1,2])test(`real emitted error frames discard fixed bridges and free all owners O${optimization}`,t=>{
 const {vm}=machine(t,'Dim value As String * 5\nvalue="start"\nOn Error Resume Next\nFail value\nProbe=value & ChrW$(Err.Number)\nErr.Clear',{optimization,procedures:'Sub Fail(ByRef value As String)\nvalue="changed"\nError 5\nEnd Sub'});
 vm.hooks.delete(vm.labels.get('native:error:raise'));const baseline=vm.memory.regions.length;
 for(let i=0;i<50;i++){const result=vm.invoke('proc:M:Probe');assert.equal(vm.memory.bstr(result),'start'+String.fromCharCode(5));vm.memory.free(result-4);assert.equal(vm.memory.regions.length,baseline);}
});
for(const optimization of [0,1,2])test(`a later failing argument cannot enter the callee or publish fixed copy-back O${optimization}`,t=>{
 const {vm}=machine(t,'Dim value As String * 5\nvalue="start"\nOn Error Resume Next\nSetText value,Fail()\nProbe=value & ChrW$(Err.Number)\nErr.Clear',{optimization,procedures:'Function Fail() As String\nError 5\nEnd Function'});
 vm.hooks.delete(vm.labels.get('native:error:raise'));const baseline=vm.memory.regions.length,result=vm.invoke('proc:M:Probe');assert.equal(vm.memory.bstr(result),'start'+String.fromCharCode(5));vm.memory.free(result-4);assert.equal(vm.memory.regions.length,baseline);
});
function variantStringApis(vm){
 const m=vm.memory,zero=p=>{for(let i=0;i<16;i+=4)m.write(p+i,0);};
 const read=p=>{let tag=m.read(p,16),at=p+8;if(tag&0x4000){at=m.read(p+8);tag&=~0x4000;}assert.ok([0,2,3,8].includes(tag),'explicit Variant test subtype');return {tag,bits:tag===2?(m.read(at,16)<<16)>>16:tag?m.read(at):0};};
 vm.hook('oleaut32.dll','VariantClear',1,([p])=>{if(m.read(p,16)===8&&m.read(p+8))m.free(m.read(p+8)-4);zero(p);return 0;});
 vm.hook('oleaut32.dll','VariantCopyInd',2,([out,source])=>{const {tag,bits}=read(source);zero(out);m.write(out,tag,16);m.write(out+8,tag===8?m.string(m.bstr(bits)):bits);return 0;});
 vm.hook('oleaut32.dll','VariantChangeTypeEx',5,([out,source,locale,flags,target])=>{assert.equal(locale,0x400);assert.equal(flags,2);assert.equal(target,8);const {tag,bits}=read(source);zero(out);m.write(out,8,16);m.write(out+8,m.string(tag===8?m.bstr(bits):tag===0?'':String(bits|0)));return 0;});
}
for(const optimization of [0,1,2])for(const inline of [false,true])test(`fixed String ByRef Variant keeps typed String coercion and copy-back O${optimization} inline=${inline}`,t=>{
 const declarations=inline?'Private Type ROW\n text As String * 5\nEnd Type':'',decl=inline?'Dim row As ROW':'Dim value As String * 5',target=inline?'row.text':'value';
 const {vm}=machine(t,`${decl}\nSetVariant ${target}\nProbe=${target}`,{optimization,declarations,procedures:'Sub SetVariant(ByRef value As Variant)\nvalue=123\nEnd Sub'});
 variantStringApis(vm);const baseline=vm.memory.regions.length,result=vm.invoke('proc:M:Probe');assert.equal(vm.memory.bstr(result),'123  ');vm.memory.free(result-4);assert.equal(vm.memory.regions.length,baseline);
});
for(const optimization of [0,1,2])test(`Windows call fixtures retain fixed-reference assertions in deterministic O${optimization} code`,async()=>{
 const {callFixture}=await import('../tools/win32-call-fixtures.mjs');const {project,checks}=callFixture(),before=JSON.stringify(project),a=compileWin32(project,{optimization});
 assert.equal(checks.length,77);assert.deepEqual(a.bytes,compileWin32(project,{optimization}).bytes);assert.equal(JSON.stringify(project),before);
 for(const word of ['fixed String','inline fixed','ByRef Variant','propagated callee error'])assert.ok(checks.some(c=>c.includes(word)),word);
});
test('Windows call driver requires both fixture families at every optimization level',async()=>{
 const fs=await import('node:fs');const ps=fs.readFileSync(new URL('../tools/test-win32-calls.ps1',import.meta.url),'utf8');
 assert.match(ps,/foreach \(\$family in @\('AotCalls','AotCallProperties'\)\)/);assert.match(ps,/foreach \(\$level in 0\.\.2\)/);assert.match(ps,/Executable differs from its build manifest/);assert.match(ps,/if \(\$process.ExitCode -ne 0\)/);
});

test('whole fixed String record arrays cannot masquerade as one scalar Variant reference',t=>{
 assert.throws(()=>machine(t,'Dim row As ROW\nSetVariant row.text\nProbe=""',{declarations:'Private Type ROW\n text(0 To 2) As String * 5\nEnd Type',procedures:'Sub SetVariant(ByRef value As Variant)\nvalue="changed"\nEnd Sub'}),/Unsupported native ByRef Variant referent/);
});
