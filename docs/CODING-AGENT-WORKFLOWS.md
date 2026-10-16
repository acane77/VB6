# Coding-agent task workflows

This guide describes the local browser agent workflow. It complements [setup](coding-agents.md), [permissions](CODING-AGENT-PERMISSIONS.md), [recovery](CODING-AGENT-RECOVERY.md), [threads and budgets](CODING-AGENT-THREADS.md), and [change review](CODING-AGENT-WORKBENCH.md). Classic VB6 chrome, docking and selected themes remain in use.

## Pause, Continue and Stop

Choose **Pause** during a run to request a cooperative boundary. The current generation, permission interaction or IDE operation can finish; Pause does not interrupt a write halfway through. A response is fully validated before any proposed operations become resumable. Once a tool has returned, its bounded result is retained, and later operations remain unexecuted. The UI displays that Pause is requested until the boundary is reached. Choose **Stop** for immediate cancellation instead.

**Continue** shows how many results are already confirmed and how many operations remain. It reuses the original validated response and original arguments; it does not ask the provider to recreate a deferred batch or run the confirmed prefix again. Each resumed run rechecks permissions, workspace identity/epoch, cumulative budget, remaining call allowance, and the bytes of the confirmed prefix before reserving output space. Full IDE access requires another acknowledgement. Read-only/deny rules and host constraints still apply.

If authority reopening or project edits invalidate an original revision, the operation fails as stale. The model must read the current revision and make a new proposal. The runner never rewrites `expectedRevision`. A completed batch is committed to native history atomically, preserving opaque provider signatures; Pause then prevents the next paid request. A final answer without tools is already complete, so it need not remain paused.

Stop overrides Pause. Stop, denial, workspace replacement or an unconfirmed interruption cannot create a replayable partially executed batch. A pending request interrupted by a permitted generation retry remains subject to its original Retry-After deadline. Pause during backoff interrupts waiting, not the deadline. Existing `/compact`, limit recovery and output-cap handling remain available. No completed edit is undone by pausing or by starting a new task.

## Search and message-prefix branching

The conversation search bar performs literal, case-insensitive search; punctuation is not a regular expression. Choose **All entries**, **Messages**, **Tool details** or **Status**. Ctrl/Cmd+F within the conversation focuses search, Enter/Shift+Enter moves to the next/previous matching entry, and Escape clears the search. Embedded controls that handle their own keyboard event retain it; composition events are not intercepted. Counts refer to matching entries, not every repeated word within an entry.

Search covers retained public text and bounded tool previews, including collapsed details. It never examines opaque native histories or hidden reasoning. Selecting a match reveals its bounded DOM window, opens the relevant tool details and freezes following. **Jump to latest** restores following. Search, match selection, expanded details and reading position are task-local in-memory state, retained when the panel is reopened.

The initial 150-entry DOM window does not grow merely because a match is old. The model remains bounded to 1,200 entries/four million accounted characters. A 256-character query has an incremental per-entry/revision cache: streaming one new entry does not rescan every old field, and pruned entries are released. Search is not a promise to recover previously omitted messages.

**New task from here…** on a user or assistant message opens a review dialog for the public prefix through that message. Later replies, the unsent composer draft, queued requests, raw tool calls/results, native history and grants are excluded. Edit the context and name before creating the new draft. This is a new conversation, not a Git branch, project rollback, provider-native fork or replay of the old task. It never sends automatically.

## Public-context files

Under **Tasks**, choose **Export public context…**, **Export Markdown…** or **Import public context…**. Export requires a warning confirmation: public text can contain confidential source or secrets the user/model wrote. The exporter excludes credential fields; it does not pretend to redact secrets embedded in public prose.

JSON is a strict versioned public-context format, not a session checkpoint. It contains the task title, informational timestamps/provider/model, historical usage totals, bounded user/assistant/question/plan messages, the unsent draft, and queued text with an omitted-attachment count. Partial responses and truncation are labelled. Markdown is a human-readable export; it is not an import format.

Excluded by schema: native history/reasoning/signatures, tool arguments/results, credentials, connection endpoints/settings, permission grants/rules, executable UI references, binary attachments, change-review baselines, project snapshots, and runtime/Undo state. Unknown fields, including attempts to smuggle authority through extra nested keys, are rejected atomically.

The JSON file is capped at **4 MiB UTF-8**, checked before reading an oversized browser File and again before parsing. It permits at most 200 public messages/500,000 message characters, 100,000 characters per message/draft, and 16 queued messages/200,000 queued characters. Export explicitly omits oldest public messages if JSON escaping pushes it beyond the byte cap; unsent draft and queued text are not silently discarded. These are safety ceilings, not durable-storage guarantees.

Import opens an editable excerpt (up to 60,000 characters) and a name. Creating the task starts a fresh native history, fresh permissions and a separate usage budget; old totals are informational only. Historical provider/model labels do not replace connection settings. An unchecked opt-in permits copying queued text-only drafts, explicitly binding them to the current workspace. They do not dispatch automatically. Review the provider, model, new task and permissions before Run.

File selection, asynchronous reads and review are cancelled by Stop, panel disposal or workspace replacement. Task/project/epoch identity is checked again after asynchronous work. Cancel, invalid JSON, schema errors, size errors or task-capacity errors cannot partly create a new task. The source conversation and live project are unchanged. Tasks remain memory-only unless the user explicitly exports public context; this does not add background browser persistence.

## Provider and model-catalog boundaries

Responses are structurally validated before tool execution. Malformed packet types, invalid completed items, duplicate/invalid call IDs, invalid names/arguments, inconsistent Anthropic stop reasons, writes after terminal completion, incompatible content-block deltas and ambiguous Google candidates are rejected. A parser failure is sticky, even if a transport callback accidentally catches it. Completed native values are defensively captured so later transport mutations cannot replace them. Harmless usage-only trailers remain supported.

Opaque fields remain opaque, rather than being reconstructed or rejected just because they are unfamiliar. Unknown server-side continuation modes are not silently treated as successful final client-tool batches. In particular, Google `CONTINUATION` and Anthropic server-tool `pause_turn` are not implemented as autonomous server-tool sessions here. Provider-native tools, arbitrary external MCP servers and host shell execution are not added by this work.

Model discovery validates IDs and page envelopes, preserves account-specific ChatGPT labels/order, filters Google's generation-capable entries and rejects cursor cycles, malformed cursors, duplicate response packets or incomplete pagination. At most 20 pages and 10,000 total records are accepted. Reaching a bound with another page outstanding is an error, not a misleading partial success. Old UI choices remain unchanged on failure. Cancellation and errors do not publish a partial catalog. The normal manual-model entry remains available; catalog listing is not proof of entitlement or inference compatibility.

Primary protocol references checked 2026-10-15:

- [OpenAI Responses streaming events](https://developers.openai.com/api/reference/resources/responses/streaming-events).
- [Anthropic streaming messages](https://platform.claude.com/docs/en/build-with-claude/streaming) and [stop reasons](https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons).
- [Google GenerateContent](https://ai.google.dev/api/generate-content) and [Models](https://ai.google.dev/api/models).

## Validation and remaining qualification

Run:

```sh
npm run build
node --test tests/coding-agents*.test.mjs tests/agent-relay.test.mjs tests/chatgpt-*.test.mjs
python tools/ci/check.py
python tools/ci/test_check.py
python tools/coding-agents-browser-tests.py
```

The existing canonical Validate workflow owns a dedicated exhaustive coding-agent matrix: Chromium/Firefox/WebKit × HTTP modules/HTTP standalone/file standalone. Each job executes all original and new workflow cases, uploads its evidence and reaches the required final `test` gate. CI rejects `--opaque` and case filtering. Local `--case NAME` is useful for focused debugging; `--opaque` is only an explicitly labelled inline-UI fallback when a managed browser blocks navigation, never proof of real-origin behavior.

New deterministic cases cover three-provider confirmed-prefix continuation, repeated pauses, real edit/Undo and stale revisions, Stop priority, stricter resumed byte budgets, archive bounds and authority exclusion, literal/incremental search, malformed provider envelopes, closed blocks, late content, opaque snapshots and bounded catalog pagination. Browser cases use real controls and the actual IDE adapter with synthetic provider responses, including pause/resume, search/reopen/pruning, downloads, file chooser imports, cancel/reload and reviewed prefix branching.

No test in this suite spends API credit. Live API/ChatGPT entitlement, account-specific quotas, provider-model quality, real rate limits and billing remain separate manual qualification. No claim is made that this task adds every provider-hosted agent feature, arbitrary host execution, durable native-session migration, project branching or complete VB6 runtime compatibility.
