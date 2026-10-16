import test from 'node:test';
import assert from 'node:assert/strict';
import {convertVbNetProject} from '../src/migration/index.js';
import {compileProject} from '../src/language/compiler.js';
import {VirtualMachine} from '../src/runtime/vm.js';
import {project} from './migration-fixtures.mjs';
import {DEFAULT_MEMBERS_FIXTURE,DEFAULT_MEMBERS_EXPECTED} from './migration-default-members-fixtures.mjs';
for(const codeStyle of ['native','compatibility'])test(codeStyle+': statically bound parameterless defaults and methods preserve reference contexts',()=>{
  const r=convertVbNetProject(DEFAULT_MEMBERS_FIXTURE,{codeStyle,platform:'AnyCPU'});
  assert.ok(r.success,JSON.stringify(r.diagnostics));
  const main=r.files['Application/Module1.vb'].replace(/\[([a-zA-Z_][a-zA-Z_0-9]*)\]/g,'$1');
  assert.match(main,/item\.\[?Value\]? = 7S/);
  assert.match(main,/callable\.Evaluate\(3S\)/);
  assert.match(main,/TypeOf item Is Counter/);
  assert.match(main,/\(item Is other\)/);
  assert.match(main,/Mutate\(other\)/);
  assert.match(main,/GetCounter\(item\)\.\[?Value\]?/);
  assert.doesNotMatch(r.files['Application/Counter.vb'],/Default Property/);
  assert.doesNotMatch(r.files['Application/CounterContract.vb'],/Default Property/);
});
test('source VM independently verifies implicit values, setters, methods, chains and identity',async()=>{
  const compiled=compileProject(DEFAULT_MEMBERS_FIXTURE);
  assert.deepEqual(compiled.diagnostics,[]);
  const output=[],vm=new VirtualMachine(compiled,{print:value=>output.push(value)});
  await vm.start();assert.deepEqual(output,DEFAULT_MEMBERS_EXPECTED);
});
function broken(body,member){const input=project('Sub Main()\nDim item As Item\nSet item=New Item\n'+body+'\nEnd Sub');input.modules.push({name:'Item',kind:'class',code:member+'\nAttribute Value.VB_UserMemId=0'});return convertVbNetProject(input);}
test('defaults requiring arguments remain blocking in implicit value contexts',()=>{
  const r=broken('Debug.Print item','Public Function Value(ByVal index As Long) As Long\nValue=index\nEnd Function');
  assert.equal(r.success,false);assert.ok(r.diagnostics.some(d=>d.code==='MIG_DEFAULT_ARGUMENT'));
});
test('recursive default types produce a bounded diagnostic, not recursive source generation',()=>{
  const r=broken('Debug.Print item','Public Property Get Value() As Item\nSet Value=Me\nEnd Property');
  assert.equal(r.success,false);assert.ok(r.diagnostics.some(d=>d.code==='MIG_DEFAULT_CYCLE'));
});
test('assignment through a scalar default function remains blocked',()=>{
  const r=broken('item=9','Public Function Value() As Long\nValue=1\nEnd Function');
  assert.equal(r.success,false);assert.ok(r.diagnostics.some(d=>d.code==='MIG_PROPERTY_ACCESSOR'));
});
