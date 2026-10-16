import {CodeWriter, identifier, key} from './names.js';
import {createContext} from './context.js';
import {declarationType} from './declarations.js';

/** Outline an entire multi-target statement, not its individual operations.
 * Captured procedure cells stay ByRef, so bounds are evaluated between mutations
 * and a caller's On Error/Resume observes exactly one source statement boundary.
 * No expression is evaluated while passing the helper's storage parameters. */
export function outlineArrayStatement(op, context, line, emit) {
  const names=new Set(),seen=new Set();
  let withReference=false;
  const visit=node=>{
    if(!node||typeof node!=='object'||seen.has(node))return;
    seen.add(node);
    if(node.kind==='with')withReference=true;
    if(node.kind==='id')names.add(key(node.name));
    for(const value of Object.values(node)){
      if(Array.isArray(value))value.forEach(visit);
      else if(value&&typeof value==='object')visit(value);
    }
  };
  for(const declaration of op.decls||[])names.add(key(declaration.name));
  visit(op);
  // A record With may denote an unmaterialized address. Do not turn it into a
  // by-value capture and silently lose mutation or receiver evaluation order.
  if(withReference){
    context.add('MIG_ARRAY_ERROR_BOUNDARY','A multi-target array statement inside With requires an explicit receiver-address adapter.');
    return;
  }
  const captures=[...names].map(name=>context.storage(name)).filter(symbol=>symbol&&(symbol.local||symbol.parameter||symbol.result));
  const name='__vbArrayStatement'+context.statementAdapters.size;
  const child=createContext(context,context.module,context.proc);
  child.locals=new Map(context.locals);
  child.aliases=new Map(context.aliases);
  child.line=context.line;
  child.outlinedArrayStatement=true;
  for(const [index,symbol] of captures.entries())child.aliases.set(key(symbol.name),'__vbCell'+index);
  const writer=new CodeWriter(context.generatedFile);
  writer.open('Private Sub '+name+'('+captures.map((symbol,index)=>'ByRef __vbCell'+index+' As '+declarationType(symbol,context)).join(', ')+')',context);
  emit(op,child,text=>writer.line(text,child));
  writer.close('End Sub');
  context.statementAdapters.set(name,{source:writer.toString(),location:{source:context.source,line:context.line}});
  line(identifier(name)+'('+captures.map(symbol=>context.name(symbol.name)).join(', ')+')');
}

export function emitStatementAdapters(writer, context) {
  for(const adapter of context.statementAdapters.values()){
    writer.line();
    writer.line(adapter.source.trimEnd(),adapter.location);
  }
}
