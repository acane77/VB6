import test from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {newProject} from '../src/project/model.js';
import {compileWin32} from '../src/native/compiler.js';
import {nativeControlFixtures} from '../tools/win32-control-fixtures.mjs';
const project=source=>({...newProject('Input'),startup:'Sub Main',modules:[{id:'m',name:'M',kind:'module',code:source}]});
const compile=body=>compileWin32(project('Sub Main\n'+body+'\nEnd Sub'));
for(const optimization of [0,1,2])for(const name of ['AotControlInputFiles','AotControlInputFileErrors'])test(`${name} is deterministic standalone native code at O${optimization}`,()=>{
 const {project:p,checks}=nativeControlFixtures().find(f=>f.project.name===name),before=JSON.stringify(p),a=compileWin32(p,{optimization});
 assert.deepEqual(a.bytes,compileWin32(p,{optimization}).bytes);assert.equal(JSON.stringify(p),before);assert.ok(checks.length>=16);
 assert.equal(a.report.target,'win32-aot');assert.equal(a.report.extraction,false);
 for(const symbol of ['ReadFile','GetFileSizeEx','SetFilePointerEx','MultiByteToWideChar','HeapFree'])assert.ok(a.report.imports.some(i=>i.symbol===symbol),symbol);
});
for(const statement of ['Open "x" For Input Access Write As #1','Dim n As Long\nLine Input #1,n','Dim a() As String\nLine Input #1,a','Dim s As String\ns=Input$(1)','Dim n As Long\nn=EOF(1,2)'])test('invalid input remains a compiler diagnostic: '+statement,()=>assert.throws(()=>compile(statement)));
test('authored functions shadow file intrinsics without linking a file table',()=>{
 const r=compileWin32(project('Function LOF(ByVal n As Long) As Long\nLOF=n+1\nEnd Function\nSub Main\nDim n As Long\nn=LOF(2)\nEnd Sub'));
 assert.ok(!r.report.imports.some(i=>i.symbol==='GetFileSizeEx'));
});

for(const optimization of [0,1,2])test(`documented sequential I/O example compiles at O${optimization}`,()=>{
 const doc=fs.readFileSync(new URL('../docs/WIN32-SEQUENTIAL-IO.md',import.meta.url),'utf8'),examples=[...doc.matchAll(/```vb\n([\s\S]*?)```/g)];
 assert.equal(examples.length,1);assert.equal(compileWin32(project(examples[0][1]),{optimization}).report.target,'win32-aot');
});
