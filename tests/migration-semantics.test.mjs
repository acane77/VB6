import {VARIANT_ARRAY_FIXTURE,CURRENCY_LOOP_FIXTURE,SELECT_CASE_FIXTURE} from './migration-semantics-fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {convertVbNetProject} from '../src/migration/index.js';
import {project, procedure} from './migration-fixtures.mjs';

function converted(input) {
  const result = convertVbNetProject(input, {platform: 'AnyCPU',codeStyle:'compatibility',runtime:'project'});
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  return result.files['Application/Module1.vb'];
}

test('Currency For uses the native overloaded loop with explicit Currency bounds and step', () => {
  const code = converted(procedure('Dim c As Currency\nFor c = 1 To 3 Step .25\nDebug.Print CStr(c)\nNext c'));
  assert.match(code, /For \[c\] = VbCurrency\.FromObject\(1S\) To VbCurrency\.FromObject\(3S\) Step VbCurrency\.FromObject\(/);
  assert.match(code, /Next \[c\]/);
  assert.doesNotMatch(code, /While|__vbFor/);
});

test('Variant Select Case captures selector once and keeps ordered null-aware case predicates', () => {
  const code = converted(project(`Option Explicit
Public Function Pick() As Variant
    Pick = 2
End Function
Public Sub Main()
    Select Case Pick()
    Case Null
        Debug.Print "wrong"
    Case 1 To 3, 9
        Debug.Print "match"
    Case Else
        Debug.Print "else"
    End Select
End Sub`));
  assert.match(code, /Dim __vbSelect\d+ As Object = \[Pick\]\(\)/);
  assert.match(code, /Select Case True/);
  assert.match(code, /VbVariant\.Truth\(VbVariant\.Binary\("="/);
  assert.match(code, /VbVariant\.Binary\(">="/);
  assert.match(code, /VbVariant\.Binary\("<="/);
  assert.match(code, /\) And VbVariant\.Truth/);
  assert.doesNotMatch(code, /AndAlso/);
  assert.equal((code.match(/= \[Pick\]\(\)/g) || []).length, 1);
});

test('Variant array ReDim and Erase are explicit runtime operations, not late calls on Nothing', () => {
  const code = converted(procedure(`Dim a As Variant
ReDim a(-1 To 2) As Long
a(-1) = 7
ReDim Preserve a(-1 To 3)
Debug.Print a(-1)
Erase a`));
  assert.match(code, /\[a\] = VbArrays\.ResizeVariant\(\[a\],/);
  assert.match(code, /GetType\(Integer\)/);
  assert.match(code, /VbArrays\.Element\(\[a\], New Object\(\) \{/);
  assert.match(code, /\[a\] = VbArrays\.EraseVariant\(\[a\]\)/);
  assert.doesNotMatch(code, /\[a\]\.Resize\(/);
});

test('ByVal Variant entry copies array values rather than sharing the caller storage', () => {
  const code = converted(project('Public Sub Main()\nEnd Sub\nPublic Sub Edit(ByVal a As Variant)\na(0) = 9\nEnd Sub'));
  assert.match(code, /\[a\] = VbRuntime\.CopyValue\(\[a\]\)/);
});

test('typed arrays cannot silently change element type or redimension fixed storage', () => {
  for (const body of ['Dim a() As Long\nReDim a(2) As String', 'Dim a(2) As Long\nReDim a(3)', 'Dim a As Long\nReDim a(3)']) {
    const result = convertVbNetProject(procedure(body), {platform:'AnyCPU'});
    assert.equal(result.success, false, body);
    assert.ok(result.diagnostics.some(d => d.code.startsWith('MIG_REDIM_')), JSON.stringify(result.diagnostics));
  }
});

// Convert every execution fixture even when the .NET SDK is absent.
for (const [name, fixture] of Object.entries({VARIANT_ARRAY_FIXTURE, CURRENCY_LOOP_FIXTURE, SELECT_CASE_FIXTURE})) {
  test('execution fixture has no migration blockers: ' + name, () => {
    const code = converted(fixture);
    assert.ok(code.includes('End Module'));
  });
}


test('live array-element ByRef aliasing is diagnosed rather than silently copied back', () => {
  for (const declaration of ['Dim a As Variant\nReDim a(1)', 'Dim a(1) As Long']) {
    for (const argument of ['a(0)', 'value:=a(0)']) {
      const source = project('Public Sub Main()\n'+declaration+'\nMutate '+argument+'\nEnd Sub\nPublic Sub Mutate(ByRef value As Variant)\nvalue = 9\nEnd Sub');
      const result = convertVbNetProject(source, {platform:'AnyCPU'});
      assert.ok(result.diagnostics.some(d => d.code === 'MIG_ARRAY_ELEMENT_BYREF'), JSON.stringify(result.diagnostics));
      assert.equal(result.success, false);
    }
  }
});

test('ambiguous late index arguments never produce a build-ready archive', () => {
  for (const argumentsText of ['index:=1', ', 1']) {
    const result = convertVbNetProject(procedure('Dim a As Variant\nDebug.Print a('+argumentsText+')'));
    assert.equal(result.success, false);
    assert.ok(result.diagnostics.some(d => d.code === 'MIG_INDEX_ARGUMENT'), JSON.stringify(result.diagnostics));
  }
});

test('multi-target array errors cannot resume into a different source statement boundary', () => {
  for (const statement of ['ReDim a(1), b(1)', 'Erase a, b']) {
    const result = convertVbNetProject(procedure('Dim a As Variant, b As Variant\nOn Error Resume Next\n'+statement));
    assert.ok(result.success, JSON.stringify(result.diagnostics));
    const source=result.files['Application/Module1.vb'];
    assert.match(source, /Private Sub __vbArrayStatement0\(ByRef __vbCell0 As Object, ByRef __vbCell1 As Object\)/);
    assert.match(source, /On Error Resume Next\s+__vbArrayStatement0\(a, b\)/);
  }
});
