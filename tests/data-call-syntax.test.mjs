import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCall} from '../src/language/expression.js';

test('implicit calls support indexed and called receivers, nested arguments and With',()=>{
  for(const source of ['rs.Fields("memo").AppendChunk "ab"','.Fields("memo").AppendChunk "ab"','factory(choose(1,2)).Items(0).Write "ab"','rs!memo.AppendChunk "ab"']){
    const ast=parseCall(source);assert.equal(ast.kind,'call');assert.equal(ast.callee.kind,'member');assert.equal(ast.args[0].value,'ab');
  }
});
test('indexed receiver calls retain positional With arguments after ordinary whitespace',()=>{
  const ast=parseCall('rs.Fields("memo").AppendChunk .Value');assert.equal(ast.args[0].kind,'member');assert.equal(ast.args[0].object.kind,'with');
});
test('single parenthesized no-Call arguments remain temporaries on indexed receivers',()=>{
  const source='items(0).Modify(value)';assert.equal(parseCall(source).args[0].kind,'group');assert.equal(parseCall(source,{explicit:true}).args[0].kind,'id');
});
test('receiver parentheses do not consume named, omitted or ByVal outer arguments',()=>{
  let ast=parseCall('items(0).Modify first:=x, second:=y');assert.equal(ast.args[0].kind,'named');assert.equal(ast.args[1].name,'second');
  ast=parseCall('items(0).Modify , ByVal x');assert.deepEqual(ast.args.map(a=>a.kind),['missing','byval']);
});
test('explicit Call still requires parenthesized argument lists on indexed receivers',()=>{
  assert.throws(()=>parseCall('items(0).Modify(x) y',{explicit:true}));
  assert.equal(parseCall('items(0).Modify(x,y)',{explicit:true}).args.length,2);
});
