import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeFileMachine} from './support/native-file-machine.mjs';
const code='Sub Main\nOpen "x" For Output As #1\nWrite #1,"x",1\nClose #1\nEnd Sub';
for(const optimization of [0,1,2])for(const texts of [[],[''],['a'],['a','b',''],['A\0B','Ω','😀'],Array.from({length:1000},(_,i)=>String(i))])test(`Write image sizes once and copies counted fields O${optimization} count=${texts.length}`,t=>{
 const f=nativeFileMachine(t,{optimization,code}),p=f.m.alloc(Math.max(4,texts.length*8)),expected=texts.join(',')+'\r\n';
 texts.forEach((s,i)=>f.m.write(p+i*8,f.m.string(s)));const before=f.vm.calls.length;
 const result=f.invoke('write-image',p,texts.length);assert.equal(f.m.bstr(result),expected);
 const calls=f.vm.calls.slice(before);assert.equal(calls.filter(c=>c.name==='iat:oleaut32.dll!SysAllocStringLen').length,1);
 assert.equal(calls.filter(c=>c.name==='iat:oleaut32.dll!SysStringLen').length,texts.length);
 assert.equal(calls.filter(c=>c.name==='iat:oleaut32.dll!VarBstrCat').length,0);
});
test('oversized Write images fail before allocation or copying, retaining input owners',t=>{
 const f=nativeFileMachine(t,{code}),p=f.m.alloc(16),text=f.m.string('x'.repeat(600000));f.m.write(p,text);f.m.write(p+8,text);const before=f.vm.calls.length;
 assert.throws(()=>f.invoke('write-image',p,2),e=>e.number===7);assert.equal(f.m.bstr(text).length,600000);
 assert.ok(!f.vm.calls.slice(before).some(c=>c.name==='iat:oleaut32.dll!SysAllocStringLen'));
});
