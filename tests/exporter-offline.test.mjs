import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createHash, webcrypto} from 'node:crypto';
import {installOfflineWorker, OFFLINE_REGISTRATION} from '../src/exporter/offline-worker.js';

const hash = data => createHash('sha256').update(data).digest('hex');
const tick = () => new Promise(resolve => setImmediate(resolve));
const scope = 'https://example.test/apps/one/';
const prefix = 'vb6-export:' + encodeURIComponent(scope) + ':';
const staticFiles = {'index.html': '<html>release one</html>', 'runtime.js': 'globalThis.runtime=1;', 'assets/raw.bin': Buffer.from([0,255,128])};

function storage() {
  const contents = new Map();
  let failOpen = false, failPut = false;
  return {
    contents,
    set failOpen(value) {failOpen = value;}, set failPut(value) {failPut = value;},
    async keys() {return [...contents.keys()];},
    async delete(name) {return contents.delete(name);},
    async open(name) {
      if (failOpen) throw new Error('Storage unavailable');
      if (!contents.has(name)) contents.set(name, new Map());
      const map = contents.get(name);
      return {
        async put(key, response) {if (failPut) throw new Error('Quota exceeded'); map.set(String(key), response.clone());},
        async match(key) {return map.get(String(key))?.clone();},
        async delete(key) {return map.delete(String(key));}
      };
    }
  };
}
function worker({files = staticFiles, revision = 'one', cache = storage(), origin = scope, responseFor, update} = {}) {
  const listeners = new Map(), requests = [], updates = [];
  const configuration = {revision, files: Object.entries(files).map(([path, data]) => ({path, bytes: Buffer.byteLength(data), sha256: hash(data)}))};
  const fetch = async request => {
    requests.push(request);
    const path = request.url.slice(origin.length);
    if (responseFor) return responseFor(path, request);
    if (!Object.hasOwn(files, path)) return new Response('missing', {status: 404});
    return new Response(files[path], {headers: {'content-type': path.endsWith('.html') ? 'text/html' : 'application/octet-stream', 'content-encoding': 'gzip'}});
  };
  const context = vm.createContext({URL, Request, Response, Headers, Uint8Array, crypto: webcrypto, caches: cache, fetch,
    self: {registration: {scope: origin, update: () => {updates.push(true); return update ? update() : Promise.resolve();}}, addEventListener: (type, fn) => listeners.set(type, fn)}});
  vm.runInContext('(' + installOfflineWorker.toString() + ')(' + JSON.stringify(configuration) + ')', context);
  const dispatch = async type => {let pending; listeners.get(type)({waitUntil(value) {pending = value;}}); await pending;};
  function request(url, options = {}) {
    const req = {url: new URL(url, origin).href, method: options.method || 'GET', mode: options.mode || 'cors', headers: new Headers(options.headers)};
    let response; const work = [];
    listeners.get('fetch')({request: req, respondWith(value) {response = value;}, waitUntil(value) {work.push(value);}});
    return {response, work};
  }
  return {cache, requests, updates, configuration, dispatch, request};
}

test('install validates all bytes and omits credentials and redirects before caching', async () => {
  const w = worker(); await w.dispatch('install');
  assert.equal(w.requests.length, 3);
  for (const request of w.requests) {assert.equal(request.cache, 'reload'); assert.equal(request.credentials, 'omit'); assert.equal(request.redirect, 'error');}
  const cache = await w.cache.open(prefix + 'one');
  for (const [path, expected] of Object.entries(staticFiles)) {
    const response = await cache.match(scope + path);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from(expected));
    assert.equal(response.headers.get('content-encoding'), null);
    assert.equal(response.headers.get('content-length'), String(Buffer.byteLength(expected)));
  }
});
for (const variant of ['404', '500', '204', 'no-store', 'wrong-hash', 'oversized', 'truncated', 'redirected', 'opaque', 'network-error', 'missing-body']) {
  test('incomplete release fails install atomically: ' + variant, async () => {
    const cache = storage(); await cache.open(prefix + 'previous');
    const w = worker({cache, responseFor: path => {
      if (path !== 'runtime.js') return new Response(staticFiles[path]);
      if (variant === 'network-error') throw new Error('Offline');
      if (variant === '204' || variant === 'missing-body') return new Response(null, {status: variant === '204' ? 204 : 200});
      const response = new Response(variant === 'wrong-hash' ? 'x'.repeat(staticFiles[path].length) : variant === 'oversized' ? staticFiles[path] + 'extra' : variant === 'truncated' ? 'short' : staticFiles[path], {status: /^[45]/.test(variant) ? Number(variant) : 200, headers: variant === 'no-store' ? {'cache-control': 'private, no-store'} : {}});
      if (variant === 'redirected') Object.defineProperty(response, 'redirected', {value: true});
      if (variant === 'opaque') Object.defineProperty(response, 'type', {value: 'opaque'});
      return response;
    }});
    await assert.rejects(w.dispatch('install'));
    assert.deepEqual(await cache.keys(), [prefix + 'previous']);
  });
}
test('failed cache writes delete only a newly allocated release cache', async () => {
  const cache = storage(); await cache.open(prefix + 'previous'); cache.failPut = true;
  await assert.rejects(worker({cache}).dispatch('install'), /Quota/);
  assert.deepEqual(await cache.keys(), [prefix + 'previous']);
  await cache.open(prefix + 'one');
  await assert.rejects(worker({cache}).dispatch('install'), /Quota/);
  assert.deepEqual(await cache.keys(), [prefix + 'previous', prefix + 'one']);
});
test('activation cleans only this exact scope and never claims clients or skip-waits', async () => {
  const w = worker();
  for (const name of [prefix + 'previous', prefix + 'one', 'vb6-export:' + encodeURIComponent(scope + 'child/') + ':old', 'unrelated']) await w.cache.open(name);
  await w.dispatch('activate');
  assert.deepEqual(await w.cache.keys(), [prefix + 'one', 'vb6-export:' + encodeURIComponent(scope + 'child/') + ':old', 'unrelated']);
  // The harness deliberately provides no skipWaiting/clients.claim implementation.
});
test('static cache serves exact files, entry navigation and launch query without network', async () => {
  const w = worker(); await w.dispatch('install');
  const before = w.requests.length;
  for (const [url, mode, content] of [['runtime.js', 'cors', staticFiles['runtime.js']], ['./?launch=yes', 'navigate', staticFiles['index.html']], ['index.html?launch=yes', 'navigate', staticFiles['index.html']]]) {
    const {response} = w.request(url, {mode});
    assert.equal(await (await response).text(), content);
  }
  assert.equal(w.requests.length, before);
});
for (const [url, options] of [['api/users', {}], ['missing.html', {mode: 'navigate'}], ['runtime.js?fresh=1', {}], ['https://elsewhere.test/runtime.js', {}], ['runtime.js', {method: 'POST'}], ['runtime.js', {headers: {Authorization: 'Bearer session-only'}}], ['runtime.js', {headers: {Range: 'bytes=1-2'}}]]) {
  test('worker leaves request to browser/network: ' + url + JSON.stringify(options), () => {
    assert.equal(worker().request(url, options).response, undefined);
  });
}
test('evicted bytes are restored only from the pinned release', async () => {
  const w = worker(); await w.dispatch('install');
  const cache = await w.cache.open(prefix + 'one'); await cache.delete(scope + 'runtime.js');
  const response = await w.request('runtime.js').response;
  assert.equal(await response.text(), staticFiles['runtime.js']);
  assert.equal(w.requests.length, 4);
  assert.ok(await cache.match(scope + 'runtime.js'));
});
test('a new server release cannot contaminate an old client, and update discovery cannot block 503', async () => {
  const w = worker({responseFor: () => new Response('different release'), update: () => new Promise(() => {})});
  const result = w.request('runtime.js'), response = await result.response;
  assert.equal(response.status, 503); assert.match(await response.text(), /close all application tabs/);
  await tick(); assert.equal(w.updates.length, 1); assert.equal(result.work.length, 1);
  const cache = await w.cache.open(prefix + 'one'); assert.equal(await cache.match(scope + 'runtime.js'), undefined);
});
test('storage restrictions still permit independently verified network bytes', async () => {
  const w = worker(); w.cache.failOpen = true;
  const response = await w.request('runtime.js').response;
  assert.equal(response.status, 200); assert.equal(await response.text(), staticFiles['runtime.js']);
});
test('zero-length packaged files pass a real response stream and SHA-256 verification', async () => {
  const w = worker({files: {'empty.txt': ''}}); await w.dispatch('install');
  assert.equal(await (await w.request('empty.txt').response).text(), '');
});

function emitter(target = {}) {
  const listeners = new Map();
  target.addEventListener = (type, fn) => {if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn);};
  target.removeEventListener = (type, fn) => listeners.get(type)?.delete(fn);
  target.emit = type => {for (const fn of [...(listeners.get(type) || [])]) fn();};
  target.listenerCount = type => listeners.get(type)?.size || 0;
  return target;
}
function registrationEnvironment({secure = true, available = true, state = 'activated', registerError, appReady = Promise.resolve({}), appPhase = 'ready', href = scope + 'offline-register.js'} = {}) {
  const worker = emitter({state}), registration = emitter({installing: state === 'installing' ? worker : null, waiting: null, active: state === 'activated' ? worker : null});
  if (state === 'installed') registration.waiting = worker;
  const calls = [], events = [];
  const context = vm.createContext({URL, isSecureContext: secure, document: {currentScript: {src: href}}, navigator: {serviceWorker: available ? {register: async (...args) => {calls.push(args); if (registerError) throw registerError; return registration;}} : undefined}, vb6ApplicationReady: appReady, vb6ApplicationStatus: {phase: appPhase}, CustomEvent: class {constructor(type, {detail}) {this.type = type; this.detail = detail;}}, dispatchEvent: event => events.push(event)});
  return {context, calls, events, registration, worker, start: () => vm.runInContext(OFFLINE_REGISTRATION, context)};
}
for (const options of [{secure: false}, {available: false}, {href: 'file:///tmp/app/offline-register.js'}]) test('offline registration degrades without failing application: ' + JSON.stringify(options), async () => {
  const env = registrationEnvironment(options);
  assert.equal(await env.start(), null); assert.equal(env.calls.length, 0); assert.equal(env.context.vb6OfflineStatus.phase, 'unavailable');
  assert.equal(env.context.vb6ApplicationStatus.phase, 'ready');
});
test('registration waits for real application readiness and uses its script-owned scope', async () => {
  let resolve; const env = registrationEnvironment({appReady: new Promise(done => {resolve = done;})});
  const first = env.start(); assert.equal(first, env.start()); await tick(); assert.equal(env.calls.length, 0);
  resolve({}); await first;
  assert.equal(env.calls.length, 1); assert.equal(env.calls[0][0], scope + 'service-worker.js');
  assert.equal(env.calls[0][1].scope, scope); assert.equal(env.calls[0][1].updateViaCache, 'none');
  assert.equal(env.context.vb6OfflineStatus.phase, 'ready');
});
test('a failed application cannot silently install a broken offline release', async () => {
  const env = registrationEnvironment({appReady: Promise.reject(new Error('VB startup failed'))});
  await assert.rejects(env.start(), /VB startup/); assert.equal(env.calls.length, 0); assert.equal(env.context.vb6OfflineStatus.phase, 'error');
});
test('disposed application never begins registration and exposes terminal status', async () => {
  const env = registrationEnvironment({appPhase: 'disposed'}); await env.start();
  assert.equal(env.calls.length, 0); assert.equal(env.context.vb6OfflineStatus.phase, 'disposed');
});
test('install completion, waiting updates and redundant workers retain truthful status', async () => {
  const env = registrationEnvironment({state: 'installing'}), ready = env.start(); await tick();
  assert.equal(env.context.vb6OfflineStatus.phase, 'registering');
  env.worker.state = 'installed'; env.worker.emit('statechange'); await ready;
  assert.equal(env.worker.listenerCount('statechange'), 0);
  assert.equal(env.context.vb6OfflineStatus.phase, 'ready');
  const newer = emitter({state: 'installing'}); env.registration.installing = newer; env.registration.emit('updatefound');
  env.registration.waiting = newer; newer.state = 'installed'; newer.emit('statechange');
  assert.equal(env.context.vb6OfflineStatus.updateAvailable, true); assert.equal(newer.listenerCount('statechange'), 0);
  const failed = registrationEnvironment({state: 'installing'}), pending = failed.start(); await tick();
  failed.worker.state = 'redundant'; failed.worker.emit('statechange'); await assert.rejects(pending, /installation failed/);
  assert.equal(failed.context.vb6OfflineStatus.phase, 'error'); assert.equal(failed.worker.listenerCount('statechange'), 0);
});
test('registration failures reject the public promise without changing application readiness', async () => {
  const env = registrationEnvironment({registerError: new Error('Worker refused')});
  await assert.rejects(env.start(), /Worker refused/);
  assert.equal(env.context.vb6OfflineStatus.error, 'Worker refused'); assert.equal(env.context.vb6ApplicationStatus.phase, 'ready');
});

test('a missing bootstrap promise cannot silently register an unstarted application', async () => {
  const env = registrationEnvironment(); delete env.context.vb6ApplicationReady;
  await assert.rejects(env.start(), /startup promise/); assert.equal(env.calls.length, 0);
});
