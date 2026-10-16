import test from 'node:test';
import assert from 'node:assert/strict';
import {compileCompute} from '../src/compute/index.js';
import {validateArtifact} from '../packages/vb6-compute/src/runtime.js';
import {ARRAY_VALUE_CASES} from './compute-array-values-cases.js';
for(const c of ARRAY_VALUE_CASES)test('array values lowering: '+c.name,()=>{
  const artifact=compileCompute(c.source,c.options);validateArtifact(artifact);
  assert.doesNotMatch(artifact.wgsl,/\b(?:target|meta|active)\b/);
});
for(const [name,source,code] of [
  ['mismatched element types','Public a() As Long\nPublic b() As Integer\nSub Main()\na=b\nEnd Sub','GPU_TYPE'],
  ['fixed destination','Public a(3) As Long\nPublic b() As Long\nSub Main()\na=b\nEnd Sub','GPU_FIXED_ARRAY'],
  ['array returned to scalar','Public a As Long\nSub Main()\na=Make()\nEnd Sub\nFunction Make() As Long()\nEnd Function','GPU_TYPE'],
  ['scalar returned to array','Public a() As Long\nSub Main()\na=Make()\nEnd Sub\nFunction Make() As Long\nEnd Function','GPU_TYPE'],
  ['mismatched ByRef array return','Sub Main()\nConsume Make()\nEnd Sub\nFunction Make() As Long()\nEnd Function\nSub Consume(ByRef a() As Integer)\nEnd Sub','GPU_ARGUMENT']
])test('array value diagnostic: '+name,()=>assert.throws(()=>compileCompute(source),e=>e.code===code));
test('array helpers are emitted only when array value operations are used',()=>{
  assert.doesNotMatch(compileCompute('Sub Main()\nEnd Sub').wgsl,/fn array_copy_value/);
  assert.match(compileCompute(ARRAY_VALUE_CASES[0].source,ARRAY_VALUE_CASES[0].options).wgsl,/fn array_copy_value/);
});
test('returned array snapshots are bounded and independently owned',()=>{
  const c=ARRAY_VALUE_CASES.find(c=>c.name.startsWith('sequential'));
  const a=compileCompute(c.source,c.options);
  assert.equal(a.sources.filter(p=>p.procedure==='Make').length,1);
  assert.ok([...a.wgsl.matchAll(/array_copy_value\(/g)].length>=4);
  assert.throws(()=>compileCompute(c.source,{...c.options,maxStateWords:16}),e=>e.code==='GPU_LIMIT');
});
