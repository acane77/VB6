import {project} from './migration-fixtures.mjs';
export const ARRAY_BOUNDARIES_FIXTURE=project(`Option Explicit
Public Trace As String
Private shouldFail As Boolean
Public Sub Main()
Dim a() As Long, b() As Long, size As Long
size=2
ReDim a(0 To 0), b(0 To 0)
a(0)=11
b(0)=22
On Error Resume Next
ReDim a(Upper(size)), b(Fail())
Debug.Print Trace
Debug.Print Err.Number
Debug.Print size
Debug.Print UBound(a)
Debug.Print a(0)
Debug.Print UBound(b)
Debug.Print b(0)
Err.Clear
ReDim Preserve a(0 To 3), b(1 To 2)
Debug.Print Err.Number
Debug.Print UBound(a)
Debug.Print LBound(b)
On Error GoTo 0
Erase a,b
Debug.Print IsArray(a)
Debug.Print IsArray(b)
Retrying
End Sub
Public Function Upper(ByRef value As Long) As Long
Trace=Trace & "A"
value=value+1
Upper=value
End Function
Public Function Fail() As Long
Trace=Trace & "B"
Err.Raise 5
End Function
Public Sub Retrying()
Dim a() As Long, b() As Long, n As Long
Trace=""
shouldFail=True
n=0
On Error GoTo handler
ReDim a(Upper(n)), b(MaybeFail())
Debug.Print Trace
Debug.Print n
Debug.Print UBound(a)
Debug.Print UBound(b)
Exit Sub
handler:
shouldFail=False
Resume
End Sub
Public Function MaybeFail() As Long
Trace=Trace & "C"
If shouldFail Then Err.Raise 5
MaybeFail=4
End Function`);
ARRAY_BOUNDARIES_FIXTURE.name='ArrayStatementBoundaries';
export const ARRAY_BOUNDARIES_EXPECTED=['AB','5','3','3','0','0','22','9','3','0','True','True','ACAC','2','2','4'];
