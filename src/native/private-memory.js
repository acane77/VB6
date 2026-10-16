/** Explicit compiler-owned pointer primitives. These are lowering rules, not
 * name-based substitutions of authored methods or an optimization-level escape.
 * Only marked private hosts with the exact all-Long ByVal ABI are admitted.
 * Evaluation order and the existing pending-error boundary are retained.
 */
import {mem8,mem16,mem32} from './x86-operands.js';
const key=value=>String(value).toLowerCase();
export const PRIVATE_MEMORY_INTRINSICS=Object.freeze({word:'load32',putword:'store32'});
export function bindPrivateMemoryIntrinsics(kernel,intrinsics={}){
 for(const [name,kind]of Object.entries(intrinsics)){
  const target=kernel.procedures.get(key(name)),load=/^load(?:8|16|32)$/.test(kind),store=/^store(?:8|16|32)$/.test(kind),count=load?2:store?3:0;
  if(!count||!kernel.hosts[key(name)]||!target||target.proc.params.length!==count||target.proc.params.some(p=>p.byRef||p.optional||p.paramArray||p.bounds!=null||key(p.type)!=='long')||
    (load?(target.proc.kind!=='function'||key(target.proc.returnType)!=='long'):target.proc.kind!=='sub'))throw new TypeError('Invalid private memory intrinsic: '+name);
  target.nativeMemoryIntrinsic=kind;
 }
}
export function inlinePrivateMemoryCall(c,target,plan){
 const kind=target.nativeMemoryIntrinsic;
 if(!kind||!target.module?.deferredNativeKernel)return false;
 const args=plan.order,load=kind.startsWith('load'),width=Number(kind.replace(/^(?:load|store)/,'')),mem={8:mem8,16:mem16,32:mem32}[width],reg={8:'al',16:'ax',32:'eax'}[width];
 const read=operand=>width===32?c.x.mov('eax',operand):c.x.movzx('eax',operand);
 // Named/reordered or explicit call-site ByVal semantics take the ordinary ABI.
 if(args.length!==(load?2:3)||args.some((a,i)=>a.index!==i||a.omitted||['byval','addressOf'].includes(a.node.kind)))return false;
 const x=c.x,offset=args[1].node;
 c.numeric(args[0].node);
 const constant=offset.kind==='literal'&&typeof offset.value==='number'&&Number.isInteger(offset.value)&&offset.value>=-2147483648&&offset.value<=2147483647;
 if(constant){
  if(load)read(mem({base:'eax',displacement:offset.value}));
  else {x.push();c.numeric(args[2].node);x.popOperand('edx').mov(mem({base:'edx',displacement:offset.value}),reg);}
 }else{
  x.push();c.numeric(offset);x.popOperand('edx');
  if(load)read(mem({base:'edx',index:'eax'}));
  else {x.lea('edx',mem32({base:'edx',index:'eax'})).pushOperand('edx');c.numeric(args[2].node);x.popOperand('edx').mov(mem({base:'edx'}),reg);}
 }
 return true;
}
