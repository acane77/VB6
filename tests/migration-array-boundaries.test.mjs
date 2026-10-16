import test from 'node:test';
import assert from 'node:assert/strict';
import {convertVbNetProject} from '../src/migration/index.js';
import {compileProject} from '../src/language/compiler.js';
import {VirtualMachine} from '../src/runtime/vm.js';
import {ARRAY_BOUNDARIES_FIXTURE,ARRAY_BOUNDARIES_EXPECTED} from './migration-array-boundaries-fixtures.mjs';
for(const codeStyle of ['native','compatibility'])test(codeStyle+': multi-target arrays retain one resumable source boundary',()=>{
  const result=convertVbNetProject(ARRAY_BOUNDARIES_FIXTURE,{codeStyle,platform:'AnyCPU'});
  assert.ok(result.success,JSON.stringify(result.diagnostics));
  const source=result.files['Application/Module1.vb'];
  assert.match(source,/Private Sub __vbArrayStatement\d+\(ByRef __vbCell0 As VbArray\(Of Integer\)/);
  assert.match(source,/ByRef __vbCell\d+ As Integer/);
  assert.match(source,/__vbCell\d+\.Resize\([^\n]+Upper\]?\(__vbCell\d+\)/);
  assert.ok(result.sourceMap.some(m=>m.source==='Module1'));
});
test('source VM independently verifies partial effects and Resume retry',async()=>{
  const compiled=compileProject(ARRAY_BOUNDARIES_FIXTURE);
  assert.deepEqual(compiled.diagnostics,[]);
  const output=[],vm=new VirtualMachine(compiled,{print:s=>output.push(s)});
  await vm.start();
  assert.deepEqual(output,ARRAY_BOUNDARIES_EXPECTED);
});
