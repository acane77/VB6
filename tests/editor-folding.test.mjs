import test from 'node:test';
import assert from 'node:assert/strict';
import {vb6FoldingRanges} from '../src/editor/folding.js';
const ranges=code=>vb6FoldingRanges(code).map(r=>[r.startLine,r.endLine,r.kind]);
for(const [open,close]of [['Sub Main()','End Sub'],['Private Function F() As Long','End Function'],['Friend Property Get Value() As Long','End Property'],['Public Property Let Value(ByVal v As Long)','End Property'],['Property Set Value(ByVal v As Object)','End Property'],['Private Type Point','End Type'],['Public Enum State','End Enum']])test('folds '+open,()=>assert.deepEqual(ranges(open+'\n  body\n'+close),[[0,2,'region']]));
for(const [open,close]of [['For i = 1 To 3','Next i'],['For Each item In items','Next'],['Do','Loop Until done'],['Do While condition','Loop'],['While ready','Wend'],['With item','End With'],['Select Case x','End Select'],['If ready Then','End If']])test('nested block '+open,()=>assert.deepEqual(ranges('Sub Main()\n'+open+'\n  body\n'+close+'\nEnd Sub'),[[0,4,'region'],[1,3,'region']]));
test('mismatched closers cannot consume unrelated block openers',()=>{
  assert.deepEqual(ranges('Sub Main()\nFor i=1 To 3\nWend\nNext\nEnd Sub'),[[0,4,'region'],[1,3,'region']]);
  assert.deepEqual(ranges('Sub Main()\nIf True Then\nFor i=1 To 2\nEnd If\nEnd Sub'),[[0,4,'region'],[1,3,'region']]);
});
test('incomplete procedures do not swallow the following completed procedure',()=>{
  assert.deepEqual(ranges('Sub Broken()\nIf True Then\nSub Good()\n  Debug.Print 1\nEnd Sub'),[[2,4,'region']]);
});
test('single-line If, strings, comments, date literals and external declarations are not openers',()=>{
  const code='Declare Sub Foreign Lib "x" ()\nSub Main()\nIf True Then Debug.Print "If x Then"\nIf False Then: Debug.Print 2\nDebug.Print "For i=1 To 2: Next"\n\'End Sub\nRem If x Then\nDebug.Print #1/2/2025#\nEnd Sub';
  assert.deepEqual(ranges(code),[[1,8,'region'],[5,6,'comment']]);
});
test('numeric labels and multiple Next variables match their own loop types',()=>{
  assert.deepEqual(ranges('Sub Main()\n100 For i=1 To 2\n200 For j=1 To 2\n300 Debug.Print i,j\n400 Next j,i\nEnd Sub'),[[0,5,'region'],[1,4,'region'],[2,4,'region']]);
});
test('continuations preserve physical lines and do not fold at a quoted colon',()=>{
  const source='Sub Main()\r\nIf True And _\r\n  True Then\r\nDebug.Print "a:b"\r\nEnd If\r\nDebug.Print 1, _\r\n  2\r\nEnd Sub';
  assert.deepEqual(ranges(source),[[0,7,'region'],[1,4,'region'],[5,6,'region']]);
});
test('conditional branches discard incomplete branch-local blocks without crossing the alternative',()=>{
  const source='Sub Main()\n#If Debug Then\nFor i=1 To 2\n#Else\nWhile ready\nbody\nWend\n#End If\nEnd Sub';
  assert.deepEqual(ranges(source),[[0,8,'region'],[1,7,'region'],[4,6,'region']]);
});
test('nested conditional directives, ElseIf and complete branch procedures fold independently',()=>{
  const source='#If A Then\n#If B Then\nSub X()\nbody\nEnd Sub\n#ElseIf C Then\n\'comment\n#Else\nSub Y()\nbody\nEnd Sub\n#End If\n#End If';
  assert.deepEqual(ranges(source),[[0,12,'region'],[1,11,'region'],[2,4,'region'],[8,10,'region']]);
});
test('comment runs and comment-region markers are separate and nested',()=>{
  assert.deepEqual(ranges("' #Region Helpers\n' description\nRem second\nSub A()\nbody\nEnd Sub\n' #End Region"),[[0,6,'region'],[1,2,'comment'],[3,5,'region']]);
});
test('crossing comment regions never produce intersecting source folds',()=>{
  const source="Sub A()\n' #Region Crossing\nbody\nEnd Sub\n' #EndRegion\n";
  assert.deepEqual(ranges(source),[[0,3,'region']]);
});
test('ranges have explicit bounds and remain bounded for a large module',()=>{
  const code='Sub A()\nbody\nEnd Sub\n'.repeat(15000),folds=vb6FoldingRanges(code);
  assert.equal(folds.length,10000);assert.deepEqual(folds[0],{startLine:0,endLine:2,kind:'region'});
  assert.equal(vb6FoldingRanges(code,{maxRanges:3}).length,3);assert.deepEqual(vb6FoldingRanges(code,{maxRanges:0}),[]);
  for(const maxRanges of [-1,10001,0.5,NaN])assert.throws(()=>vb6FoldingRanges(code,{maxRanges}),RangeError);
});
