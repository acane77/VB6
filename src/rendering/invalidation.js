/** Optional presentation listeners, shared by every renderer of a materialized
 * control. A VB property write does not necessarily mutate a DOM attribute
 * (input.value and select.selectedIndex are important examples).
 *
 * The zero-listener path is one WeakMap lookup: no events, allocations or timers.
 * Listeners must only invalidate retained paint, never modify the control model.
 */
const listeners = new WeakMap();

export function observeControlPaint(element, invalidate) {
  if (!element || typeof element !== 'object' || typeof invalidate !== 'function') {
    throw new TypeError('A control element and invalidation callback are required');
  }
  let subscriptions = listeners.get(element);
  if (!subscriptions) listeners.set(element, subscriptions = new Set());
  // Subscription identity is independent of callback identity.
  const subscription = {invalidate};
  subscriptions.add(subscription);
  return () => {
    subscriptions.delete(subscription);
    if (!subscriptions.size && listeners.get(element) === subscriptions) listeners.delete(element);
  };
}

export function notifyControlPaint(element) {
  const subscriptions = listeners.get(element);
  if (!subscriptions) return;
  // Snapshotting permits listeners to unsubscribe/re-subscribe during delivery.
  for (const subscription of [...subscriptions]) {
    if (subscriptions.has(subscription)) {
      try { subscription.invalidate(element); }
      catch (error) { globalThis.reportError?.(error); }
    }
  }
}

/** Read-only projection access to canonical primitive properties. This does not
 * retain a second model, expose collections/VM objects or let a renderer write
 * to VB state. A retired provider cannot remove a newer owner's binding. */
const properties = new WeakMap();
export function bindControlPaintProperties(element, read) {
  if (!element || typeof element !== 'object' || typeof read !== 'function')
    throw new TypeError('A control element and property reader are required');
  const binding = {read}; properties.set(element, binding);
  return () => { if (properties.get(element) === binding) properties.delete(element); };
}
export function readControlPaintProperties(element, keys) {
  if (!Array.isArray(keys) || keys.length > 64 || keys.some(key => typeof key !== 'string'))
    throw new TypeError('At most 64 primitive property names are accepted');
  const result = Object.create(null), value = properties.get(element)?.read();
  if (value) for (const key of keys) {
    // Accessor properties could invoke user code. Only materialized own data
    // descriptors are presentation state, and only primitive values escape.
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) continue;
    const v = descriptor.value;
    if (typeof v === 'string' || typeof v === 'boolean' || typeof v === 'number' && Number.isFinite(v)) result[key] = v;
  }
  return Object.freeze(result);
}
