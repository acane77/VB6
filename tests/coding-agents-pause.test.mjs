import test from 'node:test';
import assert from 'node:assert/strict';
import {CodingAgent} from '../src/agents/agent.js';
import {ProviderTransportError} from '../src/agents/providers.js';
import {createIdeAdapter} from '../src/mcp/ide-adapter.js';
import {newProject, normalizeProject} from '../src/project/model.js';
import {Signal, History} from '../src/core/core.js';

const providers = ['openai', 'anthropic', 'google'];
const read = {name: 'vb6_project_get'};
function packet(provider, calls = [], text = 'Done.') {
  const tools = calls.map((call, index) => ({id: 'c' + index, ...call}));
  if (provider === 'openai') return {status: 'completed', output: [
    {type: 'reasoning', encrypted_content: 'PRIVATE_NATIVE_CONTEXT'},
    ...tools.map(call => ({type: 'function_call', call_id: call.id, name: call.name, arguments: JSON.stringify(call.args || {})})),
    {type: 'message', role: 'assistant', content: [{type: 'output_text', text}]}], usage: {total_tokens: 10}};
  if (provider === 'anthropic') return {content: [
    {type: 'thinking', thinking: 'PRIVATE_NATIVE_CONTEXT', signature: 'PRIVATE_SIGNATURE'},
    ...tools.map(call => ({type: 'tool_use', id: call.id, name: call.name, input: call.args || {}})),
    {type: 'text', text}], stop_reason: calls.length ? 'tool_use' : 'end_turn', usage: {input_tokens: 8, output_tokens: 2}};
  return {candidates: [{content: {parts: [
    {text: 'PRIVATE_NATIVE_CONTEXT', thought: true},
    ...tools.map(call => ({functionCall: {id: call.id, name: call.name, args: call.args || {}}, thoughtSignature: 'PRIVATE_SIGNATURE'})),
    {text}]}, finishReason: 'STOP'}], usageMetadata: {totalTokenCount: 10}};
}
function fixture(t, {approve = async () => true, ...options} = {}) {
  const ide = new Signal();
  Object.assign(ide, {project: newProject('Pause'), runState: 'design', docs: [], history: new History(),
    markDirty() {}, record(before, label) { this.history.record(before, this.project, label); },
    loadProject(project) { this.project = normalizeProject(project); this.history.reset(); }});
  const adapter = createIdeAdapter(ide, {approve}), agent = new CodingAgent(adapter, options);
  t.after(() => { agent.stop(); adapter.dispose(); });
  return {ide, adapter, agent};
}
const run = (agent, provider, transport, options = {}) => agent.run({provider, model: 'test-model', prompt: 'Inspect the project.', transport, autoCompactTokens: 0, ...options});
const publicState = agent => JSON.stringify({thread: agent.thread.snapshot(), activity: agent.transcript});
function outputs(provider, body) {
  if (provider === 'openai') return body.input.filter(item => item.type === 'function_call_output');
  if (provider === 'anthropic') return body.messages.flatMap(message => Array.isArray(message.content) ? message.content.filter(item => item.type === 'tool_result') : []);
  return body.contents.flatMap(message => message.parts.filter(part => part.functionResponse));
}
const edit = f => ({name: 'vb6_code_edit', args: {expectedRevision: f.adapter.revision, edits: [{module: 'Form1', start: 0, end: 0, text: "' applied once\n", expectedText: ''}]}});

for (const provider of providers) {
  test(`pause: ${provider} can pause before the first request without losing the accepted prompt`, async t => {
    const {agent} = fixture(t);
    agent.onEvent = event => { if (event.type === 'run-start') assert.equal(agent.pause(), true); };
    const result = await run(agent, provider, async () => assert.fail('must not send'));
    assert.equal(result.status, 'limit'); assert.equal(agent.limit.kind, 'user'); assert.equal(agent.canResume, true);
    assert.equal(agent.usage.requests, 0); assert.equal(agent.history.length, 1);
    assert.equal(agent.permissionSession.snapshot().active, false);
    agent.onEvent = () => {};
    await agent.resume({transport: async (_, {receive}) => receive(packet(provider))});
    assert.equal(agent.state, 'completed'); assert.equal(agent.transcript.filter(event => event.type === 'user').length, 1);
  });
  test(`pause: ${provider} validates the current response and defers all tools without replaying generation`, async t => {
    const {agent} = fixture(t);
    const result = await run(agent, provider, async (_, {receive}) => {
      assert.equal(agent.pause(), true); assert.equal(agent.pause(), false);
      receive(packet(provider, [read, read]));
    });
    assert.equal(result.status, 'limit'); assert.equal(agent.usage.calls, 0);
    assert.equal(agent.pendingTurn.outputs.length, 0); assert.equal(agent.pendingTurn.result.calls.length, 2);
    assert.equal(agent.usage.tokens, 10); assert.ok(!publicState(agent).includes('PRIVATE'));
    let requests = 0;
    await agent.resume({transport: async (body, {receive}) => {
      requests++; assert.equal(outputs(provider, body).length, 2); assert.ok(JSON.stringify(body).includes('PRIVATE_NATIVE_CONTEXT'));
      receive(packet(provider));
    }});
    assert.equal(requests, 1); assert.equal(agent.usage.requests, 2); assert.equal(agent.usage.calls, 2);
    assert.equal(agent.usage.tokens, 20); assert.equal(agent.pendingTurn, null);
  });
  test(`pause: ${provider} resumes a confirmed prefix exactly once across repeated pauses`, async t => {
    const {agent} = fixture(t); let completed = 0;
    agent.onEvent = event => { if (event.type === 'result' && ++completed < 3) agent.pause(); };
    await run(agent, provider, async (_, {receive}) => receive(packet(provider, [read, read, read])));
    assert.equal(agent.pendingTurn.outputs.length, 1); assert.equal(agent.usage.calls, 1);
    const second = await agent.resume({maxCalls: 2, transport: async () => assert.fail('remaining batch is retained')});
    assert.equal(second.status, 'limit'); assert.equal(second.calls, 1);
    assert.equal(agent.pendingTurn.outputs.length, 2); assert.equal(agent.usage.calls, 2);
    let network = 0;
    await agent.resume({maxCalls: 2, transport: async (body, {receive}) => {
      network++; assert.equal(outputs(provider, body).length, 3); receive(packet(provider));
    }});
    assert.equal(network, 1); assert.equal(agent.state, 'completed'); assert.equal(agent.usage.calls, 3);
    assert.equal(agent.thread.entries.filter(item => item.kind === 'tool').length, 3);
    assert.equal(agent.usage.requests, 2); assert.equal(agent.usage.tokens, 20);
    assert.equal(agent.transcript.filter(event => event.type === 'user').length, 1);
  });
  test(`pause: ${provider} after the last result commits the complete batch before pausing`, async t => {
    const {agent} = fixture(t);
    agent.onEvent = event => { if (event.type === 'result') agent.pause(); };
    await run(agent, provider, async (_, {receive}) => receive(packet(provider, [read])));
    assert.equal(agent.limit.kind, 'user'); assert.equal(agent.pendingTurn, null); assert.equal(agent.completeTurns.length, 1);
    assert.equal(agent.thread.entries.find(item => item.kind === 'tool').status, 'complete');
    agent.onEvent = () => {};
    await agent.resume({transport: async (body, {receive}) => { assert.equal(outputs(provider, body).length, 1); receive(packet(provider)); }});
    assert.equal(agent.usage.calls, 1);
  });
  test(`pause: ${provider} a final answer completes normally rather than manufacturing a continuation`, async t => {
    const {agent} = fixture(t);
    await run(agent, provider, async (_, {receive}) => { agent.pause(); receive(packet(provider)); });
    assert.equal(agent.state, 'completed'); assert.equal(agent.canResume, false); assert.equal(agent.pause(), false);
  });
}

test('pause: Stop overrides a pending pause even when invoked by a result observer', async t => {
  const {agent} = fixture(t);
  agent.onEvent = event => { if (event.type === 'result') { agent.pause(); agent.stop(); } };
  await assert.rejects(run(agent, 'openai', async (_, {receive}) => receive(packet('openai', [read, read]))), /stopped/i);
  assert.equal(agent.state, 'blocked'); assert.equal(agent.pendingTurn, null); assert.equal(agent.canResume, false);
  assert.equal(agent.usage.calls, 1);
});
test('pause: Stop from a final-answer observer is not reported as successful completion', async t => {
  const {agent} = fixture(t);
  agent.onEvent = event => { if (event.type === 'assistant') agent.stop(); };
  await assert.rejects(run(agent, 'openai', async (_, {receive}) => receive(packet('openai'))), /stopped/i);
  assert.equal(agent.state, 'blocked'); assert.equal(agent.completeTurns.length, 0);
});
test('pause: permission denial while pause is requested remains terminal', async t => {
  let f;
  f = fixture(t, {approve: async () => { f.agent.pause(); return false; }});
  await assert.rejects(run(f.agent, 'openai', async (_, {receive}) => receive(packet('openai', [edit(f), read]))), /denied/i);
  assert.equal(f.agent.pendingTurn, null); assert.equal(f.agent.canResume, false); assert.equal(f.ide.history.undoStack.length, 0);
});
test('pause: a completed edit is not applied again after Continue', async t => {
  const f = fixture(t); let completed = 0;
  f.agent.onEvent = event => { if (event.type === 'result' && ++completed === 1) f.agent.pause(); };
  await run(f.agent, 'openai', async (_, {receive}) => receive(packet('openai', [edit(f), read])));
  assert.equal(f.ide.history.undoStack.length, 1); assert.equal(f.agent.pendingTurn.outputs.length, 1);
  const code = f.ide.project.modules[0].code;
  await f.agent.resume({transport: async (body, {receive}) => { assert.equal(outputs('openai', body).length, 2); receive(packet('openai')); }});
  assert.equal(f.ide.project.modules[0].code, code); assert.equal(f.ide.history.undoStack.length, 1);
  assert.equal(f.agent.usage.calls, 2);
});
test('pause: remaining edits retain stale revision guards instead of overwriting manual changes', async t => {
  const f = fixture(t);
  f.agent.onEvent = event => { if (event.type === 'result') f.agent.pause(); };
  await run(f.agent, 'openai', async (_, {receive}) => receive(packet('openai', [read, edit(f)])));
  const args = structuredClone(f.agent.pendingTurn.result.calls[1].arguments);
  f.ide.project.modules[0].code = "' manual change\n"; f.ide.markDirty();
  f.agent.onEvent = () => {};
  await f.agent.resume({transport: async (body, {receive}) => {
    assert.match(outputs('openai', body)[1].output, /revision|stale/i); receive(packet('openai'));
  }});
  assert.equal(f.ide.project.modules[0].code, "' manual change\n"); assert.equal(f.ide.history.undoStack.length, 0);
  assert.ok(f.agent.transcript.some(event => event.type === 'tool' && JSON.stringify(event.arguments) === JSON.stringify(args)));
});
test('pause: every Full IDE access continuation requires a fresh explicit acknowledgment', async t => {
  const {agent} = fixture(t);
  await run(agent, 'openai', async (_, {receive}) => { agent.pause(); receive(packet('openai', [read])); }, {mode: 'full', fullAccessConfirmed: true});
  const pending = agent.pendingTurn;
  await assert.rejects(agent.resume({mode: 'full', transport: async () => assert.fail('no request')}), /explicit local confirmation/);
  assert.equal(agent.pendingTurn, pending); assert.equal(agent.usage.calls, 0);
});
test('pause: workspace replacement cannot resume a retained prefix', async t => {
  const f = fixture(t);
  f.agent.onEvent = event => { if (event.type === 'result') f.agent.pause(); };
  await run(f.agent, 'openai', async (_, {receive}) => receive(packet('openai', [read, read])));
  f.ide.loadProject(structuredClone(f.ide.project));
  assert.equal(f.agent.canResume, false);
  await assert.rejects(f.agent.resume({transport: async () => assert.fail('no request')}), /no resumable request/);
});
test('pause: retry backoff is interruptible without shortening the provider cooldown', async t => {
  let agent, waits = 0, requests = 0;
  ({agent} = fixture(t, {wait: async (ms, signal) => {
    waits++; assert.ok(ms > 0); agent.pause(); assert.equal(signal.aborted, true); signal.throwIfAborted();
  }, random: () => 0}));
  await run(agent, 'openai', async () => { requests++; throw new ProviderTransportError('Transient', {retryable: true, retryAfterMs: 20000}); });
  assert.equal(waits, 1); assert.equal(requests, 1); assert.equal(agent.limit.kind, 'user'); assert.ok(agent.retryAt > Date.now());
  assert.equal(agent.canResume, true); assert.equal(agent.permissionSession.snapshot().active, false);
});
test('pause: malformed responses cannot be retained as resumable tool batches', async t => {
  const {agent} = fixture(t);
  await assert.rejects(run(agent, 'openai', async (_, {receive}) => { agent.pause(); receive({status: 'completed', output: [{type: 'function_call', call_id: 'bad', name: read.name, arguments: '{'}]}); }), /Malformed/);
  assert.equal(agent.pendingTurn, null); assert.equal(agent.usage.calls, 0); assert.equal(agent.canResume, false);
});

for (const provider of providers) test(`pause: ${provider} reserves confirmed output bytes before running the remaining batch`, async t => {
  const {agent, adapter} = fixture(t); let reads = 0, requests = 0;
  const original = adapter.tools.find(tool => tool.name === 'vb6.project.get');
  const execute = original.execute;
  original.execute = async (...args) => { reads++; return {...await execute(...args), payload: 'x'.repeat(80000)}; };
  agent.onEvent = event => { if (event.type === 'result') agent.pause(); };
  await run(agent, provider, async (_, {receive}) => { requests++; receive(packet(provider, [read, read])); }, {maxContextBytes: 1000000, toolResultBytes: 100000});
  assert.equal(agent.pendingTurn.outputs.length, 1); assert.equal(reads, 1);
  const prefix = structuredClone(agent.pendingTurn.outputs);
  agent.onEvent = () => {};
  await agent.resume({maxContextBytes: Math.max(65536, agent.lastRequestBytes + 8000), transport: async () => assert.fail('must pause before paid request')});
  assert.equal(agent.limit.kind, 'context'); assert.equal(reads, 1); assert.equal(requests, 1);
  assert.deepEqual(agent.pendingTurn.outputs, prefix);
  await agent.resume({maxContextBytes: 1000000, transport: async (body, {receive}) => {
    requests++; assert.equal(outputs(provider, body).length, 2); receive(packet(provider));
  }});
  assert.equal(agent.state, 'completed'); assert.equal(reads, 2); assert.equal(requests, 2); assert.equal(agent.usage.calls, 2);
});
