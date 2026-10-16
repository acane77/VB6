import test from 'node:test';
import assert from 'node:assert/strict';
import {getEventListeners} from 'node:events';
import {debounce} from '../src/core/debounce.js';
const timers = t => t.mock.timers.enable({apis: ['setTimeout']});

test('debounce uses last arguments/receiver and trailing execution', t => {
  timers(t); const seen = [], owner = {n: 4};
  const call = debounce(function(value) { seen.push(this.n + value); return this.n + value; }, 20);
  call.call(owner, 1); t.mock.timers.tick(10); call.call(owner, 2);
  t.mock.timers.tick(19); assert.deepEqual(seen, []); assert.equal(call.pending(), true);
  t.mock.timers.tick(1); assert.deepEqual(seen, [6]); assert.equal(call.pending(), false);
  assert.equal(call.flush(), 6);
});

test('debounce flush runs once and cancel is reusable', t => {
  timers(t); let count = 0; const call = debounce(() => ++count, 10);
  call(); assert.equal(call.flush(), 1); call.flush(); t.mock.timers.tick(100); assert.equal(count, 1);
  call(); call.cancel(); assert.equal(call.pending(), false); t.mock.timers.tick(100); assert.equal(count, 1);
  call(); t.mock.timers.tick(10); assert.equal(count, 2);
});

test('debounce leading and trailing do not double invoke a single call', t => {
  timers(t); const seen = [], call = debounce(n => { seen.push(n); return n; }, 10, {leading: true});
  assert.equal(call(1), 1); t.mock.timers.tick(10); assert.deepEqual(seen, [1]);
  call(2); call(3); t.mock.timers.tick(10); assert.deepEqual(seen, [1, 2, 3]);
});

test('debounce leading-only suppresses trailing calls and starts a new burst', t => {
  timers(t); const seen = [], call = debounce(n => seen.push(n), 10, {leading: true, trailing: false});
  call(1); call(2); t.mock.timers.tick(10); assert.deepEqual(seen, [1]);
  call(3); call.flush(); assert.deepEqual(seen, [1, 3]); assert.equal(call.pending(), false);
});

test('debounce maxWait bounds a continuous burst', t => {
  timers(t); const seen = [], call = debounce(n => seen.push(n), 10, {maxWait: 25});
  call(0); for (let i = 1; i <= 4; i++) { t.mock.timers.tick(5); call(i); }
  t.mock.timers.tick(5); assert.deepEqual(seen, [4]); assert.equal(call.pending(), false);
  call(5); t.mock.timers.tick(10); assert.deepEqual(seen, [4, 5]);
});

test('debounce reentrant flush leaves newly scheduled work intact', t => {
  timers(t); const seen = []; const call = debounce(n => { seen.push(n); if (n === 1) call(2); }, 10);
  call(1); call.flush(); assert.deepEqual(seen, [1]); assert.equal(call.pending(), true);
  t.mock.timers.tick(10); assert.deepEqual(seen, [1, 2]);
});

test('debounce leading reentrancy does not recurse immediately', t => {
  timers(t); const seen = []; const call = debounce(n => { seen.push(n); if (n === 1) call(2); }, 10, {leading: true});
  call(1); assert.deepEqual(seen, [1]); t.mock.timers.tick(10); assert.deepEqual(seen, [1, 2]);
});

test('debounce a thrown callback clears old work without swallowing its error', t => {
  timers(t); const error = new Error('callback'), call = debounce(() => { throw error; }, 10);
  call(); assert.throws(() => call.flush(), e => e === error); assert.equal(call.pending(), false);
  t.mock.timers.tick(100);
});

test('debounce abort and dispose stop pending and future work and release listeners', t => {
  timers(t);
  for (const action of ['abort', 'dispose']) {
    const controller = new AbortController(), call = debounce(() => assert.fail('disposed work'), 10, {signal: controller.signal});
    call(); assert.equal(getEventListeners(controller.signal, 'abort').length, 1);
    if (action === 'abort') controller.abort(); else call.dispose();
    call(); call.flush(); t.mock.timers.tick(100); assert.equal(call.pending(), false);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0); call.dispose();
  }
});

test('debounce preabort and invalid options never schedule work', t => {
  timers(t); const controller = new AbortController(); controller.abort();
  const call = debounce(() => assert.fail(), 0, {signal: controller.signal}); call(); t.mock.timers.tick(1);
  assert.equal(call.pending(), false);
  for (const value of [-1, Infinity, NaN, '10', 2147483648]) {
    assert.throws(() => debounce(() => {}, value), RangeError);
    assert.throws(() => debounce(() => {}, 1, {maxWait: value}), RangeError);
  }
  assert.throws(() => debounce(null), TypeError);
  assert.throws(() => debounce(() => {}, 1, {leading: false, trailing: false}), TypeError);
  assert.throws(() => debounce(() => {}, 1, {signal: {}}), TypeError);
});
