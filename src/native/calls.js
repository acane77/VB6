import {planNativeArguments,planNativeInStrArguments} from './call-plan.js';
export {planNativeArguments,planNativeInStrArguments};
/** Early-bound native calls: separate source evaluation order from stdcall slot
 * order, and never expose a literal/read-only snapshot as writable ByRef storage. */
import {coerce, defaultValue, scalarType} from '../runtime/values.js';
import {nativeParameterBytes} from './numeric.js';
import {nativeVariantReference} from './variant-references.js';
import {nativeFixedStringReference} from './fixed-string-references.js';
const key=value=>String(value).toLowerCase().replace(/[$%&!#@]$/, '');
const scalarTypes=new Set(['byte','integer','long','boolean','single','double','currency','date','string','variant']);

export const nativeCallMethods={
  prepareNativeParameters(context) {
    const defaults=new Map();let bytes=context.proc.kind==='function'&&key(context.proc.returnType)==='variant'?4:0;
    for(const p of context.proc.params) {
      if(p.paramArray&&(p!==context.proc.params.at(-1)||p.bounds?.length!==0||key(p.type)!=='variant'||context.proc.params.some(q=>q.optional)))
        this.fail('Native ParamArray must be the final unsized Variant array without Optional parameters',context);
      if(p.optional) {
        if(p.bounds!==null&&p.bounds!==undefined)this.fail('Optional native array parameters are not supported',context);
        if(!scalarTypes.has(key(p.type)))this.fail('Optional native parameters require a supported scalar type: '+p.name,context);
        const bound=context.proc.defaultBindings;
        if(p.initial&&!bound?.has(key(p.name)))this.fail('Unbound native optional default: '+p.name,context);
        if(key(p.type)==='variant'&&!p.initial){defaults.set(key(p.name),{nativeMissing:true});bytes+=nativeParameterBytes(p);if(bytes>65532)this.fail('Native procedure argument area exceeds the x86 stdcall return limit',context);continue;}
        try {defaults.set(key(p.name),coerce(p.initial?bound.get(key(p.name)):defaultValue(p.type),p.type));}
        catch(error){this.fail('Invalid native optional default for '+p.name+': '+error.message,context);}
      }
      bytes+=nativeParameterBytes(p);
      if(bytes>65532)this.fail('Native procedure argument area exceeds the x86 stdcall return limit',context);
    }
    context.nativeDefaults=defaults;
  },
  nativeCallPlan(target,args) {
    const signature=target.proc||target;
    if(!target.proc&&signature.params.some(p=>p.paramArray))this.fail('Native external ParamArray ABI is not supported');
    const plan=planNativeArguments(signature,args,message=>this.fail(message));
    for(const entry of plan.slots) {
      const p=signature.params[entry.index];
      if(entry.omitted) {
        if(!target.nativeDefaults?.has(key(p.name)))this.fail('Native optional default is unavailable: '+p.name);
        const value=target.nativeDefaults.get(key(p.name)),valueType=scalarType(target.proc?.defaultScalars?.get(key(p.name)));
        entry.node=value?.nativeMissing?{kind:'nativeVariant',tag:10,value:0x80020004}:value===undefined?{kind:'empty'}:{kind:'literal',value,...(valueType?{valueType}:{})};
      }
      if(entry.node.kind==='byval'&&(target.proc||!p.byRef||!['long','string','any'].includes(key(p.type))||p.bounds!==null&&p.bounds!==undefined))
        this.fail('Call-site ByVal requires an external scalar Long, As Any or String parameter declared ByRef; use parentheses for a project ByRef value');
    }
    return plan;
  },
  nativeReferenceArgument(parameter,node,omitted=false) {
    const forced=omitted||node.kind==='group',variable=this.variable(node);
    if(parameter.nativeRecord)return this.recordReferenceArgument(parameter,node,forced);
    if(key(parameter.type)==='any')return this.anyReferenceArgument(node);
    if(!forced&&variable&&key(parameter.type)==='variant')return nativeVariantReference(this,variable);
    if(variable?.nativeRecord||variable?.recordFieldArray)this.fail('ByRef native argument must have the exact declared type');
    if(!forced&&variable) {
      if(variable.nativeArray&&!variable.elementOf||key(variable.type)!==key(parameter.type))
        this.fail('ByRef native argument must be a scalar of the exact declared type');
      if(variable.fixedLength)return nativeFixedStringReference(this,variable);
      const pin=this.address(variable);return {pin};
    }
    // Both expression arguments and explicitly parenthesized variables bind to a
    // caller-owned typed temporary. Strings have a zeroed BSTR owner even when a
    // later argument fails or the callee changes the BSTR and raises an error.
    const temporary=key(parameter.type)==='variant'?this.temporaryVariant():key(parameter.type)==='string'?this.temporaryString():
      this.arrayWorkspace(['double','currency','date'].includes(key(parameter.type))?8:4,'byref-value');
    temporary.type=parameter.type;
    this.storageExpression(temporary,node);this.store(temporary);this.rawStorageAddress(temporary);
    return {temporary};
  }
};
