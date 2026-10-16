# Shared core primitives

The IDE and exported runtimes share the dependency-free ES modules in `src/core`.
The existing `core.js` named exports remain the compatibility entry point. Individual
modules can also be imported without pulling in unrelated UI helpers. Importing the
modules in Node or a worker does not require a DOM.

This document defines the supported contracts of these helpers. It is not a claim
that the rest of the VB6 language, compiler, COM, runtime or platform surface is
complete.

## Notifications and ownership

```js
import {Signal} from '../src/core/signal.js';

const events = new Signal();
const lifetime = new AbortController();
const off = events.on('change', value => render(value), {signal: lifetime.signal});
events.once('ready', value => initialize(value));
const next = events.waitFor('change', {
  signal: lifetime.signal,
  timeout: 5000,
  predicate: value => value.ready
});
events.emit('change', {ready: true});
await next;
off();                    // Idempotent; returns whether a registration was removed.
lifetime.abort();         // Releases every registration owned by this signal.
```

`on(type, callback, {once, signal})` deduplicates the same callback for a type.
The first registration owns its options and abort signal; registering it again
returns the same disposer, rather than creating another subscription. `off`,
`listenerCount`, `eventNames`, `clear(type)` and `clear()` expose explicit lifecycle
operations. Event keys may be arbitrary Map keys, including symbols and undefined.
Use these methods instead of mutating the internal `listeners` map.

Delivery is synchronous, insertion ordered, and snapshots registrations. Additions
wait until the next emission; removals take effect immediately. Once listeners are
removed before invocation, including a nested emission. A removed listener's old
disposer cannot delete a newer registration. Listener exceptions propagate and stop
that emission, preserving the original fail-fast behavior. Callbacks receive all
arguments passed to `emit` without an implicit receiver.

`waitFor` resolves the first argument accepted by a synchronous predicate. It
rejects with the original abort reason, a `TimeoutError`, or the predicate error.
Clearing its event cancels the wait with `AbortError`. Every terminal path releases
its timer, subscription and abort listener. Async predicates are not supported.
A wait with no timeout remains pending until an event, abort or clear; its owner
must explicitly manage that lifetime.

## Undo, redo and transactions

```js
import {History} from '../src/core/history.js';

const history = new History({limit: 120, maxBytes: 32 * 1024 * 1024});
const applyText = (model, text) => ({...model, text});
let model = {text: 'one'};
history.markClean();
history.recordValue('module-1', model.text, 'two', applyText, 'Typing', true);
model = {...model, text: 'two'};
model = history.undo(model); // text === 'one'; history.isDirty === false
model = history.redo(model);

history.beginTransaction('Rename and update references');
// Perform each edit and record its snapshot, value or sparse patch here.
history.commitTransaction(); // One outer undo step, one change notification.
// Alternatively: model = history.cancelTransaction(model);
```

The positional `new History(limit, maxBytes)` constructor remains supported.
`record(before, after, label)` stores JSON snapshots. `recordValue(key, before,
after, apply, label, merge)` stores source strings. `recordPatch(key, patch, apply,
label, merge)` stores cloned sparse patches with string `before` and `after`
fields; a supplied `start` must be a nonnegative safe integer. Patch offsets and
model-specific applicability are the callback's responsibility.

Replay callbacks must synchronously return the updated model. History clones the
current model and patch lists before calling them. A thrown error, undefined return,
asynchronous result or reentrant history mutation leaves the original model and
stacks unchanged. External side effects from a callback cannot be rolled back: do
not mutate outside objects, DOM, files or services inside a replay callback.

Coalescing requires the same kind, key, label and callback identity. Value edits
must also be contiguous (`last.after === next.before`). Reuse one callback per
editor; the IDE text editor does this explicitly. Patch groups are capped at 256
patches. Undo, redo, transactions, clean markers, `stopMerging()` and session
restoration establish boundaries. A new branch after undo discards redo, rather
than merging into a previous branch. A merged value edit that returns to its
starting text leaves no empty undo step.

Nested transactions replay in forward order on redo and reverse order on undo.
Only the outer commit enters the timeline. Empty commits do nothing. Cancel returns
a restored private model and preserves pre-transaction redo. A failed cancellation
leaves the transaction open. Finish all groups before undo, redo, reset, session
capture/restore or marking clean.

`canUndo`, `canRedo`, `undoLabel`, `redoLabel`, `transactionDepth`, `undoBytes`,
`redoBytes`, `bytes`, `pendingBytes`, `overBudget` and `isDirty` expose state.
`markClean()` identifies a revision, so undo/redo can return to a saved state.
The IDE's existing project persistence/dirty indicator remains separate; a
successful file write does not automatically call this helper.

Budgets cover the combined undo and redo path, not just the undo stack. Trimming
drops the oldest past, then the farthest future, preserving contiguous replay.
Sizes estimate retained UTF-16 snapshot/source text and serialized patch payload;
they do not measure JS object overhead or closed-over callback memory. By default,
the closest retained edit may exceed the byte budget, preserving the original
single-oversized-edit behavior; `overBudget` reports this. Use
`{retainNewest: false}` for strict eviction. Zero in either budget disables
retention. Open transactions are not partially evicted; inspect `pendingBytes` and
bound the work recorded before committing or cancelling.

`capture()` / `restore(session)` preserve both stacks, revisions and savepoints
across IDE project tabs. Sessions are opaque, read-only, in-memory objects that
retain callback functions, not JSON persistence or an untrusted import format.
Entries are copy-on-write during coalescing so captured sessions are not rewritten.
Legacy `undoStack`/`redoStack` assignment remains accepted but establishes a merge
boundary and invalidates the clean marker; use capture/restore for new code. Do not
mutate entries or stack arrays in place. The VBG project controller now uses this
session API.

## Debounced work

```js
import {debounce} from '../src/core/debounce.js';
const lifetime = new AbortController();
const save = debounce(function (value) { return this.write(value); }, 200, {
  maxWait: 1000,
  signal: lifetime.signal
});
save.call(storage, currentValue);
save.flush();
save.cancel();
save.dispose();
```

The default remains trailing-only execution after 200 ms. The latest arguments and
receiver are preserved. `leading` invokes immediately at the start of a burst;
a single leading-plus-trailing call does not invoke twice. `maxWait` supplies a
deadline clamped to at least the normal delay, and invokes pending work even in a
continuous burst (also when trailing is disabled). Reentrant calls retain their
new timer and arguments. `pending()` reports an active debounce window, including
a leading-only cooldown. `flush()` ends that window and invokes pending trailing
work once; its result is the most recent callback result. `cancel()` is reusable.
`dispose()` or abort permanently disables new calls and removes abort ownership.
Delays must be finite and between zero and 2,147,483,647 ms. Exceptions are not
swallowed, and async callback results are returned without being awaited.

## UI documents, elements and downloads

`registerUIDocument(document, {signal})` returns an idempotent disposer. Repeated
registrations share a single listener set with reference-counted owners. Closing
or navigating a popup releases its registrations. A persisted `pagehide` preserves
BFCache ownership, and `pageshow` can reactivate it. Cross-origin navigation does
not retain a dead document merely because removing a window listener is denied.

`uiDocuments()` returns live, unique registered documents plus the ambient main
document. `uiDocument(node)` accepts a Document, Window, node or ShadowRoot and
honors a live explicit owner before focus/remembered/main-document fallbacks.
Without any DOM it returns null instead of throwing a ReferenceError.
`hasUIDialog()` inspects modal covers across all live session documents.
Neither in-page MDI nor detached windows require a global DOM monkey patch.

`el(tag, attrs, ...children)` uses `attrs.document` or the active UI document. Strings
are always literal text, not HTML. Nested child arrays are flattened; null and
booleans are omitted, while numeric zero is retained. Supported conveniences:

- `namespace` for SVG/MathML, `class`, `text`, `htmlFor`, and `indeterminate`.
- Style objects including custom/hyphenated properties, and `dataset` objects.
- `onclick: callback` or `onclick: [callback, {once, capture, signal}]`; event tuples
  also accept a native listener object with `handleEvent`.
- `ref: node => ...`, invoked after attributes and children are initialized.
- Literal ARIA and enumerated boolean attributes, and form values initialized after
  option children. Existing textarea source-as-child calls retain their behavior.

`el` is a trusted DOM-construction helper, not an HTML sanitizer or URL policy.
Do not pass untrusted tag names, attribute names, styles, URL values or event-handler
strings as configuration. Use text children for untrusted text and a domain-specific
allowlist for any untrusted URL or attributes.

`download(name, data, type, {document, signal, revokeAfter})` activates a real download
and returns an idempotent object-URL cleanup function. It supports foreign-window
Blob/File values without losing MIME type, temporarily attaches the anchor, removes
it after activation, and cleans resources on errors, abort, nonpersisted pagehide
or expiry. The default expiry is 3000 ms. Cleanup cancels resource ownership, not an
already accepted browser download. Browser user-activation/download policies still
apply. `safeName` produces a single ASCII filename component, trims unsafe dots and
spaces, limits length and prefixes reserved Windows device names; it does not grant
filesystem permissions or supply a full path policy.

## Artifact integrity

```js
import {Sha256, sha256, sha256Hex, sha256Stream, sha256Blob} from '../src/core/sha256.js';
const bytes = new TextEncoder().encode('abc');
const nativeOrPortable = await sha256Hex(bytes);
const portable = await sha256(bytes, null);
const prefix = new Sha256().update(bytes);
const digest = prefix.clone().update(new Uint8Array([0])).digest();
const streamed = await sha256Stream(chunks, {
  signal: lifetime.signal,
  onProgress: bytesHashed => report(bytesHashed),
  yieldEvery: 4 * 1024 * 1024
});
const blobDigest = await sha256Blob(blob);
```

One-shot `sha256(data, subtle = globalThis.crypto?.subtle)` preserves the existing
async API. Null requests the portable path. Native-provider rejections propagate;
they are not silently converted into a fallback success. ArrayBuffers and all
ArrayBuffer views are accepted across realms; view offsets and byte lengths are
honored, not numeric element values. Detached buffers, spoofed buffers, strings and
shared memory are rejected. Encode strings and copy SharedArrayBuffer data explicitly.

`Sha256` consumes updates synchronously and retains only fixed-size compression
state/tail storage, rather than a padded copy of the complete input. `digest()` or
`hex()` finalizes once and subsequent calls return independent results; update after
finalization throws. `clone()` forks an unfinished prefix or finalized result.
`bytesHashed` is an exact BigInt. Input length must remain below 2^64 bits.

`sha256Stream` accepts a ReadableStream, synchronous iterable or async iterable of
byte chunks. It never buffers the complete source or retains an abort-promise
reaction for every processed chunk; cancellation owns only the current read.
It yields after the byte budget
or 128 chunks, keeping timer-driven abort responsive even with empty chunks. Abort
interrupts a pending read/next; failure cancels/closes the source and releases reader
ownership without awaiting a permanently stuck producer. It cannot force arbitrary
producer code to stop side effects. Progress callbacks receive a BigInt and must be
synchronous. Callers must not mutate a yielded chunk until hashing has consumed it.
These APIs provide unkeyed artifact integrity, not authentication, signing, HMAC or
cryptographic-module certification.

## Validation commands

```sh
npm run test:core
npm run build
npm run verify:ide-artifacts
npm test
python tools/ci/check.py
python -m unittest discover -s tools/ci -p 'test_*.py'
python tools/browser-core-primitives.py
VB6_BROWSER=firefox python tools/browser-core-primitives.py
VB6_BROWSER=webkit python tools/browser-core-primitives.py
```

The browser suite imports the real production modules through the repository
bundler and exercises actual DOM, popup focus/lifecycle, downloads, cross-realm
buffers, secure-origin WebCrypto, streaming cancellation and history. It is included
in the existing three-engine `integration-controls` CI group. Every uncaught page
error fails the suite. Explicit `VB6_TEST_TRANSPORT=memory` is available for offline
development, but skips the secure-origin assertion and is not HTTP validation.

Deterministic bundle fingerprints remain enforced by normal builds. After an
intentional source change, maintainers may author fingerprints locally with
`npm run build:update-ide-artifacts`, review the resulting manifest, then run the
strict ordinary build. CI is not permitted to rewrite its own expected manifest.
