/** Structural boundaries only. Unknown opaque reasoning/signature fields are preserved.
 * Sources: OpenAI Responses streaming events; Anthropic Streaming messages and
 * handling-stop-reasons; Google GenerateContent. See CODING-AGENT-WORKFLOWS.md.
 */
export const providerRecord = value => !!value && typeof value === 'object' && !Array.isArray(value);
const fail = () => { throw new Error('Invalid provider stream or completed response shape. No partial tools were executed.'); };
const records = value => Array.isArray(value) && value.length <= 65536 && value.every(providerRecord);
export function validatePacketShape(provider, data) {
  if (!providerRecord(data) || data.response != null && !providerRecord(data.response)) fail();
  if (data.type != null && typeof data.type !== 'string') fail();
  if (provider === 'google' && data.candidates != null) {
    if (!records(data.candidates) || data.candidates.length > 1) fail();
    const candidate = data.candidates[0];
    if (candidate?.content != null && (!providerRecord(candidate.content) || candidate.content.role != null && candidate.content.role !== 'model' || candidate.content.parts != null && !records(candidate.content.parts))) fail();
    for (const part of candidate?.content?.parts || []) {
      if (part.text != null && typeof part.text !== 'string' || part.thought != null && typeof part.thought !== 'boolean') fail();
      if (part.functionCall != null && !providerRecord(part.functionCall)) fail();
    }
  }
}
export function hasLateContent(provider, data) {
  if (provider === 'openai') return data.output != null || data.response != null || data.type?.startsWith('response.');
  if (provider === 'anthropic') return data.content != null || data.type?.startsWith('message_') || data.type?.startsWith('content_block_');
  return data.candidates?.some(item => item.finishReason || item.content?.parts?.length);
}
export function validateCompletedContent(provider, message) {
  const entries = provider === 'openai' ? message : provider === 'anthropic' ? message.content : message.parts;
  if (!records(entries)) fail();
  if (provider === 'openai') for (const item of entries) {
    if (typeof item.type !== 'string') fail();
    if (['message', 'function_call', 'reasoning'].includes(item.type) && item.status != null && item.status !== 'completed') fail();
    if (item.type === 'message') {
      if (item.role != null && item.role !== 'assistant' || !records(item.content)) fail();
      for (const part of item.content) if (part.type === 'output_text' && typeof part.text !== 'string' || part.type === 'refusal' && typeof part.refusal !== 'string') fail();
    }
    if (item.type === 'function_call' && typeof item.arguments !== 'string') fail();
  }
  if (provider === 'anthropic') for (const item of entries) {
    if (typeof item.type !== 'string' || item.type === 'text' && typeof item.text !== 'string') fail();
  }
}
export function validateToolCalls(provider, calls, message, stop) {
  const seen = new Set();
  const id = value => typeof value === 'string' && !!value.trim() && value.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value);
  for (const call of calls) {
    if (!id(call.id) || typeof call.name !== 'string' || !/^[\w-]{1,64}$/.test(call.name) || seen.has(call.id)
      || !providerRecord(call.arguments) || call.nativeId != null && !id(call.nativeId)) throw new Error('Invalid or duplicate provider tool call.');
    seen.add(call.id);
  }
  if (provider === 'anthropic' && (stop === 'tool_use') !== !!calls.length) fail();
  if (provider === 'openai' && calls.length && message.some(item => item.type === 'message' && item.content.some(part => part.type === 'refusal'))) fail();
}
