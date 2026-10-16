import {key} from './names.js';

/** A tail assignment is not generally a return. Only a single executable
 * assignment with no read of the implicit result can discard that result cell. */
export function canReturnDirectly(procedure) {
  if(procedure.returnArray)return false; // The name also addresses the result array.
  if(procedure.kind!=='function'&&procedure.accessor!=='get')return false;
  const code=procedure.code.filter(op=>op.op!=='dim'&&!(op.op==='return'&&op.implicit));
  if(code.length!==1||code[0].op!=='assign'||code[0].target.kind!=='id'||key(code[0].target.name)!==key(procedure.name))return false;
  const reads=(node,callee=false)=>{
    if(!node||typeof node!=='object')return false;
    if(node.kind==='id')return !callee&&key(node.name)===key(procedure.name);
    if(node.kind==='call')return reads(node.callee,true)||node.args.some(arg=>reads(arg));
    if(node.kind==='member')return reads(node.object);
    return Object.values(node).some(value=>Array.isArray(value)?value.some(item=>reads(item)):value&&typeof value==='object'&&reads(value));
  };
  return !reads(code[0].expr);
}
