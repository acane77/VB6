import {nativeFixedStringReference} from './fixed-string-references.js';
/** Typed l-values bound to ByRef As Variant retain their original storage type.
 * A borrowed VT_BYREF view describes the real referent: writes are immediate,
 * checked Let-coercions. Fixed Strings additionally require the explicit
 * normal-return fixed-width adapter below; variable-length scalars alias directly.
 * https://learn.microsoft.com/en-us/openspecs/microsoft_general_purpose_programming_languages/ms-vbal/1fb9af32-fc48-4c4f-998a-ed8047048ca5
 */
import {mem8,mem16,mem32} from './x86-operands.js';
import {NATIVE_VARIANT_TYPES} from './variants.js';
const P='native:variant:',arg=argument=>({argument}),addr=address=>({address});
const at=(base,displacement=0)=>mem32({base,displacement});
const local=displacement=>at('ebp',displacement);
export function nativeVariantReference(c,variable){
 const type=String(variable.type).toLowerCase(),vt=NATIVE_VARIANT_TYPES[type];
 if(variable.nativeArray&&!variable.elementOf)c.fail('Whole-array ByRef Variant arguments are not yet lowered; use a typed array parameter');
 if(vt===undefined||variable.nativeRecord||variable.recordFieldArray)c.fail('Unsupported native ByRef Variant referent: '+variable.type);
 if(variable.fixedLength){
  const transfer=nativeFixedStringReference(c,variable),borrowed=c.arrayWorkspace(16,'fixed-string-variant-reference'),x=c.x;
  // A borrowed VT_BSTR view preserves String coercion during Variant assignment;
  // only its caller-owned String slot can be replaced, never the fixed referent.
  x.push();c.zeroStorage(borrowed);c.rawStorageAddress(borrowed);x.popOperand('edx').mov(mem16({base:'eax'}),0x4008).mov(mem32({base:'eax',displacement:8}),'edx');
  return {...transfer,borrowed};
 }
 const pin=c.address(variable);if(type==='variant')return {pin};
 c.useVariant('assign');const x=c.x,reference=c.arrayWorkspace(16,'byref-variant-view');
 x.push();c.zeroStorage(reference);c.rawStorageAddress(reference);x.popOperand('edx').mov(at('eax'),0x4000|vt).mov(at('eax',8),'edx');
 return {pin,reference};
}
export function emitNativeVariantReferences(x){
 const follow=x.unique(),ordinary=x.unique(),typed=x.unique(),string=x.unique(),byte=x.unique(),word=x.unique(),wide=x.unique(),done=x.unique();
 x.label(P+'assign').enter(16);for(const offset of [-16,-12,-8,-4])x.mov(local(offset),0);
 x.value(arg(8)).mov('ebx','eax').mov('edi',64).label(follow);
 x.testOperand('ebx','ebx').branch('e','error:91').movzx('esi',mem16({base:'ebx'}));
 x.cmp('esi',0x400c).branch('ne',typed).dec('edi').branch('e','error:13').mov('ebx',at('ebx',8)).jump(follow);
 x.label(typed).testOperand('esi',0x4000).branch('e',ordinary).and('esi',~0x4000>>>0);
 const supported=x.unique();for(const vt of [2,3,4,5,6,7,8,11,17])x.cmp('esi',vt).branch('e',supported);
 x.jump('error:13').label(supported).mov('ebx',at('ebx',8)).testOperand('ebx','ebx').branch('e','error:91');
 // The conversion is transactional and cannot mutate either the referent or
 // the borrowed descriptor on failure. Only scalar targets are accepted here.
 x.push(0).pushOperand('esi').push(arg(12)).push(addr(-16)).call(P+'change');
 x.cmp('esi',8).branch('e',string).cmp('esi',17).branch('e',byte);
 x.cmp('esi',2).branch('e',word).cmp('esi',11).branch('e',word);
 for(const vt of [5,6,7])x.cmp('esi',vt).branch('e',wide);
 x.mov('ecx',at('eax',8)).mov(at('ebx'),'ecx').jump(done);
 x.label(byte).mov('cl',mem8({base:'eax',displacement:8})).mov(mem8({base:'ebx'}),'cl').jump(done);
 x.label(word).mov('cx',mem16({base:'eax',displacement:8})).mov(mem16({base:'ebx'}),'cx').jump(done);
 x.label(wide).mov('ecx',at('eax',8)).mov('edx',at('eax',12)).mov(at('ebx'),'ecx').mov(at('ebx',4),'edx').jump(done);
 x.label(string).pushOperand(at('ebx')).invoke('oleaut32.dll','SysFreeString').mov('eax',local(-8)).mov(at('ebx'),'eax').mov(local(-8),0);
 x.label(done).push(addr(-16)).invoke('oleaut32.dll','VariantClear').value(arg(8)).leave(8);
 x.label(ordinary).push(arg(12)).pushOperand('ebx').call(P+'copy').value(arg(8)).leave(8);
}
