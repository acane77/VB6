import {emitStatementAdapters} from './statement-boundaries.js';
import {returnDeclaration, returnType as procedureReturnType} from './array-returns.js';
import {emitCallAdapters} from './call-order.js';
import {optionalOverloadModifier, declarationParameters, emitOptionalOverloads} from './optional-parameters.js';
import {emitFileAdapters} from './file-records.js';
import {propertyPlan, accessorName} from './property-plan.js';
import {canReturnDirectly} from './output-plan.js';
import {finishRuntimeImports} from './runtime-plan.js';
import {defaultIdentifierType} from '../language/default-types.js';
import {key, identifier, qualified, CodeWriter} from './names.js';
import {createContext, isBuiltin} from './context.js';
import {defaultValue} from './expressions.js';
import {parameter, variable, declarationType, emitRecords, emitEnums, emitDeclare} from './declarations.js';
import {emitStatements} from './statements.js';

function publicMembers(module) { return [...module.procedures.values()].filter(p=>p.scope==='public'&&!p.external); }
function implementation(proc,context,emittedName=proc.name) {
  const matches=[];
  const ownContract=context.interfaces.has(key(context.module.name));
  if(ownContract&&proc.scope==='public')matches.push(identifier('I'+context.module.name)+'.'+identifier(emittedName));
  for(const contract of context.module.interfaces){
    const prefix=key(contract.name)+'_';
    if(key(proc.name).startsWith(prefix)){
      const name=proc.name.slice(contract.name.length+1);
      const mapped=emittedName===proc.name?name:accessorName(name,proc.accessor);
      matches.push(identifier('I'+contract.name)+'.'+identifier(mapped));
    }
  }
  return matches.length?' Implements '+matches.join(', '):'';
}
function inferredLocals(context) {
  // VB6 locals have procedure scope even when Dim appears inside a block.
  // Walk the bound IR rather than scanning identifier-looking text in literals.
  const seen=new Set(),visit=(node,position='value')=>{
    if(!node||typeof node!=='object'||seen.has(node))return;seen.add(node);
    if(node.kind==='id'){
      const name=node.name;
      if(position==='callee'||context.find(name)||isBuiltin(name)||key(name)===key(context.proc.name))return;
      if(context.module.optionExplicit)return; // Expression hooks resolve before unresolved-name diagnostics.
      context.locals.set(key(name),{name,type:defaultIdentifierType(name,context.module.defaultTypes),bounds:null,local:true,implicit:true});
      return;
    }
    if(node.kind==='member'){visit(node.object);return;}
    if(node.kind==='call'){visit(node.callee,'callee');for(const arg of node.args)visit(arg);return;}
    if(node.kind==='new'||node.kind==='addressOf')return;
    for(const [name,value] of Object.entries(node))if(name!=='decls'){
      if(Array.isArray(value))for(const item of value)visit(item);else if(value&&typeof value==='object')visit(value);
    }
  };
  for(const op of context.proc.code){
    if(['forInit','eachInit'].includes(op.op)&&!context.find(op.name)&&!op.name.includes('.')){
      if(context.module.optionExplicit)context.add('MIG_UNRESOLVED_NAME','Loop variable is not declared: '+op.name);
      else context.locals.set(key(op.name),{name:op.name,type:defaultIdentifierType(op.name,context.module.defaultTypes),bounds:null,local:true,implicit:true});
    }
    visit(op);
  }
}
function procedureBody(writer,context) {
  const {proc}=context;inferredLocals(context);
  for(const param of proc.params)if(!param.byRef&&!param.paramArray){
    const record=[...context.compiled.modules.values()].some(module=>Object.keys(module.types).some(type=>key(type)===key(param.type)));
    if(key(param.type)==='variant'||record&&(context.options.codeStyle!=='native'||context.record(param.type)?.copy)){
      const name=context.name(param.name),copy=context.runtime('VbRuntime.CopyValue')+'('+name+')';
      writer.line(name+' = '+(record?'CType('+copy+', '+context.netType(param.type)+')':copy),context);
    }
  }
  context.directReturn=context.options.codeStyle==='native'&&canReturnDirectly(proc)&&!context.representations.opaque;
  if(!context.directReturn&&(proc.kind==='function'||proc.accessor==='get')){
    context.aliases.set(key(proc.name),'__vbResult');
    writer.line('Dim __vbResult As '+procedureReturnType(proc,context)+' = '+defaultValue(returnDeclaration(proc),context));
  }
  if(proc.code.some(op=>op.op==='gosub'||op.op==='gosubReturn'||op.op==='computedJump'&&op.gosub))writer.line('Dim __vbReturns As New Global.System.Collections.Generic.Stack(Of Integer)()');
  for(const decl of context.locals.values())if(!decl.parameter){
    writer.line(variable(decl,context,{local:true,staticLocal:decl.static}),context);
  }
  // ParamArray is a CLR vector. Its array bounds are zero-based, as in VB6;
  // aliases distinguish it from general VbArray parameters.
  if(proc.code.some(op=>['onError','resume'].includes(op.op))&&proc.code.some(op=>op.op==='gosub'||op.op==='computedJump'&&op.gosub))context.add('MIG_GOSUB_RESUME','Combined GoSub and unstructured error resumption needs differential validation of synthetic continuation boundaries.');
  emitStatements(writer,context);
  if(!context.directReturn&&(proc.kind==='function'||proc.accessor==='get'))writer.line('Return __vbResult');
}
function emitProperty(writer,group,state,module,{contract=false}={}) {
  const get=group.find(p=>p.accessor==='get'),set=group.find(p=>p.accessor==='let')||group.find(p=>p.accessor==='set'),proc=get||set,context=createContext(state,module,proc);
  const value=set?.params.at(-1),params=get?get.params:set.params.slice(0,-1);
  if(propertyPlan(module,proc.name,context)?.methods){
    for(const accessor of group){
      const scope=contract?'':accessor.scope==='private'?'Private ':accessor.scope==='friend'?'Friend ':'Public ';
      const name=accessorName(accessor.name,accessor.accessor),reader=accessor.accessor==='get';
      const body=createContext(state,module,accessor);
      const header=scope+optionalOverloadModifier(accessor,body,contract)+(reader?'Function ':'Sub ')+identifier(name)+'('+declarationParameters(accessor,body).map(p=>parameter(p,body)).join(', ')+')'+(reader?' As '+procedureReturnType(accessor,body):'')+(contract?'':implementation(accessor,body,name));
      if(contract)writer.line(header,body);
      else{writer.open(header,body);procedureBody(writer,body);writer.close(reader?'End Function':'End Sub');writer.line();}
      emitOptionalOverloads(writer,accessor,body,{name,contract,scope,implementation:contract?'':implementation(accessor,body,name),parameter});
    }
    return;
  }
  if(group.filter(p=>p.accessor!=='get').length>1)context.add('MIG_DUAL_PROPERTY_SET','Property Let and Property Set share a name; .NET has one setter, so an object/value-dispatch adapter is required.');
  const prefix=(contract?'':proc.scope==='private'?'Private ':'Public ')+(module.defaultMember===key(proc.name)&&params.length?'Default ':'')+(get&&!set?'ReadOnly ':!get&&set?'WriteOnly ':'');
  const header=prefix+'Property '+identifier(proc.name)+(params.length?'('+params.map(p=>parameter({...p,byRef:false},context)).join(', ')+')':'')+' As '+procedureReturnType(get||{returnType:value?.type,returnArray:value?.bounds!=null},context)+(contract?'':implementation(proc,context));
  if(params.some(p=>p.byRef))context.add('MIG_PROPERTY_BYREF','VB.NET indexed properties use ByVal index arguments; VB6 ByRef index mutation requires accessor-method lowering.');
  if(contract){writer.line(header);return;}
  writer.open(header,context);
  if(get){writer.open('Get');procedureBody(writer,createContext(state,module,get));writer.close('End Get');}
  if(set){
    const setter=createContext(state,module,set);setter.aliases.set(key(value.name),'value');
    for(let i=0;i<params.length;i++)setter.aliases.set(key(set.params[i].name),identifier(params[i].name));
    writer.open('Set(value As '+procedureReturnType(get||{returnType:value?.type,returnArray:value?.bounds!=null},context)+')');procedureBody(writer,setter);writer.close('End Set');
  }
  writer.close('End Property');writer.line();
}
function propertyGroups(module) {
  const groups=new Map();for(const p of module.procedures.values())if(p.kind==='property'){const name=key(p.name);if(!groups.has(name))groups.set(name,[]);groups.get(name).push(p);}return groups;
}
function field(writer,decl,context) {
  if(decl.enumName)return;
  const type=declarationType(decl,context),name=identifier(decl.name);
  if(decl.autoNew){
    const backing='__vbAuto_'+decl.name;
    writer.line('Private '+identifier(backing)+' As '+type);
    writer.open((decl.scope==='public'?'Public ':decl.scope==='friend'?'Friend ':'Private ')+'Property '+name+' As '+type+(context.interfaces.has(key(context.module.name))&&decl.scope==='public'?' Implements '+identifier('I'+context.module.name)+'.'+name:''));
    writer.open('Get');writer.line('If '+identifier(backing)+' Is Nothing Then '+identifier(backing)+' = New '+qualified(decl.type)+'()');writer.line('Return '+identifier(backing));writer.close('End Get');
    writer.open('Set(value As '+type+')');writer.line(identifier(backing)+' = value');writer.close('End Set');writer.close('End Property');
  }else if(context.interfaces.has(key(context.module.name))&&decl.scope==='public'&&!decl.constant){
    const backing=identifier('__vbField_'+key(decl.name));
    writer.line('Private '+backing+' As '+type+' = '+defaultValue(decl,context));
    writer.open('Public Property '+name+' As '+type+' Implements '+identifier('I'+context.module.name)+'.'+name);
    writer.open('Get');writer.line('Return '+backing);writer.close('End Get');
    writer.open('Set(value As '+type+')');writer.line(backing+' = value');writer.close('End Set');writer.close('End Property');
  }else writer.line(variable(decl,context),{source:context.source,line:decl.line||1});
}
export function emitModule(state,module,path) {
  state={...state,generatedFile:path,fileAdapters:new Map(),callAdapters:new Map(),statementAdapters:new Map()};
  const writer=new CodeWriter(path),context=createContext(state,module);
  writer.line('Option Explicit On');writer.line('Option Strict '+(state.options.strict?'On':'Off'));writer.line('Option Infer On');writer.line('Option Compare '+(module.optionCompare==='text'?'Text':'Binary'));
  writer.line('Imports System');writer.line('Imports Microsoft.VisualBasic');
  writer.runtimeImportStart=writer.lines.length;writer.line();writer.line();writer.line();
  // Generated identifiers are reserved only within converted modules, never
  // changed silently when the source already uses this prefix.
  if(/\b__vb\w*/i.test(module.source))context.add('MIG_GENERATED_NAME','Source uses the reserved migration identifier prefix __vb; rename it or supply a naming adapter.');
  if(module.kind!=='module'&&module.kind!=='class'&&module.kind!=='form')context.add('MIG_MODULE_KIND','Unsupported module kind '+module.kind);
  if(state.interfaces.has(key(module.name))){
    writer.open('Public Interface '+identifier('I'+module.name));
    for(const decl of module.declarations.filter(d=>d.scope==='public'&&!d.constant))writer.line('Property '+identifier(decl.name)+' As '+declarationType(decl,context));
    for(const proc of publicMembers(module).filter(p=>p.kind!=='property')){
      writer.line(optionalOverloadModifier(proc,context,true)+(proc.kind==='function'?'Function ':'Sub ')+identifier(proc.name)+'('+declarationParameters(proc,context).map(p=>parameter(p,context)).join(', ')+')'+(proc.kind==='function'?' As '+procedureReturnType(proc,context):''));
      emitOptionalOverloads(writer,proc,context,{contract:true,parameter});
    }
    for(const group of propertyGroups(module).values())if(group[0].scope==='public')emitProperty(writer,group,state,module,{contract:true});
    for(const event of module.events?.values()||[])if(event.scope==='public')writer.line('Event '+identifier(event.name)+'('+event.params.map(p=>parameter(p,context)).join(', ')+')');
    writer.close('End Interface');writer.line();
  }
  writer.open('Public '+(module.form?'Partial Class ':module.kind==='module'?'Module ':'Class ')+identifier(module.name));
  if(module.form)writer.line('Inherits Global.System.Windows.Forms.Form');
  const contracts=[...module.interfaces.map(i=>identifier('I'+i.name)),...(state.interfaces.has(key(module.name))?[identifier('I'+module.name)]:[])];
  const terminate=module.procedures.get('class_terminate');if(terminate)contracts.push('Global.System.IDisposable');
  if(contracts.length)writer.line('Implements '+contracts.join(', '));
  emitEnums(writer,context);emitRecords(writer,context);
  for(const decl of module.declarations)field(writer,decl,context);
  for(const event of module.events?.values()||[])writer.line((event.scope==='private'?'Private ':'Public ')+'Event '+identifier(event.name)+'('+event.params.map(p=>parameter(p,context)).join(', ')+')'+(state.interfaces.has(key(module.name))&&event.scope==='public'?' Implements '+identifier('I'+context.module.name)+'.'+identifier(event.name):''));
  writer.line();
  const initialize=module.procedures.get('class_initialize');
  if(module.form&&!initialize){writer.open('Public Sub New()');writer.line('InitializeComponent()');const init=[...module.procedures.values()].find(p=>/^(Form|MDIForm)_Initialize$/i.test(p.name));if(init){if(init.params.length)context.add('MIG_EVENT_SIGNATURE','Form Initialize must not have parameters.');else writer.line(identifier(init.name)+'()');}writer.close('End Sub');writer.line();}
  for(const proc of module.procedures.values()){
    if(proc.kind==='property')continue;
    const c=createContext(state,module,proc);if(proc.external){emitDeclare(writer,proc,c);continue;}
    const constructor=key(proc.name)==='class_initialize',dispose=key(proc.name)==='class_terminate';
    let header;
    if(constructor)header='Public Sub New()';
    else if(dispose){c.add('MIG_DETERMINISTIC_LIFETIME','Class_Terminate is emitted as IDisposable.Dispose; COM reference-counted destruction requires an explicit ownership migration.');header='Public Sub Dispose() Implements Global.System.IDisposable.Dispose';}
    else{
      header=(proc.scope==='public'?'Public ':proc.scope==='friend'?'Friend ':'Private ')+optionalOverloadModifier(proc,c)+(proc.kind==='function'?'Function ':'Sub ')+identifier(proc.name)+'('+declarationParameters(proc,c).map(p=>parameter(p,c)).join(', ')+')'+(proc.kind==='function'?' As '+procedureReturnType(proc,c):'')+implementation(proc,c);
      const source=module.declarations.find(d=>d.withEvents&&key(proc.name).startsWith(key(d.name)+'_'));
      if(source){const event=proc.name.slice(source.name.length+1);header+=' Handles '+identifier(source.name)+'.'+identifier(event);}
    }
    writer.open(header,c);if(constructor&&module.form)writer.line('InitializeComponent()');procedureBody(writer,c);writer.close(proc.kind==='function'?'End Function':'End Sub');writer.line();
    emitOptionalOverloads(writer,proc,c,{scope:proc.scope==='public'?'Public ':proc.scope==='friend'?'Friend ':'Private ',implementation:implementation(proc,c),parameter});
  }
  for(const group of propertyGroups(module).values())emitProperty(writer,group,state,module);
  if(!state.directEntry&&state.entry?.kind==='main'&&key(state.entry.module)===key(module.name)){writer.open('Friend Sub __vbStart()');writer.line('[Main]()');writer.close('End Sub');}
  emitFileAdapters(writer,context);
  emitCallAdapters(writer,context);
  emitStatementAdapters(writer,context);
  writer.close(module.kind==='module'?'End Module':'End Class');
  return finishRuntimeImports(writer,context);
}
