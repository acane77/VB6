import test from 'node:test';
import assert from 'node:assert/strict';
import {McpCatalogPages} from '../src/mcp/catalog-pages.js';
import {McpServer} from '../src/mcp/server.js';
import {MCP_META, MCP_VERSION} from '../src/mcp/protocol.js';
const owner = {principal: 'A'}, other = {principal: 'B'};
const items = count => Array.from({length: count}, (_, i) => ({name: 'item-' + i, data: {i}}));
const code = value => value?.code === -32602;

test('catalog snapshots are immutable, retryable and independent of later edits', t => {
  const pages = new McpCatalogPages({pageSize: 2}), input = items(5); t.after(() => pages.clear());
  const first = pages.create(input, 'tools', owner), cursor = first.nextCursor;
  input[2].data.i = 999; first.items[0].data.i = 888; input.unshift({name: 'new'});
  const next = pages.read(cursor, 'tools', owner); assert.deepEqual(next.items, items(5).slice(2, 4));
  next.items[0].data.i = 777; assert.deepEqual(pages.read(cursor, 'tools', owner).items, items(5).slice(2, 4));
  assert.deepEqual(pages.read(next.nextCursor, 'tools', owner).items, items(5).slice(4));
  assert.equal(pages.read(next.nextCursor, 'tools', owner).nextCursor, undefined);
});
for (const kind of ['caller', 'catalog', 'authority', 'revoked', 'offset', 'syntax']) test('catalog cursor rejects wrong ' + kind, t => {
  const pages = new McpCatalogPages({pageSize: 2}), authority = new AbortController(); t.after(() => pages.clear());
  const {nextCursor} = pages.create(items(5), 'tools', owner, authority.signal);
  if (kind === 'revoked') authority.abort();
  assert.throws(() => pages.read(kind === 'offset' ? nextCursor.replace(/:2$/, ':3') : kind === 'syntax' ? 'page:2' : nextCursor,
    kind === 'catalog' ? 'resources' : 'tools', kind === 'caller' ? other : owner,
    kind === 'authority' ? new AbortController().signal : authority.signal), code);
});
test('catalog deadlines, per-caller eviction and global byte accounting are bounded', t => {
  let now = 0; const pages = new McpCatalogPages({now: () => now, ttlMs: 10, pageSize: 1, perPrincipal: 1, limit: 2, maxBytes: 1000}); t.after(() => pages.clear());
  const a = pages.create(items(2), 'tools', owner).nextCursor;
  const b = pages.create(items(2), 'tools', other).nextCursor;
  const a2 = pages.create(items(2), 'tools', owner).nextCursor;
  assert.throws(() => pages.read(a, 'tools', owner), code); assert.equal(pages.read(b, 'tools', other).items.length, 1);
  assert.equal(pages.inspect().snapshots, 2); assert.ok(pages.bytes <= 1000);
  pages.clear('A'); assert.throws(() => pages.read(a2, 'tools', owner), code); assert.equal(pages.inspect().snapshots, 1);
  now = 10; assert.throws(() => pages.read(b, 'tools', other), code); assert.equal(pages.bytes, 0);
});
test('catalog byte pages count UTF-8 bytes and never silently truncate a large entry', t => {
  const pages = new McpCatalogPages({pageSize: 100, pageBytes: 50, maxBytes: 500}); t.after(() => pages.clear());
  const values = Array.from({length: 4}, () => ({name: '🙂'.repeat(5)}));
  const first = pages.create(values, 'resources', owner); assert.equal(first.items.length, 1); assert.ok(first.nextCursor);
  assert.throws(() => pages.create([{name: '🙂'.repeat(30)}], 'resources', owner), /byte limit/);
  assert.throws(() => pages.create(Array.from({length: 40}, () => ({name: '0123456789'})), 'resources', owner), /retained byte limit/);
});
test('single-page catalogs are copied without retaining state', () => {
  const pages = new McpCatalogPages(), input = items(2), result = pages.create(input, 'tools', owner);
  result.items[0].data.i = 9; assert.equal(input[0].data.i, 0); assert.equal(pages.inspect().snapshots, 0);
});
for (const value of [0, -1, NaN, 1.5, Infinity]) test('invalid pagination limits reject ' + value, () => {
  assert.throws(() => new McpCatalogPages({pageSize: value}), TypeError);
});
test('server catalog continuation is principal-bound and does not re-read mutable resources', async t => {
  let reads = 0; const authority = new AbortController();
  const adapter = {tools: [], authoritySignal: authority.signal, resources: async () => { reads++; return items(201).map(x => ({...x, uri: 'vb6://' + x.name})); }};
  const server = new McpServer(adapter); t.after(() => server.close()); let id = 0;
  const call = (params, principal = 'A') => server.dispatch({jsonrpc: '2.0', id: ++id, method: 'resources/list', params: {...params,
    _meta: {[MCP_META + 'protocolVersion']: MCP_VERSION, [MCP_META + 'clientCapabilities']: {}}}}, {principal, sessionKey: 'request-' + id});
  const first = await call({}); assert.equal(first.result.resources.length, 100);
  adapter.resources = async () => { throw new Error('must not re-read'); };
  const next = await call({cursor: first.result.nextCursor}); assert.equal(next.result.resources.length, 100); assert.equal(reads, 1);
  assert.equal((await call({cursor: first.result.nextCursor}, 'B')).error.code, -32602);
  server.revokePrincipal('A'); assert.equal((await call({cursor: first.result.nextCursor})).error.code, -32602);
});

test('catalog change storms coalesce by principal and schedule one follow-up for intervening edits', async t => {
  const pending=[],reads=[];
  const server=new McpServer({tools:[],resources:context=>{reads.push(context.principal);return new Promise(resolve=>pending.push(resolve));}});t.after(()=>server.close());
  for(const principal of ['A','A','B'])server.listeners.add({principal,sessionKey:principal,filter:{resourcesListChanged:true},stamp:{},meta:{},emit:()=>{}});
  for(let i=0;i<200;i++)server.changed();await new Promise(resolve=>setTimeout(resolve,0));assert.deepEqual(reads,['A','B']);
  for(let i=0;i<200;i++)server.changed();for(const resolve of pending.splice(0))resolve([]);
  await new Promise(resolve=>setTimeout(resolve,0));assert.deepEqual(reads,['A','B','A','B']);
  for(const resolve of pending.splice(0))resolve([]);await server.catalogRefresh;assert.equal(reads.length,4);
});
test('a failing private catalog cannot block another principal or trigger unbounded retries',async t=>{
  const calls=[],events=[];const server=new McpServer({tools:[],resources:async ctx=>{calls.push(ctx.principal);if(ctx.principal==='A')throw Error('Unavailable');return[{name:'public',uri:'vb6://project'}];}});t.after(()=>server.close());
  for(const principal of ['A','B'])server.listeners.add({principal,sessionKey:principal,filter:{resourcesListChanged:true},stamp:{},meta:{},emit:()=>events.push(principal)});
  server.changed();await server.catalogRefresh;assert.deepEqual(calls,['A','B']);assert.deepEqual(events,['B']);
});
test('closing the server aborts a catalog refresh whose adapter ignores cancellation',async()=>{
  const server=new McpServer({tools:[],resources:()=>new Promise(()=>{})});server.listeners.add({principal:'A',filter:{},stamp:{},meta:{},emit:()=>{}});
  server.changed();await Promise.resolve();const refresh=server.catalogRefresh;server.close();await assert.rejects(refresh,/cancel/i);assert.equal(server.catalogRefresh,null);
});
