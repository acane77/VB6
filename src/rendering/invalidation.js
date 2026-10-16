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
