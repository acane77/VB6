/** Offline tool-schema interpreter. Host-authored schemas only; never resolves network references. */
const record = value => !!value && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.hasOwn(value, key);
const types = new Set(['null', 'boolean', 'object', 'array', 'number', 'integer', 'string']);
const schemaChildren = ['additionalProperties', 'unevaluatedProperties', 'propertyNames', 'items', 'additionalItems', 'unevaluatedItems', 'contains', 'not', 'if', 'then', 'else'];
const schemaMaps = ['$defs', 'definitions', 'properties', 'patternProperties', 'dependentSchemas'];
const schemaArrays = ['allOf', 'anyOf', 'oneOf', 'prefixItems'];

export function validateSchemaValue(value, schema, {path = 'arguments', depth = 0, maxSteps = 200000} = {}) {
  let steps = 0;
  const spend = () => { if (++steps > maxSteps) throw new Error('Schema validation work limit exceeded.'); };
  const fail = (at, message) => { throw new Error(at + ': ' + message); };
  const bad = message => { throw new Error('Unsupported or invalid tool schema: ' + message); };
  function json(value, at, level) {
    spend(); if (level > 32) fail(at, 'too deeply nested');
    if (value === null || ['string', 'boolean'].includes(typeof value)) return;
    if (typeof value === 'number' && Number.isFinite(value)) return;
    if (!value || typeof value !== 'object') fail(at, 'expected JSON data');
    if (Array.isArray(value)) {
      if (value.length > 10000) fail(at, 'too many items');
      for (let i = 0; i < value.length; i++) json(value[i], at + '[' + i + ']', level + 1);
    } else {
      if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(at, 'expected a plain JSON object');
      for (const [key, child] of Object.entries(value)) {
        if (['__proto__', 'prototype', 'constructor'].includes(key)) fail(at, 'unsafe key');
        json(child, at + '.' + key, level + 1);
      }
    }
  }
  json(value, path, depth);
  const anchors = new Map(), seen = new Set();
  function index(node, level = 0) {
    spend(); if (typeof node === 'boolean') return;
    if (!record(node) || level > 64) bad('invalid or deeply nested schema');
    if (seen.has(node)) bad('cyclic schema objects; use a local $ref'); seen.add(node);
    for (const key of ['$dynamicRef', '$dynamicAnchor', '$recursiveRef', '$recursiveAnchor']) if (own(node, key)) bad(key + ' is not supported');
    if (node !== schema && node.$id !== undefined) bad('nested $id scopes are not supported');
    if (node.$anchor !== undefined) {
      if (typeof node.$anchor !== 'string' || !/^[A-Za-z_][A-Za-z0-9._-]*$/.test(node.$anchor) || anchors.has(node.$anchor)) bad('invalid or duplicate anchor');
      anchors.set(node.$anchor, node);
    }
    for (const key of schemaMaps) if (node[key] !== undefined) {
      if (!record(node[key])) bad(key); for (const child of Object.values(node[key])) index(child, level + 1);
    }
    for (const key of schemaArrays) if (node[key] !== undefined) {
      if (!Array.isArray(node[key]) || !node[key].length && key !== 'prefixItems') bad(key);
      for (const child of node[key]) index(child, level + 1);
    }
    for (const key of schemaChildren) if (node[key] !== undefined) {
      if (key === 'items' && Array.isArray(node[key])) for (const child of node[key]) index(child, level + 1);
      else index(node[key], level + 1);
    }
    seen.delete(node);
  }
  index(schema);
  function resolve(ref) {
    if (typeof ref !== 'string') bad('$ref must be a string');
    if (!ref.startsWith('#') && typeof schema.$id === 'string' && ref.startsWith(schema.$id + '#')) ref = ref.slice(schema.$id.length);
    if (!ref.startsWith('#')) bad('only local fragment $ref values are allowed; external resolution is disabled');
    let fragment; try { fragment = decodeURIComponent(ref.slice(1)); } catch { bad('invalid $ref encoding'); }
    if (!fragment) return schema;
    if (!fragment.startsWith('/')) { if (!anchors.has(fragment)) bad('unresolved $ref anchor'); return anchors.get(fragment); }
    let node = schema;
    for (const part of fragment.slice(1).split('/')) {
      if (/~(?![01])/.test(part)) bad('invalid JSON pointer');
      const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
      if ((!record(node) && !Array.isArray(node)) || !own(node, key)) bad('unresolved local $ref'); node = node[key];
    }
    if (!record(node) && typeof node !== 'boolean') bad('$ref target is not a schema');
    return node;
  }
  function equal(a, b, level = 0) {
    spend(); if (level > 64) bad('deep comparison limit');
    if (a === b) return true;
    if (typeof a !== typeof b || !a || !b || typeof a !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
    const keys = Object.keys(a); return keys.length === Object.keys(b).length && keys.every(key => own(b, key) && equal(a[key], b[key], level + 1));
  }
  function canonical(value) {
    spend();
    if (!value || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  const regexes = new Map();
  function pattern(source) {
    if (typeof source !== 'string' || source.length > 4096) bad('pattern');
    if (!regexes.has(source)) { try { regexes.set(source, new RegExp(source, 'u')); } catch { bad('invalid regular expression'); } }
    return regexes.get(source);
  }
  function count(node, key) {
    if (!own(node, key)) return undefined;
    if (!Number.isSafeInteger(node[key]) || node[key] < 0) bad(key); return node[key];
  }
  function numeric(node, key) {
    if (!own(node, key)) return undefined;
    if (!Number.isFinite(node[key])) bad(key); return node[key];
  }
  const matchesType = (v, type) => type === 'null' ? v === null : type === 'array' ? Array.isArray(v) : type === 'object' ? record(v) :
    type === 'integer' ? Number.isSafeInteger(v) : typeof v === type;
  const merge = (to, from) => { for (const key of from.props) to.props.add(key); for (const key of from.items) to.items.add(key); };
  function decimal(number) {
    const [mantissa, exponent = '0'] = String(number).toLowerCase().split('e'), point = mantissa.indexOf('.');
    return [BigInt(mantissa.replace('.', '')), Number(exponent) - (point < 0 ? 0 : mantissa.length - point - 1)];
  }
  function multiple(value, divisor) {
    const [a, x] = decimal(value), [b, y] = decimal(divisor), delta = x - y;
    return delta >= 0 ? a * 10n ** BigInt(delta) % b === 0n : a % (b * 10n ** BigInt(-delta)) === 0n;
  }
  // A mismatch is data, whereas invalid/unsupported schemas throw. In particular
  // anyOf/not must not turn an unresolved reference or exhausted budget into success.
  function visit(v, node, at, level = 0) {
    spend(); if (level > 128) bad('recursive evaluation limit');
    const evaluated = {props: new Set(), items: new Set()}, reject = message => ({error: at + ': ' + message});
    if (node === true) return evaluated; if (node === false) return reject('value is forbidden');
    if (!record(node)) bad('schema must be an object or boolean');
    if (node.$ref !== undefined) { const match = visit(v, resolve(node.$ref), at, level + 1); if (match.error) return match; merge(evaluated, match); }
    if (node.type !== undefined) {
      const allowed = Array.isArray(node.type) ? node.type : [node.type];
      if (!allowed.length || allowed.some(type => !types.has(type))) bad('type');
      if (!allowed.some(type => matchesType(v, type))) return reject('expected ' + allowed.join(' or '));
    }
    if (node.enum !== undefined) {
      if (!Array.isArray(node.enum) || !node.enum.length) bad('enum');
      if (!node.enum.some(candidate => equal(v, candidate))) return reject('unsupported value');
    }
    if (own(node, 'const') && !equal(v, node.const)) return reject('does not match const');
    for (const keyword of ['allOf', 'anyOf', 'oneOf']) if (node[keyword] !== undefined) {
      const results = node[keyword].map(child => visit(v, child, at, level + 1)), valid = results.filter(result => !result.error);
      if (keyword === 'allOf' && valid.length !== results.length || keyword === 'anyOf' && !valid.length || keyword === 'oneOf' && valid.length !== 1) return reject('does not satisfy ' + keyword);
      for (const match of valid) merge(evaluated, match);
    }
    if (node.not !== undefined && !visit(v, node.not, at, level + 1).error) return reject('matches forbidden schema');
    if (node.if !== undefined) {
      const condition = visit(v, node.if, at, level + 1), branch = condition.error ? node.else : node.then;
      if (!condition.error) merge(evaluated, condition);
      if (branch !== undefined) { const match = visit(v, branch, at, level + 1); if (match.error) return match; merge(evaluated, match); }
    }
    if (typeof v === 'number') {
      if (v < (numeric(node, 'minimum') ?? -Infinity) || v > (numeric(node, 'maximum') ?? Infinity) ||
        v <= (numeric(node, 'exclusiveMinimum') ?? -Infinity) || v >= (numeric(node, 'exclusiveMaximum') ?? Infinity)) return reject('out of range');
      const divisor = numeric(node, 'multipleOf'); if (divisor !== undefined) { if (divisor <= 0) bad('multipleOf'); if (!multiple(v, divisor)) return reject('not a multipleOf'); }
    }
    if (typeof v === 'string') {
      let length = 0; for (const unused of v) length++;
      if (length < (count(node, 'minLength') ?? 0) || length > (count(node, 'maxLength') ?? Infinity)) return reject('invalid length');
      if (node.pattern !== undefined && !pattern(node.pattern).test(v)) return reject('pattern mismatch');
    }
    if (record(v)) {
      const keys = Object.keys(v);
      if (keys.length < (count(node, 'minProperties') ?? 0) || keys.length > (count(node, 'maxProperties') ?? Infinity)) return reject('invalid property count');
      if (node.required !== undefined) {
        if (!Array.isArray(node.required) || node.required.some(key => typeof key !== 'string')) bad('required');
        for (const key of node.required) if (!own(v, key)) return reject('missing ' + key);
      }
      if (node.dependentRequired !== undefined) {
        if (!record(node.dependentRequired)) bad('dependentRequired');
        for (const [key, required] of Object.entries(node.dependentRequired)) {
          if (!Array.isArray(required) || required.some(key => typeof key !== 'string')) bad('dependentRequired');
          if (own(v, key)) for (const name of required) if (!own(v, name)) return reject('missing dependency ' + name);
        }
      }
      for (const [key, child] of Object.entries(node.dependentSchemas || {})) if (own(v, key)) {
        const match = visit(v, child, at, level + 1); if (match.error) return match; merge(evaluated, match);
      }
      for (const key of keys) {
        if (node.propertyNames !== undefined) { const match = visit(key, node.propertyNames, at + '.' + key, level + 1); if (match.error) return match; }
        const children = [];
        if (own(node.properties || {}, key)) children.push(node.properties[key]);
        for (const [source, child] of Object.entries(node.patternProperties || {})) if (pattern(source).test(key)) children.push(child);
        if (!children.length && node.additionalProperties === false) return reject('unexpected ' + key);
        if (!children.length && node.additionalProperties !== undefined) children.push(node.additionalProperties);
        for (const child of children) { const match = visit(v[key], child, at + '.' + key, level + 1); if (match.error) return match; evaluated.props.add(key); }
      }
      if (node.unevaluatedProperties !== undefined) for (const key of keys) if (!evaluated.props.has(key)) {
        const match = visit(v[key], node.unevaluatedProperties, at + '.' + key, level + 1); if (match.error) return match; evaluated.props.add(key);
      }
    }
    if (Array.isArray(v)) {
      if (v.length < (count(node, 'minItems') ?? 0) || v.length > (count(node, 'maxItems') ?? 10000)) return reject('invalid item count');
      if (node.uniqueItems !== undefined && typeof node.uniqueItems !== 'boolean') bad('uniqueItems');
      if (node.uniqueItems && new Set(v.map(canonical)).size !== v.length) return reject('duplicate items');
      const prefix = node.prefixItems || (Array.isArray(node.items) ? node.items : []);
      const remaining = Array.isArray(node.items) ? node.additionalItems : node.items;
      for (let i = 0; i < v.length; i++) {
        const child = i < prefix.length ? prefix[i] : remaining;
        if (child !== undefined) { const match = visit(v[i], child, at + '[' + i + ']', level + 1); if (match.error) return match; evaluated.items.add(i); }
      }
      if (node.contains !== undefined) {
        const matches = []; for (let i = 0; i < v.length; i++) if (!visit(v[i], node.contains, at + '[' + i + ']', level + 1).error) matches.push(i);
        if (matches.length < (count(node, 'minContains') ?? 1) || matches.length > (count(node, 'maxContains') ?? Infinity)) return reject('contains count mismatch');
        for (const i of matches) evaluated.items.add(i);
      }
      if (node.unevaluatedItems !== undefined) for (let i = 0; i < v.length; i++) if (!evaluated.items.has(i)) {
        const match = visit(v[i], node.unevaluatedItems, at + '[' + i + ']', level + 1); if (match.error) return match; evaluated.items.add(i);
      }
    }
    return evaluated;
  }
  const result = visit(value, schema, path); if (result.error) throw new Error(result.error);
}
