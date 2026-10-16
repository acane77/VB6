import test from 'node:test';
import assert from 'node:assert/strict';
import {getEventListeners} from 'node:events';
import {Signal} from '../src/core/signal.js';
import {sha256} from '../src/core/sha256.js';

test('Signal clear uses Map key equality for NaN and signed zero waiters', async () => {
  for (const [registered, cleared] of [[NaN, NaN], [-0, 0], [0, -0]]) {
    const signal = new Signal(), controller = new AbortController();
    const pending = signal.waitFor(registered, {signal: controller.signal});
    signal.clear(cleared);
    assert.equal(signal.listenerCount(registered), 0);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    await assert.rejects(pending, {name: 'AbortError'});
  }
});

test('SHA-256 native providers must return actual bytes, not a size or array-like impostor', async () => {
  for (const result of [32, '32', Array(32).fill(0), {length: 32}, {[Symbol.toStringTag]: 'ArrayBuffer', byteLength: 32}])
    await assert.rejects(sha256(new Uint8Array([1]), {digest: async () => result}), TypeError);
  const data = new Uint8Array(34).fill(7);
  const digest = await sha256(new Uint8Array([1]), {digest: async () => new DataView(data.buffer, 1, 32)});
  data.fill(0); assert.deepEqual(digest, new Uint8Array(32).fill(7));
});
