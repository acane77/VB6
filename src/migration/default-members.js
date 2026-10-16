import {key} from './names.js';

/** Resolve only project-bound default members. Do not guess default members of
 * Object, external COM, controls, arrays, or unknown return types. */
export function defaultMember(symbol, context) {
  if (!symbol || symbol.control || symbol.bounds != null || symbol.returnArray || symbol.paramArray) return null;
  const owner = context.compiled.modules.get(key(symbol.type || ''));
  if (!owner?.defaultMember) return null;
  const procedures = [...owner.procedures.values()].filter(p => key(p.name) === key(owner.defaultMember));
  const getter = procedures.find(p => p.accessor === 'get') || procedures.find(p => p.kind === 'function');
  return {owner, procedures, getter, name:procedures[0]?.name || owner.defaultMember};
}

/** Expand value coercion at its use site, leaving receivers, Set, Is, TypeOf,
 * raw introspection and procedure argument references untouched. The receiver
 * expression occurs once per hop. Recursive default types need dynamic dispatch
 * and remain diagnosed, rather than generating unbounded source or copying cells. */
export function defaultValueExpression(node, context, {assignment = false} = {}) {
  if (!node || assignment && node.kind === 'id' && context.aliases.has(key(node.name))) return node;
  const seen = new Set();
  let current = node;
  for (;;) {
    const member = defaultMember(context.resolve(current), context);
    if (!member) return current;
    const identity = key(member.owner.name) + '.' + key(member.name);
    if (seen.has(identity)) {
      context.add('MIG_DEFAULT_CYCLE', 'Recursive default-member type requires a dynamic receiver adapter: ' + identity + '.');
      return current;
    }
    seen.add(identity);
    if (assignment) {
      const setter = member.procedures.find(p => p.accessor === 'let');
      if (!setter) {
        context.add('MIG_PROPERTY_ACCESSOR', 'Default member ' + identity + ' has no Property Let accessor.');
        return current;
      }
      const indexes = setter.params.slice(0, -1);
      if (indexes.some(p => !p.optional && !p.paramArray)) {
        context.add('MIG_DEFAULT_ARGUMENT', 'Default member ' + identity + ' cannot be assigned without required indexes.');
        return current;
      }
      const callee = {kind:'member', object:current, name:member.name};
      return indexes.length ? {kind:'call', callee, args:[]} : callee;
    }
    const getter = member.getter;
    if (!getter || getter.params.some(p => !p.optional && !p.paramArray)) {
      context.add('MIG_DEFAULT_ARGUMENT', 'Default member ' + identity + ' cannot be read without required arguments.');
      return current;
    }
    const callee = {kind:'member', object:current, name:member.name};
    current = getter.kind === 'function' || getter.params.length ? {kind:'call', callee, args:[]} : callee;
  }
}
