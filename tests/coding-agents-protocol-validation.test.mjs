import test from 'node:test';
import assert from 'node:assert/strict';
import {responseCollector, listModels} from '../src/agents/providers.js';
const packet = (provider, call = {}) => {
  const {id = 'call0', name = 'vb6_module_read', args = {module: 'Form1'}} = call;
  if (provider === 'openai') return {type: 'response.completed', response: {status: 'completed', output: [{type: 'function_call', call_id: id, name, arguments: JSON.stringify(args)}], usage: {total_tokens: 12}}};
  if (provider === 'anthropic') return {content: [{type: 'tool_use', id, name, input: args}], stop_reason: 'tool_use', usage: {input_tokens: 10, output_tokens: 2}};
  return {candidates: [{content: {role: 'model', parts: [{functionCall: {id, name, args}, thoughtSignature: 'opaque'}]}, finishReason: 'STOP'}], usageMetadata: {totalTokenCount: 12}};
};
const collect = (provider, value) => { const result = responseCollector(provider); result.receive(value); return result.result(); };
for (const provider of ['openai', 'anthropic', 'google']) {
  for (const value of [null, [], 'secret upstream payload', 17, false, {type: 5}, {response: []}]) test(`${provider}: invalid packet shape is generic and permanently fails the collector (${JSON.stringify(value)})`, () => {
    const collector = responseCollector(provider);
    assert.throws(() => collector.receive(value), error => /provider stream/.test(error.message) && !error.message.includes('secret'));
    assert.throws(() => collector.receive(packet(provider)), /provider stream/);
    assert.throws(() => collector.result(), /provider stream/);
  });
  for (const [key, value] of [['id', {}], ['id', ''], ['id', 'a\nb'], ['id', 'x'.repeat(513)], ['name', {}], ['name', 'a.b'], ['name', 'x'.repeat(65)], ['args', []], ['args', false], ['args', 'text']]) test(`${provider}: tool ${key} must have its native valid type (${JSON.stringify(value).slice(0, 20)})`, () => {
    assert.throws(() => collect(provider, packet(provider, {[key]: value})), /provider tool call/);
  });
  test(`${provider}: late content cannot overwrite a completed turn, even if the receiver error is caught`, () => {
    const collector = responseCollector(provider); collector.receive(packet(provider));
    assert.throws(() => collector.receive(packet(provider, {name: 'vb6_module_write'})), /after completion/);
    assert.throws(() => collector.result(), /after completion/); assert.equal(collector.usage().tokens, 12);
  });
  test(`${provider}: a trailing cumulative usage packet is allowed without replaying text or calls`, () => {
    const collector = responseCollector(provider); collector.receive(packet(provider));
    collector.receive(provider === 'google' ? {usageMetadata: {totalTokenCount: 30}} : {usage: {total_tokens: 30}});
    const result = collector.result(); assert.equal(result.tokens, 30); assert.equal(result.calls.length, 1);
  });
}
for (const status of ['in_progress', 'incomplete']) test('OpenAI: completed envelope cannot execute a ' + status + ' output item', () => {
  const value = packet('openai'); value.response.output[0].status = status;
  assert.throws(() => collect('openai', value), /completed response shape/);
});
test('OpenAI: refusal and function calls cannot be mixed into an executable batch', () => {
  const value = packet('openai'); value.response.output.push({type: 'message', role: 'assistant', content: [{type: 'refusal', refusal: 'No.'}]});
  assert.throws(() => collect('openai', value), /completed response shape/);
});
for (const output of [null, {}, [null], [{type: 'message', role: 'user', content: []}], [{type: 'message', content: [{type: 'output_text', text: 17}]}], [{type: 'function_call', call_id: 'c', name: 'read', arguments: {}}]]) test('OpenAI: malformed completed output is rejected without exposing the body ' + JSON.stringify(output), () => {
  const value = packet('openai'); value.response.output = output;
  assert.throws(() => collect('openai', value), /completed response shape/);
});
test('OpenAI: terminal data is snapshotted, including opaque signatures, before a caller can mutate its packet', () => {
  const value = packet('openai'); value.response.output.unshift({type: 'reasoning', status: 'completed', encrypted_content: 'keep-exact'});
  const collector = responseCollector('openai'); collector.receive(value); value.response.output[1].name = 'changed';
  const result = collector.result(); assert.equal(result.calls[0].name, 'vb6_module_read'); assert.equal(result.message[0].encrypted_content, 'keep-exact');
});
for (const stop of ['end_turn', 'stop_sequence']) test('Anthropic: tool batch must match its stop reason ' + stop, () => {
  const value = packet('anthropic'); value.stop_reason = stop; assert.throws(() => collect('anthropic', value), /completed response shape/);
});
test('Anthropic: tool_use without tools is not a completed answer', () => {
  assert.throws(() => collect('anthropic', {content: [{type: 'text', text: 'No tool'}], stop_reason: 'tool_use'}), /completed response shape/);
});
test('Anthropic: a closed block cannot accept a later delta or close twice', () => {
  for (const late of [{type: 'content_block_delta', index: 0, delta: {type: 'input_json_delta', partial_json: '{}'}}, {type: 'content_block_stop', index: 0}]) {
    const collector = responseCollector('anthropic'); collector.receive({type: 'content_block_start', index: 0, content_block: {type: 'tool_use', id: 'c', name: 'read', input: {}}});
    collector.receive({type: 'content_block_stop', index: 0}); assert.throws(() => collector.receive(late), /stream/);
  }
});
for (const [type, field, block] of [['text_delta', 'text', 'text'], ['input_json_delta', 'partial_json', 'tool_use'], ['thinking_delta', 'thinking', 'thinking'], ['signature_delta', 'signature', 'thinking']]) test('Anthropic: streamed ' + field + ' cannot be coerced from an object', () => {
  const shown = [], collector = responseCollector('anthropic', text => shown.push(text)); collector.receive({type: 'content_block_start', index: 0, content_block: {type: block}});
  assert.throws(() => collector.receive({type: 'content_block_delta', index: 0, delta: {type, [field]: {secret: 'not public'}}}), /delta shape/); assert.deepEqual(shown, []);
});
test('Anthropic: server-tool pause_turn is diagnosed, not silently called a final answer', () => {
  assert.throws(() => collect('anthropic', {content: [{type: 'text', text: 'Working'}], stop_reason: 'pause_turn'}), /did not finish/);
});
for (const mutate of [value => value.candidates.push(value.candidates[0]), value => value.candidates[0].content.role = 'user', value => value.candidates[0].content.parts = {}, value => value.candidates[0].content.parts[0].text = {}, value => value.candidates[0].content.parts[0].functionCall = [], value => value.candidates[0].content.parts[0].thought = 'false']) test('Google: ambiguous candidate/content shape is rejected (' + mutate.toString() + ')', () => {
  const value = packet('google'); mutate(value); assert.throws(() => collect('google', value), /provider stream/);
});
test('Google: omitted call id remains supported, but an explicitly empty id is invalid', () => {
  const value = packet('google'); delete value.candidates[0].content.parts[0].functionCall.id;
  const result = collect('google', value); assert.equal(result.calls[0].id, 'call_0'); assert.equal(result.message.parts[0].thoughtSignature, 'opaque');
  value.candidates[0].content.parts[0].functionCall.id = ''; assert.throws(() => collect('google', value), /provider tool call/);
});
test('Google: a new continuation mode cannot execute a partial batch', () => {
  const value = packet('google'); value.candidates[0].finishReason = 'CONTINUATION'; value.continuationToken = 'private';
  assert.throws(() => collect('google', value), error => /did not finish/.test(error.message) && !error.message.includes('private'));
});
const transport = value => async (_, {receive}) => receive(value);
for (const value of [null, {}, [], {data: {}}, {data: [null]}, {data: [{id: {}}]}, {data: [{id: '../bad'}]}, {data: [{id: 'x'.repeat(151)}]}, {data: [], has_more: 'true'}, {error: {message: 'secret'}}]) test('models: malformed catalog rejects atomically ' + JSON.stringify(value), async () => {
  await assert.rejects(listModels(transport(value), 'openai'), error => /model catalog/.test(error.message) && !error.message.includes('secret'));
});
test('models: multiple packets cannot replace one account catalog with another', async () => {
  await assert.rejects(listModels(async (_, {receive}) => { receive({data: [{id: 'a'}]}); receive({data: [{id: 'b'}]}); }, 'openai'), /model catalog/);
});
test('models: non-adjacent cursor cycles reject the whole catalog', async () => {
  let calls = 0;
  await assert.rejects(listModels(async (_, {receive}) => { calls++; receive({data: [{id: 'a'}], has_more: true, last_id: calls % 2 ? 'one' : 'two'}); }, 'anthropic'), /model catalog/);
  assert.equal(calls, 3);
});
test('models: missing/invalid/oversize next cursor rejects rather than truncating', async () => {
  for (const next of [undefined, {}, 'x'.repeat(8193)]) await assert.rejects(listModels(transport({data: [{id: 'a'}], has_more: true, last_id: next}), 'anthropic'), /model catalog/);
});
test('models: exactly 20 complete pages are allowed, a continuing page 20 is not', async () => {
  for (const complete of [false, true]) {
    let calls = 0; const request = listModels(async (_, {receive}) => { calls++; receive({data: [{id: 'm' + calls}], has_more: !complete || calls < 20, last_id: 'p' + calls}); }, 'anthropic');
    if (complete) assert.equal((await request).length, 20); else await assert.rejects(request, /model catalog/);
    assert.equal(calls, 20);
  }
});
test('models: 10,000 total records includes duplicate and non-generation entries', async () => {
  await assert.rejects(listModels(transport({data: Array.from({length: 10001}, () => ({id: 'same'}))}), 'openai'), /model catalog/);
});
test('models: cancellation before/after a transport never publishes a partial result', async () => {
  let calls = 0; const controller = new AbortController(); controller.abort();
  await assert.rejects(listModels(async () => { calls++; }, 'openai', controller.signal), {name: 'AbortError'}); assert.equal(calls, 0);
  const next = new AbortController(); await assert.rejects(listModels(async (_, {receive}) => { receive({data: [{id: 'a'}]}); next.abort(); }, 'openai', next.signal), {name: 'AbortError'});
});
test('models: account labels/order remain intact while returning independent, safe fields only', async () => {
  const value = {chatgpt: true, data: [{id: 'z', label: 'Z', private: 'excluded'}, {id: 'a', label: 'A'}, {id: 'z', label: 'Duplicate'}]};
  const result = await listModels(transport(value), 'openai', undefined, {details: true}); assert.deepEqual(result, [{id: 'z', label: 'Z'}, {id: 'a', label: 'A'}]);
  result[0].label = 'changed'; assert.equal(value.data[0].label, 'Z');
  await assert.rejects(listModels(transport({chatgpt: true, data: [{id: 'z', label: {}}]}), 'openai'), /model catalog/);
});
test('models: supported Google generation methods are filtered with validated identifiers', async () => {
  const value = {models: [{name: 'models/b', supportedGenerationMethods: ['embedContent']}, {name: 'models/a', supportedGenerationMethods: ['generateContent']} ]};
  assert.deepEqual(await listModels(transport(value), 'google'), ['a']);
  value.models[1].supportedGenerationMethods = 'generateContent'; await assert.rejects(listModels(transport(value), 'google'), /model catalog/);
});

test('models: swallowed packet errors and post-receive mutations cannot replace the catalog', async () => {
  await assert.rejects(listModels(async (_, {receive}) => {
    receive({data: [{id: 'a'}]}); try { receive({data: [{id: 'b'}]}); } catch {}
  }, 'openai'), /model catalog/);
  const source = {data: [{id: 'original'}]};
  assert.deepEqual(await listModels(async (_, {receive}) => { receive(source); source.data[0].id = 'mutated'; }, 'openai'), ['original']);
});
