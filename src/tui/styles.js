import {desktopPattern} from './texture.js';
import {TUI_WORKSPACE_CSS} from './workspace-css.js';
/** Paint-only selectors are attached to owned nodes rather than matching every
 * descendant of a document. Independent and nested ApplicationHosts can choose
 * different presentations without retheming one another's controls. */
export const TUI_CSS = `
[data-tui-root] { --dos-fg:#000; --dos-bg:#aaa; --dos-desk:#0000aa; --dos-hi:#ffff55; --dos-select:#00aaaa; --dos-border:#fff; --dos-line:16px; --dos-cell-width:8px; }
[data-tui-root][data-vb-dos="commander"] { --dos-fg:#ffff55; --dos-bg:#0000aa; --dos-select:#00aaaa; --dos-border:#55ffff; }
[data-tui-root][data-vb-dos="win31"] { --dos-desk:#00aaaa; --dos-select:#0000aa; --dos-border:#000; }
[data-tui-root][data-vb-dos="monochrome"] { --dos-fg:#aaa; --dos-bg:#000; --dos-desk:#000; --dos-select:#aaa; --dos-border:#aaa; }
[data-tui-root].vb-app-stage { background:var(--dos-desk)!important; }
[data-tui-shell] body { background:var(--dos-desk)!important; }
[data-tui-shell] .ide-shell { grid-template-rows:20px 21px auto minmax(0,1fr) auto 21px auto!important; --right-width:280px; --vb-face:var(--dos-bg); --vb-button:var(--dos-bg); --vb-text:var(--dos-fg); --vb-window:var(--dos-desk); --vb-window-text:var(--dos-hi); --vb-highlight:var(--dos-select); --vb-highlight-text:#fff; font:14px/var(--dos-line) monospace!important; color:var(--dos-fg)!important; background:var(--dos-bg)!important; }
[data-tui-shell] :is(.app-title,.ide-titlebar,.titlebar,.tool-caption,.dock-caption,.document-title,.ide-modal-title,.dialog-caption) { color:var(--dos-hi)!important; background:var(--dos-desk)!important; background-image:none!important; border-color:var(--dos-border)!important; border-radius:0!important; box-shadow:none!important; font-family:monospace!important; }
[data-tui-shell] :is(.ide-menubar,.menubar,.toolbar,.command-bar,.statusbar,.panel-toolbar,.debug-tabs,.document-tabs,.dock-tabs,.ide-menu,.ide-modal,.popup-menu,.dialog-tabs,.classic-tab-pages,.options-group) { color:var(--dos-fg)!important; background:var(--dos-bg)!important; background-image:none!important; border-radius:0!important; box-shadow:none!important; }
[data-tui-shell] :is(.dock-panel,.dock-group,.toolbox,.debug-dock,.runtime-window) { border-color:var(--dos-border)!important; border-radius:0!important; box-shadow:8px 8px #0008!important; }
[data-tui-shell] :is(.designer-scroll,.designer-plane,.document-views,.center-dock,.mdi-workspace,.mdi-client,.mdi-desktop,.workspace,.code-pane) { background:var(--dos-desk)!important; background-image:none!important; }
[data-tui-shell] :is(.property-grid,.property-table,.properties-panel,.project-panel,.project-tree,.toolbox,.toolbox-grid,.debug-body,.option-field) { color:var(--dos-fg)!important; background:var(--dos-bg)!important; }
[data-tui-shell] :is(.ide-shell,.ide-modal,.ide-menu) :is(button,select,input,textarea):not(.source-input):not(.xaml-input):not(.vb-form *):not(.vb-control *) { font-family:monospace!important; border-radius:0!important; color:var(--dos-fg)!important; background:var(--dos-bg)!important; box-shadow:none!important; text-shadow:none!important; transition:none!important; }
[data-tui-frame-target]>[data-tui-chrome-target]{z-index:3;}
.vb-tui-chrome-surface.vb-tui-frame-surface{z-index:1!important;left:var(--tui-frame-left,0px)!important;top:var(--tui-frame-top,0px)!important;}
[data-tui-anchor]{position:relative!important}
[data-tui-chrome-target]{color:transparent!important;background-image:none!important;text-shadow:none!important}
[data-tui-chrome-target]>:not(.vb-tui-chrome-surface){opacity:0!important}
.vb-tui-chrome-surface{position:absolute!important;left:0!important;top:0!important;right:auto!important;bottom:auto!important;pointer-events:none!important;image-rendering:pixelated;border:0!important;margin:0!important;padding:0!important;max-width:none!important;max-height:none!important;z-index:2!important}
[data-tui-source-paint]{background:var(--dos-desk)!important}
[data-tui-native-edit]>.vb-tui-chrome-surface{visibility:hidden!important}
[data-tui-native-edit]>:not(.vb-tui-chrome-surface){opacity:1!important}
[data-tui-native-edit]{color:var(--dos-fg)!important}
[data-tui-cell-editor] :is(input,textarea){font-family:monospace!important;font-size:calc(var(--dos-line)*.875)!important;line-height:var(--dos-line)!important;letter-spacing:var(--tui-native-spacing,0px)!important;tab-size:8!important;caret-color:transparent!important}
[data-tui-cell-editor][data-tui-editing] :is(input,textarea){caret-color:var(--dos-fg)!important}
[data-tui-graphics]>.graphics-surface{opacity:0!important}
:is(.vb-form-content,.vb-picture)>.vb-tui-graphics-surface{z-index:-1!important}
/* Border widths, padding and client rectangles remain the canonical renderer's. */
[data-tui-chrome] { border-color:var(--dos-border)!important; border-radius:0!important; font-family:monospace!important; }
[data-tui-chrome].vb-form > .vb-form-title { color:var(--dos-hi)!important; background:var(--dos-desk)!important; background-image:none!important; border-radius:0!important; box-shadow:none!important; }
[data-tui-chrome].vb-form > .vb-form-content { background-color:var(--dos-bg)!important; }
[data-tui-chrome].vb-form > .vb-form-menu { background:var(--dos-bg)!important; color:var(--dos-fg)!important; }
[data-tui-chrome].vb-frame { background:var(--dos-bg)!important; }
[data-tui-chrome].vb-frame > .vb-frame-legend { font-family:monospace!important; background:var(--dos-bg)!important; color:var(--dos-fg)!important; }
[data-tui-paint=cells] { background:var(--dos-bg)!important; background-image:none!important; box-shadow:none!important; border-color:transparent!important; border-radius:0!important; color:transparent!important; }
[data-tui-paint=cells] > :not(.vb-tui-surface) { opacity:0!important; }
[data-tui-paint=cells] > select.vb-list { font:calc(var(--dos-line)*.875)/var(--dos-line) monospace!important; }
[data-tui-paint=cells] > select.vb-list > option { min-height:var(--dos-line); line-height:var(--dos-line); }
.vb-tui-surface { position:absolute!important; left:0!important; top:0!important; right:auto!important; bottom:auto!important; pointer-events:none!important; image-rendering:pixelated; z-index:1!important; border:0!important; margin:0!important; padding:0!important; max-width:none!important; max-height:none!important; }
[data-tui-editing] > :not(.vb-tui-surface) { opacity:1!important; }
[data-tui-editing] > .vb-tui-surface { visibility:hidden!important; }
[data-tui-editing] { color:var(--dos-fg)!important; }
[data-tui-editing] :is(input,textarea,[contenteditable]) { color:var(--dos-fg)!important; background:var(--dos-bg)!important; caret-color:var(--dos-fg)!important; }
[data-tui-shell] .toolbox-grid { grid-template-columns:1fr!important; gap:0!important; }
[data-tui-shell] .toolbox-grid button { width:100%!important; height:var(--dos-line)!important; min-height:var(--dos-line)!important; text-align:left!important; overflow:hidden; white-space:nowrap; padding:0 2px!important; }
[data-tui-shell] .toolbox-grid button>* { display:none!important; }
[data-tui-shell] .toolbox-grid button::after { content:attr(data-control-type); font:12px/var(--dos-line) monospace; }
[data-tui-shell] .toolbar .tool-button { width:auto!important; min-width:32px!important; padding-inline:4px!important; }
[data-tui-shell] .toolbar .tool-button>:is(svg,.icon) { display:none!important; }
[data-tui-shell] .toolbar .tool-button::after { content:attr(data-command); font:12px/var(--dos-line) monospace; }
[data-tui-shell] .toolbar { overflow-x:auto!important; }
[data-tui-shell] .designer-selection { border-color:var(--dos-hi)!important; }
[data-tui-shell] .selection-handle { background:var(--dos-hi)!important; border-color:#000!important; border-radius:0!important; }
[data-tui-shell] .ide-shell:not(.command-bar-shell) { grid-template-rows:20px 21px 30px minmax(0,1fr) 21px auto!important; }
[data-tui-shell] .ide-shell:not(.command-bar-shell) .dos-function-bar { grid-row:6; }
[data-tui-shell] .dos-function-bar { grid-row:7; display:flex; flex-wrap:wrap; gap:0; min-height:24px; color:var(--dos-hi); background:var(--dos-desk); font:14px/20px monospace; }
[data-tui-shell] .dos-function-bar button { flex:1; border:0; color:var(--dos-fg)!important; background:var(--dos-select)!important; min-width:80px; }
[data-tui-shell] .dos-function-bar kbd { color:var(--dos-hi); background:var(--dos-desk); padding:0 5px; margin-right:4px; }
@media(forced-colors:active) { [data-tui-chrome-target]{color:CanvasText!important;} [data-tui-chrome-target]>:not(.vb-tui-chrome-surface),[data-tui-graphics]>.graphics-surface{opacity:1!important;} .vb-tui-chrome-surface{display:none!important;} [data-tui-paint=cells]{color:CanvasText!important;background:Canvas!important;} [data-tui-paint=cells]>:not(.vb-tui-surface){opacity:1!important;} .vb-tui-surface{display:none!important;} }
@media print { [data-tui-chrome-target]{color:#000!important;} [data-tui-chrome-target]>:not(.vb-tui-chrome-surface),[data-tui-graphics]>.graphics-surface{opacity:1!important;} .vb-tui-chrome-surface{display:none!important;} [data-tui-paint=cells]{color:#000!important;background:#fff!important;} .vb-tui-surface { display:none!important; } [data-tui-paint=cells]>:not(.vb-tui-surface){opacity:1!important;} }
`;

const sheets = new WeakMap();
/** Each live renderer owns a lease; a pre-existing stylesheet is never removed. */
export function retainTUIStyle(document) {
  let record = sheets.get(document);
  if (!record) {
    let style = document.getElementById('vb6-tui-style');
    const owned = !style;
    if (!style) {
      style = document.createElement('style');
      style.id = 'vb6-tui-style';
      style.textContent = TUI_CSS + TUI_WORKSPACE_CSS;
      document.head.append(style);
    }
    sheets.set(document, record = {style, owned, references: 0});
  }
  record.references++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--record.references === 0) {
      if (record.owned) record.style.remove();
      sheets.delete(document);
    }
  };
}

export function applyTUIStyle(root, settings) {
  root.setAttribute('data-vb-dos', settings.profile);
  root.style.setProperty('--dos-line', settings.cellHeight + 'px');
  root.style.setProperty('--dos-cell-width', settings.cellWidth + 'px');
  root.style.setProperty('--tui-desktop-pattern', desktopPattern(settings.profile));
}
