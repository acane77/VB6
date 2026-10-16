import test from 'node:test';
import assert from 'node:assert/strict';
import {AgentThread} from '../src/agents/thread.js';
import {AgentThreadSearch} from '../src/agents/thread-search.js';
const event = (thread, type, text, extra = {}) => thread.apply({type, text, time: new Date().toISOString(), ...extra});
const fixture = () => {
  const thread = new AgentThread();
  event(thread, 'user', 'Find [a+b]* literally');
  event(thread, 'assistant', 'A second literal [A+B]* answer', {requestId: '1'});
  event(thread, 'tool', 'inspect', {requestId: '1', callId: 't', arguments: {needle: 'Hidden result needle'}});
  event(thread, 'result', 'Inspection complete', {requestId: '1', callId: 't', result: {code: 'needle'}});
  event(thread, 'limit', 'Status needle');
  return thread;
};
test('literal case-insensitive search never evaluates regular expressions', () => {
  const thread = fixture(), search = new AgentThreadSearch(); search.configure('[a+b]*');
  assert.equal(search.update(thread).length, 2); assert.equal(search.position, 1);
  search.configure('(?=.)'); assert.deepEqual(search.update(thread), []);
});
test('all/messages/tools/status search only the selected PUBLIC fields', () => {
  const thread = fixture(), search = new AgentThreadSearch();
  for (const [scope, count] of [['all', 2], ['messages', 0], ['tools', 1], ['status', 1]]) {
    search.configure('needle', scope); assert.equal(search.update(thread).length, count);
  }
  search.configure('literal', 'messages'); assert.equal(search.update(thread).length, 2);
});
test('next and previous wrap by matching entry, including a single match', () => {
  const search = new AgentThreadSearch(); search.configure('literal'); search.update(fixture());
  const [a, b] = search.ids; assert.equal(search.currentId, a);
  assert.equal(search.move(-1), b); assert.equal(search.move(1), a); assert.equal(search.move(1), b);
  search.configure('Status needle'); search.update(search.thread); assert.equal(search.move(-1), search.ids[0]);
  search.configure('missing'); search.update(search.thread); assert.equal(search.move(1), ''); assert.equal(search.position, 0);
});
test('stream updates scan changed entries, not every old message', () => {
  const thread = new AgentThread(), search = new AgentThreadSearch();
  for (let i = 0; i < 1000; i++) event(thread, 'user', 'Entry needle ' + i);
  search.configure('needle'); search.update(thread); assert.equal(search.scans, 1000);
  search.update(thread); assert.equal(search.scans, 1000);
  event(thread, 'status', 'Waiting', {requestId: 'stream'}); search.update(thread);
  const oldScans = search.scans; search.move(1); const selected = search.currentId;
  for (let i = 0; i < 20; i++) { event(thread, 'delta', 'needle ', {requestId: 'stream'}); search.update(thread); }
  assert.equal(search.scans - oldScans, 20); assert.equal(search.currentId, selected);
  assert.equal(search.ids.length, 1001); assert.equal(search.cache.size, 1001);
});
test('eviction releases cached text references and selects an existing result', () => {
  const thread = new AgentThread({maxEntries: 3}), search = new AgentThreadSearch(); search.configure('needle');
  for (let i = 0; i < 8; i++) { event(thread, 'user', 'needle ' + i); search.update(thread); }
  assert.equal(search.cache.size, 3); assert.equal(search.ids.length, 3);
  assert.equal(search.currentId, thread.entries[0].id); assert.equal(thread.omitted, 5);
});
test('switching tasks with reused ids cannot return old matches', () => {
  const first = new AgentThread(), second = new AgentThread(), search = new AgentThreadSearch();
  event(first, 'user', 'needle'); event(second, 'user', 'different'); search.configure('needle');
  assert.equal(search.update(first).length, 1); assert.equal(search.update(second).length, 0);
  assert.equal(search.cache.get(second.entries[0].id).item, second.entries[0]);
});
test('clearing search drops references and performs no scans until a new query', () => {
  const thread = fixture(), search = new AgentThreadSearch(); search.configure('needle'); search.update(thread);
  search.configure(''); search.update(thread); const scans = search.scans;
  event(thread, 'user', 'needle'); search.update(thread); assert.equal(search.scans, scans); assert.equal(search.cache.size, 0);
  search.clear(); assert.equal(search.thread, null); assert.equal(search.scans, 0);
});
test('changing query rescans once; identical query does not', () => {
  const thread = fixture(), search = new AgentThreadSearch(); search.configure('needle'); search.update(thread);
  const scans = search.scans; assert.equal(search.configure('needle'), false); search.update(thread); assert.equal(search.scans, scans);
  assert.equal(search.configure('literal'), true); search.update(thread); assert.equal(search.scans, scans + thread.entries.length);
});
test('Unicode is literal and deterministic without DOM offsets or regex backtracking', () => {
  const thread = new AgentThread(), search = new AgentThreadSearch(); event(thread, 'user', 'ŻÓŁĆ 😀 İ');
  search.configure('żółć'); assert.equal(search.update(thread).length, 1);
  search.configure('😀'); assert.equal(search.update(thread).length, 1);
  search.configure('i\u0307'); assert.equal(search.update(thread).length, 1);
});
test('invalid query/scope/direction does not change an existing selection', () => {
  const search = new AgentThreadSearch(); search.configure('needle'); search.update(fixture()); const id = search.currentId;
  for (const args of [[null], ['x'.repeat(257)], ['x', 'native'], ['x', {}]]) assert.throws(() => search.configure(...args));
  assert.throws(() => search.move(0)); assert.equal(search.currentId, id); assert.equal(search.query, 'needle');
});
