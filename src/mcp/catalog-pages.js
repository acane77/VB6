import {McpError, MCP_LIMIT, randomToken, utf8Length} from './protocol.js';

/** Immutable, short-lived catalog snapshots. Cursors never confer caller authority. */
export class McpCatalogPages {
  constructor({now = () => Date.now(), ttlMs = 60000, limit = 64, perPrincipal = 8,
    maxBytes = MCP_LIMIT * 2, pageSize = 100, pageBytes = MCP_LIMIT - 65536} = {}) {
    for (const [name, value] of Object.entries({ttlMs, limit, perPrincipal, maxBytes, pageSize, pageBytes}))
      if (!Number.isSafeInteger(value) || value < 1) throw new TypeError('Invalid catalog limit: ' + name);
    this.now = now; this.ttlMs = ttlMs; this.limit = limit; this.perPrincipal = perPrincipal;
    this.maxBytes = maxBytes; this.pageSize = pageSize; this.pageBytes = pageBytes;
    this.entries = new Map(); this.bytes = 0;
  }
  remove(id) {
    const entry = this.entries.get(id);
    if (entry) { this.bytes -= entry.bytes; this.entries.delete(id); clearTimeout(entry.timer); }
  }
  purge() { for (const [id, entry] of this.entries) if (this.now() >= entry.expiresAt) this.remove(id); }
  clear(principal) { for (const [id, entry] of this.entries) if (principal === undefined || entry.principal === principal) this.remove(id); }
  inspect() { this.purge(); return {snapshots: this.entries.size, bytes: this.bytes, ttlMs: this.ttlMs, limit: this.limit}; }
  identity(context) {
    const identity = context.principal || context.sessionKey;
    if (typeof identity !== 'string' || !identity || identity.length > 512) throw new McpError(-32602, 'A transport identity is required for catalog paging.');
    return identity;
  }
  read(cursor, kind, context, authority) {
    this.purge();
    const match = typeof cursor === 'string' && /^mcp-page:([a-f0-9]{48}):([1-9][0-9]*)$/.exec(cursor);
    const entry = match && this.entries.get(match[1]), offset = match && Number(match[2]);
    if (!entry || entry.kind !== kind || entry.principal !== this.identity(context) || entry.authority !== authority ||
      authority?.aborted || !Number.isSafeInteger(offset) || !entry.offsets.has(offset))
      throw new McpError(-32602, 'Catalog cursor is invalid, expired or belongs to another caller; restart the list.');
    return this.page(entry, offset);
  }
  create(items, kind, context, authority) {
    this.purge();
    const principal = this.identity(context);
    if (authority?.aborted) throw new McpError(-32800, 'Catalog authority was revoked.');
    const serialized = [], lengths = []; let bytes = 0;
    for (const item of items) {
      const text = JSON.stringify(item), length = typeof text === 'string' ? utf8Length(text) + 1 : Infinity;
      if (length > this.pageBytes) throw new McpError(-32603, 'A catalog entry exceeds the MCP page byte limit.');
      bytes += length;
      if (bytes > this.maxBytes) throw new McpError(-32603, 'Catalog exceeds the retained byte limit.');
      serialized.push(text); lengths.push(length);
    }
    const entry = {id: randomToken(24), principal, kind, authority, serialized, lengths, bytes,
      offsets: new Set([0]), expiresAt: this.now() + this.ttlMs};
    const first = this.page(entry, 0);
    if (!first.nextCursor) return first;
    for (const [id, old] of this.entries) if (old.principal === principal &&
      [...this.entries.values()].filter(value => value.principal === principal).length >= this.perPrincipal) this.remove(id);
    while (this.entries.size >= this.limit || this.bytes + bytes > this.maxBytes) this.remove(this.entries.keys().next().value);
    entry.timer = setTimeout(() => this.remove(entry.id), this.ttlMs); entry.timer.unref?.();
    this.entries.set(entry.id, entry); this.bytes += bytes;
    return first;
  }
  page(entry, offset) {
    let end = offset, bytes = 0;
    while (end < entry.serialized.length && end - offset < this.pageSize && bytes + entry.lengths[end] <= this.pageBytes)
      bytes += entry.lengths[end++];
    const more = end < entry.serialized.length;
    if (more) entry.offsets.add(end);
    return {items: entry.serialized.slice(offset, end).map(text => JSON.parse(text)),
      ...(more ? {nextCursor: 'mcp-page:' + entry.id + ':' + end} : {})};
  }
}
