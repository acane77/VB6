/** VB Input # interchange fields are not CSV: a closing quote ends its field.
 * The private lexer shares the slot-owned byte buffer and installed ANSI codec;
 * numeric conversion uses a fixed locale and preserves the declared target type.
 * https://learn.microsoft.com/openspecs/microsoft_general_purpose_programming_languages/ms-vbal/f41b8636-a3f5-4501-b1a9-78058017c232
 */
export const NATIVE_INPUT_FIELDS_SOURCE=`
Private Declare Function VariantChangeTypeEx Lib "oleaut32" (ByVal destination As Long, ByVal source As Long, ByVal locale As Long, ByVal flags As Integer, ByVal target As Integer) As Long
Private Function PeekUnit(ByVal entry As Long) As Long
 Dim pending As Long
 pending=Word(entry,44)
 If pending<>0 Then
  PeekUnit=pending-1
 Else
  PeekUnit=PeekByte(entry)
 End If
End Function
Private Function ReadFieldText(ByVal entry As Long, ByRef quoted As Long) As String
 Dim result As String, capacity As Long, length As Long, destination As Long, value As Long, ignored As Long
 quoted=0
 Do
  value=PeekUnit(entry)
  If value<>32 And value<>9 Then Exit Do
  ignored=ReadUnit(entry)
 Loop
 If value<0 Then Err.Raise 62
 If value=34 Then
  quoted=1
  ignored=ReadUnit(entry)
 End If
 capacity=256
 result=Space$(capacity)
 destination=StrPtr(result)
 Do
  value=PeekUnit(entry)
  If value<0 Then Err.Raise 62
  If quoted=0 Then
   If value=44 Or value=13 Or value=10 Then Exit Do
  End If
  value=ReadUnit(entry)
  If quoted<>0 And value=34 Then Exit Do
  If length=capacity Then
   If capacity>=1048576 Then Err.Raise 7
   result=result & Space$(capacity)
   capacity=capacity*2
   destination=StrPtr(result)
  End If
  PutUnit destination,length*2,value
  length=length+1
 Loop
 result=Left$(result,length)
 If quoted=0 Then result=Trim$(result)
 Do
  value=PeekUnit(entry)
  If value<>32 And value<>9 Then Exit Do
  ignored=ReadUnit(entry)
 Loop
 If value=44 Or value=10 Then
  ignored=ReadUnit(entry)
 ElseIf value=13 Then
  ignored=ReadUnit(entry)
  If PeekUnit(entry)=10 Then ignored=ReadUnit(entry)
 End If
 ReadFieldText=result
End Function
Private Function IsFieldNumber(ByVal text As String) As Boolean
 Dim i As Long, length As Long, value As Long, digits As Long, pointer As Long
 length=Len(text)
 pointer=StrPtr(text)
 If length=0 Then Exit Function
 value=Unit(pointer,0)
 If value=43 Or value=45 Then i=1
 Do While i<length
  value=Unit(pointer,i*2)
  If value<48 Or value>57 Then Exit Do
  digits=digits+1
  i=i+1
 Loop
 If i<length Then
  If Unit(pointer,i*2)=46 Then
   i=i+1
   Do While i<length
    value=Unit(pointer,i*2)
    If value<48 Or value>57 Then Exit Do
    digits=digits+1
    i=i+1
   Loop
  End If
 End If
 If digits=0 Then Exit Function
 If i<length Then
  value=Unit(pointer,i*2)
  If value<>69 And value<>101 Then Exit Function
  i=i+1
  If i<length Then
   value=Unit(pointer,i*2)
   If value=43 Or value=45 Then i=i+1
  End If
  digits=0
  Do While i<length
   value=Unit(pointer,i*2)
   If value<48 Or value>57 Then Exit Do
   digits=digits+1
   i=i+1
  Loop
  If digits=0 Then Exit Function
 End If
 IsFieldNumber=i=length
End Function
Private Function ConvertField(ByVal text As String, ByVal target As Integer) As Variant
 Dim source As Variant, converted As Variant, hr As Long
 source=text
 hr=VariantChangeTypeEx(VarPtr(converted),VarPtr(source),1033,4,target)
 If hr<0 Then
  If hr=&H8007000E Then Err.Raise 7
  If hr=&H8002000A Then Err.Raise 6
  Err.Raise 13
 End If
 ConvertField=converted
End Function
Private Function ReadField(ByVal entry As Long, ByVal target As Integer) As Variant
 Dim text As String, quoted As Long, number As Long
 text=ReadFieldText(entry,quoted)
 If target=8 Then
  ReadField=text
 ElseIf quoted<>0 Then
  If target=12 Then
   ReadField=text
  Else
   ReadField=0
  End If
 ElseIf text="" Then
  ReadField=Empty
 ElseIf text="#NULL#" Then
  ReadField=Null
 ElseIf text="#TRUE#" Then
  ReadField=True
 ElseIf text="#FALSE#" Then
  ReadField=False
 ElseIf Left$(text,7)="#ERROR " And Right$(text,1)="#" Then
  number=CLng(ConvertField(Mid$(text,8,Len(text)-8),3))
  ReadField=CVErr(number)
 ElseIf Left$(text,1)="#" And Right$(text,1)="#" Then
  ReadField=ConvertField(Mid$(text,2,Len(text)-2),7)
 ElseIf target=7 Then
  Err.Raise 6
 ElseIf IsFieldNumber(text) Then
  If target=11 Then Err.Raise 6
  If target=12 Then target=5
  ReadField=ConvertField(text,target)
 ElseIf target=12 Then
  ReadField=text
 Else
  ReadField=0
 End If
End Function`;
