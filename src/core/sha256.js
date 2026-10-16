/** SHA-256 for artifact integrity, not authentication. No keys are stored.
 * WebCrypto for one-shot inputs; constant-workspace portable and stream APIs.
 * Compression/padding follow FIPS 180-4; test vectors are independently checked
 * against node:crypto and WebCrypto rather than this implementation itself.
 */
const K = new Uint32Array([
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
]);
const rotate = (value, count) => (value >>> count) | (value << (32-count));
const arrayBufferSize = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get;

function bytesOf(data) {
  let bytes;
  if (ArrayBuffer.isView(data)) bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  else {
    // A native brand check accepts foreign-realm buffers without accepting an
    // object that merely spoofs Symbol.toStringTag as an empty byte buffer.
    try { arrayBufferSize.call(data); }
    catch { throw new TypeError('SHA-256 input must be an ArrayBuffer or an ArrayBuffer view.'); }
    bytes = new Uint8Array(data);
  }
  // Concurrently mutable memory cannot provide deterministic artifact integrity.
  try { arrayBufferSize.call(bytes.buffer); }
  catch { throw new TypeError('Copy shared memory before hashing.'); }
  return bytes;
}
const toHex = bytes => [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');

/** Incremental hasher. update() consumes bytes synchronously without retaining
 * them. digest()/hex() finalize once and return independent results thereafter.
 * clone() forks either an unfinished prefix or a finalized hash.
 */
export class Sha256 {
  #state = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
  #words = new Uint32Array(64);
  #block = new Uint8Array(64);
  #view = new DataView(this.#block.buffer);
  #used = 0;
  #low = 0;
  #high = 0;
  #result = null;

  get bytesHashed() { return BigInt(this.#high) * 0x100000000n + BigInt(this.#low); }
  get finalized() { return this.#result !== null; }

  #compress(view, offset) {
    const w = this.#words, state = this.#state;
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const x = w[i-15], y = w[i-2];
      w[i] = (w[i-16] + (rotate(x,7)^rotate(x,18)^(x>>>3)) + w[i-7] + (rotate(y,17)^rotate(y,19)^(y>>>10))) >>> 0;
    }
    let a=state[0],b=state[1],c=state[2],d=state[3],e=state[4],f=state[5],g=state[6],h=state[7];
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotate(e,6)^rotate(e,11)^rotate(e,25)) + ((e&f)^(~e&g)) + K[i] + w[i]) >>> 0;
      const t2 = ((rotate(a,2)^rotate(a,13)^rotate(a,22)) + ((a&b)^(a&c)^(b&c))) >>> 0;
      h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;
    }
    state[0]=(state[0]+a)>>>0;state[1]=(state[1]+b)>>>0;state[2]=(state[2]+c)>>>0;state[3]=(state[3]+d)>>>0;
    state[4]=(state[4]+e)>>>0;state[5]=(state[5]+f)>>>0;state[6]=(state[6]+g)>>>0;state[7]=(state[7]+h)>>>0;
  }

  update(data) {
    if (this.finalized) throw new Error('SHA-256 has already been finalized.');
    const bytes = bytesOf(data), length = bytes.byteLength;
    const low = this.#low + (length % 0x100000000);
    const high = this.#high + Math.floor(length / 0x100000000) + Math.floor(low / 0x100000000);
    if (high >= 0x20000000) throw new RangeError('SHA-256 input must be shorter than 2^64 bits.');
    this.#low = low >>> 0; this.#high = high;
    let offset = 0;
    if (this.#used) {
      const count = Math.min(64 - this.#used, length);
      this.#block.set(bytes.subarray(0, count), this.#used);
      this.#used += count; offset = count;
      if (this.#used === 64) { this.#compress(this.#view, 0); this.#used = 0; }
    }
    if (offset + 64 <= length) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      while (offset + 64 <= length) { this.#compress(view, offset); offset += 64; }
    }
    if (offset < length) {
      this.#block.set(bytes.subarray(offset)); this.#used = length - offset;
    }
    return this;
  }

  digest() {
    if (!this.#result) {
      this.#block[this.#used] = 0x80;
      this.#block.fill(0, this.#used + 1);
      if (this.#used >= 56) { this.#compress(this.#view, 0); this.#block.fill(0); }
      this.#view.setUint32(56, ((this.#high << 3) | (this.#low >>> 29)) >>> 0);
      this.#view.setUint32(60, (this.#low << 3) >>> 0);
      this.#compress(this.#view, 0);
      this.#result = new Uint8Array(32);
      const view = new DataView(this.#result.buffer);
      for (let i = 0; i < 8; i++) view.setUint32(i * 4, this.#state[i]);
    }
    return this.#result.slice();
  }
  hex() { return toHex(this.digest()); }
  clone() {
    const copy = new Sha256();
    copy.#state.set(this.#state); copy.#block.set(this.#block);
    copy.#used = this.#used; copy.#low = this.#low; copy.#high = this.#high;
    copy.#result = this.#result?.slice() ?? null;
    return copy;
  }
}

export async function sha256(data, subtle = globalThis.crypto?.subtle) {
  const bytes = bytesOf(data);
  if (subtle == null) return new Sha256().update(bytes).digest();
  if (typeof subtle.digest !== 'function') throw new TypeError('Invalid SubtleCrypto provider.');
  // Do not disguise a native provider rejection as a successful fallback.
  const result = bytesOf(await subtle.digest('SHA-256', bytes));
  if (result.byteLength !== 32) throw new Error('Invalid SHA-256 digest length.');
  return result.slice();
}
export async function sha256Hex(data, subtle = globalThis.crypto?.subtle) { return toHex(await sha256(data, subtle)); }

/** Hash ReadableStream or (async) iterable chunks without buffering the source.
 * onProgress receives an exact BigInt byte count. Long synchronous producers
 * yield to timers/input after yieldEvery bytes. Cancellation also interrupts a
 * pending read/next and releases the stream lock without awaiting a stuck source.
 */
export async function sha256Stream(source, {signal, onProgress, yieldEvery = 4 * 1024 * 1024} = {}) {
  if (signal != null && (typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function' || typeof signal.aborted !== 'boolean'))
    throw new TypeError('signal must be an AbortSignal.');
  if (onProgress != null && typeof onProgress !== 'function') throw new TypeError('onProgress must be a function.');
  if (!Number.isSafeInteger(yieldEvery) || yieldEvery < 1) throw new RangeError('yieldEvery must be a positive safe integer.');
  if (signal?.aborted) throw signal.reason;
  let reader, iterator;
  if (typeof source?.getReader === 'function') reader = source.getReader();
  else if (typeof source?.[Symbol.asyncIterator] === 'function') iterator = source[Symbol.asyncIterator]();
  else if (typeof source?.[Symbol.iterator] === 'function') iterator = source[Symbol.iterator]();
  else throw new TypeError('A byte stream or iterable of byte chunks is required.');
  let rejectRead, complete = false, work = 0, chunks = 0;
  // Own only the current read. Racing every chunk against one never-settled
  // abort promise would retain a reaction and its closure for every chunk.
  const abort = () => rejectRead?.(signal.reason);
  const waitForRead = pending => !signal ? pending : new Promise((resolve, reject) => {
    rejectRead = reject;
    Promise.resolve(pending).then(resolve, reject);
    // A synchronous producer can abort inside next(), before this read exists.
    if (signal.aborted) reject(signal.reason);
  }).finally(() => { rejectRead = undefined; });
  const check = () => { if (signal?.aborted) throw signal.reason; };
  signal?.addEventListener('abort', abort, {once: true});
  const hash = new Sha256();
  try {
    while (true) {
      check();
      const pending = reader ? reader.read() : iterator.next();
      const step = await waitForRead(pending);
      check();
      if (!step || typeof step !== 'object') throw new TypeError('Invalid byte iterator result.');
      if (step.done) { complete = true; break; }
      const bytes = bytesOf(step.value);
      for (let offset = 0; offset < bytes.length;) {
        check();
        const size = Math.min(bytes.length - offset, 1024 * 1024, yieldEvery - work);
        hash.update(bytes.subarray(offset, offset + size));
        offset += size; work += size;
        if (work >= yieldEvery) { work = chunks = 0; await new Promise(resolve => setTimeout(resolve, 0)); check(); }
      }
      const progress = onProgress?.(hash.bytesHashed);
      if (progress && typeof progress.then === 'function') {
        Promise.resolve(progress).catch(() => {});
        throw new TypeError('onProgress must be synchronous.');
      }
      // Empty/tiny synchronous chunks must not starve timer-driven aborts.
      if (++chunks >= 128) { chunks = work = 0; await new Promise(resolve => setTimeout(resolve, 0)); check(); }
    }
    return hash.digest();
  } finally {
    signal?.removeEventListener('abort', abort);
    if (!complete) {
      // Cleanup errors never replace the original hashing/read/abort failure.
      try { Promise.resolve(reader ? reader.cancel(signal?.reason) : iterator.return?.()).catch(() => {}); } catch {}
    }
    if (complete) reader?.releaseLock();
    else { try { reader?.releaseLock(); } catch {} }
  }
}
export async function sha256Blob(blob, options) {
  if (typeof blob?.stream !== 'function') throw new TypeError('A Blob with stream() is required.');
  return sha256Stream(blob.stream(), options);
}
