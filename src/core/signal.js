/** Synchronous, insertion-ordered notifications shared by the IDE and runtime.
 * Delivery snapshots registrations: additions wait for the next emit, removals
 * take effect immediately, and once listeners are removed before invocation.
 * Listener exceptions deliberately propagate, as they did in the original API.
 */
export class Signal {
  #waiters = new Set();
  constructor() { this.listeners = new Map(); }

  on(type, fn, {once = false, signal} = {}) {
    if (typeof fn !== 'function') throw new TypeError('A signal listener must be a function.');
    if (signal != null && (typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function' || typeof signal.aborted !== 'boolean'))
      throw new TypeError('signal must be an AbortSignal.');
    if (signal?.aborted) return () => false;
    let list = this.listeners.get(type);
    const existing = list?.get(fn);
    if (existing) return existing.off;
    if (!list) this.listeners.set(type, list = new Map());
    const record = {fn, once: !!once, active: true, off: null};
    record.off = () => {
      if (!record.active) return false;
      record.active = false;
      signal?.removeEventListener('abort', record.off);
      list.delete(fn);
      if (!list.size && this.listeners.get(type) === list) this.listeners.delete(type);
      return true;
    };
    list.set(fn, record);
    signal?.addEventListener('abort', record.off, {once: true});
    // Also works with a signal aborted while its listener is being attached.
    if (signal?.aborted) record.off();
    return record.off;
  }

  once(type, fn, options = {}) { return this.on(type, fn, {...options, once: true}); }
  off(type, fn) { return this.listeners.get(type)?.get(fn)?.off() ?? false; }
  listenerCount(type) { return this.listeners.get(type)?.size ?? 0; }
  eventNames() { return [...this.listeners.keys()]; }

  emit(type, ...args) {
    const list = this.listeners.get(type);
    if (!list?.size) return false;
    for (const record of [...list.values()]) {
      if (!record.active) continue;
      if (record.once) record.off();
      const fn = record.fn;
      fn(...args);
    }
    return true;
  }

  clear(type) {
    const lists = arguments.length ? [this.listeners.get(type)] : [...this.listeners.values()];
    for (const list of lists) for (const record of [...(list?.values() ?? [])]) record.off();
    for (const waiter of [...this.#waiters]) if (!arguments.length || waiter.type === type || Object.is(waiter.type, type)) waiter.cancel();
  }

  /** Resolve the first value accepted by predicate, or reject on abort/timeout.
   * Every completion path releases its listener, timer and abort registration.
   */
  waitFor(type, {signal, timeout, predicate = () => true} = {}) {
    return new Promise((resolve, reject) => {
      if (typeof predicate !== 'function') throw new TypeError('predicate must be a function.');
      if (timeout !== undefined && (!Number.isFinite(timeout) || timeout < 0 || timeout > 0x7fffffff))
        throw new RangeError('timeout must be between 0 and 2147483647 milliseconds.');
      if (signal != null && (typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function' || typeof signal.aborted !== 'boolean'))
        throw new TypeError('signal must be an AbortSignal.');
      let timer, off, waiter, settled = false;
      const finish = (error, value, failed = false) => {
        if (settled) return;
        settled = true;
        off?.();
        this.#waiters.delete(waiter);
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        if (failed) reject(error); else resolve(value);
      };
      const abort = () => finish(signal.reason, undefined, true);
      if (signal?.aborted) { abort(); return; }
      off = this.on(type, value => {
        try {
          const accepted = predicate(value);
          if (accepted && typeof accepted.then === 'function') {
            Promise.resolve(accepted).catch(() => {});
            throw new TypeError('predicate must be synchronous.');
          }
          if (accepted) finish(undefined, value);
        } catch (error) { finish(error, undefined, true); }
      });
      waiter = {type, cancel: () => {
        const error = new Error('Signal listeners were cleared.'); error.name = 'AbortError';
        finish(error, undefined, true);
      }};
      this.#waiters.add(waiter);
      signal?.addEventListener('abort', abort, {once: true});
      if (signal?.aborted) abort();
      if (timeout !== undefined && !settled) timer = setTimeout(() => {
        const error = new Error('Timed out waiting for signal.'); error.name = 'TimeoutError';
        finish(error, undefined, true);
      }, timeout);
    });
  }
}
