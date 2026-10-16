import test from 'node:test';
import assert from 'node:assert/strict';
import {getEventListeners} from 'node:events';
import {Signal} from '../src/core/signal.js';

test('Signal deduplicates callbacks and preserves insertion order/arguments', () => {
  const signal = new Signal(), seen = [], callback = (...args) => seen.push(args);
  const off = signal.on('x', callback);
  assert.equal(signal.on('x', callback), off);
  signal.on('x', (...args) => seen.push(['second', ...args]));
  assert.equal(signal.listenerCount('x'), 2);
  assert.deepEqual(signal.eventNames(), ['x']);
  assert.equal(signal.emit('x', 1, 2), true);
  assert.deepEqual(seen, [[1, 2], ['second', 1, 2]]);
  assert.equal(off(), true); assert.equal(off(), false);
  assert.equal(signal.off('x', callback), false);
  signal.clear(); assert.equal(signal.emit('x'), false);
  assert.deepEqual(signal.eventNames(), []);
});

test('Signal additions wait for next emit and removals skip pending callbacks', () => {
  const signal = new Signal(), seen = [];
  const later = () => seen.push('later');
  signal.on('x', () => { seen.push('first'); signal.off('x', removed); signal.on('x', later); });
  const removed = () => seen.push('removed'); signal.on('x', removed);
  signal.emit('x'); assert.deepEqual(seen, ['first']);
  signal.emit('x'); assert.deepEqual(seen, ['first', 'first', 'later']);
});

test('Signal remove/re-add creates a new registration and stale disposer cannot delete it', () => {
  const signal = new Signal(), seen = [];
  const fn = () => seen.push('called');
  let off;
  signal.once('x', () => { off(); signal.on('x', fn); });
  off = signal.on('x', fn);
  signal.emit('x'); assert.deepEqual(seen, []);
  assert.equal(off(), false);
  signal.emit('x'); assert.deepEqual(seen, ['called']);
});

test('Signal once removes before a nested emit and supports symbol/undefined keys', () => {
  const signal = new Signal(), key = Symbol('event'); let count = 0;
  signal.once(key, () => { count++; signal.emit(key); });
  signal.emit(key); signal.emit(key); assert.equal(count, 1);
  signal.on(undefined, () => count++); signal.on('undefined', () => count++);
  signal.clear(undefined); signal.emit(undefined); signal.emit('undefined'); assert.equal(count, 2);
});

test('Signal clear during delivery stops removed listeners but not another event', () => {
  const signal = new Signal(), seen = [];
  signal.on('x', () => { seen.push(1); signal.clear('x'); });
  signal.on('x', () => seen.push(2)); signal.on('y', () => seen.push(3));
  signal.emit('x'); signal.emit('y'); assert.deepEqual(seen, [1, 3]);
});

test('Signal exceptions retain the original synchronous fail-fast contract', () => {
  const signal = new Signal(), error = new Error('listener failed'); let called = false;
  signal.once('x', () => { throw error; }); signal.on('x', () => { called = true; });
  assert.throws(() => signal.emit('x'), e => e === error);
  assert.equal(called, false); assert.equal(signal.listenerCount('x'), 1);
  signal.emit('x'); assert.equal(called, true);
});

test('Signal abort, off and clear release abort listeners', () => {
  for (const method of ['abort', 'off', 'clear']) {
    const signal = new Signal(), controller = new AbortController();
    const off = signal.on('x', () => assert.fail('removed listener'), {signal: controller.signal});
    assert.equal(getEventListeners(controller.signal, 'abort').length, 1);
    if (method === 'abort') controller.abort(); else if (method === 'off') off(); else signal.clear();
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    assert.equal(signal.listenerCount('x'), 0); signal.emit('x');
  }
});

test('Signal preaborted and duplicate registrations do not acquire abort listeners', () => {
  const signal = new Signal(), a = new AbortController(), b = new AbortController(), fn = () => {};
  a.abort(); signal.on('x', fn, {signal: a.signal}); assert.equal(signal.listenerCount('x'), 0);
  const off = signal.on('x', fn); assert.equal(signal.once('x', fn, {signal: b.signal}), off);
  assert.equal(getEventListeners(b.signal, 'abort').length, 0); off();
});

test('Signal validates listeners and cancellation before changing state', () => {
  const signal = new Signal();
  for (const fn of [null, 0, {}, 'callback']) assert.throws(() => signal.on('x', fn), TypeError);
  assert.throws(() => signal.on('x', () => {}, {signal: {}}), TypeError);
  assert.deepEqual(signal.eventNames(), []);
});

test('Signal waitFor filters, resolves and releases every owned resource', async () => {
  const signal = new Signal(), controller = new AbortController();
  const pending = signal.waitFor('x', {signal: controller.signal, timeout: 1000, predicate: x => x > 2});
  signal.emit('x', 1); assert.equal(signal.listenerCount('x'), 1);
  signal.emit('x', 3); assert.equal(await pending, 3);
  assert.equal(signal.listenerCount('x'), 0); assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('Signal waitFor timeout and abort preserve error/reason identity', async () => {
  const signal = new Signal(), controller = new AbortController(), reason = {reason: 'cancelled'};
  await assert.rejects(signal.waitFor('x', {timeout: 0}), {name: 'TimeoutError'});
  const pending = signal.waitFor('x', {signal: controller.signal, timeout: 1000}); controller.abort(reason);
  await assert.rejects(pending, value => value === reason);
  await assert.rejects(signal.waitFor('x', {signal: controller.signal}), value => value === reason);
  assert.equal(signal.listenerCount('x'), 0); assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('Signal waitFor rejects invalid/asynchronous predicates and predicate errors', async () => {
  const signal = new Signal(), error = new Error('predicate');
  for (const timeout of [-1, Infinity, NaN, 2147483648]) await assert.rejects(signal.waitFor('x', {timeout}), RangeError);
  await assert.rejects(signal.waitFor('x', {predicate: null}), TypeError);
  await assert.rejects(signal.waitFor('x', {signal: {}}), TypeError);
  const failure = signal.waitFor('x', {predicate() { throw error; }}); signal.emit('x');
  await assert.rejects(failure, e => e === error);
  const asynchronous = signal.waitFor('x', {predicate: async () => true}); signal.emit('x');
  await assert.rejects(asynchronous, /synchronous/); assert.equal(signal.listenerCount('x'), 0);
});

test('Signal clear cancels pending waiters and releases timer/abort ownership', async () => {
  const signal = new Signal(), controller = new AbortController();
  const a = signal.waitFor('a', {signal: controller.signal, timeout: 10000});
  const b = signal.waitFor('b'); signal.clear('a');
  await assert.rejects(a, {name: 'AbortError'});
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  assert.equal(signal.listenerCount('b'), 1); signal.clear();
  await assert.rejects(b, {name: 'AbortError'});
});
