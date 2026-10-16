import test from 'node:test';
import assert from 'node:assert/strict';
import {parseExpression} from '../src/language/expression.js';
for(const name of ['Input','Input$','InputB','InputB$'])test(`${name} accepts the optional hash only at its file-number argument`,()=>{
 assert.deepEqual(parseExpression(`${name}(2,#1)`),parseExpression(`${name}(2,1)`));
 assert.deepEqual(parseExpression(`${name}(filenumber:=#1,number:=2)`),parseExpression(`${name}(filenumber:=1,number:=2)`));
 assert.deepEqual(parseExpression(`${name}(2,#f)+${name}(3,#g)`),parseExpression(`${name}(2,f)+${name}(3,g)`));
});
for(const source of ['Foo(2,#1)','obj.Input(2,#1)','Input$(#2,1)','Input$(2,1,#3)','Input$(number:=#2,filenumber:=1)'])test('file-number prefix is not a general expression prefix: '+source,()=>assert.throws(()=>parseExpression(source)));
test('Input file-number prefixes do not swallow surrounding date literals',()=>{
 const result=parseExpression('Input$(2,#f) & #2024-01-02# & Input$(1,#g)');assert.equal(result.left.right.kind,'date');
});
