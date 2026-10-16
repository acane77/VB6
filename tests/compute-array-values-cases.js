/** Literal independent expectations, shared by host compilation and actual WGSL
 * execution. No reference interpreter is used to compute these expected values. */
const options={dynamicArrayCapacity:8,maxStringLength:24,maxCallDepth:5};
const fixture=(name,source,expected,extra={})=>({name,source,expected,options,...extra});
const scalars=[['Boolean','True','False',true,false],['Byte','CByte(255)','CByte(7)',255,7],['Integer','-32768','42',-32768,42],['Long','2147483647&','-9&',2147483647,-9],['Single','1.25!','-0.5!',1.25,-0.5],['Double','9007199254740992#','1.25#',9007199254740992,1.25],['Currency','922337203685477.5807@','-1.0001@','922337203685477.5807','-1.0001'],['Date','CDate(-1.25#)','CDate(42#)',-1.25,42],['String','"A" & ChrW(0) & ChrW(55296)','"zażółć"','A\0\ud800','zażółć']];
export const ARRAY_VALUE_CASES=[
  ...scalars.flatMap(([type,a,b,expectedA,expectedB])=>[
    fixture(type+' multidimensional deep-copy assignment',`Public output() As ${type}
Public input(-1 To 0,3 To 3) As ${type}
Sub Main()
input(-1,3)=${a}
input(0,3)=${b}
output=input
input(-1,3)=${b}
End Sub`,{output:[expectedA,expectedB],input:[expectedB,expectedB]},{bounds:{output:[[-1,0],[3,3]]}}),
    fixture(type+' function returns independent typed array',`Public output() As ${type}
Public result As Long
Sub Main()
output=Make()
result=LBound(output)*100&+UBound(output)
End Sub
Function Make() As ${type}()
Dim values(2 To 3) As ${type}
values(2)=${a}
values(3)=${b}
Make=values
values(2)=${b}
End Function`,{output:[expectedA,expectedB],result:203},{bounds:{output:[[2,3]]}})
  ]),
  fixture('nested Split Filter Join and bounds expressions',`Public result As String
Public count As Long
Sub Main()
result=Join(Filter(Split("alpha|beta|gamma","|"),"a"),",")
count=UBound(Split("a|b|c","|"))+1&
End Sub`,{result:'alpha,beta,gamma',count:3}),
  fixture('String array function result feeds Filter and Join',`Public result As String
Sub Main()
result=Join(Filter(Make(),"a",False),"|")
End Sub
Function Make() As String()
Make=Split("alpha|bbb|gamma|ccc","|")
End Function`,{result:'bbb|ccc'}),
  fixture('two intrinsic arrays have independent ByRef storage',`Public result As String
Sub Main()
Pair Split("A|B","|"),Split("C|D","|")
End Sub
Sub Pair(ByRef a() As String,ByRef b() As String)
b(0)="X"
result=Join(a,"|") & ":" & Join(b,"|")
End Sub`,{result:'A|B:X|D'}),
  fixture('empty intrinsic result retains allocated zero-based shape',`Public output() As String
Public low As Long
Public high As Long
Sub Main()
output=Filter(Split("a|b","|"),"z")
low=LBound(output)
high=UBound(output)
End Sub`,{output:[],low:0,high:-1},{bounds:{output:[[0,-1]]}}),
  fixture('zero-argument syntax and self-assignment',`Public output() As Long
Public input(2 To 3) As Long
Sub Main()
input(2)=42&
output()=input()
output()=output()
End Sub`,{output:[42,0]}),
  fixture('sequential returned array arguments are separate snapshots',`Public result As Long
Sub Main()
Pair Make(11&),Make(22&)
End Sub
Function Make(ByVal n As Long) As Long()
Dim values(2 To 2) As Long
values(2)=n
Make=values
End Function
Sub Pair(ByRef a() As Long,ByRef b() As Long)
b(2)=b(2)+1&
result=a(2)*100&+b(2)
End Sub`,{result:1123}),
  fixture('recursive typed array returns own their frame values',`Public output() As Long
Sub Main()
output=Nest(3&)
End Sub
Function Nest(ByVal n As Long) As Long()
Dim values() As Long
If n=0& Then
ReDim values(1 To 1)
values(1)=10&
Else
values=Nest(n-1&)
values(1)=values(1)+1&
End If
Nest=values
End Function`,{output:[13]}),
  fixture('unassigned return clears destination without allocating shape',`Public output() As Long
Sub Main()
ReDim output(1 To 2)
output(1)=42&
output=EmptyResult()
End Sub
Function EmptyResult() As Long()
End Function`,{output:[]},{bounds:{output:[]}}),
  fixture('bounds queries accept temporary array returns',`Public result As Long
Sub Main()
result=LBound(Make())*100&+UBound(Make())
End Sub
Function Make() As Long()
Dim values(2 To 3) As Long
Make=values
End Function`,{result:203}),
  fixture('ByRef dynamic-array whole assignment retains caller descriptor',`Public output() As Double
Sub Main()
Fill output
End Sub
Sub Fill(ByRef a() As Double)
Dim b(1 To 2) As Double
b(1)=1.25#
b(2)=2.5#
a=b
End Sub`,{output:[1.25,2.5]}),
  fixture('oversized array assignment preserves old values and bounds',`Public output() As Long
Public input(1 To 9) As Long
Public result As Long
Sub Main()
ReDim output(4 To 4)
output(4)=42&
On Error Resume Next
output=input
result=Err.Number
End Sub`,{output:[42],result:7},{bounds:{output:[[4,4]]}}),
  fixture('locked destination assignment unwinds element lock',`Public output() As Long
Public input(1 To 3) As Long
Public result As Long
Sub Main()
ReDim output(1 To 2)
output(1)=42&
On Error Resume Next
Replace output(1)
result=Err.Number
ReDim Preserve output(1 To 3)
End Sub
Sub Replace(ByRef element As Long)
output=input
End Sub`,{output:[42,0,0],result:10}),
  fixture('fixed array passed ByRef cannot become assignment destination',`Public output(1 To 2) As Long
Public result As Long
Sub Main()
output(1)=42&
On Error Resume Next
Replace output
result=Err.Number
End Sub
Sub Replace(ByRef values() As Long)
Dim other(1 To 1) As Long
values=other
End Sub`,{output:[42,0],result:10}),
  fixture('fixed String ByRef has variable-length temporary and truncates copy-back',`Public text As String * 3
Public result As Long
Sub Main()
text="old"
Edit text
End Sub
Sub Edit(ByRef value As String)
value="abcdef"
result=Len(value)
End Sub`,{text:'abc',result:6}),
  fixture('fixed String ByRef pads on copy-back',`Public text As String * 5
Sub Main()
text="start"
Edit text
End Sub
Sub Edit(ByRef value As String)
value="X"
End Sub`,{text:'X    '}),
  fixture('fixed String aliases use separate argument snapshots',`Public text As String * 3
Public result As String
Sub Main()
text="old"
Edit b:=text,a:=text
End Sub
Sub Edit(ByRef a As String,ByRef b As String)
a="AAAA"
result=b
b="BBBB"
End Sub`,{text:'BBB',result:'old'}),
  fixture('fixed String copy-back does not run on escaping error',`Public text As String * 3
Public result As Long
Sub Main()
text="old"
On Error Resume Next
Edit text
result=Err.Number
End Sub
Sub Edit(ByRef value As String)
value="new!"
Error 11
End Sub`,{text:'old',result:11}),
  fixture('fixed String array element copy-back releases shape lock',`Public text() As String * 3
Public result As Long
Sub Main()
ReDim text(1 To 2)
text(1)="old"
On Error Resume Next
Edit text(1)
result=Err.Number
ReDim Preserve text(1 To 3)
End Sub
Sub Edit(ByRef value As String)
value="new!"
ReDim text(1 To 4)
End Sub`,{text:['old','   ','   '],result:10}),
  fixture('fixed String caught error still copies back on normal return',`Public text As String * 3
Sub Main()
text="old"
Edit text
End Sub
Sub Edit(ByRef value As String)
On Error Resume Next
Error 11
value="new!"
End Sub`,{text:'new'})
];
