import test from 'node:test';
import assert from 'node:assert/strict';
import {convertVbNetProject} from '../src/migration/index.js';
import {compileProject} from '../src/language/compiler.js';
import {VirtualMachine} from '../src/runtime/vm.js';
import {ARRAY_RETURNS_FIXTURE,ARRAY_RETURNS_EXPECTED} from './migration-array-returns-fixtures.mjs';

for(const codeStyle of ['native','compatibility'])test(codeStyle+': typed array results retain storage, public ABI and forwarding types',()=>{
  const r=convertVbNetProject(ARRAY_RETURNS_FIXTURE,{codeStyle,platform:'AnyCPU'});
  assert.ok(r.success,JSON.stringify(r.diagnostics));
  const source=r.files['Application/Module1.vb'];
  assert.match(source,/Function \[?Make\]?\([^\n]+As VbArray\(Of Integer\)/);
  assert.match(source,/Dim __vbResult As VbArray\(Of Integer\) = New VbArray\(Of Integer\)\(\)/);
  assert.match(source,/__vbResult.Resize\(VbArrayBounds.FromPairs\(CInt\(4S\), CInt\(5S\)\), False\)/);
  assert.match(source,/Private Function __vbCallOrder\d+\([^\n]+As VbArray\(Of Integer\)/);
  assert.match(source,/Dim __vbRecord\d+ As (?:Entry|\[Entry\]) = __vbArray\d+\(__vbIndex\d+\)/);
  assert.match(source,/(?:__vbRecord\d+|\[__vbRecord\d+\])\.(?:Name|\[Name\]) = "owned"[\s\S]+__vbArray\d+\(__vbIndex\d+\) = __vbRecord\d+/);
  assert.match(source,/Function \[?OptionalValues\]?\(\) As VbArray\(Of Integer\)/);
  assert.match(r.files['Application/ArrayContract.vb'],/ReadOnly Property \[?Values\]? As VbArray\(Of Integer\)/);
  assert.match(r.files['Application/ArrayImplementation.vb'],/As VbArray\(Of Integer\) Implements \[?IArrayContract\]?\.\[?Values\]?/);
  assert.ok(r.report.runtime.features.includes('VbArray'));
  assert.equal(r.report.validation.dotnetBuild,'not-run');
});

test('typed array support remains explicit under runtime none',()=>{
  const r=convertVbNetProject(ARRAY_RETURNS_FIXTURE,{runtime:'none',platform:'AnyCPU'});
  assert.equal(r.success,false);
  assert.ok(r.diagnostics.some(d=>d.code==='MIG_RUNTIME_REQUIRED'&&d.feature==='VbArray'));
  assert.match(r.files['Directory.Build.targets'],/RequireResolvedMigration/);
});

test('source VM independently exercises array returns, rank, copying, recursion and interfaces',async()=>{
  const compiled=compileProject(ARRAY_RETURNS_FIXTURE);
  assert.deepEqual(compiled.diagnostics,[]);
  const output=[],vm=new VirtualMachine(compiled,{print:s=>output.push(s)});
  await vm.start();
  assert.deepEqual(output,ARRAY_RETURNS_EXPECTED);
});
