import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {getEventListeners} from 'node:events';
import {spawnSync} from 'node:child_process';
import {Sha256, sha256, sha256Hex, sha256Stream, sha256Blob} from '../src/core/sha256.js';
const hex = bytes => Buffer.from(bytes).toString('hex');
const expected = bytes => createHash('sha256').update(bytes).digest('hex');
const encoder = new TextEncoder();

for (const [name, text, digest] of [
  ['empty', '', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
  ['abc', 'abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  ['multiblock', 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
  ['million-a', 'a'.repeat(1000000), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0']
]) test('SHA-256 known vector: ' + name, async () => {
  const bytes = encoder.encode(text); assert.equal(await sha256Hex(bytes, null), digest);
  assert.equal(await sha256Hex(bytes), digest); assert.equal(expected(bytes), digest);
});

test('SHA-256 300 padding boundaries and offset/chunk layouts match independent native hashes', async () => {
  for (let length = 0; length < 300; length++) {
    const source = Uint8Array.from({length: length + 13}, (_, i) => (i * 73 + length) & 255), bytes = source.subarray(7, 7 + length);
    const digest = expected(bytes); assert.equal(await sha256Hex(bytes, null), digest);
    assert.equal(await sha256Hex(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)), digest);
    const hash = new Sha256(); for (let offset = 0; offset < length; offset += 7) hash.update(bytes.subarray(offset, offset + 7));
    assert.equal(hash.hex(), digest); assert.equal(hash.bytesHashed, BigInt(length));
  }
});

test('SHA-256 cross-realm ArrayBuffers/views hash their bytes, not their element values', async () => {
  for (const expression of ['new Uint8Array([1,2,3])', 'new Uint16Array([257,514,771])', 'new DataView(new Uint8Array([4,5,6]).buffer)', 'new Uint8Array([8,9]).buffer']) {
    const data = runInNewContext(expression);
    const bytes = ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data);
    assert.equal(await sha256Hex(data, null), expected(bytes)); assert.equal(await sha256Hex(data), expected(bytes));
  }
});

test('SHA-256 clone forks partial prefixes and finalized results cannot mutate internal state', () => {
  const prefix = new Sha256().update(encoder.encode('prefix'));
  const a = prefix.clone().update(encoder.encode('A')), b = prefix.clone().update(encoder.encode('B'));
  assert.equal(a.hex(), expected(encoder.encode('prefixA'))); assert.equal(b.hex(), expected(encoder.encode('prefixB')));
  const result = a.digest(); result.fill(0); assert.equal(a.hex(), expected(encoder.encode('prefixA')));
  assert.equal(a.clone().hex(), a.hex()); assert.equal(prefix.finalized, false);
  assert.throws(() => a.update(new Uint8Array()), /finalized/);
});

test('SHA-256 consumes partial input synchronously without retaining caller buffers', () => {
  const data = encoder.encode('abcdef'), hash = new Sha256().update(data); data.fill(0);
  assert.equal(hash.hex(), expected(encoder.encode('abcdef')));
});

test('SHA-256 invalid input/native provider failure cannot silently succeed', async () => {
  for (const value of [null, undefined, {}, [], 'abc', 12, {[Symbol.toStringTag]: 'ArrayBuffer'}, new Proxy(new ArrayBuffer(2), {})]) await assert.rejects(sha256(value, null), TypeError);
  await assert.rejects(sha256(new Uint8Array(new SharedArrayBuffer(2)), null), /shared memory/);
  await assert.rejects(sha256(new Uint8Array(), {}), TypeError);
  const error = new Error('native digest failed'); await assert.rejects(sha256(new Uint8Array(), {digest: async () => { throw error; }}), e => e === error);
  await assert.rejects(sha256(new Uint8Array(), {digest: async () => new ArrayBuffer(1)}), /digest length/);
});

test('SHA-256 streams iterable and asynchronous chunks with exact progress', async () => {
  const chunks = [encoder.encode('a'), new Uint8Array(), encoder.encode('bc')], progress = [];
  assert.equal(hex(await sha256Stream(chunks, {onProgress: n => progress.push(n), yieldEvery: 2})), expected(encoder.encode('abc')));
  assert.deepEqual(progress, [1n, 1n, 3n]);
  async function* source() { yield* chunks; }
  assert.equal(hex(await sha256Stream(source())), expected(encoder.encode('abc')));
});

test('SHA-256 ReadableStream and Blob paths release their reader lock', async () => {
  const blob = new Blob(['abc', 'def']), stream = blob.stream();
  assert.equal(hex(await sha256Stream(stream)), expected(encoder.encode('abcdef'))); assert.equal(stream.locked, false);
  assert.equal(hex(await sha256Blob(blob)), expected(encoder.encode('abcdef')));
});

test('SHA-256 abort interrupts pending stream read, cancels source and removes listeners', async () => {
  const controller = new AbortController(), reason = new Error('cancel'); let cancelled;
  const stream = new ReadableStream({cancel(value) { cancelled = value; }});
  const pending = sha256Stream(stream, {signal: controller.signal}); controller.abort(reason);
  await assert.rejects(pending, e => e === reason); assert.equal(cancelled, reason); assert.equal(stream.locked, false);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('SHA-256 abort interrupts stuck iterable and closes it without awaiting stuck return', async () => {
  let closed = 0; const controller = new AbortController();
  const source = {[Symbol.asyncIterator]() { return this; }, next() { return new Promise(() => {}); }, return() { closed++; return new Promise(() => {}); }};
  const pending = sha256Stream(source, {signal: controller.signal}); controller.abort('cancel');
  await assert.rejects(pending, e => e === 'cancel'); assert.equal(closed, 1);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('SHA-256 timer abort remains responsive with a synchronous source', async () => {
  const controller = new AbortController(); let closed = false;
  function* source() { try { for (let i = 0; i < 100000; i++) yield new Uint8Array(4096); } finally { closed = true; } }
  const timer = setTimeout(() => controller.abort('timer'), 0);
  try { await assert.rejects(sha256Stream(source(), {signal: controller.signal, yieldEvery: 8192}), e => e === 'timer'); }
  finally { clearTimeout(timer); }
  assert.equal(closed, true);
});

test('SHA-256 malformed stream chunks and progress failures cancel and unlock', async () => {
  for (const mode of ['chunk', 'progress', 'async-progress']) {
    let cancelled = 0; const stream = new ReadableStream({start(c) { c.enqueue(mode === 'chunk' ? 'bad' : new Uint8Array([1])); }, cancel() { cancelled++; }});
    await assert.rejects(sha256Stream(stream, {onProgress: mode === 'progress' ? () => { throw new Error('progress'); } : mode === 'async-progress' ? async () => {} : undefined}));
    assert.equal(stream.locked, false); assert.equal(cancelled, 1);
  }
});

test('SHA-256 preabort/invalid options do not acquire a reader', async () => {
  let reads = 0; const source = {getReader() { reads++; throw new Error('acquired'); }}, controller = new AbortController(); controller.abort('stop');
  await assert.rejects(sha256Stream(source, {signal: controller.signal}), e => e === 'stop');
  for (const options of [{signal: {}}, {onProgress: 1}, {yieldEvery: 0}, {yieldEvery: Infinity}]) await assert.rejects(sha256Stream(source, options));
  assert.equal(reads, 0); await assert.rejects(sha256Stream({}), TypeError); await assert.rejects(sha256Blob({}), TypeError);
});

for (const length of [0, 1]) test('SHA-256 timer abort interrupts tiny synchronous chunks of size ' + length, async () => {
  const controller = new AbortController(); let count = 0, closed = false;
  function* source() { try { for (; count < 100000; count++) yield new Uint8Array(length); } finally { closed = true; } }
  const timer = setTimeout(() => controller.abort('tiny'), 0);
  try { await assert.rejects(sha256Stream(source(), {signal: controller.signal}), e => e === 'tiny'); }
  finally { clearTimeout(timer); }
  assert.equal(closed, true); assert.ok(count < 1000, 'abort yields after bounded chunks');
});

test('SHA-256 detached buffers are rejected and cleanup cannot mask the producer failure', async () => {
  const bytes = new Uint8Array(3); structuredClone(bytes.buffer, {transfer: [bytes.buffer]});
  await assert.rejects(sha256(bytes, null), TypeError);
  const original = new Error('read failed');
  const source = {getReader() { return {read() { throw original; }, cancel() { throw new Error('cancel'); }, releaseLock() { throw new Error('release'); }}; }};
  await assert.rejects(sha256Stream(source), error => error === original);
});


test('SHA-256 cancellation does not retain one promise reaction per processed chunk', () => {
  // Isolate forced GC from the test runner. Compare retained heap while the
  // stream is still open, not after completion has released all its closures.
  const moduleUrl = new URL('../src/core/sha256.js', import.meta.url).href;
  const probe = `
    import {sha256Stream} from ${JSON.stringify(moduleUrl)};
    async function growth(signal) {
      let count = 0, baseline = 0, retained = 0;
      const empty = new Uint8Array();
      function* source() { for (let i = 0; i < 50000; i++) yield empty; }
      await sha256Stream(source(), {signal, onProgress() {
        if (++count === 1000) { globalThis.gc(); baseline = process.memoryUsage().heapUsed; }
        if (count === 50000) { globalThis.gc(); retained = process.memoryUsage().heapUsed; }
      }});
      return retained - baseline;
    }
    console.log(JSON.stringify({plain: await growth(), cancelable: await growth(new AbortController().signal)}));
  `;
  const result = spawnSync(process.execPath, ['--expose-gc', '--input-type=module', '-e', probe], {encoding: 'utf8', timeout: 20000});
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  const memory = JSON.parse(result.stdout);
  assert.ok(memory.cancelable < Math.max(0, memory.plain) + 4 * 1024 * 1024,
    'Cancellation retains per-chunk promise reactions: ' + JSON.stringify(memory));
});

test('SHA-256 observes abort inside a synchronous next before awaiting a stuck result', async () => {
  const controller = new AbortController(); let closed = 0;
  const source = {
    [Symbol.asyncIterator]() { return this; },
    next() { controller.abort('inside next'); return new Promise(() => {}); },
    return() { closed++; return {done: true}; }
  };
  await assert.rejects(sha256Stream(source, {signal: controller.signal}), reason => reason === 'inside next');
  assert.equal(closed, 1); assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});
