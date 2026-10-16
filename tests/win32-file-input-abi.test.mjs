import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeFileMachine} from './support/native-file-machine.mjs';
const bytes=text=>new TextEncoder().encode(text),error=number=>e=>e.number===number;
for(const optimization of [0,1,2])test(`buffered native byte helpers preserve logical position and own one bounded buffer O${optimization}`,t=>{
 const f=nativeFileMachine(t,{optimization});f.add('x',bytes('abcdefghij'));const e=f.open('x',1,3,4);
 assert.equal(f.invoke('length',e),10);assert.equal(f.invoke('attr',e,1),1);assert.equal(f.invoke('eof',e),0);
 assert.equal(f.invoke('tell',e),0);assert.equal(f.invoke('seek-position',e),1);
 for(const expected of bytes('abcdef'))assert.equal(f.invoke('read-byte',e),expected);
 assert.equal(f.invoke('tell',e),6);assert.equal(f.invoke('peek',e),103);assert.equal(f.invoke('tell',e),6);
 assert.equal(f.vm.calls.filter(c=>c.name==='iat:kernel32.dll!ReadFile').length,2);
 f.invoke('seek-to',e,f.generation(e),2);assert.equal(f.invoke('read-byte',e),98);
 assert.equal(f.m.read(e+52),4);const p=f.m.read(e+32);assert.equal(f.m.region(p).bytes.length,4);
 f.invoke('close',1);assert.equal(f.handles.size,0);assert.equal(f.m.read(e+32),0);assert.throws(()=>f.m.region(p),/unmapped/);
});
for(const capacity of [1,2,3,128,512,32767])test(`ReadText counts UTF16 units, preserves punctuation/NUL and decodes split UTF8 with buffer ${capacity}`,t=>{
 const f=nativeFileMachine(t,{encoding:'utf-8'}),expected='A\0,\r\nΩ中😀B';f.add('x',bytes(expected));const e=f.open('x',1,3,capacity);
 let got='';for(let i=0;i<expected.length;i++)got+=f.text(e,1);
 assert.equal(got,expected);assert.equal(f.invoke('eof',e),0xffffffff);assert.equal(f.invoke('tell',e),bytes(expected).length);
});
for(const [encoding,data,expected]of [['windows-1252',[0x80,0xe9],'€é'],['shift_jis',[0x82,0xa0,0x82,0xa2],'あい']])test(`ReadText follows explicit ${encoding} foreign codec ABI across single-byte fills`,t=>{
 const f=nativeFileMachine(t,{encoding});f.add('x',data);const e=f.open('x',1,3,1);assert.equal(f.text(e,expected.length),expected);
});
for(const capacity of [1,2,7,512])test(`Line Input terminates CR/CRLF but retains isolated LF, quotes and NUL, buffer ${capacity}`,t=>{
 const f=nativeFileMachine(t);f.add('x',bytes('\r\nA\nB\0,"C"\rLAST'));const e=f.open('x',1,3,capacity);
 assert.equal(f.line(e),'');assert.equal(f.line(e),'A\nB\0,"C"');assert.equal(f.line(e),'LAST');assert.equal(f.invoke('eof',e),0xffffffff);
});
test('Line Input grows geometrically without overwriting counted UTF16 storage',t=>{
 const f=nativeFileMachine(t),expected='x'.repeat(1100);f.add('x',bytes(expected+'\r\n'));const e=f.open('x',1,3,73);assert.equal(f.line(e),expected);
});
test('ReadText zero count does not consume or allocate a stream buffer',t=>{
 const f=nativeFileMachine(t);f.add('x',[]);const e=f.open('x');assert.equal(f.text(e,0),'');assert.equal(f.m.read(e+32),0);assert.equal(f.invoke('tell',e),0);
});
test('input Open is read-only OPEN_EXISTING, never creates missing files or truncates existing bytes',t=>{
 const f=nativeFileMachine(t);assert.throws(()=>f.open('missing'),error(53));assert.equal(f.files.size,0);
 f.add('x',bytes('keep'));f.open('x');assert.deepEqual([...f.files.get('x').bytes],[...bytes('keep')]);
 assert.ok(!f.vm.calls.some(c=>c.name==='iat:kernel32.dll!SetEndOfFile'));
});
test('append starts with real end position and reports mode while output EOF is true',t=>{
 const f=nativeFileMachine(t);f.add('x',bytes('abc'));const e=f.open('x',1,2);assert.equal(f.invoke('seek-position',e),4);assert.equal(f.invoke('attr',e,1),8);assert.equal(f.invoke('eof',e),0xffffffff);
});
for(const size of [2147483648n,4294967296n])test('LOF and position reject oversized Win32 values '+size,t=>{
 const f=nativeFileMachine(t);const file=f.add('x',[]);file.size=size;const e=f.open('x');assert.throws(()=>f.invoke('length',e),error(6));
 f.handles.get(f.m.read(e)).position=size;assert.throws(()=>f.invoke('tell',e),error(6));
});
test('Seek invalidates decoder carry as well as unread bytes',t=>{
 const f=nativeFileMachine(t,{encoding:'utf-8'});f.add('x',bytes('😀Z'));const e=f.open('x',1,3,2);assert.equal(f.text(e,1),'\ud83d');assert.notEqual(f.m.read(e+44),0);
 assert.equal(f.invoke('eof',e),0);f.invoke('seek-to',e,f.generation(e),5);assert.equal(f.m.read(e+44),0);assert.equal(f.text(e,1),'Z');
});
test('stream failures retain slot-owned buffers for Close and stale generation fails before seeking',t=>{
 const f=nativeFileMachine(t);f.add('x',bytes('abc'));const e=f.open('x'),gen=f.generation(e);f.failures.set('read',5);
 assert.throws(()=>f.invoke('peek',e),error(70));const buffer=f.m.read(e+32);assert.ok(buffer);f.invoke('close',1);assert.throws(()=>f.m.region(buffer),/unmapped/);
 f.open('x');const count=f.vm.calls.length;assert.throws(()=>f.invoke('seek-to',e,gen,1),error(52));assert.ok(!f.vm.calls.slice(count).some(c=>c.name==='iat:kernel32.dll!SetFilePointerEx'));
});
test('partial ReadFile completions are consumed before refilling, never treated as EOF',t=>{
 const f=nativeFileMachine(t);f.add('x',bytes('abcdef'));f.failures.set('partial',2);const e=f.open('x',1,3,8);assert.equal(f.text(e,6),'abcdef');assert.equal(f.invoke('tell',e),6);assert.equal(f.vm.calls.filter(c=>c.name==='iat:kernel32.dll!ReadFile').length,3);
});
test('Loc uses logical position rather than read-ahead position',t=>{
 const f=nativeFileMachine(t);f.add('x',bytes('x'.repeat(1024)));const e=f.open('x');f.text(e,127);assert.equal(f.invoke('loc',e),0);f.text(e,1);assert.equal(f.invoke('loc',e),1);
});
