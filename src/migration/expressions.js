import {defaultValueExpression} from './default-members.js';
import {orderedCall} from './call-order.js';
import {bindOptionalArguments, optionalDefault} from './optional-parameters.js';
import {accessorReference, propertyPlan, defaultPropertyCall} from './property-plan.js';
import {nativeIntrinsic, valueNeedsCopy} from './native-intrinsics.js';
import {validateCallSemantics} from './call-semantics.js';
import {key, identifier, qualified, vbString} from './names.js';
import {INTRINSICS, INTRINSIC_CONSTANTS, BUILTIN_NAMES, SIMPLE_MEMBERS} from './registry.js';

const CONSTANTS=Object.freeze({vbmodal:'1',vbmodeless:'0',vbchecked:'1',vbunchecked:'0',vbgrayed:'2',
  vbleftbutton:'1',vbrightbutton:'2',vbmiddlebutton:'4',vbshiftmask:'1',vbctrlmask:'2',vbaltmask:'4',
  vbtwips:'1',vbpixels:'3',vbinches:'5',vbcentimeters:'7',vbpoints:'2',vbmillimeters:'6',
  vbkeyreturn:'13',vbkeyescape:'27',vbkeyspace:'32',vbkeyleft:'37',vbkeyup:'38',vbkeyright:'39',vbkeydown:'40',
  vbkeyback:'8',vbkeytab:'9',vbkeydelete:'46',vbkeyhome:'36',vbkeyend:'35',vbkeypageup:'33',vbkeypagedown:'34',
  vbtextcompare:'Global.Microsoft.VisualBasic.CompareMethod.Text',vbbinarycompare:'Global.Microsoft.VisualBasic.CompareMethod.Binary',
  vbobjecterror:'-2147221504',vbnullstring:'String.Empty',vbtrue:'-1',vbfalse:'0'});
const RAW_INTRINSICS=new Set(['isobject','ismissing','isarray','iserror','isempty','isnull','typename','vartype','callbyname']);
const VARIANT_TYPES=new Set(['object','variant']);
export function expression(node, context, usage={}) {
  const replacement=context.hook('expression',{node,usage});if(replacement!==undefined)return replacement;
  if(!node)return 'Nothing';
  const e=(value,mode={})=>expression(value,context,mode);
  const expanded=defaultPropertyCall(node,context);if(expanded)return e(expanded,usage);
  if(!usage.defaultExpanded&&!usage.receiver&&!usage.reference&&!usage.callee&&!usage.assignment&&!usage.argument){
    const value=defaultValueExpression(node,context);if(value!==node)return e(value,{...usage,defaultExpanded:true});
  }
  switch(node.kind) {
    case 'literal':
      if(node.value===null)return 'Global.System.DBNull.Value';
      if(node.valueType==='boolean')return node.value?'True':'False';
      if(typeof node.value==='string')return vbString(node.value);
      if(typeof node.value==='number'){
        if(!Number.isFinite(node.value)){context.add('MIG_LITERAL','Non-finite numeric literal');return '0';}
        const suffix={integer:'S',long:'I',single:'F',double:'R'}[node.valueType]||'';
        // The positive token of -32768 cannot be parsed as a signed Short literal.
        if(node.value===-32768&&suffix==='S')return 'Short.MinValue';
        if(node.value===-2147483648&&suffix==='I')return 'Integer.MinValue';
        return String(node.value)+(Number.isInteger(node.value)&&['R','F'].includes(suffix)?'.0':'')+suffix;
      }
      return String(node.value);
    case 'currency': context.netType('Currency'); return context.decimalCurrency?node.value+'D':context.runtime('VbCurrency.FromDecimal')+'('+node.value+'D)';
    case 'date': return 'Global.System.DateTime.Parse('+vbString(node.value)+', Global.System.Globalization.CultureInfo.InvariantCulture)';
    case 'nothing': case 'empty': return 'Nothing';
    case 'missing': return usage.argument?'':context.runtime('VbMissing.Value');
    case 'named': return identifier(node.name)+':='+e(node.expr,{argument:true});
    case 'byval': case 'group': return '('+e(node.expr,usage)+')';
    case 'with': return context.withReceiver||'';
    case 'addressOf': context.add('MIG_CALLBACK_ABI','AddressOf requires a typed unmanaged delegate and a verified calling convention.');return 'AddressOf '+qualified(node.name);
    case 'new': return 'New '+qualified(node.name)+'()';
    case 'typeof': return '(TypeOf '+e(node.expr,{reference:true})+' Is '+context.netType(node.name)+')';
    case 'unary': {
      const value=e(node.expr);
      if(VARIANT_TYPES.has(key(context.valueType(node.expr))))return context.runtime('VbVariant.Unary')+'('+vbString(node.op)+', '+value+')';
      return '('+(node.op==='not'?'Not ':node.op)+value+')';
    }
    case 'binary': {
      const op=node.op,a=e(node.left,{reference:op==='is'}),b=e(node.right,{reference:op==='is'});
      if(op!=='is'&&(VARIANT_TYPES.has(key(context.valueType(node.left)))||VARIANT_TYPES.has(key(context.valueType(node.right)))))return context.runtime('VbVariant.Binary')+'('+vbString(op)+', '+a+', '+b+', '+(context.module.optionCompare==='text'?'True':'False')+')';
      if(op==='eqv')return '(Not ('+a+' Xor '+b+'))';
      if(op==='imp')return '((Not '+a+') Or '+b+')';
      return '('+a+' '+({and:'And',or:'Or',xor:'Xor',mod:'Mod',is:'Is',like:'Like'}[op]||op)+' '+b+')';
    }
    case 'id': {
      const k=key(node.name),symbol=context.find(node.name);
      if(k==='me')return 'Me';
      if(context.aliases.has(k)&&!(usage.callee&&!context.proc?.returnArray&&k===key(context.proc?.name||'')))return context.aliases.get(k);
      if(symbol){
        if(symbol.formMember)return e({kind:'member',object:{kind:'id',name:'Me'},name:symbol.name},usage);
        if(symbol.form)return context.runtime('VbForms.GetInstance')+'(Of '+qualified(symbol.name)+')()';
        if(symbol.control&&!symbol.controlArray&&!usage.receiver&&!usage.reference&&!usage.callee&&!usage.assignment){const member=controlDefault(symbol.type,context);if(member)return e({kind:'member',object:node,name:member},{receiver:true});}
        const prefix=symbol.owner&&symbol.owner!==context.module&&symbol.owner.kind==='module'?qualified(symbol.owner.name)+'.':'';
        
        if(symbol.autoNew&&symbol.local&&!usage.assignment)return context.runtime('VbRuntime.AutoNew')+'(Of '+context.netType(symbol.type)+')('+prefix+identifier(symbol.name)+', Function() New '+qualified(symbol.type)+'())';
        if(symbol.enumName)return prefix+identifier(symbol.enumName)+'.'+identifier(symbol.name);
        const accessor=usage.assignment?null:accessorReference(symbol,context);
        if(accessor&&!usage.assignment)return prefix+accessor+(usage.callee?'':'()');
        if(symbol.procedure&&symbol.kind!=='property'&&!usage.callee)return prefix+identifier(symbol.name)+'()';
        return prefix+identifier(symbol.name);
      }
      if(Object.hasOwn(CONSTANTS,k))return CONSTANTS[k];
      if(/^vbkey[a-z0-9]$/i.test(node.name))return String(node.name.at(-1).toUpperCase().charCodeAt(0));
      if(/^vbkeyf(?:[1-9]|1[0-6])$/i.test(node.name))return String(111+Number(node.name.slice(6)));
      if(Object.hasOwn(INTRINSIC_CONSTANTS,k)){const value=INTRINSIC_CONSTANTS[k];return typeof value==='string'?vbString(value):String(value);}
      if(k==='err')return 'Global.Microsoft.VisualBasic.Information.Err()';
      if(k==='app')return context.runtime('VbApp');
      if(k==='clipboard')return 'Global.System.Windows.Forms.Clipboard';
      if(k==='debug')return 'Global.System.Diagnostics.Debug';
      if(k==='screen'||k==='printer'){context.add('MIG_GLOBAL_OBJECT','VB6 '+node.name+' object requires a host-specific adapter.');return identifier(node.name);}
      if(Object.hasOwn(INTRINSICS,k))return intrinsicName(INTRINSICS[k],context)+(usage.callee||['date','now','time','timer'].includes(k)?'':'()');
      if(BUILTIN_NAMES.has(k))return identifier(node.name)+(usage.callee?'':'()');
      context.add('MIG_UNRESOLVED_NAME','Unresolved symbol: '+node.name);
      return identifier(node.name);
    }
    case 'member': {
      const receiver=context.resolve(node.object),obj=e(node.object,{receiver:true,reference:true}),k=key(node.name);
      if(receiver?.control||receiver?.form||node.object.kind==='id'&&key(node.object.name)==='me'&&context.module.form){
        if(['left','top','width','height'].includes(k)&&!usage.assignment)return context.runtime('VbForms.PixelsToTwips')+'('+obj+', '+obj+'.'+identifier(node.name)+')';
        if(k==='value'&&receiver?.type==='CheckBox')return 'CShort('+obj+'.CheckState)';
        if(k==='value'&&receiver?.type==='OptionButton')return obj+'.Checked';
        if(k==='picture')return obj+'.Image';
        if(k==='list')return obj+'.Items';
        if(k==='caption')return obj+'.Text';
        if(k==='backcolor'||k==='forecolor')return usage.assignment?obj+'.'+SIMPLE_MEMBERS[k]:'Global.System.Drawing.ColorTranslator.ToOle('+obj+'.'+SIMPLE_MEMBERS[k]+')';
        if(k==='setfocus'&&usage.callee)return obj+'.Focus';
        if(k==='refresh'&&usage.callee)return obj+'.Refresh';
        if(SIMPLE_MEMBERS[k])return obj+'.'+SIMPLE_MEMBERS[k];
        if(!['name','show','hide','close','refresh','focus','additem','removeitem','clear','move','setfocus','font','controls','count'].includes(k))context.add('MIG_CONTROL_MEMBER','No verified control-member adapter for '+node.name+'.');
      }
      const accessor=usage.assignment?null:accessorReference(context.resolve(node),context);
      if(accessor&&!usage.assignment)return (obj?obj+'.':'.')+accessor+(usage.callee?'':'()');
      return (obj?obj+'.':'.')+identifier(node.name);
    }
    case 'call': {
      const symbol=context.resolve(node.callee),k=node.callee.kind==='id'?key(node.callee.name):'';
      validateCallSemantics(node,symbol,context);
      const intrinsicEmit=(arg,mode={})=>e(arg,{...mode,reference:mode.reference||RAW_INTRINSICS.has(k)});
      const native=nativeIntrinsic(node,context,intrinsicEmit,usage);
      if(native!==null)return native;
      const array=context.arrayPlan(symbol);
      if(array&&node.args.length){
        const indexes=node.args.map(n=>'CInt('+e(n)+')');
        if(array.lower)indexes[0]=context.runtime('VbNativeArrays.Index')+'('+indexes[0]+', '+array.lower+', '+(array.upper-array.lower+1)+')';
        return e(node.callee,{reference:true})+'('+indexes.join(', ')+')';
      }
      if(symbol?.bounds!==undefined&&symbol.bounds!==null&&node.args.length===0)return e(node.callee);
      if(symbol&&!symbol.procedure&&!symbol.module&&!symbol.control&&!symbol.paramArray&&symbol.bounds==null&&VARIANT_TYPES.has(key(symbol.type)))return context.runtime('VbArrays.Element')+'('+e(node.callee,{reference:true,receiver:true})+', New Object() {'+node.args.map(n=>e(n)).join(', ')+'}).Value';
      if(k==='array'&&!symbol)return context.runtime('VbArray')+'(Of Object).FromValues(New Object() {'+node.args.map(n=>e(n)).join(', ')+'}, '+context.module.optionBase+')';
      if(['strptr','varptr','objptr'].includes(k))context.add('MIG_MANAGED_POINTER','Raw VB6 pointer intrinsic requires an explicit interop mapping.');
      if(['createobject','getobject'].includes(k)&&!symbol)context.add('MIG_COM_ACTIVATION','COM activation requires the original installed component, compatible bitness, and deployment verification.','warning');
      if(k==='cstr'&&!context.decimalCurrency&&key(context.type(node.args[0]))==='currency')return e(node.args[0])+'.ToString()';
      if(['cint','clng','csng','cdbl','cdec'].includes(k)&&!context.decimalCurrency&&key(context.type(node.args[0]))==='currency')return INTRINSICS[k]+'('+e(node.args[0])+'.ToDecimal())';
      if(node.callee.kind==='member'){
        const c=node.callee,receiver=context.resolve(c.object),obj=e(c.object,{receiver:true,reference:true}),member=key(c.name);
        if(receiver?.control||receiver?.form){
          if(member==='additem')return context.runtime('VbForms.AddItem')+'('+[obj,...node.args.map(n=>e(n))].join(', ')+')';
          if(member==='removeitem')return obj+'.Items.RemoveAt('+node.args.map(n=>e(n)).join(', ')+')';
          if(member==='clear')return obj+'.Items.Clear()';
          if(member==='move')return context.runtime('VbForms.Move')+'('+[obj,...node.args.map(n=>e(n))].join(', ')+')';
          if(member==='show'&&receiver.form)return context.runtime('VbForms.Show')+'('+[obj,...node.args.map(n=>e(n))].join(', ')+')';
        }
      }
      const emitArgument=(arg,parameter)=>{
        if(symbol?.external&&key(parameter?.type||'')==='string'&&arg.kind==='id'&&key(arg.name)==='vbnullstring')return 'Nothing';
        if(parameter?.byRef&&context.resolve(arg)?.autoNew&&context.resolve(arg)?.local)context.add('MIG_AS_NEW_BYREF','ByRef assignment to a lazy As New local requires a value-cell adapter.');
        if(parameter&&arg.kind!=='missing'&&key(parameter.type)==='currency'&&key(context.type(arg))!=='currency')return context.decimalCurrency?'CDec('+e(arg)+')':context.runtime('VbCurrency.FromObject')+'('+e(arg)+')';
        return symbol?e(arg,{argument:true}):intrinsicEmit(arg);
      };
      const ordered=orderedCall(node,symbol,context,emitArgument,e);
      if(ordered!==null)return ordered;
      const args=bindOptionalArguments(node,symbol,context,emitArgument)||node.args.map((arg,index)=>{
        const p=arg.kind==='named'?symbol?.params?.find(param=>key(param.name)===key(arg.name)):symbol?.params?.[index];
        if(arg.kind==='missing'&&p?.optional)return optionalDefault(symbol,p,context);
        return arg.kind==='named'?identifier(arg.name)+':='+emitArgument(arg.expr,p):emitArgument(arg,p);
      });
      const call=e(node.callee,{callee:true})+'('+args.join(', ')+')';
      if(symbol?.controlArray&&!usage.receiver&&!usage.reference&&!usage.callee&&!usage.assignment){const member=controlDefault(symbol.type,context);if(member)return call+'.'+(SIMPLE_MEMBERS[key(member)]||identifier(member));}
      return call;
    }
    default: context.add('MIG_EXPRESSION','Unsupported expression AST node: '+node.kind);return 'Nothing';
  }
}
export function condition(node,context) {
  const value=expression(node,context);
  const type=key(context.valueType(node));
  if(type==='boolean')return value;
  if(context.options.codeStyle==='native'&&(['byte','integer','long','single','double','decimal','string'].includes(type)||type==='currency'&&context.decimalCurrency))return 'CBool('+value+')';
  return context.runtime('VbVariant.Truth')+'('+value+')';
}
export function defaultValue(decl,context) {
  if(decl.initial)return expression(decl.initial,context);
  if(decl.bounds!==null&&decl.bounds!==undefined){
    const type=context.netType(decl.type),dims=decl.bounds,native=context.arrayPlan(context.find(decl.name));
    if(native){
      if(!native.fixed)return 'Nothing';
      const bounds=native.lower?[String(native.upper-native.lower)]:dims.map(([,upper])=>expression(upper,context));
      return 'New '+type+'('+bounds.join(', ')+') {}';
    }
    context.runtime('VbArray');
    const record=context.record(decl.type);
    const objectElements=key(decl.type)==='object';
    const factory=decl.fixedLength?'Function() New String(" "c, '+decl.fixedLength+')':record&&(context.options.codeStyle!=='native'||record.initialize)?'AddressOf '+type+'.Create':'';
    if(!dims.length)return 'New VbArray(Of '+type+')('+factory+(objectElements?(factory?', ':'')+'objectElements:=True':'')+')';
    return 'New VbArray(Of '+type+')('+boundsArguments(dims,context)+', True'+(factory?', '+factory:'')+(objectElements?', objectElements:=True':'')+')';
  }
  if(decl.fixedLength)return 'New String(" "c, '+decl.fixedLength+')';
  if(decl.autoNew)return 'Nothing';
  if(key(decl.type)==='string')return 'String.Empty';
  if(context.options.codeStyle==='native'&&key(decl.type)==='date')return 'Global.System.DateTime.FromOADate(0.0)';
  const record=context.record(decl.type);
  if(record&&(context.options.codeStyle!=='native'||record.initialize))return context.netType(decl.type)+'.Create()';
  return 'Nothing';
}
export function boundsArguments(bounds,context) {
  return 'New Integer() {'+bounds.map(b=>b[0]?expression(b[0],context):context.module.optionBase).join(', ')+'}, New Integer() {'+bounds.map(b=>expression(b[1],context)).join(', ')+'}';
}
export function assignment(target,value,context,{objectSet=false,asReturn=false}={}) {
  target=defaultPropertyCall(target,context)||target;
  if(!objectSet)target=defaultValueExpression(target,context,{assignment:true});
  const callee=target.kind==='call'?target.callee:target,property=context.resolve(callee);
  const plan=property?.kind==='property'?propertyPlan(property.owner||context.module,property.name,context):null;
  // An assignment to the current getter's result variable is not a property set.
  const resultVariable=callee.kind==='id'&&context.aliases.has(key(callee.name));
  const accessor=plan?.methods&&!resultVariable&&!asReturn?accessorReference(property,context,objectSet?'set':'let'):null;
  const setter=accessor?plan[objectSet?'set':'let']:null;
  const symbol=setter?.params.at(-1)||(target.kind==='id'?context.storage(target.name):context.resolve(target));
  if(symbol?.control&&!objectSet){const member=controlDefault(symbol.type,context);if(member)return assignment({kind:'member',object:target,name:member},value,context,{objectSet});}
  const native=context.arrayPlan(symbol),style=context.options.codeStyle==='native';
  let right=expression(value,context,{reference:objectSet,nativeArray:!!native}),left='';
  const wholeArray=symbol?.bounds!==undefined&&symbol.bounds!==null;
  if(wholeArray){
    if(symbol.bounds.length)context.add('MIG_FIXED_ARRAY_ASSIGN','Whole fixed-array assignment requires a verified copy adapter.');
    if(native){
      const type=context.netType(symbol.type)+'('+','.repeat(native.rank-1)+')';
      const producer=value?.kind==='call'&&value.callee.kind==='id'&&!context.find(value.callee.name)&&['split','filter'].includes(key(value.callee.name));
      if(!producer)right='If('+right+' Is Nothing, Nothing, DirectCast('+right+'.Clone(), '+type+'))';
    }else right='CType('+context.runtime('VbRuntime.CopyValue')+'('+right+'), '+context.runtime('VbArray')+'(Of '+context.netType(symbol.type)+'))';
  }else{
    if(symbol?.fixedLength)right=context.runtime('VbRuntime.FixedString')+'('+right+', '+symbol.fixedLength+')';
    if(key(symbol?.type||'')==='currency')right=context.decimalCurrency?'CDec('+right+')':context.runtime('VbCurrency.FromObject')+'('+right+')';
    if(!objectSet&&symbol&&['object','variant'].includes(key(symbol.type))&&(!style||valueNeedsCopy(value,context)))right=context.runtime('VbRuntime.CopyValue')+'('+right+')';
    if(symbol&&context.record(symbol.type)&&(!style||context.record(symbol.type).copy))right='CType('+context.runtime('VbRuntime.CopyValue')+'('+right+'), '+context.netType(symbol.type)+')';
  }
  // Setters share the same lexical permutation plan as getters, but native
  // properties remain assignments inside a Sub instead of getter-call lvalues.
  const selectedSetter=plan?.[objectSet?'set':'let'];
  if(selectedSetter&&!resultVariable&&!asReturn&&target.kind==='call'){
    const boundSetter={...selectedSetter,owner:property.owner||context.module};
    const call={kind:'call',callee,args:[...target.args,{kind:'named',name:selectedSetter.params.at(-1).name,expr:value}]};
    validateCallSemantics(call,boundSetter,context);
    const ordered=orderedCall(call,boundSetter,context,(arg,param)=>{
      if(arg===value)return right;
      if(key(param.type)==='currency'&&key(context.type(arg))!=='currency')return context.decimalCurrency?'CDec('+expression(arg,context)+')':context.runtime('VbCurrency.FromObject')+'('+expression(arg,context)+')';
      return expression(arg,context,{argument:true});
    },(node,usage)=>expression(node,context,usage),{accessor:objectSet?'set':'let'});
    if(ordered!==null)return ordered;
  }
  if(!accessor)left=expression(target,context,{assignment:true});
  if(accessor){
    const args=target.kind==='call'?target.args:[];
    validateCallSemantics({kind:'call',callee,args:[...args,value]},setter,context);
    const prefix=callee.kind==='member'?expression(callee.object,context,{receiver:true,reference:true})+'.':property.owner&&property.owner!==context.module?qualified(property.owner.name)+'.':'';
    const emitted=args.map(arg=>expression(arg,context,{argument:true}));
    emitted.push((setter?identifier(setter.params.at(-1).name)+':=':'')+right);
    return prefix+accessor+'('+emitted.join(', ')+')';
  }
  if(target.kind==='member'){
    const receiver=context.resolve(target.object),name=key(target.name),obj=expression(target.object,context,{receiver:true,reference:true});
    if(receiver?.control||receiver?.form){
      if(['left','top','width','height'].includes(name))right=context.runtime('VbForms.TwipsToPixels')+'('+obj+', '+right+')';
      if(name==='backcolor'||name==='forecolor')right=(style?'Global.System.Drawing.ColorTranslator.FromOle':context.runtime('VbForms.OleColor'))+'(CInt('+right+'))';
      if(name==='value'&&receiver.type==='CheckBox'){left=obj+'.CheckState';right='CType('+right+', Global.System.Windows.Forms.CheckState)';}
      if(name==='value'&&receiver.type==='OptionButton'){left=obj+'.Checked';right='CBool('+right+')';}
    }
  }
  return asReturn?'Return '+right:left+' = '+right;
}

function controlDefault(type,context){
  const name={TextBox:'Text',RichTextBox:'Text',ComboBox:'Text',ListBox:'Text',Label:'Caption',Frame:'Caption',CheckBox:'Value',OptionButton:'Value',HScrollBar:'Value',VScrollBar:'Value',Image:'Picture',PictureBox:'Picture'}[type];
  if(!name)context.add('MIG_CONTROL_DEFAULT','No verified default property for '+type+'.');
  return name;
}

function intrinsicName(name,context){
  return /^(?:VbRuntime|VbVariant|VbForms|VbCurrency|VbArrays)\./.test(name)?context.runtime(name):name;
}
