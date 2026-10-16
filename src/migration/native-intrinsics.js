import {frameworkRecordLayout} from './file-record-layout.js';
import {key} from './names.js';

/** Bind standard-library overloads from proven argument representations. Return
 * null when Null, owned arrays or legacy subtype behavior still needs a helper. */
export function nativeIntrinsic(node,context,emit,usage={}) {
  if(node.callee.kind!=='id'||context.find(node.callee.name))return null;
  const name=key(node.callee.name);
  // An approved semantic rule is independent of the chosen output style.
  if(name==='ccur'&&context.decimalCurrency)return 'CDec('+node.args.map(value=>emit(value)).join(', ')+')';
  if(context.options.codeStyle!=='native')return null;
  const arg=node.args[0],symbol=context.resolve(arg),declared=key(['isobject','ismissing','isarray','iserror','isempty','isnull','typename','vartype','callbyname'].includes(name)?context.type(arg):context.valueType(arg));
  const type=declared==='currency'&&context.decimalCurrency?'decimal':declared;
  const scalar=!symbol?.returnArray&&symbol?.bounds==null&&!['object','variant'].includes(type)&&!context.record(type);
  const nativeArray=context.arrayPlan(symbol)||symbol?.paramArray;
  if(nativeArray?.lower&&['lbound','ubound'].includes(name)){
    const dimension=node.args[1];
    if(!dimension||dimension.kind==='literal'&&dimension.value===1)return String(name==='lbound'?nativeArray.lower:nativeArray.upper);
    return context.runtime('VbNativeArrays.Bound')+'('+nativeArray.lower+', '+nativeArray.upper+', CInt('+emit(dimension)+'), '+(name==='ubound'?'True':'False')+')';
  }
  const args=()=>node.args.map(value=>emit(value)).join(', ');
  const strings='Global.Microsoft.VisualBasic.Strings.',info='Global.Microsoft.VisualBasic.Information.';
  if(['lbound','ubound','isarray'].includes(name)&&nativeArray)return info+({lbound:'LBound',ubound:'UBound',isarray:'IsArray'}[name])+'('+args()+')';
  if(['split','filter'].includes(name)&&usage.nativeArray)return strings+(name==='split'?'Split':'Filter')+'('+args()+')';
  if(name==='join'){
    const split=arg?.kind==='call'&&arg.callee.kind==='id'&&['split','filter'].includes(key(arg.callee.name))&&!context.find(arg.callee.name);
    if(nativeArray||split)return strings+'Join('+[emit(arg,{nativeArray:true}),...node.args.slice(1).map(value=>emit(value))].join(', ')+')';
  }
  if(name==='len'&&((scalar&&type!=='currency')||(symbol?.bounds==null&&context.record(type)&&frameworkRecordLayout(context.compiled,context.module,type))))return strings+'Len('+args()+')';
  if(name==='isnull'&&scalar)return 'Global.System.Convert.IsDBNull('+args()+')';
  if(name==='vartype'&&scalar&&type!=='currency')return 'CInt('+info+'VarType('+args()+'))';
  if(name==='abs'&&['single','double','decimal'].includes(type))return 'Global.System.Math.Abs('+args()+')';
  if(name==='sgn'&&['byte','integer','long','single','double','decimal'].includes(type))return 'Global.System.Math.Sign('+args()+')';
  if(name==='round'&&['double','decimal'].includes(type)&&(!node.args[1]||node.args[1].kind==='literal'&&Number.isInteger(node.args[1].value)&&node.args[1].value>=0&&node.args[1].value<=(type==='double'?15:28)))return 'Global.System.Math.Round('+args()+')';
  return null;
}

export function valueNeedsCopy(node,context){
  if(node&&['literal','currency','date','nothing','empty','missing'].includes(node.kind))return false;
  const symbol=context.resolve(node);
  if(symbol?.bounds!=null)return true;
  const record=context.record(context.type(node));
  if(record)return record.copy;
  return ['object','variant'].includes(key(context.type(node)));
}
