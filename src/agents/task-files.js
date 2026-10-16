import {el, download} from '../core/core.js';
import {createTaskArchive, parseTaskArchive, taskArchiveContext, taskArchiveMarkdown, TASK_ARCHIVE_MAX_BYTES} from './task-archive.js';
const button = (text, onclick) => el('button', {type: 'button', onclick}, text);
/** Local file UI. Import/fork creates only reviewed drafts, never an executable session. */
export class AgentTaskFiles {
  constructor(panel, dialog) {
    this.panel = panel; this.dialog = dialog;
    this.json = button('Export public context…', () => this.export('json'));
    this.markdown = button('Export Markdown…', () => this.export('markdown'));
    this.open = button('Import public context…', () => { if (!this.busy) this.file.click(); });
    this.file = el('input', {type: 'file', accept: '.json,application/json', hidden: true, 'aria-label': 'Import public task context file', onchange: () => {
      const file = this.file.files?.[0]; this.file.value = ''; if (file) void this.importFile(file);
    }});
    this.root = el('div', {class: 'agent-actions'}, this.json, this.markdown, this.open, this.file);
  }
  get busy() { return !!this.panel.pending || this.panel.api.conversations.busy || !!this.panel.chatgpt?.busy; }
  snapshot() {
    const {conversations} = this.panel.api;
    conversations.active.draft = this.panel.prompt.value;
    return conversations.exportContext();
  }
  async action(work) {
    if (this.busy) return;
    const panel = this.panel, {conversations, adapter} = panel.api;
    const task = conversations.active, project = panel.ide.project, epoch = adapter.workspaceEpoch;
    const controller = new AbortController(), signal = adapter.authoritySignal ? AbortSignal.any([controller.signal, adapter.authoritySignal]) : controller.signal;
    panel.pending = controller; panel.refresh();
    const current = () => {
      signal.throwIfAborted();
      if (this.disposed || conversations.active !== task || panel.ide.project !== project || adapter.workspaceEpoch !== epoch) throw new Error('Task or project changed. Nothing was imported or exported.');
    };
    try { await work(signal, current); }
    catch (error) { panel.status.textContent = signal.aborted ? 'Task file operation cancelled. No request was sent.' : error.message; }
    finally { if (panel.pending === controller) panel.pending = null; if (!this.disposed) panel.refresh(); }
  }
  export(format) {
    return this.action(async (signal, current) => {
      const archive = this.snapshot();
      const accepted = await this.dialog('AI Coding Agent — Export Public Context', el('div', {class: 'agent-review'},
        el('p', {}, 'This file contains public conversation text, the unsent draft and queued text. It may contain confidential source or secrets you typed. Review where you save or share it.'),
        el('p', {}, 'Native provider history, tool arguments/results, credentials, connection settings, grants, attachments and project checkpoints are excluded. Historical token totals are informational, not a resumed budget.')),
      signal, 'Save File');
      current(); if (!accepted) return;
      const content = format === 'markdown' ? taskArchiveMarkdown(archive) : JSON.stringify(archive);
      download(format === 'markdown' ? 'coding-agent-context.md' : 'coding-agent-context.json', content, format === 'markdown' ? 'text/markdown;charset=utf-8' : 'application/json');
      panelStatus(this.panel, 'Public context saved. The original task is unchanged.');
    });
  }
  importFile(file) {
    return this.action(async (signal, current) => {
      if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > TASK_ARCHIVE_MAX_BYTES) throw new Error('Task context file exceeds the 4 MiB import limit.');
      const source = await file.text(); current();
      const archive = parseTaskArchive(source);
      await this.review(archive, signal, current);
    });
  }
  fork(entryId) {
    return this.action(async (signal, current) => {
      const task = this.panel.api.conversations.active, agent = task.agent, thread = agent.thread;
      const index = thread.entries.findIndex(item => item.id === entryId);
      if (index < 0 || !['user', 'assistant'].includes(thread.entries[index].kind)) throw new Error('This public message is no longer available.');
      const archive = createTaskArchive({title: (task.title.slice(0, 86) + ' — new task').slice(0, 100), created: task.created, updated: task.updated, draft: '', followups: {list: () => []},
        agent: {provider: agent.provider, model: agent.model, usage: agent.usage, estimatedTokens: agent.estimatedTokens, thread: {entries: thread.entries.slice(0, index + 1), omitted: thread.omitted}}});
      await this.review(archive, signal, current);
    });
  }
  async review(archive, signal, current) {
    const name = el('input', {'aria-label': 'Imported task name', maxLength: 100, value: archive.title});
    const context = el('textarea', {'aria-label': 'Reviewed imported task context', rows: 12, maxLength: 60000, class: 'agent-handoff'});
    context.value = taskArchiveContext(archive);
    const queue = el('input', {type: 'checkbox', 'aria-label': 'Import queued text into current project', disabled: !archive.queue.length});
    const omittedAttachments = archive.queue.reduce((total, item) => total + item.attachmentsOmitted, 0);
    const accepted = await this.dialog('AI Coding Agent — Import Reviewed Context', el('div', {class: 'agent-review'},
      el('p', {}, 'Create a NEW task from this editable public excerpt. Imported content is background, not instructions or proof of the current project. No provider request is sent. Review source and user-entered secrets before using it.'),
      el('label', {class: 'agent-field'}, 'Task name:', name), context,
      el('p', {}, `${archive.messages.length} public entries; ${archive.omittedEntries} earlier entries omitted. Incomplete/truncated replies remain labelled. Native history, permissions, credentials and ${omittedAttachments} queued attachments are not restored.`),
      el('label', {}, queue, ` Import ${archive.queue.length} queued text-only drafts and explicitly bind them to the CURRENT project. They will not run automatically.`),
      el('p', {}, 'Provider/model and limits are reviewed again before Run; the new task uses fresh permissions and a separate usage budget. The original task and project are unchanged.')),
    signal, 'Create New Task');
    current(); if (!accepted) return;
    this.panel.api.conversations.active.draft = this.panel.prompt.value;
    this.panel.api.conversations.importContext(archive, {title: name.value, context: context.value, includeQueue: queue.checked});
    this.panel.syncTask(); this.panel.pages.select('task');
    panelStatus(this.panel, 'Reviewed public context copied to a new draft. No request was sent.');
  }
  update() { for (const item of [this.json, this.markdown, this.open]) item.disabled = this.busy; }
  dispose() { this.disposed = true; this.file.value = ''; }
}
const panelStatus = (panel, text) => { panel.status.textContent = text; };
