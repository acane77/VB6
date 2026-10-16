import test from 'node:test';
import assert from 'node:assert/strict';
import {scanDeclarations} from '../src/language/declaration-index.js';
import {sourceCodeActions,applySourceCodeAction,includesActionKind} from '../src/editor/source-actions.js';
import {run} from './helpers/compiler-runtime.mjs';

function fixture(body,selection,{prefix='Option Explicit\n',suffix='',index=-1,only=['refactor']}={}){
  const code=prefix+'Sub Main()\n'+body+'\nEnd Sub\n'+suffix,module={id:'m',name:'M',kind:'module',code};
  const start=index<0?code.lastIndexOf(selection):index,end=start+selection.length;
  assert.ok(start>=0,'Test selection must occur in source.');
  return {module,start,end,actions:sourceCodeActions(module,scanDeclarations(module),start,end,{only})};
}
const extract=f=>f.actions.find(a=>a.kind==='refactor.extract.constant');
const inline=f=>f.actions.find(a=>a.kind==='refactor.inline.constant');
for(const [expression,type]of [['42','Integer'],['40000','Long'],['1.25!','Single'],['1.25#','Double'],['12.3456@','Currency'],['True','Boolean'],['"Zażółć 😀"','String'],['#12/31/2025#','Date'],['(2 + 3) * 4','Integer'],['1 / 2','Double'],['-32768','Integer'],['-2147483648','Long']]){
  test('extract '+expression+' retains '+type+' and its runtime value',async()=>{
    const f=fixture('    Debug.Print '+expression+', VarType('+expression+')',expression),action=extract(f);assert.ok(action);
    const next=applySourceCodeAction(f.module.code,action);assert.match(next,new RegExp('Const NewConstant As '+type+' = '));
    assert.deepEqual((await run(next)).output,(await run(f.module.code)).output);
    assert.equal(next.slice(action.selection.start,action.selection.end),'NewConstant');
  });
}
for(const [body,selection]of [
  ['    Dim x As Long\n    x = 1 + 2 * 3','1 + 2'],
  ['    Dim x As Long\n    x = 12345','234'],
  ['    Debug.Print "12345"','234'],
  ['    Debug.Print "hi" \' 123','123'],
  ['    Rem 123','123'],
  ['    Dim x As Long\n    x = SideEffect()','SideEffect()'],
  ['    Dim x As Long\n    x = other + 1','other + 1'],
  ['    Dim x As Long\n    x = 1 / 0','1 / 0'],
  ['    Dim x As Long\n    x = 32767 + 1','32767 + 1'],
  ['    Dim x As Long\n    x = Null','Null'],
  ['    Dim x As Long\n    x = Empty','Empty'],
  ['    Dim x As Long\n    x = -32768','32768'],
  ['    Dim x As Long\n    x = -2147483648','2147483648'],
  ['    Const Size = 10','10'],
  ['#If True Then\n    Debug.Print 10\n#End If','10'],
])test('unsafe extraction is not offered: '+body.replace(/\n/g,' | '),()=>assert.equal(extract(fixture(body,selection)),undefined));
for(const [body,selection]of [
  ['    Dim x As Long\n    x = 1 + 2 * 3\n    Debug.Print x','2 * 3'],
  ['    Dim x As Long\n    For x = 1 To 3\n      Debug.Print x\n    Next','3'],
  ['    If True Then\n      Debug.Print "yes"\n    End If','True'],
  ['    If False Then\n    ElseIf True Then\n      Debug.Print "yes"\n    End If','True'],
  ['    Select Case 3\n    Case 1 To 4\n      Debug.Print "yes"\n    End Select','4'],
  ['    Dim x As Long\n    Do While x < 3\n      x = x + 1\n    Loop\n    Debug.Print x','3'],
  ['    Dim x As Long\n    Do\n      x = x + 1\n    Loop Until x = 3\n    Debug.Print x','3'],
  ['    Dim x As Long\n    While x < 3\n      x = x + 1\n    Wend\n    Debug.Print x','3'],
  ['    Dim x As Long\n    x = 2: Debug.Print (1 + 3) * x','1 + 3'],
])test('statement-context extraction preserves execution: '+selection+' in '+body.split('\n')[0],async()=>{
  const f=fixture(body,selection),action=extract(f);assert.ok(action);assert.deepEqual((await run(applySourceCodeAction(f.module.code,action))).output,(await run(f.module.code)).output);
});
test('extracted constants passed ByRef retain temporary-value behavior and exact types',async()=>{
  const f=fixture('    Work 42\n    Work 43','42',{suffix:'Sub Work(ByRef value As Integer)\n  Debug.Print VarType(value), value\n  value = value + 1\nEnd Sub\n'}),action=extract(f);assert.ok(action);
  assert.deepEqual((await run(applySourceCodeAction(f.module.code,action))).output,(await run(f.module.code)).output);
});
test('name generation avoids active, inactive, undeclared and case-insensitive collisions',()=>{
  const f=fixture('    Dim NEWCONSTANT As Long, NewConstant1 As Long\n    \' NewConstant2\n    Debug.Print 42','42',{prefix:'Option Explicit\n#If False Then\nDim NewConstant3\n#End If\n'});
  assert.equal(extract(f).title,'Extract constant NewConstant4');
});
test('CRLF, tabs, Unicode offsets and comments survive extraction without reformatting',()=>{
  const f=fixture('\tDebug.Print "😀", 42 \' keep','42',{prefix:'\' heading 😀\nOption Explicit\n'});
  f.module.code=f.module.code.replace(/\n/g,'\r\n');const start=f.module.code.indexOf('42'),action=sourceCodeActions(f.module,scanDeclarations(f.module),start,start+2,{only:['refactor.extract']})[0];
  const next=applySourceCodeAction(f.module.code,action);assert.match(next,/\r\n\tConst NewConstant As Integer = 42\r\n/);assert.match(next,/"😀", NewConstant ' keep/);assert.equal(next.replace(/\r\n/g,'' ).includes('\n'),false);
});
for(const [declaration,type]of [['Const Limit = 10','Integer'],['Const Limit As Long = 40000','Long'],['Const Limit = "hello"','String'],['Const Limit As Currency = 1.25@','Currency'],['Const Limit As Boolean = True','Boolean'],['Const Limit As Double = 1.25#','Double']]){
  test('inline '+type+' constant retains type and other references',async()=>{
    const f=fixture('    '+declaration+'\n    Debug.Print Limit, VarType(Limit), Limit','Limit'),action=inline(f);assert.ok(action);
    const next=applySourceCodeAction(f.module.code,action);assert.ok(next.includes(declaration));assert.deepEqual((await run(next)).output,(await run(f.module.code)).output);
  });
}
test('inline at a caret expands the entire identifier',()=>{
  const f=fixture('    Const Limit = 10\n    Debug.Print Limit','Limit');
  const actions=sourceCodeActions(f.module,scanDeclarations(f.module),f.start+2,f.start+2,{only:['refactor.inline']});assert.equal(actions[0].edits[0].start,f.start);assert.equal(actions[0].edits[0].end,f.end);
});
test('inline module constants respects local shadowing and member names',()=>{
  const yes=fixture('    Debug.Print Limit','Limit',{prefix:'Const Limit = 42\n'});assert.ok(inline(yes));
  const no=fixture('    Dim Limit As Long\n    Debug.Print Limit','Limit',{prefix:'Const Limit = 42\n'});assert.equal(inline(no),undefined);
  assert.equal(inline(fixture('    Const Limit = 42\n    Debug.Print obj.Limit','Limit')),undefined);
  assert.equal(inline(fixture('    Const Limit = 42\n    Limit = 10','Limit')),undefined);
});
for(const declaration of ['Const Limit As Long = 1','Const Limit As Variant = 1','Const Limit As Integer = 40000','Const Limit = Other + 1','Const Limit = SideEffect()'])test('inline refuses coercions and nonliteral initializer: '+declaration,()=>assert.equal(inline(fixture('    '+declaration+'\n    Debug.Print Limit','Limit')),undefined));
test('inline groups a Long boundary so a unary minus does not become a narrower signed literal',async()=>{
  const f=fixture('    Const Limit As Long = 32768\n    Debug.Print VarType(-Limit), -Limit','Limit'),action=inline(f);assert.ok(action);
  assert.deepEqual((await run(applySourceCodeAction(f.module.code,action))).output,(await run(f.module.code)).output);
});
test('default-type directives cannot silently narrow or widen an extracted or inlined value',async()=>{
  const f=fixture('    Debug.Print VarType(10)','10',{prefix:'DefLng A-Z\n'});assert.match(extract(f).edits[0].text,/As Integer/);
  assert.deepEqual((await run(applySourceCodeAction(f.module.code,extract(f)))).output,(await run(f.module.code)).output);
  assert.equal(inline(fixture('    Const Limit = 1\n    Debug.Print Limit','Limit',{prefix:'DefLng A-Z\n'})),undefined);
});
test('kind filters use hierarchy segments, not arbitrary string prefixes',()=>{
  for(const parent of ['','refactor','refactor.extract','refactor.extract.constant'])assert.equal(includesActionKind('refactor.extract.constant',[parent]),true);
  for(const parent of ['ref','refactor.ex','refactor.extract.constant.more','source'])assert.equal(includesActionKind('refactor.extract.constant',[parent]),false);
  assert.equal(includesActionKind('source.fixAll',[]),false);assert.equal(includesActionKind('source.fixAll',['source.fix']),false);
});
test('source actions preserve meaningful string whitespace and insert Option Explicit only once',()=>{
  const module={id:'m',name:'M',kind:'module',code:'\ufeffSub Main()\r\n  Debug.Print "two  "  \r\nEnd Sub\r\n'};
  const actions=sourceCodeActions(module,scanDeclarations(module));assert.equal(actions.length,2);
  const add=actions.find(a=>a.kind==='source.addOptionExplicit');assert.equal(add.edits[0].start,1);
  const next=applySourceCodeAction(module.code,add);assert.ok(next.startsWith('\ufeffOption Explicit\r\n'));
  module.code=next;const second=sourceCodeActions(module,scanDeclarations(module));assert.equal(second.length,1);assert.equal(second[0].kind,'source.fixAll');
  assert.match(applySourceCodeAction(module.code,second[0]),/"two  "\r\n/);
});
test('selection and action validation reject reversed, overlapping, stale and out-of-bounds edits',()=>{
  const f=fixture('    Debug.Print 42','42'),action=extract(f);assert.ok(action);
  for(const [a,b]of [[-1,0],[1,0],[0,f.module.code.length+1],[NaN,2]])assert.throws(()=>sourceCodeActions(f.module,scanDeclarations(f.module),a,b),RangeError);
  assert.throws(()=>applySourceCodeAction(f.module.code+' ',action),/stale/);
  for(const edits of [[{start:0,end:3,text:''},{start:2,end:4,text:''}],[{start:0,end:9999,text:''}],[{start:0.5,end:1,text:''}],[{start:0,end:1,text:null}]])assert.throws(()=>applySourceCodeAction(f.module.code,{before:f.module.code,edits}));
});
test('large-module refactoring uses a bounded statement and retains all surrounding source',()=>{
  const f=fixture("    ' unrelated\n".repeat(10000)+'    Debug.Print 42','42'),action=extract(f);assert.ok(action);
  const next=applySourceCodeAction(f.module.code,action);assert.equal(next.match(/unrelated/g).length,10000);assert.match(next,/Debug.Print NewConstant/);
});
