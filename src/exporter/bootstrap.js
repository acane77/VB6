/** This function is emitted as ordinary JavaScript, not eval/Function or a module
 * fetch. Keep it self-contained so inline, file:// and CSP deployments share it.
 */
export function startExportedApplication() {
  if (globalThis.vb6ApplicationReady) return globalThis.vb6ApplicationReady;
  const status = {phase: 'loading', error: null};
  globalThis.vb6ApplicationStatus = status;
  const banner = document.getElementById('vb6-startup');
  const emit = (name, detail) => globalThis.dispatchEvent(new CustomEvent(name, {detail}));
  let options, startupError, host, departed = false, closed = false, rejectDeparture;
  const abort = new AbortController();
  const departure = new Promise((resolve, reject) => { rejectDeparture = reject; });
  const cancelled = () => Object.assign(new Error('Application startup was cancelled because the page was closed.'), {name: 'AbortError', code: 'EXPORT_STARTUP_CANCELLED'});
  const ensureActive = () => { if (departed) throw cancelled(); };
  const reportLifecycleError = error => emit('vb6:lifecycle-error', {message: String(error?.message || error)});
  function saveHost() {
    if (host && !closed && !host.disposed) {
      try { host.persist?.(); } catch (error) { reportLifecycleError(error); }
    }
  }
  function closeHost() {
    if (!host || closed) return;
    closed = true;
    if (!host.disposed) {
      try { host.dispose?.(); } catch (error) { reportLifecycleError(error); }
    }
  }
  // Own the lifetime before any async adapter or mount starts. Late hosts from
  // an outgoing document are disposed too; failed hosts remain inspectable.
  globalThis.addEventListener('pagehide', event => {
    if (departed) return;
    saveHost();
    if (!event.persisted) {
      departed = true;
      abort.abort();
      closeHost();
      if (status.phase === 'loading') rejectDeparture(cancelled());
      else status.phase = 'disposed';
    }
  });
  function fail(error) {
    status.phase = departed ? 'disposed' : 'error';
    status.error = {message: String(error?.message || error || 'Application startup failed'), number: error?.number, source: error?.source, line: error?.line};
    if (banner && !departed) {
      banner.hidden = false;
      banner.setAttribute('role', 'alert');
      banner.textContent = 'Application could not start.\n' + status.error.message;
    }
    // Preserve the existing token/source-checked IDE protocol for failures that
    // happen before ApplicationHost can establish its own message callbacks.
    if (options?.bridgeToken && globalThis.parent !== globalThis) globalThis.parent.postMessage({channel: 'vb6-runtime', token: options.bridgeToken, type: 'error', error: status.error}, '*');
    emit(departed ? 'vb6:cancelled' : 'vb6:error', status.error);
  }
  const startup = Promise.resolve().then(async () => {
    ensureActive();
    const project = JSON.parse(document.getElementById('vb6-project').textContent);
    options = JSON.parse(document.getElementById('vb6-options').textContent);
    if (typeof globalThis.VB6Runtime?.mountApplication !== 'function') throw new Error('The application runtime could not be loaded. Check that all deployment files are present.');
    // Trusted deployment scripts can install actual callbacks, data/automation
    // providers and control registries here instead of losing them in JSON.
    if (globalThis.vb6ConfigureApplication !== undefined) {
      if (typeof globalThis.vb6ConfigureApplication !== 'function') throw new Error('vb6ConfigureApplication must be a function');
      const overrides = await globalThis.vb6ConfigureApplication({project, options, runtime: globalThis.VB6Runtime, signal: abort.signal});
      ensureActive();
      if (overrides !== undefined) {
        if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) throw new Error('vb6ConfigureApplication must return runtime options or undefined');
        options = {...options, ...overrides};
      }
    }
    const onMessage = options.onMessage;
    if (onMessage !== undefined && typeof onMessage !== 'function') throw new Error('Runtime onMessage must be a function');
    options.onMessage = message => {
      if (message.type === 'error') startupError = message.error;
      if (banner && ['ready', 'pause', 'interaction'].includes(message.type)) banner.hidden = true;
      emit('vb6:message', message);
      onMessage?.(message);
    };
    ensureActive();
    host = await VB6Runtime.mountApplication(project, document.getElementById('app'), options);
    if (!host || typeof host !== 'object') throw new Error('The application runtime did not return a host.');
    globalThis.vb6Application = host;
    if (departed) { closeHost(); throw cancelled(); }
    // ApplicationHost reports VB errors through messages and may resolve with a
    // failed VM. Keep the host inspectable, but never signal a successful launch.
    if (host.vm?.state === 'error') throw Object.assign(new Error(startupError?.message || 'Visual Basic startup failed'), startupError);
    status.phase = 'ready';
    if (banner) banner.hidden = true;
    emit('vb6:ready', {host});
    return host;
  });
  const ready = Promise.race([startup, departure]);
  globalThis.vb6ApplicationReady = ready;
  // Attach a handler without replacing the public promise: callers can still
  // await its rejection, and an unattended standalone has no unhandled rejection.
  ready.catch(fail);
  return ready;
}

export const APPLICATION_BOOTSTRAP = '(' + startExportedApplication.toString() + ')();';
