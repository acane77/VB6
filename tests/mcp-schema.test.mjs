import test from 'node:test';
import assert from 'node:assert/strict';
import {validateArguments, McpError} from '../src/mcp/protocol.js';
import {validateSchemaValue} from '../src/mcp/schema.js';
import {formatToolResult} from '../src/mcp/tool-result.js';

const cases = [
  ['boolean true', true, [null, 42, {}, []], []],
  ['boolean false', false, [], [null, 42, {}, []]],
  ['nullable union', {type:['string','null']}, ['x',null], [1,false]],
  ['object equality', {enum:[{x:1,y:[2]}]}, [{y:[2],x:1}], [{x:1,y:[3]}]],
  ['const objects', {const:{a:[1,2]}}, [{a:[1,2]}], [{a:[2,1]}]],
  ['exclusive bounds', {type:'number',exclusiveMinimum:0,exclusiveMaximum:2}, [1,1.99], [0,2]],
  ['exact decimal multiple', {type:'number',multipleOf:0.1}, [0,0.3,-0.3,1e-1], [0.31,0.30000000000000004]],
  ['subnormal multiple', {multipleOf:5e-324}, [5e-324,1e-323], []],
  ['Unicode code points', {type:'string',minLength:2,maxLength:2}, ['a🙂','🙂🙂'], ['🙂','abc']],
  ['anchored pattern', {pattern:'^[A-Z][a-z]+$'}, ['Hello'], ['hello','Hello!']],
  ['allOf bounds', {allOf:[{type:'integer',minimum:1},{maximum:3}]}, [1,2,3], [0,4,1.5]],
  ['anyOf types', {anyOf:[{type:'string'},{const:42}]}, ['x',42], [0,null]],
  ['oneOf exclusivity', {oneOf:[{type:'number'},{type:'integer'}]}, [1.5], [1,'x']],
  ['not', {not:{type:'string'}}, [null,{}], ['x']],
  ['conditional', {if:{type:'string'},then:{minLength:2},else:{const:42}}, ['ok',42], ['x',0]],
  ['required properties', {required:['name'],properties:{name:{type:'string'}},additionalProperties:false}, [{name:'x'}], [{},{name:2},{name:'x',extra:1}]],
  ['pattern properties', {patternProperties:{'^x':{type:'number'}},additionalProperties:{type:'boolean'}}, [{x1:1,other:true}], [{x1:false},{other:1}]],
  ['property names', {propertyNames:{pattern:'^[a-z]+$'}}, [{abc:1}], [{'A':1}]],
  ['property count', {minProperties:1,maxProperties:2}, [{a:1},{a:1,b:2}], [{},{a:1,b:2,c:3}]],
  ['dependencies', {dependentRequired:{card:['billing']}}, [{},{card:1,billing:'x'}], [{card:1}]],
  ['dependent schema', {dependentSchemas:{name:{required:['id']}}}, [{id:1},{name:'x',id:1}], [{name:'x'}]],
  ['unevaluated allOf', {allOf:[{properties:{a:true}},{properties:{b:true}}],unevaluatedProperties:false}, [{a:1,b:2}], [{a:1,c:2}]],
  ['unevaluated anyOf annotations', {anyOf:[{properties:{a:{const:1}},required:['a']},{properties:{b:{const:2}},required:['b']}],unevaluatedProperties:false}, [{a:1},{b:2},{a:1,b:2}], [{a:1,b:3}]],
  ['conditional annotations', {if:{properties:{type:{const:'a'}},required:['type']},then:{properties:{a:true}},else:{properties:{b:true}},unevaluatedProperties:false}, [{type:'a',a:1},{b:1}], [{type:'a',b:1}]],
  ['array length', {type:'array',minItems:1,maxItems:2}, [[1],[1,2]], [[],[1,2,3]]],
  ['deep unique', {uniqueItems:true}, [[{a:1},{a:2}]], [[{a:1,b:2},{b:2,a:1}]]],
  ['prefix tuple', {prefixItems:[{type:'string'},{type:'integer'}],items:false}, [[],['x'],['x',1]], [[1],['x',1,2]]],
  ['legacy tuple', {items:[{type:'string'}],additionalItems:{type:'number'}}, [['x'],['x',2,3]], [[0],['x',false]]],
  ['contains', {contains:{type:'integer'},minContains:2,maxContains:3}, [[1,2,'x'],[1,2,3]], [[1,'x'],[1,2,3,4]]],
  ['contains zero', {contains:{const:1},minContains:0,maxContains:0}, [[],[2]], [[1]]],
  ['unevaluated items', {allOf:[{prefixItems:[true]}],contains:{type:'string'},unevaluatedItems:false}, [[1,'x'],['x']], [[1,2]]],
  ['local pointer', {$defs:{number:{type:'number'}},properties:{x:{$ref:'#/$defs/number'}}}, [{x:1}], [{x:'x'}]],
  ['escaped pointer', {$defs:{'a/b~c':{type:'integer'}},$ref:'#/$defs/a~1b~0c'}, [1], ['x']],
  ['encoded pointer', {$defs:{'a b':{const:42}},$ref:'#/$defs/a%20b'}, [42], [41]],
  ['anchor ref', {$defs:{a:{$anchor:'answer',const:42}},$ref:'#answer'}, [42], [41]],
  ['root URI local fragment', {$id:'urn:vb6:test',$defs:{a:{const:42}},$ref:'urn:vb6:test#/$defs/a'}, [42], [41]],
  ['ref siblings', {$defs:{a:{type:'number'}},$ref:'#/$defs/a',minimum:2}, [2], [1,'2']],
  ['recursive finite data', {$defs:{node:{type:['object','null'],properties:{next:{$ref:'#/$defs/node'}},additionalProperties:false}},$ref:'#/$defs/node'}, [null,{next:{next:null}}], [{next:1},{wrong:true}]],
];
for (const [name,schema,valid,invalid] of cases) test('schema: '+name,()=>{
  for (const value of valid) assert.doesNotThrow(()=>validateArguments(value,schema),JSON.stringify(value));
  for (const value of invalid) assert.throws(()=>validateArguments(value,schema),error=>error instanceof McpError&&error.code===-32602,JSON.stringify(value));
});
for (const [name,schema] of [
  ['network ref',{$ref:'https://example.com/schema'}], ['unresolved pointer',{$ref:'#/missing'}],
  ['pointer escape',{$ref:'#/~2'}],['invalid percent',{$ref:'#/%GG'}],['missing anchor',{$ref:'#none'}],
  ['dynamic scope',{$dynamicRef:'#node'}],['nested id',{$defs:{x:{$id:'other',type:'string'}}}],
  ['duplicate anchor',{$defs:{a:{$anchor:'x'},b:{$anchor:'x'}}}],['empty union',{anyOf:[]}],
  ['invalid schema child',{properties:{x:12}}],['unresolved ref in anyOf',{anyOf:[true,{$ref:'#/missing'}]}],
  ['unresolved ref in not',{not:{$ref:'#/missing'}}],['zero divisor',{multipleOf:0}],
  ['bad regex',{pattern:'['}],['invalid type',{type:'frobnicate'}],['invalid count',{minLength:-1}],
]) test('schema: fails closed for '+name,()=>assert.throws(()=>validateArguments(typeof schema.pattern==='string'||schema.minLength!==undefined?'x':1,schema),/schema/i));
test('schema: never mutates values or applies defaults',()=>{
  const value={};validateArguments(value,{properties:{x:{default:42}}});assert.deepEqual(value,{});
});
test('schema: cycles, recursion and work budgets terminate',()=>{
  const cycle={};cycle.not=cycle;assert.throws(()=>validateArguments(null,cycle),/cyclic/);
  assert.throws(()=>validateArguments(null,{$ref:'#'}),/recursive evaluation limit/);
  assert.throws(()=>validateSchemaValue([1,2,3],{anyOf:[true,true]},{maxSteps:5}),/work limit/);
  let deep=null;for(let i=0;i<34;i++)deep={next:deep};assert.throws(()=>validateArguments(deep,true),/deeply nested/);
});
test('schema: non-JSON data, unsafe keys and oversized arrays are rejected',()=>{
  for(const value of [NaN,Infinity,undefined,1n,()=>{},new Date(),JSON.parse('{"constructor":1}'),Array(10001).fill(0)])assert.throws(()=>validateArguments(value,true));
});
test('schema: output boolean schemas and reference assertions are enforced',()=>{
  assert.throws(()=>formatToolResult({}, {outputSchema:false}),/outputSchema/);
  assert.deepEqual(formatToolResult([1,null],{outputSchema:true}).structuredContent,[1,null]);
  assert.throws(()=>formatToolResult({x:'wrong'},{outputSchema:{$defs:{number:{type:'number'}},properties:{x:{$ref:'#/$defs/number'}}}}),/outputSchema/);
});
