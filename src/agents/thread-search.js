const scopes = new Set(['all', 'messages', 'tools', 'status']);
const messages = new Set(['user', 'assistant', 'question', 'plan']);
/** Literal search of the bounded PUBLIC thread. No native history or provider access. */
export class AgentThreadSearch {
  constructor() { this.clear(); }
  clear() {
    this.thread = null; this.query = ''; this.scope = 'all'; this.generation = 0;
    this.version = -1; this.cache = new Map(); this.ids = []; this.currentId = ''; this.scans = 0;
  }
  configure(query = '', scope = 'all') {
    if (typeof query !== 'string' || query.length > 256 || !scopes.has(scope)) throw new Error('Invalid conversation search. Use up to 256 literal characters.');
    if (this.query === query && this.scope === scope) return false;
    this.query = query; this.scope = scope; this.generation++; this.version = -1; this.currentId = ''; return true;
  }
  update(thread) {
    if (this.thread !== thread) {
      this.thread = thread; this.version = -1; this.cache.clear(); this.ids = []; this.currentId = '';
    }
    if (!thread || this.version === thread.revision) return this.ids;
    this.version = thread.revision;
    if (!this.query) { this.cache.clear(); this.ids = []; this.currentId = ''; return this.ids; }
    const needle = this.query.toLowerCase(), existing = new Set(), ids = [];
    for (const item of thread.entries) {
      existing.add(item.id);
      let cached = this.cache.get(item.id);
      if (!cached || cached.item !== item || cached.revision !== item.revision || cached.generation !== this.generation) {
        const included = this.scope === 'all' || this.scope === 'messages' && messages.has(item.kind)
          || this.scope === 'tools' && item.kind === 'tool' || this.scope === 'status' && item.kind === 'notice';
        let matched = false;
        if (included) {
          this.scans++;
          // Test fields separately so a match cannot cross an artificial field boundary.
          matched = ['text', 'note', 'arguments', 'result', 'label', 'status'].some(key => typeof item[key] === 'string' && item[key].toLowerCase().includes(needle));
        }
        cached = {item, revision: item.revision, generation: this.generation, matched};
        this.cache.set(item.id, cached);
      }
      if (cached.matched) ids.push(item.id);
    }
    for (const id of this.cache.keys()) if (!existing.has(id)) this.cache.delete(id);
    this.ids = ids;
    if (!ids.includes(this.currentId)) this.currentId = ids[0] || '';
    return ids;
  }
  move(direction) {
    if (direction !== 1 && direction !== -1) throw new Error('Invalid search direction.');
    if (!this.ids.length) return '';
    const index = this.ids.indexOf(this.currentId);
    this.currentId = this.ids[(Math.max(0, index) + direction + this.ids.length) % this.ids.length];
    return this.currentId;
  }
  get position() { return this.currentId ? this.ids.indexOf(this.currentId) + 1 : 0; }
}
