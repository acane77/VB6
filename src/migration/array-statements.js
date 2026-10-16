import {outlineArrayStatement} from './statement-boundaries.js';
import {key} from './names.js';
import {expression} from './expressions.js';

const isArray = symbol => symbol?.bounds !== undefined && symbol.bounds !== null;
const isVariant = symbol => key(symbol?.type || '') === 'variant' && !isArray(symbol);

/** A single emitted statement retains On Error Resume Next's statement boundary. */
export function emitArrayStatement(op, context, line) {
  if (!context.outlinedArrayStatement && ['redim', 'erase'].includes(op.op) && (op.decls || op.exprs).length > 1 &&
      context.proc.code.some(instruction => ['onError', 'resume'].includes(instruction.op))) {
    outlineArrayStatement(op, context, line, emitArrayStatement);
    return true;
  }
  if (op.op === 'redim') {
    for (const declaration of op.decls) {
      const node = {kind: 'id', name: declaration.name};
      const symbol = context.storage(declaration.name);
      const target = expression(node, context, {assignment: true});
      if (!declaration.bounds?.length || declaration.autoNew || symbol?.paramArray || isArray(symbol) && symbol.bounds.length) {
        context.add('MIG_REDIM_TARGET', 'ReDim requires a resizable array or a scalar Variant, not fixed storage, ParamArray, or As New.');
        continue;
      }
      const native=context.arrayPlan(symbol);
      if(native){
        const bounds=declaration.bounds.map(([,upper])=>'CInt('+expression(upper,context)+')');
        line('ReDim '+(op.preserve?'Preserve ':'')+target+'('+bounds.join(', ')+')');
        continue;
      }
      // Interleave each lower and upper expression. Two separate arrays reorder side effects.
      const pairs = declaration.bounds.flatMap(([lower, upper]) => [lower ? expression(lower, context) : String(context.module.optionBase), expression(upper, context)]);
      const bounds = context.runtime('VbArrayBounds.FromPairs')+'(' + pairs.map(value => 'CInt(' + value + ')').join(', ') + ')';
      const preserve = op.preserve ? 'True' : 'False';
      if (isVariant(symbol)) {
        const record = [...context.compiled.modules.values()].some(module => Object.keys(module.types).some(type => key(type) === key(declaration.type)));
        if (declaration.fixedLength || record) {
          context.add('MIG_VARIANT_ARRAY_TYPE', 'Variant arrays of fixed-length strings or user-defined records require an explicit storage adapter.');
          continue;
        }
        const type = declaration.explicitType ? ', GetType(' + context.netType(declaration.type) + '), ' + (key(declaration.type) === 'object' ? 'True' : 'False') : '';
        line(target + ' = '+context.runtime('VbArrays.ResizeVariant')+'(' + expression(node, context, {reference: true}) + ', ' + bounds + ', ' + preserve + type + ')');
      } else if (isArray(symbol)) {
        if (declaration.explicitType && key(declaration.type) !== key(symbol.type)) {
          context.add('MIG_REDIM_ELEMENT_TYPE', 'ReDim cannot change a declared array element type; only a scalar Variant may hold different array types.');
          continue;
        }
        line(target + '.Resize(' + bounds + ', ' + preserve + ')');
      } else {
        context.add('MIG_REDIM_TARGET', 'ReDim target must be an array or Variant: ' + declaration.name);
      }
    }
    return true;
  }
  if (op.op === 'erase') {
    for (const node of op.exprs) {
      const symbol = (node.kind==='id'?context.storage(node.name):context.resolve(node));
      const target = expression(node, context, {assignment: true});
      if (symbol?.paramArray || isVariant(symbol) && node.kind !== 'id') {
        context.add('MIG_ERASE_TARGET', 'Erase of ParamArray or a complex Variant location requires an explicit lifetime/address adapter.');
        continue;
      }
      const native=context.arrayPlan(symbol);
      if(native){
        line(native.fixed?'Global.System.Array.Clear('+target+', 0, '+target+'.Length)':'Erase '+target);
        continue;
      }
      if (isVariant(symbol)) line(target + ' = '+context.runtime('VbArrays.EraseVariant')+'(' + expression(node, context, {reference: true}) + ')');
      else if (isArray(symbol)) line(target + '.Erase()');
      else context.add('MIG_ERASE_TARGET', 'Erase requires an array or Variant variable.');
    }
    return true;
  }
  return false;
}
