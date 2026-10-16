import {Signal} from './signal.js';

const entryBytes = entry => entry.bytes ?? (entry.before.length + entry.after.length) * 2;
const byteSum = entries => entries.reduce((sum, entry) => sum + entryBytes(entry), 0);
function snapshot(value) {
  const text = JSON.stringify(value);
  if (text === undefined) throw new TypeError('History snapshots must be JSON serializable.');
  return text;
}
function bounds(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(name + ' must be a nonnegative safe integer.');
  return value;
}

/** JSON project snapshots, source values and sparse patches in one undo timeline.
 * Replay is synchronous and operates on a private clone. A failed callback leaves
 * both the caller's model and the stacks intact. Apply callbacks must not produce
 * external side effects. Public stack assignment remains supported for VBG tabs;
 * use capture()/restore() to preserve savepoints as well as the entries.
 */
export class History extends Signal {
  #undo = [];
  #redo = [];
  #groups = [];
  #replaying = false;
  #boundary = true;
  #revision = 0;
  #sequence = 0;
  #clean = 0;
  #limit;
  #maxBytes;

  constructor(limit = 120, maxBytes = 32 * 1024 * 1024) {
    super();
    const options = typeof limit === 'object' && limit !== null ? limit : {limit, maxBytes};
    this.#limit = bounds(options.limit ?? 120, 'limit');
    this.#maxBytes = bounds(options.maxBytes ?? 32 * 1024 * 1024, 'maxBytes');
    // Preserve the original single-oversized-edit behavior unless strict bounds
    // are requested. Zero in either budget always disables retention.
    this.retainNewest = options.retainNewest !== false;
  }

  get limit() { return this.#limit; }
  set limit(value) { this.#assertIdle(); this.#limit = bounds(value, 'limit'); if (this.trim()) this.#changed(); }
  get maxBytes() { return this.#maxBytes; }
  set maxBytes(value) { this.#assertIdle(); this.#maxBytes = bounds(value, 'maxBytes'); if (this.trim()) this.#changed(); }
  get undoStack() { return this.#undo; }
  set undoStack(value) { this.#setStack('undo', value); }
  get redoStack() { return this.#redo; }
  set redoStack(value) { this.#setStack('redo', value); }
  get undoBytes() { return byteSum(this.#undo); }
  get redoBytes() { return byteSum(this.#redo); }
  get bytes() { return this.undoBytes + this.redoBytes; }
  get pendingBytes() { return this.#groups.reduce((sum, group) => sum + byteSum(group.entries), 0); }
  get canUndo() { return !this.#groups.length && !!this.#undo.length; }
  get canRedo() { return !this.#groups.length && !!this.#redo.length; }
  get undoLabel() { return this.#undo.at(-1)?.label ?? ''; }
  get redoLabel() { return this.#redo.at(-1)?.label ?? ''; }
  get transactionDepth() { return this.#groups.length; }
  get isDirty() { return this.#revision !== this.#clean || this.pendingBytes > 0; }
  get overBudget() { return this.bytes > this.maxBytes || this.#undo.length + this.#redo.length > this.limit; }

  #assertIdle(noGroup = false) {
    if (this.#replaying) throw new Error('Cannot change history during replay.');
    if (noGroup && this.#groups.length) throw new Error('Finish the history transaction first.');
  }
  #setStack(which, value) {
    this.#assertIdle(true);
    if (!Array.isArray(value)) throw new TypeError('A history stack must be an array.');
    // Assignments intentionally do not trim: VBG restores undo and redo in two
    // consecutive assignments. The next record/trim applies the current budget.
    if (which === 'undo') this.#undo = value; else this.#redo = value;
    this.#revision = this.#undo.at(-1)?.afterRevision ?? this.#redo.at(-1)?.beforeRevision ?? ++this.#sequence;
    this.#sequence = value.reduce((sequence, entry) => Math.max(sequence, entry.afterRevision ?? 0), Math.max(this.#sequence, this.#revision));
    this.#clean = null;
    this.#boundary = true;
  }
  #changed() { this.emit('change'); }
  stopMerging() { this.#assertIdle(); this.#boundary = true; }

  trim() {
    this.#assertIdle();
    let bytes = this.bytes, undo = 0, redo = 0;
    const total = this.#undo.length + this.#redo.length;
    const minimum = this.retainNewest && this.limit > 0 && this.maxBytes > 0 ? 1 : 0;
    while (total - undo - redo > minimum && (total - undo - redo > this.limit || bytes > this.maxBytes)) {
      // Drop the oldest past, then the farthest future; retain a contiguous
      // replay path around the current cursor, including when all edits are undone.
      if (undo < this.#undo.length) bytes -= entryBytes(this.#undo[undo++]);
      else bytes -= entryBytes(this.#redo[redo++]);
    }
    if (undo) this.#undo.splice(0, undo);
    if (redo) this.#redo.splice(0, redo);
    return undo + redo;
  }

  #append(entry, merge) {
    const target = this.#groups.at(-1)?.entries ?? this.#undo;
    const last = target.at(-1);
    const coalesce = merge && !this.#boundary && !this.#redo.length && last?.kind === entry.kind &&
      last.key === entry.key && last.label === entry.label && last.apply === entry.apply;
    if (coalesce && entry.kind === 'value' && last.after === entry.before) {
      entry = {...last, after: entry.after, bytes: (last.before.length + entry.after.length) * 2};
      target.pop();
      // Typing and then erasing back to the initial text should not leave an
      // empty undo step. Its beforeRevision remains the current savepoint.
      if (entry.before === entry.after) {
        if (!this.#groups.length) this.#revision = entry.beforeRevision;
        this.#boundary = true;
        if (!this.#groups.length) this.#changed();
        return true;
      }
    } else if (coalesce && entry.kind === 'patch' && last.patches.length < 256) {
      entry = {...last, patches: [...last.patches, ...entry.patches], bytes: last.bytes + entry.bytes};
      target.pop();
    }
    this.#boundary = false;
    if (this.#groups.length) { target.push(entry); return true; }
    entry.beforeRevision ??= this.#revision;
    entry.afterRevision = ++this.#sequence;
    this.#revision = entry.afterRevision;
    target.push(entry);
    this.#redo = [];
    this.trim();
    this.#changed();
    return true;
  }

  record(before, after, label = 'Edit') {
    this.#assertIdle();
    const a = snapshot(before), b = snapshot(after);
    if (a === b) return false;
    return this.#append({before: a, after: b, label, bytes: (a.length + b.length) * 2}, false);
  }

  recordValue(key, before, after, apply, label = 'Edit', merge = false) {
    this.#assertIdle();
    if (typeof before !== 'string' || typeof after !== 'string') throw new TypeError('History values must be source strings.');
    if (typeof apply !== 'function') throw new TypeError('History apply must be a function.');
    if (before === after) return false;
    return this.#append({kind: 'value', key, before, after, apply, label, bytes: (before.length + after.length) * 2}, merge);
  }

  recordPatch(key, patch, apply, label = 'Edit', merge = false) {
    this.#assertIdle();
    if (!patch || typeof patch.before !== 'string' || typeof patch.after !== 'string') throw new TypeError('A history patch needs before/after strings.');
    if (patch.start !== undefined) bounds(patch.start, 'patch.start');
    if (typeof apply !== 'function') throw new TypeError('History apply must be a function.');
    if (patch.before === patch.after) return false;
    const item = structuredClone(patch), bytes = snapshot(item).length * 2;
    return this.#append({kind: 'patch', key, patches: [item], bytes, apply, label, before: '', after: ''}, merge);
  }

  #apply(entry, current, undo) {
    let result;
    if (entry.kind === 'group') {
      result = current;
      for (const child of undo ? [...entry.entries].reverse() : entry.entries) result = this.#apply(child, result, undo);
    } else if (entry.kind === 'patch') result = entry.apply(current, structuredClone(entry.patches), undo);
    else if (entry.kind === 'value') result = entry.apply(current, undo ? entry.before : entry.after);
    else result = JSON.parse(undo ? entry.before : entry.after);
    if (result && typeof result.then === 'function') {
      Promise.resolve(result).catch(() => {});
      throw new TypeError('History replay must be synchronous.');
    }
    if (result === undefined) throw new TypeError('History replay must return the updated model.');
    return result;
  }
  #replay(entry, current, undo) {
    this.#replaying = true;
    try { return this.#apply(entry, structuredClone(current), undo); }
    finally { this.#replaying = false; }
  }
  undo(current) {
    this.#assertIdle(true);
    const entry = this.#undo.at(-1);
    if (!entry) return null;
    const value = this.#replay(entry, current, true);
    this.#undo.pop(); this.#redo.push(entry);
    this.#revision = entry.beforeRevision; this.#boundary = true;
    this.#changed();
    return value;
  }
  redo(current) {
    this.#assertIdle(true);
    const entry = this.#redo.at(-1);
    if (!entry) return null;
    const value = this.#replay(entry, current, false);
    this.#redo.pop(); this.#undo.push(entry);
    this.#revision = entry.afterRevision; this.#boundary = true;
    this.#changed();
    return value;
  }

  beginTransaction(label = 'Edit') {
    this.#assertIdle();
    this.#groups.push({kind: 'group', label, entries: []});
    this.#boundary = true;
    return this.#groups.length;
  }
  commitTransaction() {
    this.#assertIdle();
    const group = this.#groups.pop();
    if (!group) throw new Error('There is no history transaction.');
    this.#boundary = true;
    if (!group.entries.length) return false;
    group.bytes = byteSum(group.entries);
    this.#append(group, false);
    this.#boundary = true;
    return true;
  }
  cancelTransaction(current) {
    this.#assertIdle();
    const group = this.#groups.at(-1);
    if (!group) throw new Error('There is no history transaction.');
    const result = this.#replay(group, current, true);
    this.#groups.pop(); this.#boundary = true;
    return result;
  }
  markClean() {
    this.#assertIdle(true);
    this.#clean = this.#revision; this.#boundary = true; this.#changed();
  }
  capture() {
    this.#assertIdle(true);
    return {undo: this.#undo.slice(), redo: this.#redo.slice(), revision: this.#revision, clean: this.#clean, sequence: this.#sequence};
  }
  restore(state) {
    this.#assertIdle(true);
    if (!state || !Array.isArray(state.undo) || !Array.isArray(state.redo) || !Number.isSafeInteger(state.revision) || !Number.isSafeInteger(state.sequence))
      throw new TypeError('Invalid history session.');
    this.#undo = state.undo.slice(); this.#redo = state.redo.slice();
    this.#revision = state.revision; this.#clean = state.clean;
    this.#sequence = Math.max(this.#sequence, state.sequence); this.#boundary = true;
    this.trim(); this.#changed();
  }
  reset() {
    this.#assertIdle(true);
    this.#undo = []; this.#redo = [];
    this.#revision = ++this.#sequence; this.#clean = this.#revision;
    this.#boundary = true; this.#changed();
  }
}
