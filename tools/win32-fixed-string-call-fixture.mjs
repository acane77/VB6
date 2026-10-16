/** Native project-call String adapters, including actual OleAut32 coercion and
 * real VB error unwinding. Appended to the existing all-optimization call matrix. */
export function extendFixedStringCalls({add,check,procedures}){
 add('Dim fixedRow As CALL_FIXED_ROW, fixedReturn As Variant\nfixedText="start"\nresult=FixedResult(fixedText,"xy")');
 check('result="result:start   " And fixedText="xy      "','fixed String arguments expose a writable BSTR and pad only when the call completes');
 add('result=FixedResult(fixedText,"1234567890")');
 check('fixedText="12345678" And result="result:xy      "','fixed String copy-back truncates while preserving an independently owned String return');
 add('fixedRow.before=123\nfixedRow.after=456\nresult=FixedResult(fixedRow.text,"A" & ChrW$(0) & ChrW$(937) & "0123456")');
 check('fixedRow.before=123 And fixedRow.after=456 And Len(fixedRow.text)=5 And AscW(Mid$(fixedRow.text,2,1))=0 And AscW(Mid$(fixedRow.text,3,1))=937','inline fixed UDT fields preserve counted UTF16 and adjacent scalar guards');
 add('result=FixedResult(fixedRow.names(-1),"abcdef")');check('fixedRow.names(-1)="abcd" And fixedRow.names(0)=Space$(4)','indexed inline fixed String fields commit to the captured element only');
 add('fixedText="original"\nresult=FixedResult((fixedText),"different")');check('fixedText="original" And result="result:original"','parentheses keep a fixed String argument isolated without copy-back');
 add('result=FixedResult(text:="named",value:=fixedText)');check('fixedText="named   " And result="result:original"','named fixed String arguments bind to the correct formal and retain their captured source');
 add('fixedText="original"\nresult=FixedPair(fixedText,fixedText)');check('result="originaloriginal" And fixedText="second  "','aliased fixed arguments have distinct snapshots and commit in source order');
 add('ReDim fixedItems(0)\nfixedItems(0)="start"\nfixedIndices=0\nresult=FixedResult(fixedItems(FixedIndex()),"new")');check('fixedIndices=1 And fixedItems(0)="new  "','fixed String array references evaluate their subscript once and copy back before unpinning');
 add('result=FixedPinned(fixedItems(0))');check('result="locked" And fixedItems(0)="fit  " And UBound(fixedItems)=0','callee resize is rejected while a fixed String element is pinned but a handled error can return normally');
 add('ReDim Preserve fixedItems(2)');check('UBound(fixedItems)=2 And fixedItems(0)="fit  "','normal copy-back releases the SAFEARRAY pin for a subsequent resize');
 add('fixedText="original"\nOn Error Resume Next\nErr.Clear\nresult=FixedFail(fixedText)');check('Err.Number=5 And fixedText="original" And result="locked"','propagated callee error discards the fixed bridge and preserves caller result storage');
 add('Err.Clear\nresult=FixedResult(fixedItems(0),FixedGrow())');check('Err.Number=10 And fixedItems(0)="fit  "','a later argument cannot resize an earlier pinned fixed String element');
 add('Err.Clear\nOn Error GoTo 0\nReDim Preserve fixedItems(3)');check('UBound(fixedItems)=3','failed argument evaluation releases fixed String bridge pins before the next statement');
 add('fixedText="original"\nFixedVariant fixedText,123');check('fixedText="123     "','ByRef Variant writes preserve String coercion before fixed-width copy-back');
 add('FixedVariant fixedRow.text,"abcdefg"');check('fixedRow.text="abcde" And fixedRow.after=456','ByRef Variant uses the same bounded inline-field copy-back');
 add('fixedText="original"\nOn Error Resume Next\nErr.Clear\nFixedVariant fixedText,Null');check('Err.Number=94 And fixedText="original"','invalid Null-to-String Variant assignment fails before touching the fixed referent');
 add('Err.Clear\nOn Error GoTo 0\nFixedVariant (fixedText),123');check('fixedText="original"','a grouped fixed argument for a Variant formal has no copy-back');
 for(const [type,literal]of [['Byte','255'],['Integer','-123'],['Long','123456'],['Boolean','True'],['Single','1.5'],['Double','1.25'],['Currency','123.4567@'],['Date','#2024-02-29#'],['Variant','"variant result"']]){
  procedures.push(`Private Function FixedReturn${type}(ByRef value As String) As ${type}\n value="done"\n FixedReturn${type}=${literal}\nEnd Function`);
  check(`FixedReturn${type}(fixedText)=${literal} And fixedText="done    "`,`fixed String copy-back preserves the ${type} return ABI`);
 }
 add('For i=1 To 1000\n result=FixedResult(fixedText,"repeat")\n FixedVariant fixedRow.text,123\nNext');check('result="result:repeat  " And fixedText="repeat  " And fixedRow.text="123  "','repeated fixed String/Variant bridges leave result and referent owners usable');
 procedures.push(`Private Function FixedResult(ByRef value As String,ByVal text As String) As String
 FixedResult="result:" & value
 value=text
End Function
Private Function FixedPair(ByRef first As String,ByRef second As String) As String
 FixedPair=first & second
 first="first"
 second="second"
End Function
Private Function FixedIndex() As Long
 fixedIndices=fixedIndices+1
 FixedIndex=0
End Function
Private Function FixedPinned(ByRef value As String) As String
 On Error Resume Next
 ReDim fixedItems(4)
 If Err.Number=10 Then FixedPinned="locked"
 Err.Clear
 value="fit"
End Function
Private Function FixedGrow() As String
 ReDim fixedItems(8)
 FixedGrow="wrong"
End Function
Private Function FixedFail(ByRef value As String) As String
 value="changed"
 Error 5
End Function
Private Sub FixedVariant(ByRef value As Variant,ByVal replacement As Variant)
 value=replacement
End Sub`);
 return `Private Type CALL_FIXED_ROW
 before As Long
 text As String * 5
 names(-1 To 0) As String * 4
 after As Long
End Type
Private fixedItems() As String * 5
Private fixedIndices As Long`;
}
