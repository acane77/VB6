import {returnType} from './array-returns.js';
import {scalarType, unbox} from '../runtime/values.js';
import {key, identifier, vbString} from './names.js';

/** CLR optional metadata cannot store a preserving Currency structure. Use a
 * required typed core plus a linear set of suffix-forwarding overloads instead
 * of boxing public parameters or adding a per-call compatibility runtime. */
export function optionalOverloads(procedure, context) {
  return !context.decimalCurrency && !!procedure?.params?.some(p => p.optional && key(p.type) === 'currency');
}

/** Standard modules overload implicitly; the explicit Overloads modifier is
 * rejected there (BC36917). Classes and companion interfaces retain it. */
export function optionalOverloadModifier(procedure, context, contract = false) {
  return optionalOverloads(procedure, context) && (contract || context.module.kind !== 'module') ? 'Overloads ' : '';
}

export function declarationParameters(procedure, context) {
  return optionalOverloads(procedure, context)
    ? procedure.params.map(p => p.optional ? {...p, optional:false} : p)
    : procedure.params;
}

/** Defaults are bound in the declaring module, not re-evaluated in the caller's
 * scope. In particular, never round an exact Currency through a JS Number. */
export function optionalDefault(procedure, parameter, context) {
  const type = key(parameter.type);
  if (!parameter.initial) {
    if (type === 'variant') return context.runtime('VbMissing.Value');
    if (type === 'string') return 'String.Empty';
    if (type === 'date') return 'Global.System.DateTime.FromOADate(0.0)';
    return 'Nothing';
  }
  const bound = procedure.defaultScalars;
  if (!bound?.has(key(parameter.name))) {
    context.add('MIG_OPTIONAL_DEFAULT_BINDING', 'Optional default has no verified declaration-scope binding: ' + parameter.name);
    return 'Nothing';
  }
  const scalar = bound.get(key(parameter.name)), value = unbox(scalar), subtype = scalarType(scalar);
  if (value?.__nothing) return 'Nothing';
  if (subtype === 'currency') return context.decimalCurrency ? value.toString() + 'D'
    : context.runtime('VbCurrency.FromDecimal') + '(' + value.toString() + 'D)';
  if (subtype === 'date') {
    const ticks = (BigInt(value.getTime()) + 62135596800000n) * 10000n;
    return 'New Global.System.DateTime(' + ticks + 'L, Global.System.DateTimeKind.Unspecified)';
  }
  if (subtype === 'string') return vbString(value);
  if (subtype === 'boolean') return value ? 'True' : 'False';
  if (subtype === 'decimal') return value.toString() + 'D';
  if (typeof value === 'number' && Number.isFinite(value)) {
    const literal = Object.is(value, -0) ? '-0.0' : String(value);
    const suffix = {byte:'US', integer:'S', long:'I', single:'F', double:'R'}[subtype] || 'R';
    const result = subtype === 'integer' && value === -32768 ? 'Short.MinValue'
      : subtype === 'long' && value === -2147483648 ? 'Integer.MinValue'
      : subtype === 'byte' ? 'CByte(' + literal + ')' : literal + suffix;
    return parameter.storageType ? 'CType(' + result + ', ' + context.netType(parameter.type) + ')' : result;
  }
  context.add('MIG_OPTIONAL_DEFAULT_BINDING', 'Optional default subtype requires an explicit representation: ' + parameter.name);
  return 'Nothing';
}

/** Bind omitted arguments to declaration-scope defaults. Reordered supplied
 * names must first pass through orderedCall: spelling named VB.NET arguments
 * in lexical order alone does not preserve their evaluation order. */
export function bindOptionalArguments(node, procedure, context, emit) {
  if (!optionalOverloads(procedure, context) || !node.args.some(arg => arg.kind === 'named' || arg.kind === 'missing')) return null;
  const supplied = new Set();
  const args = node.args.map((argument, index) => {
    const named = argument.kind === 'named';
    const parameter = named ? procedure.params.find(p => key(p.name) === key(argument.name)) : procedure.params[index];
    if (!parameter) return emit(argument, undefined);
    supplied.add(key(parameter.name));
    const value = argument.kind === 'missing' ? optionalDefault(procedure, parameter, context) : emit(named ? argument.expr : argument, parameter);
    return named ? identifier(parameter.name) + ':=' + value : value;
  });
  for (const parameter of procedure.params) if (parameter.optional && !supplied.has(key(parameter.name))) {
    args.push(identifier(parameter.name) + ':=' + optionalDefault(procedure, parameter, context));
  }
  return args;
}

export function emitOptionalOverloads(writer, procedure, context, {name=procedure.name, contract=false, scope, implementation='', parameter}) {
  if (!optionalOverloads(procedure, context)) return;
  const first = procedure.params.findIndex(p => p.optional);
  const returns = procedure.kind === 'function' || procedure.accessor === 'get';
  for (let length = procedure.params.length - 1; length >= first; length--) {
    const accepted = procedure.params.slice(0, length);
    const header = (contract ? '' : scope) + optionalOverloadModifier(procedure, context, contract) + (returns ? 'Function ' : 'Sub ') + identifier(name) + '(' +
      accepted.map(p => parameter({...p, optional:false}, context)).join(', ') + ')' +
      (returns ? ' As ' + returnType(procedure, context) : '') + (contract ? '' : implementation);
    if (contract) { writer.line(header, context); continue; }
    writer.open(header, context);
    // Explicit local storage for omitted defaults prevents accidental ByRef
    // copy-back into constants or another invocation's optional argument cell.
    for (const p of procedure.params.slice(length)) writer.line('Dim ' + identifier('__vbDefault_' + p.name) + ' As ' + context.netType(p.type) + ' = ' + optionalDefault(procedure, p, context));
    writer.line((returns ? 'Return ' : '') + identifier(name) + '(' + procedure.params.map((p, index) =>
      identifier(index < length ? p.name : '__vbDefault_' + p.name)).join(', ') + ')');
    writer.close(returns ? 'End Function' : 'End Sub');
    writer.line();
  }
}
