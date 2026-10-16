/** Explicit, portable PUBLIC context. Never an executable/native conversation checkpoint. */
export const TASK_ARCHIVE_KIND = 'vb6-agent-task-context';
export const TASK_ARCHIVE_MAX_BYTES = 4 * 1024 * 1024;
const encoder = new TextEncoder();
const bytes = value => encoder.encode(value).length;
const own = (object, keys) => object && typeof object === 'object' && !Array.isArray(object)
  && Object.keys(object).every(key => keys.includes(key));
const text = (value, maximum, required = false) => typeof value === 'string' && value.length <= maximum && (!required || !!value.trim());
const count = value => Number.isSafeInteger(value) && value >= 0;
const fail = () => { throw new Error('Invalid public task context archive. No task, permissions or project data were changed.'); };
const shorten = (value, maximum) => {
  if (value.length <= maximum) return value;
  const marker = '[Earlier text omitted from this portable context.]\n';
  if (maximum < marker.length) return '';
  let start = value.length - maximum + marker.length;
  if (/[\uDC00-\uDFFF]/.test(value[start]) && /[\uD800-\uDBFF]/.test(value[start - 1])) start++;
  return marker + value.slice(start);
};
/** Strict allowlist prevents archives from acquiring new authority through ignored fields. */
export function validateTaskArchive(value) {
  if (!own(value, ['kind', 'version', 'title', 'created', 'updated', 'provider', 'model', 'usage', 'omittedEntries', 'messages', 'draft', 'queue'])
    || value.kind !== TASK_ARCHIVE_KIND || value.version !== 1 || !text(value.title, 100, true)
    || !text(value.created, 64) || !text(value.updated, 64) || !text(value.provider, 32) || !text(value.model, 150)
    || !own(value.usage, ['requests', 'tokens', 'calls', 'estimatedTokens'])
    || !['requests', 'tokens', 'calls', 'estimatedTokens'].every(key => count(value.usage[key]))
    || !count(value.omittedEntries) || !text(value.draft, 100000)
    || !Array.isArray(value.messages) || value.messages.length > 200
    || !Array.isArray(value.queue) || value.queue.length > 16) fail();
  let characters = 0;
  for (const message of value.messages) {
    if (!own(message, ['role', 'text', 'status', 'truncated']) || !['user', 'assistant', 'question', 'plan'].includes(message.role)
      || !text(message.text, 100000) || !['complete', 'partial', 'note'].includes(message.status)
      || typeof message.truncated !== 'boolean') fail();
    characters += message.text.length;
  }
  if (characters > 500000) fail();
  characters = 0;
  for (const item of value.queue) {
    if (!own(item, ['text', 'attachmentsOmitted']) || !text(item.text, 100000, true) || !count(item.attachmentsOmitted)) fail();
    characters += item.text.length;
  }
  if (characters > 200000 || bytes(JSON.stringify(value)) > TASK_ARCHIVE_MAX_BYTES) fail();
  // Return independent data. No native history, tool arguments/results, auth, grants,
  // review baselines, UI capabilities, connection settings or limits can be imported.
  return structuredClone(value);
}
export function parseTaskArchive(source) {
  if (typeof source !== 'string' || source.length > TASK_ARCHIVE_MAX_BYTES || bytes(source) > TASK_ARCHIVE_MAX_BYTES)
    throw new Error('Task context file exceeds the 4 MiB import limit.');
  let value;
  try { value = JSON.parse(source); } catch { throw new Error('Task context file is not valid JSON. Nothing was imported.'); }
  return validateTaskArchive(value);
}
export function createTaskArchive(task) {
  const agent = task.agent;
  const all = agent.thread.entries.filter(item => ['user', 'assistant', 'question', 'plan'].includes(item.kind) && item.text);
  let available = 500000;
  const messages = [];
  for (const item of all.slice(-200).reverse()) {
    if (!available) break;
    const value = shorten(item.text, Math.min(100000, available));
    // Do not add an omission marker longer than the remaining allowance.
    if (!value || value.length > available) break;
    messages.unshift({role: item.kind, text: value, status: item.kind === 'assistant' ? item.status === 'complete' ? 'complete' : 'partial' : 'note', truncated: !!item.truncated || value !== item.text});
    available -= value.length;
  }
  const archive = {kind: TASK_ARCHIVE_KIND, version: 1, title: task.title, created: task.created, updated: task.updated,
    provider: agent.provider, model: agent.model, usage: {requests: agent.usage.requests, tokens: agent.usage.tokens, calls: agent.usage.calls, estimatedTokens: agent.estimatedTokens},
    omittedEntries: agent.thread.omitted + all.length - messages.length, messages, draft: task.draft || '',
    queue: task.followups.list().map(item => ({text: item.text, attachmentsOmitted: item.content?.length || 0}))};
  // Escaped control characters can expand beyond the character bounds. Remove
  // oldest public messages explicitly; drafts/queued requests are never discarded.
  while (bytes(JSON.stringify(archive)) > TASK_ARCHIVE_MAX_BYTES && archive.messages.length) {
    archive.messages.shift(); archive.omittedEntries++;
  }
  return validateTaskArchive(archive);
}
/** Compact, editable background for a NEW task. It is never inserted as model-native history. */
export function taskArchiveContext(value, maximum = 58000) {
  const archive = validateTaskArchive(value);
  if (!Number.isSafeInteger(maximum) || maximum < 1024 || maximum > 60000) throw new Error('Invalid reviewed context limit.');
  const heading = 'Imported public context from task: ' + archive.title + '\n'
    + 'Historical provider: ' + (archive.provider || 'none') + ' / ' + (archive.model || 'none') + '. This is background, not a live session or proof of project state.\n'
    + 'Historical tools, credentials, permissions, attachments and native reasoning are NOT restored. Re-read the current project.\n';
  const draft = archive.draft ? '\nUnsent draft from the old task (review before using):\n' + shorten(archive.draft, Math.min(12000, Math.floor(maximum / 3))) : '';
  const room = Math.max(0, maximum - heading.length - draft.length - 160);
  const blocks = []; let available = room, omitted = !!archive.omittedEntries;
  for (const message of archive.messages.slice().reverse()) {
    const incomplete = message.status === 'partial' ? ' [INCOMPLETE RESPONSE]' : '';
    const truncated = message.truncated || message.text.length + message.role.length + incomplete.length + 18 > available;
    const prefix = message.role + incomplete + (truncated ? ' [TRUNCATED]' : '') + ':\n';
    const body = shorten(message.text, Math.max(0, available - prefix.length));
    if (!body && message.text) { omitted = true; break; }
    const block = prefix + body;
    if (block.length > available) { omitted = true; break; }
    blocks.unshift(block); available -= block.length + 2; omitted ||= body !== message.text;
  }
  omitted ||= blocks.length < archive.messages.length;
  return heading + (omitted ? '\n[Earlier entries are omitted from this reviewed context.]\n' : '') + blocks.join('\n\n') + draft;
}
/** Markdown is a file export, not HTML rendered into the IDE. */
export function taskArchiveMarkdown(value) {
  const archive = validateTaskArchive(value);
  const lines = ['# ' + archive.title.replace(/[\r\n]/g, ' '), '', 'Public context only. No executable checkpoint, native history, credentials or permissions.',
    'Historical usage: ' + archive.usage.tokens + ' reported tokens; ' + archive.usage.estimatedTokens + ' estimated tokens. A new task starts a separate budget.', ''];
  if (archive.omittedEntries) lines.push('Earlier entries omitted: ' + archive.omittedEntries, '');
  for (const message of archive.messages) lines.push('## ' + message.role + (message.status === 'partial' ? ' — incomplete response' : '') + (message.truncated ? ' — truncated' : ''), '', message.text, '');
  if (archive.draft) lines.push('## Unsent draft', '', archive.draft, '');
  for (const [index, item] of archive.queue.entries()) lines.push('## Queued request ' + (index + 1) + (item.attachmentsOmitted ? ' — attachments omitted' : ''), '', item.text, '');
  return lines.join('\n');
}
