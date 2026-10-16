/** Counted ANSI-to-UTF16 sequential input. ASCII takes an allocation-free fast
 * path; multibyte characters are decoded by the installed Windows ANSI code page,
 * including sequences split across buffer fills. CR and CRLF terminate Line Input;
 * an isolated LF remains data, as required by the VBA statement contract.
 * https://learn.microsoft.com/office/vba/language/reference/user-interface-help/input-function
 * https://learn.microsoft.com/office/vba/language/reference/user-interface-help/line-inputstatement
 */
import {NATIVE_INPUT_FIELDS_SOURCE} from './file-input-fields.js';
import {mem8,mem16,mem32} from './x86-operands.js';
const arg=argument=>({argument});
export const NATIVE_INPUT_SOURCE=`Option Explicit
Private Declare Function MultiByteToWideChar Lib "kernel32" (ByVal codepage As Long, ByVal flags As Long, ByVal source As Long, ByVal count As Long, ByVal destination As Long, ByVal capacity As Long) As Long
Private Function PeekByte(ByVal entry As Long) As Long
End Function
Private Function ReadByte(ByVal entry As Long) As Long
End Function
Private Function Word(ByVal pointer As Long, ByVal offset As Long) As Long
End Function
Private Sub PutWord(ByVal pointer As Long, ByVal offset As Long, ByVal value As Long)
End Sub
Private Function Unit(ByVal pointer As Long, ByVal offset As Long) As Long
End Function
Private Sub PutUnit(ByVal pointer As Long, ByVal offset As Long, ByVal value As Long)
End Sub
Private Sub PutByte(ByVal pointer As Long, ByVal offset As Long, ByVal value As Long)
End Sub
Private Function ReadUnit(ByVal entry As Long) As Long
 Dim pending As Long, value As Long, packed As Long, units As Long, count As Long, converted As Long
 pending=Word(entry,44)
 If pending<>0 Then
  PutWord entry,44,0
  ReadUnit=pending-1
  Exit Function
 End If
 value=ReadByte(entry)
 If value<128 Then
  ReadUnit=value
  Exit Function
 End If
 packed=value
 For count=1 To 4
  converted=MultiByteToWideChar(0,8,VarPtr(packed),count,VarPtr(units),2)
  If converted<>0 Then
   ReadUnit=Unit(VarPtr(units),0)
   If converted=2 Then PutWord entry,44,Unit(VarPtr(units),2)+1
   Exit Function
  End If
  If count=4 Then Err.Raise 5
  value=ReadByte(entry)
  If value<0 Then Err.Raise 62
  PutByte VarPtr(packed),count,value
 Next
End Function
Private Function ReadText(ByVal entry As Long, ByVal number As Long) As String
 Dim result As String, destination As Long, i As Long, value As Long
 If number<0 Then Err.Raise 5
 If number>1048576 Then Err.Raise 7
 result=Space$(number)
 destination=StrPtr(result)
 For i=0 To number-1
  value=ReadUnit(entry)
  If value<0 Then Err.Raise 62
  PutUnit destination,i*2,value
 Next
 ReadText=result
End Function
Private Function ReadLine(ByVal entry As Long) As String
 Dim result As String, destination As Long, capacity As Long, length As Long, value As Long, ignored As Long
 capacity=256
 result=Space$(capacity)
 destination=StrPtr(result)
 Do
  value=ReadUnit(entry)
  If value<0 Then
   If length=0 Then Err.Raise 62
   Exit Do
  End If
  If value=13 Then
   If PeekByte(entry)=10 Then ignored=ReadByte(entry)
   Exit Do
  End If
  If length=capacity Then
   If capacity>=1048576 Then Err.Raise 7
   result=result & Space$(capacity)
   capacity=capacity*2
   destination=StrPtr(result)
  End If
  PutUnit destination,length*2,value
  length=length+1
 Loop
 ReadLine=Left$(result,length)
End Function`;
function memoryHost(width,store){return (c,p)=>{
 const x=c.x,mem={8:mem8,16:mem16,32:mem32}[width];
 x.label(p.label).enter().value(arg(8)).mov('edx','eax').value(arg(12)).add('edx','eax');
 if(store)x.value(arg(16)).mov(mem({base:'edx'}),{8:'al',16:'ax',32:'eax'}[width]);
 else if(width===32)x.mov('eax',mem({base:'edx'}));else x.movzx('eax',mem({base:'edx'}));
 x.leave(store?12:8);
};}
export function nativeInputKernel(c){return c.nativeInputKernel ||= c.privateNativeKernel('NativeFileText',NATIVE_INPUT_SOURCE+NATIVE_INPUT_FIELDS_SOURCE,{
 peekbyte:(c,p)=>c.x.label(p.label).enter().push(arg(8)).call('native:file:peek').leave(4),
 readbyte:(c,p)=>c.x.label(p.label).enter().push(arg(8)).call('native:file:read-byte').leave(4),
 word:memoryHost(32,false),putword:memoryHost(32,true),unit:memoryHost(16,false),putunit:memoryHost(16,true),putbyte:memoryHost(8,true)
},{word:'load32',putword:'store32',unit:'load16',putunit:'store16',putbyte:'store8'});}
export function nativeReadText(c,entry,number){c.invokePrivateNative(nativeInputKernel(c),'ReadText',[entry,number]);}
export function nativeReadLine(c,entry){c.invokePrivateNative(nativeInputKernel(c),'ReadLine',[entry]);}

export function nativeReadField(c,entry,target){c.invokePrivateNative(nativeInputKernel(c),'ReadField',[entry,target]);}
