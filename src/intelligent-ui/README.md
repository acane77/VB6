# Intelligent UI IDE integration

This directory connects the reusable [`packages/intelligent-ui`](../../packages/intelligent-ui) compiler/runtime/renderers to VB6 Studio's tools, coding-agent threads and trusted approval UI.

- `studio.js` installs the host and Tools menu; `host-lifecycle.js` invalidates task/project lifetimes.
- `workbench-model.js` owns bounded in-memory documents and history; `workbench.js` implements editing, preview, diagnostics and file workflows.
- `gallery.js` owns revocable, revision-pinned MCP result views and app lifetimes.
- `thread.js`, `actions.js`, `action-context.js` and `extensions.js` keep generated output separate from trusted project/task capabilities.
- `adapter.js`, `resources.js`, `controls.js` and `examples.js` provide MCP tooling, reviewed resources, control adapters and examples.

See the [workbench guide](../../docs/INTELLIGENT-UI-WORKBENCH.md) for workflows, shortcuts, safety, limits and validation, and the [host/SDK guide](../../docs/INTELLIGENT-UI.md) for the existing protocol and deployment boundaries.
