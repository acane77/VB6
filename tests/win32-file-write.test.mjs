import test from 'node:test';
import assert from 'node:assert/strict';
import {newProject} from '../src/project/model.js';
import {compileWin32} from '../src/native/compiler.js';
import {NATIVE_WRITE_SOURCE} from '../src/native/file-write.js';
const project=source=>({...newProject('Write'),startup:'Sub Main',modules:[{id:'m',name:'M',kind:'module',code:source}]});
for(const optimization of [0,1,2])test(`Write # is standalone native code with fixed-locale OLE coercion at O${optimization}`,()=>{
 const p=project('Sub Main\nOpen "file.txt" For Output As #1\nWrite #1, "text", 1.5, True, Null, Empty, CDec("1.2"), #2024-06-07 08:09:10#, CVErr(42)\nClose #1\nEnd Sub');
 const before=JSON.stringify(p),a=compileWin32(p,{optimization}),b=compileWin32(p,{optimization});
 assert.deepEqual(a.bytes,b.bytes);assert.equal(JSON.stringify(p),before);
 assert.equal(a.report.target,'win32-aot');assert.equal(a.report.extraction,false);
 for(const symbol of ['VariantChangeTypeEx','WriteFile','CreateFileW'])assert.ok(a.report.imports.some(i=>i.symbol===symbol),symbol);
});
test('the Write kernel uses a fixed locale with NOUSEROVERRIDE and keeps numeric Decimal coercion in OLE',()=>{
 assert.match(NATIVE_WRITE_SOURCE,/VariantChangeTypeEx\(VarPtr\(converted\),VarPtr\(value\),1033,4,8\)/);
 assert.match(NATIVE_WRITE_SOURCE,/Case 2,3,4,5,6,14,17/);
 assert.doesNotMatch(NATIVE_WRITE_SOURCE,/CDbl\(value\).*VariantChangeTypeEx/);
});
test('ordinary Print does not add the Write-specific conversion kernel',()=>{
 const a=compileWin32(project('Sub Main\nOpen "file.txt" For Output As #1\nPrint #1, "text"\nClose #1\nEnd Sub'));
 assert.ok(!Buffer.from(a.bytes).includes(Buffer.from('#TRUE#','utf16le')));
});
