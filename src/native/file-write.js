/** Locale-independent Write # records, emitted as ordinary private VB/x86.
 * Delimiters are the VBA interchange format, not RFC 4180 CSV. In particular,
 * embedded quotation marks are preserved, not doubled into a different format.
 * https://learn.microsoft.com/office/vba/language/reference/user-interface-help/writestatement
 */
import {MAX_NATIVE_STRING} from './storage.js';
import {mem16,mem32} from './x86-operands.js';
const arg=argument=>({argument}),slot=v=>mem32({base:'ebp',displacement:v.offset});
export const NATIVE_WRITE_SOURCE=`Option Explicit
Private Declare Function VariantChangeTypeEx Lib "oleaut32" (ByVal destination As Long, ByVal source As Long, ByVal locale As Long, ByVal flags As Integer, ByVal target As Integer) As Long
Private Function TwoDigits(ByVal value As Long) As String
 TwoDigits=Right$("0" & CStr(value),2)
End Function
Private Function Field(ByVal value As Variant) As String
 Dim kind As Long, converted As Variant, result As String, hr As Long, d As Date
 kind=VarType(value)
 Select Case kind
 Case 0
  Field=""
 Case 1
  Field="#NULL#"
 Case 8
  Field=Chr$(34) & CStr(value) & Chr$(34)
 Case 11
  If CBool(value) Then
   Field="#TRUE#"
  Else
   Field="#FALSE#"
  End If
 Case 10
  Field="#ERROR " & Mid$(CStr(value),7) & "#"
 Case 7
  d=CDate(value)
  If Fix(CDbl(d))<>0 Then result=Right$("000" & CStr(Year(d)),4) & "-" & TwoDigits(Month(d)) & "-" & TwoDigits(Day(d))
  If Hour(d)<>0 Or Minute(d)<>0 Or Second(d)<>0 Or result="" Then
   If result<>"" Then result=result & " "
   result=result & TwoDigits(Hour(d)) & ":" & TwoDigits(Minute(d)) & ":" & TwoDigits(Second(d))
  End If
  Field="#" & result & "#"
 Case 2,3,4,5,6,14,17
  ' Fixed en-US LCID plus NOUSEROVERRIDE: never use a user decimal separator.
  hr=VariantChangeTypeEx(VarPtr(converted),VarPtr(value),1033,4,8)
  If hr<0 Then
   If hr=&H8007000E Then Err.Raise 7
   If hr=&H8002000A Then Err.Raise 6
   Err.Raise 13
  End If
  Field=CStr(converted)
 Case Else
  Err.Raise 13
 End Select
End Function`;
function kernel(c){return c.nativeWriteKernel ||= c.privateNativeKernel('NativeWriteRecord',NATIVE_WRITE_SOURCE);}
export function nativeWriteImage(c,instruction){
 const x=c.x,parts=c.arrayWorkspace(Math.max(4,instruction.exprs.length*8),'write-fields'),position=c.arrayWorkspace(4,'write-column');
 c.nativeWriteUsed=true;
 // Field results already have independent statement-scoped BSTR owners. Keep
 // those snapshots until every expression succeeds, then size/copy exactly once.
 for(const [index,expr] of instruction.exprs.entries()){
  c.invokePrivateNative(kernel(c),'Field',[expr]);
  x.mov(mem32({base:'ebp',displacement:parts.offset+index*8}),'eax');
 }
 c.rawStorageAddress(parts);x.push(instruction.exprs.length).push({address:parts.offset}).call('native:file:write-image');
 const out=c.ownString();x.mov(slot(position),0).value(arg(out.offset));return {out,position};
}
export function emitNativeWriteImage(c){
 if(!c.nativeWriteUsed)return;const x=c.x,at=(base,displacement=0)=>mem32({base,displacement});
 const sized=x.unique(),sizing=x.unique(),empty=x.unique(),copy=x.unique(),end=x.unique();
 x.label('native:file:write-image').enter(4).value(arg(12)).compare(MAX_NATIVE_STRING-1).branch('a','error:7').mov('ebx','eax').mov('edi','eax').inc('edi').testOperand('ebx','ebx').branch('e',empty).value(arg(8)).mov('esi','eax');
 x.label(sizing).pushOperand(at('esi')).invoke('oleaut32.dll','SysStringLen').mov(at('esi',4),'eax').add('edi','eax').branch('c','error:7').cmp('edi',MAX_NATIVE_STRING).branch('a','error:7').add('esi',8).dec('ebx').branch('ne',sizing).jump(sized);
 x.label(empty).mov('edi',2).label(sized).pushOperand('edi').push(0).invoke('oleaut32.dll','SysAllocStringLen').test().branch('e','error:7').mov(at('ebp',-4),'eax').mov('edi','eax').value(arg(12)).mov('ebx','eax').test().branch('e',end).value(arg(8)).mov('esi','eax');
 x.label(copy).mov('ecx',at('esi',4)).pushOperand('esi').mov('esi',at('esi')).emit(0xfc,0x66,0xf3,0xa5).popOperand('esi').dec('ebx').branch('e',end).mov(mem16({base:'edi'}),44).add('edi',2).add('esi',8).jump(copy);
 x.label(end).mov(at('edi'),0x000a000d).mov('eax',at('ebp',-4)).leave(8);
}
