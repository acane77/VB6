import {sourceCodeActions,applySourceCodeAction} from './source-actions.js';
import {showMenu} from '../ide/ui.js';
import {hasUIDialog} from '../core/window-context.js';

/** Classic and enhanced panes use the same source actions and project history.
 * Menu callbacks retain a snapshot and refuse a stale or read-only document. */
export function installSourceCodeActions(ide) {
  const surface=editor=>ide.advancedEditor?.runtime?.surfaces.get(editor);
  const composing=editor=>editor.composing||surface(editor)?.composing;
  ide.sourceCodeActions=()=>{
    const editor=ide.editor,module=ide.activeModule;
    if(!module||ide.activeDoc?.view!=='code'||editor.readOnly||composing(editor)||!['design','paused'].includes(ide.runState))return [];
    const range=editor.selectionBounds(),live={...module,code:editor.text};
    return sourceCodeActions(live,editor.intelligence.index(live,ide.project),range.start,range.end,{tabWidth:ide.project.settings.tabWidth||4});
  };
  ide.applySourceCodeAction=(action,snapshot)=>{
    const {project,module,editor}=snapshot;
    if(ide.project!==project||ide.activeModule!==module||ide.editor!==editor||ide.activeDoc?.view!=='code'||editor.readOnly||composing(editor)||!['design','paused'].includes(ide.runState))throw new Error('The code-action context changed. Request it again.');
    const text=applySourceCodeAction(editor.text,action);
    if(module.code!==action.before)throw new Error('The source changed before applying the action.');
    if(text===module.code)return false;
    const next=structuredClone(project);next.modules.find(m=>m.id===module.id).code=text;ide.project=next;
    if(ide.runState==='paused'){ide.pendingEdits=true;ide.editRevision=(ide.editRevision||0)+1;}
    ide.record(project,action.title);
    if(action.selection)ide.editor.selectGlobal(action.selection.start,action.selection.end);
    if(surface(ide.editor))surface(ide.editor).focus();else ide.editor.input.focus();ide.status(action.title);return true;
  };
  ide.showSourceCodeActions=()=>{
    const actions=ide.sourceCodeActions();if(!actions.length){ide.status('No source actions are available for this selection.');return;}
    const snapshot={project:ide.project,module:ide.activeModule,editor:ide.editor},rect=ide.editor.root.getBoundingClientRect();
    showMenu(actions.map((a,i)=>({label:a.title,id:String(i)})),rect.left+32,rect.top+36,id=>{
      try{ide.applySourceCodeAction(actions[Number(id)],snapshot);}catch(error){ide.status(error.message);}
    });
  };
  const command=ide.command.bind(ide);ide.command=id=>id==='sourceCodeActions'?ide.showSourceCodeActions():command(id);
  const menu=ide.menu.bind(ide);ide.menu=name=>{const items=menu(name);if(name==='Edit')items.push(null,{label:'Source Actions…',id:'sourceCodeActions',shortcut:'Ctrl+.',enabled:!!ide.activeModule&&['design','paused'].includes(ide.runState)});return items;};
  const keydown=ide.keydown.bind(ide);ide.keydown=event=>{
    if(!event.defaultPrevented&&!event.isComposing&&!composing(ide.editor)&&!surface(ide.editor)&&event.target===ide.editor.input&&!hasUIDialog()&&(event.ctrlKey||event.metaKey)&&!event.altKey&&event.key==='.'&&ide.activeDoc?.view==='code'){
      event.preventDefault();ide.showSourceCodeActions();return;
    }
    return keydown(event);
  };
}
