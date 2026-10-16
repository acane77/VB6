import test from 'node:test';
import assert from 'node:assert/strict';
import {AgentConversations} from '../src/agents/conversations.js';
import {TASK_ARCHIVE_MAX_BYTES, createTaskArchive, parseTaskArchive, validateTaskArchive, taskArchiveContext, taskArchiveMarkdown} from '../src/agents/task-archive.js';
const fixture = () => {
  const adapter = {tools: [], workspaceEpoch: 1, authorityEpoch: 1, snapshot: () => ({id: 'current-project', name: 'Current project'})};
  const conversations = new AgentConversations(adapter);
  const task = conversations.active;
  task.agent.emit('user', 'Please inspect the project.');
  task.agent.emit('status', 'Request 1', {requestId: 'request1'});
  task.agent.emit('assistant', 'Public answer.', {requestId: 'request1'});
  task.draft = 'Unsent follow-up.';
  task.followups.add('Queued follow-up.');
  return {adapter, conversations, task};
};
const archive = () => createTaskArchive(fixture().task);

test('archive: round-trips only allowlisted public context and text drafts', () => {
  const {task} = fixture();
  Object.assign(task, {authBinding: 'AUTH_SECRET', permissions: {mode: 'full', secret: 'PERMISSION_SECRET'}});
  task.agent.history = [{type: 'reasoning', encrypted_content: 'NATIVE_SECRET'}];
  task.agent.uiContexts = {private: 'UI_CAPABILITY_SECRET'};
  task.agent.emit('tool', 'vb6.project.get', {requestId: 'request1', callId: 'a', arguments: {secret: 'ARGUMENT_SECRET'}});
  task.agent.emit('result', 'Completed', {requestId: 'request1', callId: 'a', result: {secret: 'TOOL_RESULT_SECRET'}});
  const value = createTaskArchive(task), encoded = JSON.stringify(value);
  for (const secret of ['AUTH_SECRET', 'PERMISSION_SECRET', 'NATIVE_SECRET', 'UI_CAPABILITY_SECRET', 'ARGUMENT_SECRET', 'TOOL_RESULT_SECRET']) assert.ok(!encoded.includes(secret));
  assert.equal(value.messages.length, 2); assert.equal(value.draft, 'Unsent follow-up.');
  assert.equal(value.queue[0].text, 'Queued follow-up.');
  assert.deepEqual(parseTaskArchive(encoded), value);
});
test('archive: public text is not falsely claimed to be secret-redacted', () => {
  const {task} = fixture(); task.agent.emit('user', 'A secret typed by the user: not-a-real-key');
  assert.ok(JSON.stringify(createTaskArchive(task)).includes('not-a-real-key'));
});
test('archive: marks streaming responses as incomplete and omits empty waiting rows', () => {
  const {task} = fixture();
  task.agent.emit('status', 'Request 2', {requestId: 'request2'});
  assert.equal(createTaskArchive(task).messages.length, 2);
  task.agent.emit('delta', 'Partial reply.', {requestId: 'request2'});
  const value = createTaskArchive(task);
  assert.equal(value.messages.at(-1).status, 'partial');
  assert.match(taskArchiveContext(value), /INCOMPLETE RESPONSE/);
});
test('archive: caps old public entries while keeping the latest complete messages in order', () => {
  const {task} = fixture();
  for (let index = 0; index < 250; index++) task.agent.emit('user', 'Message ' + index);
  const value = createTaskArchive(task);
  assert.equal(value.messages.length, 200); assert.equal(value.omittedEntries, 52);
  assert.equal(value.messages[0].text, 'Message 50'); assert.equal(value.messages.at(-1).text, 'Message 249');
});
test('archive: per-message truncation preserves Unicode scalar boundaries and advertises omissions', () => {
  const {task} = fixture(); task.agent.emit('user', '😀'.repeat(60000));
  const value = createTaskArchive(task), last = value.messages.at(-1);
  assert.equal(last.truncated, true); assert.ok(last.text.length <= 100000);
  assert.ok(!/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u.test(last.text));
  assert.match(taskArchiveContext(value), /TRUNCATED/);
});
test('archive: escaping-heavy source respects the byte cap without dropping queued drafts', () => {
  const {task} = fixture();
  for (let index = 0; index < 6; index++) task.agent.emit('user', '\u0000'.repeat(100000));
  task.draft = '\u0000'.repeat(100000);
  task.followups.clear(); task.followups.add('Q' + '\u0000'.repeat(99999)); task.followups.add('R' + '\u0000'.repeat(99999));
  const value = createTaskArchive(task);
  assert.ok(Buffer.byteLength(JSON.stringify(value)) <= TASK_ARCHIVE_MAX_BYTES);
  assert.ok(value.omittedEntries > 0); assert.equal(value.draft.length, 100000); assert.equal(value.queue.length, 2);
  assert.deepEqual(parseTaskArchive(JSON.stringify(value)), value);
});
test('archive: counts intentionally omitted queue attachments without exporting attachment data', () => {
  const {task} = fixture();
  task.followups.items = [Object.freeze({...task.followups.items[0], content: [{type: 'text', text: 'ATTACHMENT_SECRET'}]})];
  const value = createTaskArchive(task);
  assert.equal(value.queue[0].attachmentsOmitted, 1); assert.ok(!JSON.stringify(value).includes('ATTACHMENT_SECRET'));
  assert.match(taskArchiveMarkdown(value), /attachments omitted/);
});
for (const [name, mutate] of [
  ['native history', value => { value.history = []; }],
  ['credentials', value => { value.apiKey = 'secret'; }],
  ['permissions', value => { value.permissions = {mode: 'full'}; }],
  ['wrong kind', value => { value.kind = 'checkpoint'; }],
  ['unknown version', value => { value.version = 2; }],
  ['system instructions', value => { value.messages[0].role = 'system'; }],
  ['tool results', value => { value.messages[0].toolResults = []; }],
  ['oversize message', value => { value.messages[0].text = 'x'.repeat(100001); }],
  ['nonstring text', value => { value.messages[0].text = {}; }],
  ['native complete state', value => { value.messages[0].status = 'approved'; }],
  ['oversize queue', value => { value.queue = Array.from({length: 17}, () => ({text: 'x', attachmentsOmitted: 0})); }],
  ['queue aggregate', value => { value.queue = Array.from({length: 3}, () => ({text: 'x'.repeat(100000), attachmentsOmitted: 0})); }],
  ['queue permissions', value => { value.queue[0].permission = 'full'; }],
  ['invalid counters', value => { value.usage.tokens = -1; }],
  ['fractional counters', value => { value.usage.calls = 0.1; }],
  ['unknown usage fields', value => { value.usage.apiKey = 'hidden'; }],
  ['missing title', value => { delete value.title; }],
  ['empty queued message', value => { value.queue[0].text = ' '; }]
]) test('archive: rejects ' + name + ' atomically', () => {
  const {conversations} = fixture(), original = conversations.active;
  const value = archive(); mutate(value);
  assert.throws(() => conversations.importContext(value), /Invalid/);
  assert.equal(conversations.active, original); assert.equal(conversations.tasks.size, 1);
});
test('archive: rejects prototype-shaped fields and malformed JSON', () => {
  const encoded = JSON.stringify(archive());
  assert.throws(() => parseTaskArchive(encoded.replace('{', '{"__proto__":{"polluted":true},')), /Invalid/);
  assert.equal({}.polluted, undefined);
  assert.throws(() => parseTaskArchive('{private-invalid-json'), /not valid JSON/);
  assert.throws(() => parseTaskArchive(' '.repeat(TASK_ARCHIVE_MAX_BYTES + 1)), /4 MiB/);
  assert.throws(() => parseTaskArchive('😀'.repeat(TASK_ARCHIVE_MAX_BYTES / 4 + 1)), /4 MiB/);
});
test('archive: imports into a fresh task with no native conversation or inherited authority', () => {
  const {conversations, task} = fixture(), value = createTaskArchive(task);
  value.provider = 'google'; value.model = 'archived-model'; value.usage.tokens = 900000;
  const imported = conversations.importContext(value, {context: 'User reviewed this background.', includeQueue: true});
  assert.notEqual(imported, task); assert.equal(conversations.active, imported);
  assert.equal(imported.agent.provider, ''); assert.equal(imported.agent.model, ''); assert.equal(imported.authBinding, undefined);
  assert.equal(imported.permissions.mode, 'review'); assert.equal(imported.agent.permissionSession, null);
  assert.deepEqual(imported.agent.history, []); assert.deepEqual(imported.agent.usage, {requests: 0, tokens: 0, calls: 0});
  assert.equal(imported.agent.estimatedTokens, 0); assert.equal(imported.agent.pendingTurn, null);
  assert.match(imported.draft, /User reviewed this background/); assert.match(imported.draft, /New task:/);
  const queued = imported.followups.list()[0]; assert.equal(queued.text, value.queue[0].text);
  assert.deepEqual(queued.context, {projectId: 'current-project', epoch: 1}); assert.equal(queued.content, undefined);
  assert.equal(task.followups.list().length, 1);
});
test('archive: queue import is opt-in and rejects non-boolean consent', () => {
  const {conversations} = fixture();
  assert.equal(conversations.importContext(archive()).followups.list().length, 0);
  const original = conversations.active;
  assert.throws(() => conversations.importContext(archive(), {includeQueue: 'yes'}), /Explicitly choose/);
  assert.equal(conversations.active, original);
});
test('archive: rejected reviewed context and task bounds leave selection and source tasks intact', () => {
  const {conversations} = fixture(), original = conversations.active;
  for (const context of ['', ' ', 'x'.repeat(60001), {}]) assert.throws(() => conversations.importContext(archive(), {context}), /Reviewed context/);
  assert.equal(conversations.active, original); assert.equal(conversations.tasks.size, 1);
  conversations.maxTasks = 1;
  assert.throws(() => conversations.importContext(archive(), {includeQueue: true}), /Task limit/);
  assert.equal(conversations.active, original); assert.equal(original.followups.list().length, 1);
});
test('archive: busy tasks cannot import or be replaced through context import', () => {
  const {conversations, task} = fixture(); task.agent.busy = true;
  assert.throws(() => conversations.importContext(archive()), /Stop the running task/);
  assert.equal(conversations.active, task); assert.equal(conversations.tasks.size, 1);
});
test('archive: imported and exported values do not share mutable caller data', () => {
  const value = archive(), parsed = validateTaskArchive(value);
  parsed.messages[0].text = 'changed'; assert.notEqual(value.messages[0].text, 'changed');
  const {conversations} = fixture(), imported = conversations.importContext(value, {includeQueue: true});
  value.queue[0].text = 'changed'; assert.notEqual(imported.followups.list()[0].text, 'changed');
});
test('archive: reviewed context stays bounded and preserves incomplete-response warnings', () => {
  const value = archive(); value.messages = Array.from({length: 5}, (_, index) => ({role: 'assistant', text: String(index).repeat(100000), status: 'partial', truncated: false}));
  value.draft = 'D'.repeat(100000);
  for (const maximum of [1024, 58000, 60000]) {
    const context = taskArchiveContext(value, maximum);
    assert.ok(context.length <= maximum); assert.match(context, /not a live session/); assert.match(context, /omitted/);
  }
  assert.throws(() => taskArchiveContext(value, 1), /Invalid reviewed/);
});
test('archive: Markdown export contains public messages, incomplete flags, draft and queue only', () => {
  const value = archive(); value.messages[1].status = 'partial';
  const markdown = taskArchiveMarkdown(value);
  assert.match(markdown, /incomplete response/); assert.match(markdown, /Unsent follow-up/); assert.match(markdown, /Queued follow-up/);
  assert.match(markdown, /No executable checkpoint/);
});
