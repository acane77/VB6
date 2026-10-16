/** Project ByRef String adapters for fixed-length scalar storage. A callee owns
 * a writable variable-length view, while normal return commits through the
 * original fixed-width assignment path. Parenthesized values remain isolated.
 * The captured address and any SAFEARRAY pin survive later argument evaluation;
 * error transfers clean the bridge without publishing a partially completed call.
 */
import {mem32} from './x86-operands.js';
const arg=argument=>({argument});
export function nativeFixedStringReference(c,variable){
 const x=c.x,destination=c.arrayWorkspace(4,'fixed-string-destination'),pin=c.address(variable);
 x.mov(mem32({base:'ebp',displacement:destination.offset}),'eax');
 if(variable.nativeInlineString)x.push(variable.fixedLength).push(arg(destination.offset)).invoke('oleaut32.dll','SysAllocStringLen').test().branch('e','error:7');
 else x.mov('eax',mem32({base:'eax'})).push().call('native:string:copy');
 const temporary=c.ownString();
 const referent={type:'String',fixedLength:variable.fixedLength,nativeInlineString:variable.nativeInlineString,nativeKernelPointer:arg(destination.offset)};
 c.rawStorageAddress(temporary);
 return {pin,temporary,fixedString:{temporary,referent}};
}
export function commitNativeFixedStrings(c,transfers){
 if(!transfers.length)return;
 c.x.push();
 for(const {temporary,referent}of transfers){c.x.value(arg(temporary.offset));c.store(referent);}
 c.x.popOperand('eax');
}
