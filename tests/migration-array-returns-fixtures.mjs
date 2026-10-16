import {project} from './migration-fixtures.mjs';

export const ARRAY_RETURNS_FIXTURE=project(`Option Explicit
Private saved() As Long
Public Trace As String
Public Sub Main()
Dim values() As Long
values = Make(b:=Mark(2), a:=Mark(1))
Debug.Print Trace
Debug.Print LBound(values)
Debug.Print UBound(values)
Debug.Print values(-2)
Debug.Print values(1)
values(-2)=99
Debug.Print saved(-2)
saved(1)=88
Debug.Print values(1)
values=Recursive(3)
Debug.Print values(5)
values=Build()
Debug.Print LBound(values)
Debug.Print UBound(values)
Debug.Print values(4)
values=OptionalValues()
Debug.Print values(0)
values=OptionalValues(3@)
Debug.Print values(0)
Dim matrix() As Long
matrix=MatrixValues()
Debug.Print LBound(matrix,1)
Debug.Print UBound(matrix,2)
Debug.Print matrix(-1,4)
Dim value As Variant
value=MatrixValues()
Debug.Print IsArray(value)
Debug.Print value(-1,4)
Dim reader As ArrayContract
Set reader=New ArrayImplementation
values=reader.Values
Debug.Print values(2)
Dim records() As Entry
records=RecordValues()
Debug.Print records(1).Name
Debug.Print records(1).Number
Dim missing() As Long
missing=Unallocated()
Debug.Print IsArray(missing)
On Error Resume Next
Debug.Print UBound(missing)
Debug.Print Err.Number
End Sub
Public Function Mark(ByVal n As Long) As Long
Trace=Trace & CStr(n)
Mark=n
End Function
Public Function Make(ByVal a As Long, ByVal b As Long) As Long()
ReDim saved(-2 To 1)
saved(-2)=a
saved(1)=b
Make=saved
End Function
Public Function Recursive(ByVal n As Long) As Long()
If n=0 Then
Dim result() As Long
ReDim result(5 To 5)
result(5)=42
Recursive=result
Else
Recursive=Module1.Recursive(n-1)
End If
End Function
Public Function Build() As Long()
ReDim Build(4 To 5)
Build(4)=40
ReDim Preserve Build(4 To 6)
End Function
Public Function Unallocated() As Long()
End Function
Public Function OptionalValues(Optional ByVal n As Currency=2@) As Long()
Dim result() As Long
ReDim result(0 To 0)
result(0)=CLng(n)
OptionalValues=result
End Function
Public Function MatrixValues() As Long()
Dim result() As Long
ReDim result(-1 To 1, 3 To 4)
result(-1,4)=72
MatrixValues=result
End Function
Public Type Entry
Name As String
Number As Long
End Type
Public Function RecordValues() As Entry()
Dim result() As Entry
ReDim result(1 To 1)
result(1).Name="owned"
result(1).Number=31
RecordValues=result
End Function`);
ARRAY_RETURNS_FIXTURE.name='ArrayReturns';
ARRAY_RETURNS_FIXTURE.modules.push(
  {name:'ArrayContract',kind:'class',code:`Option Explicit
Public Property Get Values() As Long()
End Property`},
  {name:'ArrayImplementation',kind:'class',code:`Option Explicit
Implements ArrayContract
Private Property Get ArrayContract_Values() As Long()
Dim data() As Long
ReDim data(2 To 2)
data(2)=61
ArrayContract_Values=data
End Property`}
);
export const ARRAY_RETURNS_EXPECTED=['21','-2','1','1','2','1','2','42','4','6','40','2','3','-1','4','72','True','72','61','owned','31','True','9'];
