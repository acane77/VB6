# Intelligent UI workbench

Open **Tools → Intelligent UI**. The workbench edits the existing bounded DIL interpreter's source; it does not execute arbitrary JavaScript in the IDE, replace the coding agent's permission model, or send prompts automatically.

## Documents, editing and files

Each document owns its title, DIL source, JSON data, undo/redo history and bounded local preview state. New Document and Load Example create separate drafts; they never silently overwrite an existing draft. Duplicate Document creates independent source/data/history. The document selector marks unsaved drafts with a dot. Source and JSON use ordinary keyboard-accessible text editors, not a replacement IDE language service.

Undo and Redo include source, JSON and title changes. Typing is coalesced until a pause, editor blur or explicit transaction. Replace All is a single undo transaction. Search is literal and wraps; it does not interpret regular expressions, replacement-dollar tokens or code. Expanding replacements are rejected before allocating oversized output.

**Save source** downloads plain `.dil`. **Export document** downloads version-one `.iui.json`, containing only `format`, `version`, `title`, `source` and `dataText`. **Import document** accepts that exact JSON schema or plain `.dil`/`.txt`; validation is atomic. Invalid preview JSON is retained as editable text, including through an export/import roundtrip. It must be corrected before rendering.

Files never contain credentials, permissions, app configuration, task identity, tool ownership, reviewed model context, live references or interpreter state. The browser reports download initiation rather than confirmed disk persistence: exporting does not silently mark a draft safe to discard. An unchanged imported document is clean; other unsaved documents require an explicit discard confirmation. Edits made while confirmation is pending invalidate the confirmation.

Drafts survive closing and reopening this tool window **within the same IDE session**. They are not placed in localStorage, autosave, provider history or project files. Reloading the browser loses in-memory drafts. Export work that should survive a browser reload. Loading another VB6 project retains editable source/JSON but discards cached interpreter state; it grants no authority to the new project.

## Preview and diagnostics

Live Preview coalesces source edits; unchecking it leaves the last render until Render or Ctrl/Cmd+Enter. JSON must be an object. Include Current Project injects a fresh trusted project snapshot as `data.project` for each render; uncheck it to use only the JSON editor. Capture Project in JSON creates an explicit editable copy and disables automatic project injection.

State is retained across document selection, panel closure and renderer toggles. Reset Preview State starts that document's state again. Phone, tablet and desktop presets use 375, 768 and 1024 CSS-pixel preview frames; Responsive follows the panel's available width. The workbench controls its frame viewport explicitly so inner padding does not override the selected breakpoint width.

Malformed input and evaluation failures retain the last valid UI. That old preview cannot authorize effects for an edited draft. Diagnostics include navigable line/column positions using the compiler's UTF-16 offsets, and the compiled-program inspector displays inert JSON. The searchable component catalog is read from the actual runtime catalog; its insertions are editable scaffolds, not capability grants. Components requiring properties can report diagnostics until those properties are supplied.

Keyboard commands: Ctrl/Cmd+Enter renders; Ctrl/Cmd+S exports a document; Ctrl/Cmd+F focuses literal search; Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z and Ctrl/Cmd+Y operate on document history while an editor is focused. Tab retains standard browser focus navigation.

## Live MCP and agent results

The gallery retains caller/adapter isolation. Filter by title, owner or document ID. Open Data and Provenance to inspect the inert associated values. Edit a Local Copy creates a draft without modifying the caller's original result. Close UI Document uses the current owner and expected revision; a local copy remains independent.

Only the first four added cards open automatically. Collapsing or filtering a card releases its Worker, renderer and MCP App while preserving bounded declarative state; it does not close the caller's document. Reopening restores that state. Source/revision changes, revocation, panel closure and cancellation invalidate pending app openings. Obsolete async resource discovery cannot create a late iframe.

MCP App hosting, reviewed downloads, rich messages/context, trusted reference providers and separate-origin AppBlocks use the existing host capabilities described in [INTELLIGENT-UI.md](INTELLIGENT-UI.md). Arbitrary HTML/JavaScript still needs the explicitly configured separate-origin sandbox and exact-source approval. No public server, provider key or reference service is implicitly configured.

## Lifetimes and limits

Every surface action receives an AbortSignal. Source/data replacement, restart and disposal abort outstanding actions and release their listeners. A replacement source is not blocked by an old host promise that ignores cancellation; stale event batches cannot execute remaining actions against a new generation. Committed Worker render deltas are consumed in order even after a source replacement, because subsequent diffs are relative to that committed tree; only obsolete host effects are discarded. New interactions cannot invoke the old document’s handlers while a source update is pending or in flight. Changing task, thread, project session or the enable setting also invalidates ownership. Switching away and back cannot revive an old review.

Disabling Interactive Agent UI removes workbench/thread/gallery renderers and closes apps. Editing/export remain available. Reviewed image/AppBlock dialogs are cancelled when their owning render nodes disappear. Sharing revocation and revision checks remain in place; none of these changes bypasses provider or IDE permission confirmation.

The workbench admits at most 16 drafts, 100,000 source characters, 100,000 JSON-editor characters, 1 MB input files, 64 history entries with a 2 MB serialized history budget per draft, and a 4 MB aggregate serialized draft budget. Preview snapshots are bounded to 128,000 serialized units. The interpreter's separate source, steps, nesting, text, data and Worker limits still apply. No claim is made that every existing VB6 control or arbitrary external app is supported by DIL.

## Validation

`node --test tests/intelligent-ui*.test.mjs` covers the runtime and host contracts, including action lifetimes, snapshot ownership, draft limits, undo/redo, file validation and stale-consent rejection.

`python tools/intelligent-ui-workbench-tests.py` drives real inputs against HTTP modules, HTTP standalone and file standalone. It is owned by the existing Intelligent UI CI suite and runs in Chromium, Firefox and WebKit alongside the existing package/IDE and two-origin host suites. The explicitly requested `--opaque` mode is only a local DOM/Worker diagnostic; it is not a substitute for HTTP, file or separate-origin acceptance. The Worker ordering regression delays delivery of a real Worker result across an actual source edit, verifying that the original interaction is rendered once rather than replayed or lost. Tests use local fixture data and no paid provider request.
