import test from 'node:test';
import assert from 'node:assert/strict';
import {withToolContent, normalizeToolContent, formatToolResult} from '../src/mcp/tool-result.js';
import {McpServer} from '../src/mcp/server.js';
import {MCP_META, MCP_VERSION} from '../src/mcp/protocol.js';

for (const data of [null, true, false, 42, 'text', [1, 2], {ok: true}]) test('modern structured result preserves JSON type ' + JSON.stringify(data), () => {
  const result = formatToolResult(data); assert.deepEqual(result.structuredContent, data); assert.deepEqual(JSON.parse(result.content[0].text), data);
});
test('legacy non-object structured output has an explicit compatibility wrapper', () => {
  assert.deepEqual(formatToolResult([1, 2], {modern: false, outputSchema: {type: 'array'}}).structuredContent, {value: [1, 2]});
});
test('project fields cannot spoof protocol metadata or result presentation', () => {
  const data = {content: [{type: 'text', text: 'untrusted'}], _meta: {ui: {resourceUri: 'https://invalid.example'}}, isError: true};
  const result = formatToolResult(data); assert.equal(result.isError, false); assert.equal(result._meta, undefined); assert.equal(result.content.length, 1);
  assert.deepEqual(result.structuredContent, data);
});
test('rich presentation preserves ordinary tool data, schema validation and JSON fallback', () => {
  const content = [{type: 'text', text: 'Readable result'}, {type: 'image', mimeType: 'image/png', data: 'AQID'},
    {type: 'audio', mimeType: 'audio/wav', data: 'AQ=='}, {type: 'resource_link', uri: 'vb6://build/abc', name: 'Build', size: 3},
    {type: 'resource', resource: {uri: 'vb6://module/Form1/source', mimeType: 'text/plain', text: 'Option Explicit'}}];
  const data = withToolContent({ok: true}, {content, _meta: {ui: {resourceUri: 'ui://vb6/intelligent-ui'}}});
  assert.deepEqual(Object.keys(data), ['ok']); assert.equal(JSON.stringify(data), '{"ok":true}');
  const result = formatToolResult(data, {outputSchema: {type: 'object', required: ['ok']}});
  assert.equal(result.content.length, 6); assert.equal(result.content[0].text, 'Readable result'); assert.equal(result.structuredContent.ok, true);
  content[0].text = 'changed'; assert.equal(result.content[0].text, 'Readable result');
  assert.throws(() => formatToolResult(data, {outputSchema: {type: 'object', required: ['missing']}}), /outputSchema/);
});
test('older clients get a text resource-link fallback, not an unsupported block', () => {
  const data = withToolContent({}, {content: [{type: 'resource_link', uri: 'vb6://build/abc', name: 'Build'}]});
  for (const version of ['2024-11-05', '2025-03-26']) assert.equal(formatToolResult(data, {modern: false, version}).content[0].type, 'text');
  assert.equal(formatToolResult(data, {modern: false, version: '2025-06-18'}).content[0].type, 'resource_link');
});
const invalid = [null, {}, [{type: 'html', text: '<b>x</b>'}], [{type: 'text', text: 4}],
  [{type: 'image', data: 'AQ==', mimeType: 'audio/wav'}], [{type: 'audio', data: 'AR==', mimeType: 'audio/wav'}],
  [{type: 'resource_link', name: 'bad', uri: 'javascript:alert(1)'}], [{type: 'resource_link', name: 'bad', uri: 'https://a:b@example.com'}],
  [{type: 'resource_link', name: '', uri: 'vb6://project'}], [{type: 'resource_link', name: 'bad', uri: 'relative'}],
  [{type: 'resource', resource: {uri: 'vb6://project', text: 'x', blob: 'AQ=='}}],
  [{type: 'text', text: 'x', annotations: {priority: NaN}}], [{type: 'text', text: 'x', annotations: {audience: ['system']}}]];
for (const [i, value] of invalid.entries()) test('invalid rich content fails closed #' + i, () => assert.throws(() => normalizeToolContent(value), e => e.code === -32603));
test('large canonical media is validated without recursive-regex stack overflow', () => {
  const data = Buffer.alloc(300000, 1).toString('base64'); assert.equal(normalizeToolContent([{type: 'image', mimeType: 'image/png', data}])[0].data, data);
});
test('branded execution errors can omit success schema fields', () => {
  const data = withToolContent({reason: 'unavailable'}, {isError: true});
  assert.equal(formatToolResult(data, {outputSchema: {type: 'object', required: ['ok']}}).isError, true);
});
test('rich output crosses the server boundary with metadata while arbitrary data does not', async t => {
  const server = new McpServer({resources: () => [], tools: [{name: 'rich', inputSchema: {type: 'object'}, outputSchema: {type: 'array'},
    execute: () => withToolContent([1, 2], {content: [{type: 'text', text: 'Two entries'}], _meta: {test: true}})}]}); t.after(() => server.close());
  const reply = await server.dispatch({jsonrpc: '2.0', id: 1, method: 'tools/call', params: {name: 'rich', arguments: {},
    _meta: {[MCP_META + 'protocolVersion']: MCP_VERSION, [MCP_META + 'clientCapabilities']: {}}}});
  assert.equal(reply.error, undefined); assert.deepEqual(reply.result.structuredContent, [1, 2]); assert.equal(reply.result._meta.test, true);
});
test('host toJSON hooks cannot smuggle invalid content or metadata onto the wire', () => {
  const block={type:'text',text:'valid before serialization',toJSON(){return {type:'resource_link',uri:'javascript:alert(1)',name:'unsafe'};}};
  assert.throws(()=>formatToolResult(withToolContent({}, {content:[block]})),/unsafe resource/);
  assert.throws(()=>formatToolResult(withToolContent({}, {_meta:{toJSON:()=>[]}})),/serialized metadata/);
});
