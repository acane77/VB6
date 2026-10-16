import {McpError, MCP_LIMIT, isRecord, utf8Length, validateArguments} from './protocol.js';

// Out-of-band branding prevents untrusted project data named "content" or "_meta"
// from changing the protocol envelope. Ordinary in-process tool callers still get data.
const presentation = new WeakMap();
export function withToolContent(value, {content = [], _meta, isError = false} = {}) {
  if (!value || typeof value !== 'object') throw new TypeError('Presented tool data must be an object or array.');
  presentation.set(value, {content, _meta, isError}); return value;
}
const invalid = message => { throw new McpError(-32603, 'Invalid MCP tool result: ' + message); };
const mime = value => typeof value === 'string' && value.length <= 256 && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+(?:;[\x20-\x7e]*)?$/i.test(value);
function uri(value) {
  if (typeof value !== 'string' || value.length > 4096 || /[\x00-\x20\x7f]/.test(value)) invalid('resource URI');
  let parsed; try { parsed = new URL(value); } catch { invalid('absolute resource URI required'); }
  if (parsed.username || parsed.password || ['javascript:', 'vbscript:', 'data:'].includes(parsed.protocol)) invalid('unsafe resource URI');
}
function base64(value) {
  if (typeof value !== 'string' || value.length > MCP_LIMIT || value.length % 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) invalid('base64 data');
  try { if (btoa(atob(value)) !== value) invalid('base64 padding bits'); } catch { invalid('base64 data'); }
}
function annotations(value) {
  if (value === undefined) return;
  if (!isRecord(value) || value.audience !== undefined && (!Array.isArray(value.audience) || value.audience.some(x => !['user', 'assistant'].includes(x))) ||
    value.priority !== undefined && (!Number.isFinite(value.priority) || value.priority < 0 || value.priority > 1) ||
    value.lastModified !== undefined && (typeof value.lastModified !== 'string' || !Number.isFinite(Date.parse(value.lastModified)))) invalid('content annotations');
}
/** Validate data without fetching resources, interpreting markup, or executing code. */
export function normalizeToolContent(content) {
  if (!Array.isArray(content) || content.length > 64) invalid('expected at most 64 content blocks');
  for (const block of content) {
    if (!isRecord(block)) invalid('content block');
    annotations(block.annotations);
    if (block.type === 'text') { if (typeof block.text !== 'string') invalid('text block'); }
    else if (block.type === 'image' || block.type === 'audio') {
      if (!mime(block.mimeType) || !block.mimeType.startsWith(block.type + '/')) invalid('media MIME type');
      base64(block.data);
    } else if (block.type === 'resource_link') {
      uri(block.uri);
      if (typeof block.name !== 'string' || !block.name || block.name.length > 1000 || block.mimeType !== undefined && !mime(block.mimeType) ||
        block.size !== undefined && (!Number.isSafeInteger(block.size) || block.size < 0)) invalid('resource link');
    } else if (block.type === 'resource') {
      const value = block.resource;
      if (!isRecord(value) || Object.hasOwn(value, 'text') === Object.hasOwn(value, 'blob')) invalid('resource content');
      uri(value.uri); annotations(value.annotations);
      if (value.mimeType !== undefined && !mime(value.mimeType)) invalid('resource MIME type');
      if (Object.hasOwn(value, 'text')) { if (typeof value.text !== 'string') invalid('resource text'); }
      else base64(value.blob);
    } else invalid('unsupported content type');
  }
  return content;
}
export function formatToolResult(output, {outputSchema, modern = true, version} = {}) {
  const extra = output && typeof output === 'object' ? presentation.get(output) : undefined;
  let raw;
  try {
    raw = JSON.parse(JSON.stringify(output === undefined ? null : output, (key, value) => {
      if (typeof value === 'number' && !Number.isFinite(value) || ['bigint', 'function', 'symbol'].includes(typeof value)) invalid('non-JSON data');
      return value;
    }));
  } catch { invalid('structured content must be JSON-serializable'); }
  const data = modern || isRecord(raw) ? raw : {value: raw};
  if (outputSchema !== undefined && !extra?.isError) {
    try { validateArguments(raw, outputSchema, 'result'); }
    catch { throw new McpError(-32603, 'Tool output does not match its outputSchema.'); }
  }
  let content = extra ? normalizeToolContent(extra.content) : [];
  // Resource links were added in 2025-06-18; older clients still get a useful inert fallback.
  if (!modern && ['2024-11-05', '2025-03-26'].includes(version)) content = content.map(block =>
    block.type === 'resource_link' ? {type: 'text', text: block.name + ': ' + block.uri + ' (resource link; not fetched)'} : block);
  if (extra?._meta !== undefined && !isRecord(extra._meta)) invalid('metadata');
  if (extra && typeof extra.isError !== 'boolean') invalid('isError');
  let json; try { json = JSON.stringify(data, null, 2); } catch { invalid('structured content must be JSON-serializable'); }
  const result = {content: [...content, {type: 'text', text: json}], structuredContent: data,
    isError: extra?.isError || false, ...(extra?._meta === undefined ? {} : {_meta: extra._meta})};
  let text; try { text = JSON.stringify(result); } catch { invalid('result must be JSON-serializable'); }
  if (utf8Length(text) > MCP_LIMIT - 4096) throw new McpError(-32000, 'MCP result exceeds the message limit; read smaller ranges.');
  // Do not let post-return mutations or non-JSON values escape through MessagePort.
  const wire = JSON.parse(text);
  normalizeToolContent(wire.content);
  if (wire._meta !== undefined && !isRecord(wire._meta)) invalid('serialized metadata');
  return wire;
}
