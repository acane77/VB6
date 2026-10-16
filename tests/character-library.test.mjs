import test from 'node:test';import assert from 'node:assert/strict';
import {characterLibrary} from '../src/runtime/character-library.js';
import {run,main,error} from './helpers/compiler-runtime.mjs';
const c=characterLibrary();
test('Windows-1252 characters round trip every byte including C1 range',()=>{
 for(let i=0;i<256;i++)assert.equal(c.Asc(c.Chr(i)),i);
 assert.equal(c.Chr(128),'€');assert.equal(c.Chr(147),'“');assert.equal(c.Asc('€'),'128'*1);
});
test('Unicode signed range, banker rounding and empty/type errors',()=>{
 assert.equal(c.ChrW(-1),'\uffff');assert.equal(c.AscW(c.ChrW(32768)),-32768);
 assert.equal(c.ChrW(64.5),'@');assert.equal(c.ChrW(65.5),'B');
 for(const n of [-32769,65536])error(()=>c.ChrW(n),5);
 for(const n of [-1,256])error(()=>c.Chr(n),5);
 error(()=>c.Asc(''),5);error(()=>c.Asc(null),94);error(()=>c.Asc('漢'),5);
});
test('String numeric code modulo 256 and Null propagation',()=>{
 assert.equal(c.String(2,384),'€€');assert.equal(c.String(3.5,'Alpha'),'AAAA');
 assert.equal(c.String(null,'x'),null);assert.equal(c.String(3,null),null);
 error(()=>c.String(1,''),5);error(()=>c.String(-1,'x'),5);error(()=>c.String(1,-1),5);
});
test('Proper case uses documented separators, not punctuation',()=>{
 assert.equal(c.StrConv("o'NEILL foo-BAR a.b  éCOLE\tONE\rTWO\nTHREE\0FOUR",3),"O'neill Foo-bar A.b  École\tOne\rTwo\nThree\0Four");
 assert.equal(c.StrConv('i I',1,1055),'İ I');assert.equal(c.StrConv('i I',2,1055),'i ı');
 assert.equal(c.StrConv(null,1),null);
 for(const mode of [-1,4,8,16,32,64,128,192])error(()=>c.StrConv('test',mode),5);
 error(()=>c.StrConv('x',1,99999),5);
});
test('Character intrinsics preserve String/Variant forms and named LCID',async()=>{
 assert.deepEqual((await run(main(`Dim v
v = String(2, 384)
Debug.Print v, Asc(v), ChrW(65.5), StrConv(lcid:=1055, conversion:=vbUpperCase, string:="i")
Debug.Print IsNull(String(2, Null)), IsNull(StrConv(Null, vbProperCase))
On Error Resume Next
v = String$(2, Null)
Debug.Print Err.Number`))).output,['€€ 128 B İ','True True','94']);
});
