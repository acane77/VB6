import {UIError} from './safety.js';

/** A bounded lifetime for trusted host actions. Model data cannot extend it. */
export class UIActionScope {
  constructor({limit=32}={}) {
    if(!Number.isInteger(limit)||limit<1||limit>128)throw new UIError('limits','Invalid action scope limit.');
    this.limit=limit;this.pending=new Set();this.disposed=false;
  }
  acquire(signal) {
    if(this.disposed)throw new UIError('disposed','UI action scope is disposed.');
    signal?.throwIfAborted();
    if(this.pending.size>=this.limit)throw new UIError('action_limit','Too many pending UI actions.');
    const controller=new AbortController();let released=false;
    const release=()=>{if(released)return;released=true;this.pending.delete(entry);signal?.removeEventListener('abort',abort);};
    const abort=()=>{controller.abort(signal.reason);release();};
    const entry={signal:controller.signal,release,cancel:reason=>{controller.abort(reason);release();}};
    this.pending.add(entry);signal?.addEventListener('abort',abort,{once:true});
    // Account for host-supplied signals that were aborted during listener registration.
    if(signal?.aborted)abort();
    return entry;
  }
  invalidate(reason=new UIError('stale_action','The UI changed while this action was pending.')) {
    for(const entry of [...this.pending])entry.cancel(reason);
  }
  dispose() {
    if(this.disposed)return;this.disposed=true;
    this.invalidate(new UIError('disposed','The UI was closed while this action was pending.'));
  }
}
