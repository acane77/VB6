/** Scoped presentation only: no authored geometry or VB6 properties are changed. */
export const TUI_CSS = `
:root[data-vb-dos] { color-scheme:dark; --dos-fg:#000; --dos-bg:#aaa; --dos-desk:#0000aa; --dos-hi:#ffff55; --dos-select:#00aaaa; --dos-border:#fff; --dos-line:16px; }
:root[data-vb-dos="commander"] { --dos-fg:#ffff55; --dos-bg:#0000aa; --dos-select:#00aaaa; --dos-border:#55ffff; }
:root[data-vb-dos="win31"] { color-scheme:light; --dos-desk:#00aaaa; --dos-select:#0000aa; --dos-border:#000; }
:root[data-vb-dos="monochrome"] { --dos-fg:#aaa; --dos-bg:#000; --dos-desk:#000; --dos-select:#aaa; --dos-border:#aaa; }
[data-vb-dos] body { background:var(--dos-desk)!important; }
[data-vb-dos] .ide-shell { grid-template-rows:20px 21px auto minmax(0,1fr) auto 21px auto!important; --right-width:280px; --vb-face:var(--dos-bg); --vb-button:var(--dos-bg); --vb-text:var(--dos-fg); --vb-window:var(--dos-desk); --vb-window-text:var(--dos-hi); --vb-highlight:var(--dos-select); --vb-highlight-text:#fff; font:14px/var(--dos-line) monospace!important; color:var(--dos-fg)!important; background:var(--dos-bg)!important; }
[data-vb-dos] :is(.ide-shell,.ide-modal,.ide-menu,.vb-form,.vb-menu-popup) :is(button,input,textarea,select,.tool-caption,.dock-caption,.property-table,.project-tree,.code-editor) { font-family:monospace!important; border-radius:0!important; text-shadow:none!important; transition:none!important; }
[data-vb-dos] :is(.app-title,.ide-titlebar,.titlebar,.tool-caption,.dock-caption,.document-title,.vb-form-title,.ide-modal-title,.dialog-caption) { color:var(--dos-hi)!important; background:var(--dos-desk)!important; background-image:none!important; border:1px solid var(--dos-border)!important; border-radius:0!important; box-shadow:none!important; }
[data-vb-dos] :is(.ide-menubar,.menubar,.toolbar,.command-bar,.statusbar,.panel-toolbar,.debug-tabs,.document-tabs,.dock-tabs,.vb-form-menu,.vb-menu-popup,.ide-menu,.ide-modal,.vb-dialog,.popup-menu,.dialog-tabs,.classic-tab-pages,.options-group) { color:var(--dos-fg)!important; background:var(--dos-bg)!important; background-image:none!important; border-radius:0!important; box-shadow:none!important; }
[data-vb-dos] :is(.dock-panel,.dock-group,.toolbox,.debug-dock,.runtime-window,.vb-form) { border:3px double var(--dos-border)!important; border-radius:0!important; box-shadow:8px 8px #0008!important; }
[data-vb-dos] :is(.designer-scroll,.designer-plane,.document-views,.center-dock,.mdi-workspace,.mdi-client,.mdi-desktop,.workspace,.code-pane) { background:var(--dos-desk)!important; background-image:none!important; }
[data-vb-dos] :is(.property-grid,.property-table,.properties-panel,.project-panel,.project-tree,.toolbox,.toolbox-grid,.debug-body,.figma-inspector,.option-field) { color:var(--dos-fg)!important; background:var(--dos-bg)!important; }
[data-vb-dos] .ide-shell :is(button,select,input,textarea),[data-vb-dos] .ide-modal :is(button,select,input,textarea) { border-radius:0!important; color:var(--dos-fg)!important; background:var(--dos-bg)!important; box-shadow:none!important; }
[data-vb-dos] :is(button:focus-visible,[role=treeitem]:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible) { outline:2px dashed var(--dos-hi)!important; outline-offset:-2px; }
[data-vb-dos] :is(.selected,.active,[aria-selected=true]) { --vb-highlight:var(--dos-select); }
[data-vb-dos] :is(.vb-form,.vb-control) { font-family:monospace!important; border-radius:0!important; }
[data-vb-dos] .vb-form-content { background-color:var(--dos-bg)!important; }
[data-vb-dos] .vb-frame { border:3px double var(--dos-border)!important; background:var(--dos-bg)!important; }
[data-vb-dos] .vb-frame-legend { font-family:monospace!important; background:var(--dos-bg)!important; color:var(--dos-fg)!important; }
[data-vb-dos] [data-tui-paint=cells] { background:var(--dos-bg)!important; background-image:none!important; box-shadow:none!important; border-color:transparent!important; color:transparent!important; }
[data-vb-dos] [data-tui-paint=cells] > :not(.vb-tui-surface) { opacity:0!important; }
[data-vb-dos] .vb-tui-surface { position:absolute!important; inset:0!important; width:100%!important; height:100%!important; pointer-events:none!important; image-rendering:pixelated; z-index:2147483000!important; border:0!important; margin:0!important; padding:0!important; }
[data-vb-dos] [data-tui-editing] > :not(.vb-tui-surface) { opacity:1!important; }
[data-vb-dos] [data-tui-editing] > .vb-tui-surface { visibility:hidden!important; }
[data-vb-dos] [data-tui-editing] :is(input,textarea,[contenteditable]) { font:14px/16px monospace!important; color:var(--dos-fg)!important; background:var(--dos-bg)!important; caret-color:var(--dos-fg)!important; }
[data-vb-dos] .toolbox-grid { grid-template-columns:1fr!important; gap:0!important; }
[data-vb-dos] .toolbox-grid button { width:100%!important; height:var(--dos-line)!important; min-height:var(--dos-line)!important; text-align:left!important; overflow:hidden; white-space:nowrap; padding:0 2px!important; }
[data-vb-dos] .toolbox-grid button>:is(svg,.icon) { display:none!important; }
[data-vb-dos] .toolbox-grid button::after { content:attr(data-control-type); font:12px/var(--dos-line) monospace; }
[data-vb-dos] .toolbar .tool-button { width:auto!important; min-width:32px!important; padding-inline:4px!important; }
[data-vb-dos] .toolbar .tool-button>:is(svg,.icon) { display:none!important; }
[data-vb-dos] .toolbar .tool-button::after { content:attr(data-command); font:12px/var(--dos-line) monospace; }
[data-vb-dos] .toolbar { overflow-x:auto!important; }
[data-vb-dos] .designer-selection { border:1px dashed var(--dos-hi)!important; }
[data-vb-dos] .selection-handle { background:var(--dos-hi)!important; border-color:#000!important; border-radius:0!important; }
[data-vb-dos] .ide-shell:not(.command-bar-shell) { grid-template-rows:20px 21px 30px minmax(0,1fr) 21px auto!important; }
[data-vb-dos] .ide-shell:not(.command-bar-shell) .dos-function-bar { grid-row:6; }
[data-vb-dos] .dos-function-bar { grid-row:7; display:flex; flex-wrap:wrap; gap:0; min-height:24px; color:#fff; background:#0000aa; font:14px/20px monospace; }
[data-vb-dos] .dos-function-bar button { flex:1; border:0; color:#000!important; background:#00aaaa!important; min-width:80px; }
[data-vb-dos] .dos-function-bar kbd { color:#fff; background:#0000aa; padding:0 5px; margin-right:4px; }
@media(forced-colors:active) { [data-vb-dos] [data-tui-paint=cells]{color:CanvasText!important;background:Canvas!important;} [data-vb-dos] [data-tui-paint=cells]>:not(.vb-tui-surface){opacity:1!important;} [data-vb-dos] .vb-tui-surface{display:none!important;} }
@media print { [data-vb-dos] [data-tui-paint=cells]{color:#000!important;background:#fff!important;} [data-vb-dos] .vb-tui-surface { display:none!important; } [data-vb-dos] [data-tui-paint=cells]>:not(.vb-tui-surface){opacity:1!important;} }
`;
export function applyTUIStyle(document,settings) {
  let style=document.getElementById('vb6-tui-style');if(!style){style=document.createElement('style');style.id='vb6-tui-style';style.textContent=TUI_CSS;document.head.append(style);}
  document.documentElement.setAttribute('data-vb-dos',settings.profile);document.documentElement.style.setProperty('--dos-line',settings.cellHeight+'px');
}
