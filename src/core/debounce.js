/** Debounce with receiver preservation, explicit cleanup and optional deadlines.
 * A deadline invokes the latest pending call even during a continuous burst.
 * cancel() is reusable; dispose()/AbortSignal permanently disable new calls.
 */
export function debounce(fn, delay = 200, {leading = false, trailing = true, maxWait, signal} = {}) {
  if (typeof fn !== 'function') throw new TypeError('debounce requires a function.');
  for (const [name, value] of [['delay', delay], ['maxWait', maxWait]])
    if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 0x7fffffff))
      throw new RangeError(name + ' must be between 0 and 2147483647 milliseconds.');
  if (!leading && !trailing) throw new TypeError('Enable leading or trailing execution.');
  if (signal != null && (typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function' || typeof signal.aborted !== 'boolean'))
    throw new TypeError('signal must be an AbortSignal.');
  let timer, deadline, args, receiver, result, disposed = false;
  function clearTimers() {
    clearTimeout(timer); clearTimeout(deadline);
    timer = deadline = undefined;
  }
  function invoke() {
    const values = args, owner = receiver;
    // Clear captured arguments before calling user code; reentrant calls create
    // a new independent pending invocation that must not be cleared afterwards.
    args = receiver = undefined;
    result = fn.apply(owner, values);
    return result;
  }
  function finish(force = false) {
    clearTimers();
    if (args && (trailing || force)) return invoke();
    args = receiver = undefined;
    return result;
  }
  function wrapped(...values) {
    if (disposed || signal?.aborted) return result;
    const idle = timer === undefined;
    args = values; receiver = this;
    clearTimeout(timer);
    timer = setTimeout(() => finish(), delay);
    if (maxWait !== undefined && deadline === undefined)
      deadline = setTimeout(() => finish(true), Math.max(delay, maxWait));
    if (idle && leading) return invoke();
    return result;
  }
  wrapped.cancel = () => { clearTimers(); args = receiver = undefined; };
  wrapped.flush = () => finish();
  wrapped.pending = () => timer !== undefined;
  wrapped.dispose = () => {
    if (disposed) return;
    disposed = true; wrapped.cancel();
    signal?.removeEventListener('abort', wrapped.dispose);
  };
  signal?.addEventListener('abort', wrapped.dispose, {once: true});
  if (signal?.aborted) wrapped.dispose();
  return wrapped;
}
