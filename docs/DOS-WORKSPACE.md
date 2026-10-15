# DOS / TUI workspace

Choose **Tools > Options > General > Workspace mode > DOS / TUI**, or **View > DOS / TUI Workspace**. **Tools > DOS Workspace Options** configures the palette and cell metrics independently. Classic remains the default. Options are staged until OK; Cancel does not change the active mode. The Figma, classic and DOS presentations are mutually exclusive and use the same project.

## Architecture

`src/tui/cells.js` is a DOM-independent, bounded character-cell framebuffer with Unicode scalar glyphs, packed 4-bit foreground/background attributes, clip stacks, mnemonic handling, overlap-safe blits, detached snapshots and per-row damage. `CanvasCellRenderer` consumes only damaged spans and uses a bounded device-scaled glyph cache. The EGA palette is fixed to 16 colors. No font files, DOS binaries or vendor assets are shipped.

`src/tui/controls.js` is the replaceable paint adapter registry. `src/tui/dom.js` reads the existing materialized BrowserControl DOM into paint snapshots, composes a back buffer and diffs it into the retained front buffer. There is no second form model, layout solver, event dispatcher, binding engine or undo stack. Mutation, resize, input and font notifications coalesce at animation-frame boundaries. Hidden documents suspend scheduling. Removed controls, closed documents and disabled workspaces release their observers, listeners, canvases and caches.

Painting is inert: canvases are aria-hidden and pointer-events:none. The original DOM remains the keyboard, pointer and accessibility target. Text and rich-text editing expose the original editor while focused, retaining the browser caret, IME, selection, clipboard and native pickers. No synthesized key/click events or weakened iframe sandbox are required. Forced-colors and print expose the original HTML controls.

The shell uses scoped TUI chrome and text-based command/toolbox buttons on the existing docking, menu, command, property and editor infrastructure. Authored twips, geometry, auto-layout, anchors, VB6 source, control identity, application theme and history are not changed by selecting a workspace. Cell metrics affect paint resolution, not project geometry. Device-pixel-ratio handling is presentation-only.

## Paint coverage

All 40 built-in toolbox controls have explicit capabilities, in addition to forms. There are 32 cell-painted adapters: Label, TextBox, CommandButton, CheckBox, OptionButton, ComboBox, ListBox, HScrollBar, VScrollBar, Timer, DriveListBox, DirListBox, FileListBox, Shape, Line, Data, TreeView, ListView, ProgressBar, Slider, StatusBar, Toolbar, RichTextBox, MSFlexGrid, MSHFlexGrid, DataGrid, DTPicker, MonthView, UpDown, ImageList, CommonDialog and Adodc.

Form/MDIForm, Frame, PictureBox, TabStrip and SSTab retain their container structure and receive scoped chrome. Image, MSChart, OLE and WebBrowser retain their native graphical/interactive surfaces. Unregistered custom/OCX controls also remain native, rather than silently losing functionality. These are explicit fallback capabilities, not assertions that every control is rendered entirely as text.

## Runtime and extension APIs

F5 and design-mode Immediate pass through the existing trusted runtime-document loader. DOS mode contributes only validated palette/cell attributes on the runtime HTML root. The normally bundled runtime mounts the presentation in its own document, including opaque-origin sandboxed iframes. Native hosts still authorize the final document URL/CSP; loader refusal never falls back to srcdoc.

```js
await vb6Studio.dosMode.configure({mode: 'dos', profile: 'commander', cellWidth: 8, cellHeight: 16});
const cells = vb6Studio.dosMode.snapshot();
await vb6Studio.dosMode.configure({mode: 'classic'});
```

Palettes are `turbo`, `commander`, `win31`, and `monochrome`. Third-party painters register through `vb6Studio.dosMode.registry.register(type, painter, {capability: 'cells'})`; registration returns an idempotent unregister function. Register before mounting that control. Paint snapshots are display data, not writable VB6 objects. `VB6Runtime.mountApplication(project, container, {presentation: {mode: 'dos', profile: 'turbo'}})` selects TUI presentation for an embedding host. Workspace preferences are not silently written into standalone exports or project files.

## Verification and current fidelity boundary

Run `node --test tests/tui-*.test.mjs`, `npm run build`, and `python tools/dos-browser-tests.py`. The browser suite belongs to the existing `integration-authoring` CI group and runs on Chromium, Firefox and WebKit; it checks the all-control fixture, mode transitions, unchanged model/control identity, inspector/undo, cancellation, preview sandbox, VB6 button events, native editing and disposal. Reports and screenshots are evidence of the current renderer, not vendor reference goldens. `VB6_ORIGIN=file` checks the standalone file; `VB6_ORIGIN=memory` permits offline DOM/interaction qualification without navigation or origin storage.

This implementation is not an MS-DOS/FreeDOS emulator, Windows 3.1 window manager, or binary clone of Norton Commander/Turbo Vision. The profile names describe design references. The shell is themed retained HTML, not a single hardware text-mode screen. Glyphs use the browser's local monospace rasterizer rather than an exact IBM VGA ROM atlas. Rich/native islands remain, and active input editing uses the original editor. Native reference capture, exact glyph/cell goldens, wholly cell-rendered shell/container chrome and complete graphical-to-text projection are outstanding for the requested 100% visual-parity target. No exact native-pixel parity certification is claimed.
