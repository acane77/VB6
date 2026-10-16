/** Files are populated by independent Win32 calls, then read by emitted VB.
 * Both directions use the installed ANSI code page, not a browser virtual disk. */
export function nativeFileInputFixtures(fixture){return [build(fixture,false),build(fixture,true)];}
function build(fixture,errors){
 const {add,check,finish}=fixture(errors?'AotControlInputFileErrors':'AotControlInputFiles');
 add('Dim s As String, v As Variant, fixed As String * 4, lines(1 To 2) As String, row As RowData, n As Long, before As Long, after As Long');
 if(!errors){
  check('WriteAnsi("input.txt","alpha" & vbCrLf & "beta" & vbCr & "tail")','independent Win32 writer creates the input fixture');
  add('Open "input.txt" For Input Access Read Shared As #1 Len=3');
  check('LOF(1)=16 And Seek(1)=1 And Loc(1)=0 And FileAttr(1)=1 And Not EOF(1)','Input opens existing bytes with read access and one-based logical position');
  check('Seek(1)=1 And Not EOF(1) And Seek(1)=1','EOF may read ahead but cannot consume a character or change the logical position');
  add('Line Input #1,s');check('s="alpha" And Seek(1)=8','Line Input consumes CRLF even when its bytes straddle buffer fills');
  add('Line Input #1,v');check('VarType(v)=vbString And v="beta" And Seek(1)=13','Line Input supports a Variant target and standalone CR terminator');
  add('Line Input #1,s');check('s="tail" And EOF(1) And Seek(1)=17','final nonterminated line is returned and logical position reaches EOF');
  add('Seek #1,1\ns=Input$(5,#1)');check('s="alpha" And Seek(1)=6','Seek invalidates read-ahead and Input$ accepts a hash-prefixed file number');
  add('s=Input$(filenumber:=#1,number:=2)');check('s=vbCrLf And Seek(1)=8','Input$ includes CRLF and binds named arguments to their declaration slots');
  add('Seek #1,1\nLine Input #1,fixed');check('fixed="alph"','Line Input truncates a fixed-length String destination using normal assignment');
  add('Seek #1,13\nLine Input #1,row.text');check('row.text="tail  "','Line Input pads an inline fixed-length UDT String field');
  add('Seek #1,1\nindexCalls=0\nLine Input #1,lines(NextIndex())');check('indexCalls=1 And lines(1)="alpha"','Line Input evaluates an array subscript exactly once and pins its destination');
  add('Close #1');check('FreeFile=1','Close frees an input slot for reuse');
  check('WriteAnsi("input.txt","A" & vbLf & "B" & ChrW$(0) & Chr$(34) & ",C" & vbCr)','independent fixture includes isolated LF, embedded NUL and literal delimiters');
  add('Open "input.txt" For Input As #256 Len=1\nLine Input #256,s\nClose #256');
  check('s="A" & vbLf & "B" & ChrW$(0) & Chr$(34) & ",C"','Line Input preserves LF, NUL, quotes and commas as counted String data');
  check('WriteAnsi("input.txt",String$(4097,"z") & vbCrLf)','long line fixture is independently written');
  add('Open "input.txt" For Input As #1 Len=7\nLine Input #1,s');check('Len(s)=4097 And s=String$(4097,"z") And EOF(1)','Line Input grows geometrically across many buffer fills without losing data');
  add('Seek #1,1\ns=Input$(127,#1)');check('Loc(1)=0 And Seek(1)=128','Loc reports complete 128-byte sequential units, not OS read-ahead');
  add('s=Input$(1,#1)');check('Loc(1)=1 And Seek(1)=129','Loc crosses the 128-byte boundary at the logical byte position');
  add('Close #1');
  check('WriteAnsi("input.txt","A" & ChrW$(233) & ChrW$(937) & ChrW$(20013) & "Z")','Unicode fixture is encoded by the installed Windows ANSI code page');
  add('s=AnsiRoundTrip("A" & ChrW$(233) & ChrW$(937) & ChrW$(20013) & "Z")\nOpen "input.txt" For Input As #1 Len=1\nv=Input$(Len(s),#1)');
  check('v=s And EOF(1)','Input$ follows the installed ANSI code page with sequences split across single-byte fills');
  add('Close #1\nOpen "input.txt" For Append As #1');check('Seek(1)=LOF(1)+1 And FileAttr(1)=8 And EOF(1)','Append starts at real EOF and reports its VB open mode');
  add('Close #1');
 }else{
  check('WriteAnsi("input.txt","abc")','error fixture is independently created');
  add('On Error Resume Next\nErr.Clear\nOpen "missing.txt" For Input As #1');check('Err.Number=53 And GetFileAttributesW(StrPtr("missing.txt"))=-1','Input on a missing file raises 53 and never creates it');
  add('Err.Clear\nOn Error GoTo 0\nOpen "input.txt" For Input As #1 Len=2\ns="keep"\nOn Error Resume Next\nErr.Clear\ns=Input$(4,#1)');check('Err.Number=62 And Err.Description="Input past end of file" And s="keep"','Input$ past EOF raises 62 and preserves the destination on failure');
  add('Err.Clear\nLine Input #1,s');check('Err.Number=62 And s="keep"','Line Input at EOF raises 62 without replacing its destination');
  add('Err.Clear\nSeek #1,1\ns=Input$(-1,#1)');check('Err.Number=5 And Seek(1)=1','a negative Input$ count fails before consuming data');
  add('Err.Clear\ns=Input$(0,#1)');check('s="" And Seek(1)=1','zero-count Input$ returns an empty String without consuming data');
  add('Err.Clear\nSeek #1,0');check('Err.Number=5 And Seek(1)=1','an invalid Seek position leaves the logical cursor unchanged');
  add('Err.Clear\nn=FileAttr(1,2)');check('Err.Number=5','unsupported 16-bit FileAttr handle requests are diagnosed, not fabricated');
  add('Err.Clear\nPrint #1,"not allowed"');check('Err.Number=54','Print rejects an Input-mode handle');
  add('Err.Clear\nWrite #1,"not allowed"');check('Err.Number=54','Write rejects an Input-mode handle');
  add('Err.Clear\nOn Error GoTo 0\nClose #1\nOpen "replacement.txt" For Output As #1\nOn Error Resume Next\nErr.Clear\ns=Input$(1,#1)');check('Err.Number=54','Input$ rejects an Output-mode handle');
  add('Err.Clear\nLine Input #1,s');check('Err.Number=54','Line Input rejects an Output-mode handle');
  add('Err.Clear\nClose #1\ns=Input$(0,#1)');check('Err.Number=52','zero-count Input$ still validates the file handle');
  add('Err.Clear\nOn Error GoTo 0\nOpen "input.txt" For Input As #1\nOn Error Resume Next\nErr.Clear\nSeek #1,ReopenInput()');check('Err.Number=52 And Seek(1)=1','Seek rejects a handle closed and reused while evaluating its position');
  add('Err.Clear\nOn Error GoTo 0\nClose #1\nOpen "input.txt" For Input As #1\nlines(1)="keep"\nOn Error Resume Next\nErr.Clear\nLine Input #1,lines(ReopenInput())');check('Err.Number=52 And lines(1)="keep" And Seek(1)=1','Line Input rejects a handle reused by destination subscript evaluation');
  add('Err.Clear\nOn Error GoTo 0\nClose #1\nn=GetProcessHandleCount(GetCurrentProcess(),before)\nFor n=1 To 40\n Open "input.txt" For Input As #1 Len=1\n s=Input$(1,#1)\n Close #1\nNext\nn=GetProcessHandleCount(GetCurrentProcess(),after)');check('before=after And FreeFile=1','repeated input buffer allocation and Close do not leak kernel handles');
 }
 add('Close\nn=DeleteFileW(StrPtr("input.txt"))\nn=DeleteFileW(StrPtr("replacement.txt"))');
 return finish(`Private indexCalls As Long
Private Type RowData
 text As String * 6
End Type
Private Declare Function CreateFileW Lib "kernel32" (ByVal name As Long, ByVal access As Long, ByVal share As Long, ByVal security As Long, ByVal creation As Long, ByVal flags As Long, ByVal template As Long) As Long
Private Declare Function WriteFile Lib "kernel32" (ByVal file As Long, ByVal bytes As Long, ByVal count As Long, actual As Long, ByVal overlap As Long) As Long
Private Declare Function CloseHandle Lib "kernel32" (ByVal handle As Long) As Long
Private Declare Function DeleteFileW Lib "kernel32" (ByVal name As Long) As Long
Private Declare Function GetFileAttributesW Lib "kernel32" (ByVal name As Long) As Long
Private Declare Function WideCharToMultiByte Lib "kernel32" (ByVal cp As Long, ByVal flags As Long, ByVal chars As Long, ByVal count As Long, ByVal bytes As Long, ByVal capacity As Long, ByVal replacement As Long, ByVal used As Long) As Long
Private Declare Function MultiByteToWideChar Lib "kernel32" (ByVal cp As Long, ByVal flags As Long, ByVal bytes As Long, ByVal count As Long, ByVal chars As Long, ByVal capacity As Long) As Long
Private Declare Function GetProcessHandleCount Lib "kernel32" (ByVal process As Long, count As Long) As Long
Private Declare Function GetCurrentProcess Lib "kernel32" () As Long`,
`Private Function WriteAnsi(ByVal path As String, ByVal value As String) As Boolean
 Dim file As Long, size As Long, count As Long, n As Long, bytes() As Byte
 file=CreateFileW(StrPtr(path),&H40000000,3,0,2,128,0)
 If file=-1 Then Exit Function
 If Len(value)>0 Then
  size=WideCharToMultiByte(0,0,StrPtr(value),Len(value),0,0,0,0)
  ReDim bytes(0 To size-1)
  n=WideCharToMultiByte(0,0,StrPtr(value),Len(value),VarPtr(bytes(0)),size,0,0)
  n=WriteFile(file,VarPtr(bytes(0)),size,count,0)
  WriteAnsi=n<>0 And count=size
 Else
  WriteAnsi=True
 End If
 n=CloseHandle(file)
End Function
Private Function AnsiRoundTrip(ByVal value As String) As String
 Dim bytes() As Byte, size As Long, count As Long, n As Long, result As String
 size=WideCharToMultiByte(0,0,StrPtr(value),Len(value),0,0,0,0)
 ReDim bytes(0 To size-1)
 n=WideCharToMultiByte(0,0,StrPtr(value),Len(value),VarPtr(bytes(0)),size,0,0)
 count=MultiByteToWideChar(0,0,VarPtr(bytes(0)),size,0,0)
 result=Space$(count)
 n=MultiByteToWideChar(0,0,VarPtr(bytes(0)),size,StrPtr(result),count)
 AnsiRoundTrip=result
End Function
Private Function NextIndex() As Long
 indexCalls=indexCalls+1
 NextIndex=1
End Function
Private Function ReopenInput() As Long
 Close #1
 Open "input.txt" For Input As #1
 ReopenInput=1
End Function`);
}
