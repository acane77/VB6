/** Emitted verbatim as an external classic service worker. Static release files
 * only: no API, remote-origin, authenticated or arbitrary navigation caching.
 * Updates wait for old clients naturally; never skipWaiting or force a reload.
 */
export function installOfflineWorker(configuration) {
  const scope = new URL(self.registration.scope);
  const prefix = 'vb6-export:' + encodeURIComponent(scope.href) + ':';
  const cacheName = prefix + configuration.revision;
  const entries = new Map(configuration.files.map(entry => [new URL(entry.path, scope).href, entry]));
  const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  async function fetchVerified(url, entry) {
    const response = await fetch(new Request(url, {cache: 'reload', credentials: 'omit', redirect: 'error'}));
    if (!response.ok || response.status !== 200 || response.redirected || response.type === 'opaque' || /(?:^|,)\s*no-store\b/i.test(response.headers.get('cache-control') || '')) throw new Error('Offline file unavailable: ' + entry.path);
    if (!response.body) throw new Error('Offline response body unavailable: ' + entry.path);
    const bytes = new Uint8Array(entry.bytes), reader = response.body.getReader();
    let offset = 0;
    try {
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        if (offset + value.length > bytes.length) throw new Error('Offline file exceeds expected size: ' + entry.path);
        bytes.set(value, offset); offset += value.length;
      }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    finally { reader.releaseLock(); }
    if (offset !== entry.bytes || hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))) !== entry.sha256) throw new Error('Offline integrity mismatch: ' + entry.path);
    const headers = new Headers(response.headers);
    headers.delete('content-encoding'); headers.set('content-length', String(bytes.length));
    return new Response(bytes, {status: 200, headers});
  }
  self.addEventListener('install', event => {
    event.waitUntil((async () => {
      // Validate the whole release before opening its cache. A partial upload,
      // login redirect, HTML error page or mismatched release fails installation.
      const responses = [];
      for (const [url, entry] of entries) responses.push([url, await fetchVerified(url, entry)]);
      const existed = (await caches.keys()).includes(cacheName);
      try {
        const cache = await caches.open(cacheName);
        for (const [url, response] of responses) await cache.put(url, response);
      } catch (error) {
        // Do not delete an identical release already used by an active worker.
        if (!existed) await caches.delete(cacheName);
        throw error;
      }
    })());
  });
  self.addEventListener('activate', event => {
    event.waitUntil((async () => {
      for (const key of await caches.keys()) if (key.startsWith(prefix) && key !== cacheName) await caches.delete(key);
    })());
  });
  self.addEventListener('fetch', event => {
    const request = event.request;
    if (request.method !== 'GET' || request.headers.has('authorization') || request.headers.has('range')) return;
    const url = new URL(request.url);
    if (url.origin !== scope.origin) return;
    let key = url.href;
    // Only the actual entry page (including launch parameters) has a shell
    // fallback. A missing /api route must never receive the application HTML.
    if (request.mode === 'navigate' && (url.pathname === scope.pathname || url.pathname === new URL('index.html', scope).pathname)) key = new URL('index.html', scope).href;
    if (!entries.has(key)) return;
    event.respondWith((async () => {
      let cache;
      try {
        cache = await caches.open(cacheName);
        const response = await cache.match(key);
        if (response) return response;
      } catch { /* Private/storage-restricted contexts may still use verified network bytes. */ }
      // Recover evicted entries only when the server still has these exact
      // release bytes. Never mix a new release into an existing client's cache.
      try {
        const restored = await fetchVerified(key, entries.get(key));
        try { await cache?.put(key, restored.clone()); } catch { /* Storage may be full; verified network bytes remain usable. */ }
        return restored;
      } catch {
        // Ask the platform to discover an update without force-activating it.
        event.waitUntil(Promise.resolve().then(() => self.registration.update()).catch(() => {}));
        return new Response('Offline release unavailable. Reconnect, close all application tabs, then reopen to update.', {status: 503, headers: {'Content-Type': 'text/plain; charset=utf-8'}});
      }
    })());
  });
}

export function registerOfflineApplication() {
  if (globalThis.vb6OfflineReady) return globalThis.vb6OfflineReady;
  const base = new URL('./', document.currentScript.src);
  const status = {phase: 'registering', updateAvailable: false, error: null};
  globalThis.vb6OfflineStatus = status;
  const emit = () => globalThis.dispatchEvent(new CustomEvent('vb6:offline', {detail: {...status}}));
  const promise = Promise.resolve().then(async () => {
    if (!/^https?:$/.test(base.protocol) || !globalThis.isSecureContext || !navigator.serviceWorker) {
      status.phase = 'unavailable';
      emit();
      return null;
    }
    if (typeof globalThis.vb6ApplicationReady?.then !== 'function') throw new Error('Application startup promise is unavailable.');
    await globalThis.vb6ApplicationReady;
    if (globalThis.vb6ApplicationStatus?.phase === 'disposed') {status.phase = 'disposed'; emit(); return null;}
    const registration = await navigator.serviceWorker.register(new URL('service-worker.js', base).href, {scope: base.href, updateViaCache: 'none'});
    const watch = worker => {
      if (!worker) return;
      const changed = () => {
        status.updateAvailable = Boolean(registration.waiting);
        if (status.updateAvailable) emit();
        if (['installed', 'activated', 'redundant'].includes(worker.state)) worker.removeEventListener('statechange', changed);
      };
      worker.addEventListener('statechange', changed);
      changed();
    };
    registration.addEventListener('updatefound', () => watch(registration.installing));
    const worker = registration.installing || registration.waiting || registration.active;
    if (!worker) throw new Error('Offline worker was not created.');
    watch(worker);
    if (!['installed', 'activated'].includes(worker.state)) await new Promise((resolve, reject) => {
      const changed = () => {
        if (worker.state === 'redundant') { worker.removeEventListener('statechange', changed); reject(new Error('Offline installation failed; verify the deployed release files.')); }
        else if (['installed', 'activated'].includes(worker.state)) { worker.removeEventListener('statechange', changed); resolve(); }
      };
      worker.addEventListener('statechange', changed);
      changed();
    });
    status.phase = 'ready';
    status.updateAvailable = Boolean(registration.waiting);
    emit();
    return registration;
  });
  globalThis.vb6OfflineReady = promise;
  promise.catch(error => { status.phase = 'error'; status.error = String(error?.message || error); emit(); });
  return promise;
}

export const OFFLINE_REGISTRATION = '(' + registerOfflineApplication.toString() + ')();';
export const DEFAULT_APPLICATION_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" rx="64" fill="#24364b"/><path d="M96 136h320v240H96z" fill="#c0c0c0"/><path d="M112 152h288v40H112z" fill="#000080"/><path d="m152 240 48 72 48-72m32 0h64v72h-64z" fill="none" stroke="#24364b" stroke-width="20"/></svg>\n';
