/** Classic group authoring with staged dialogs and shared structural undo. */
import {el,clone} from '../core/core.js';
import {modal,alertDialog} from './ui.js';
import {normalizeProject} from '../project/model.js';
import {sourceFiles} from '../project/formats.js';
import {workspaceProjects,selectWorkspaceProject,validateWorkspace} from '../project/native-project.js';
import {WorkspaceHistory} from '../project/workspace-history.js';
import {createProjectWorkspace,addWorkspaceProject,removeWorkspaceProject,reorderWorkspaceProjects,setWorkspaceStartup,moveWorkspaceProject,workspaceDependencies,projectManifestPath} from '../project/workspace.js';
const option=(value,label=value)=>el('option',{value},label);
const projectFile=projectManifestPath;

export function installProjectGroups(ide,{onLoad=()=>{}}={}){
  const load=ide.loadProject.bind(ide),ledger=new WorkspaceHistory(ide.history);let transitioning=false;
  const view=()=>({breakpoints:clone(ide.breakpoints),watches:clone(ide.watches),docs:clone(ide.docs),active:ide.activeDoc?.key});
  const remember=()=>ledger.remember(ide.project,view());
  const savedFor=next=>{
    try{const saved=JSON.parse(ide.savedJSON),peer=workspaceProjects(saved).find(p=>p.id===next.id);return JSON.stringify(peer&&saved.nativeWorkspace?selectWorkspaceProject(saved,projectFile(peer)):saved);}catch{return ide.savedJSON;}
  };
  const enter=(next,saved,dirty)=>{
    transitioning=true;try{ide.loadProject(next);}finally{transitioning=false;}
    const state=ledger.enter(ide.project);
    if(state){
      ide.breakpoints=clone(state.breakpoints);ide.watches=clone(state.watches);
      for(const doc of [...ide.docs])ide.closeDocument(doc.key);
      for(const doc of state.docs)if(ide.project.modules.some(m=>m.id===doc.id))ide.openDocument(doc.id,doc.view);
      const active=state.docs.find(d=>d.key===state.active);if(active&&ide.project.modules.some(m=>m.id===active.id))ide.openDocument(active.id,active.view);
    }
    ide.savedJSON=saved;ide.dirty=dirty||JSON.stringify(ide.project)!==saved;ide.lastTyped=0;ide.lastTypingModule=null;
    ide.updateTitle();ide.updateCommandState();ide.persist();ide.renderAll();
  };
  ide.loadProject=(project,...args)=>{
    if(!transitioning){ledger.reset();onLoad();}
    const result=load(project,...args);if(!transitioning)ledger.enter(ide.project);return result;
  };
  ide.switchNativeProject=(path,{interactive=true}={})=>{
    try{
      if(ide.runState!=='design')throw new Error('Stop execution before switching projects.');
      if(path.toLowerCase()===projectFile(ide.project).toLowerCase())return false;
      const next=selectWorkspaceProject(ide.project,path),saved=savedFor(next),dirty=ide.dirty;remember();enter(next,saved,dirty);
      ide.status('Active project: '+next.name+'; all projects remain in the workspace.');return true;
    }catch(error){if(!interactive)throw error;ide.nativeGroupSelect.value=projectFile(ide.project);alertDialog(error.message,'Project Group');return false;}
  };
  for(const method of ['undo','redo']){
    const original=ide.history[method].bind(ide.history);
    ide.history[method]=(...args)=>{
      remember();const groupResult=ledger.step(method,ide.project);
      if(groupResult){const saved=savedFor(groupResult);enter(groupResult,saved,true);return ide.project;}
      const workspace=ide.project.nativeWorkspace,result=original(...args);
      // Independent source edits cannot revert more recent edits in peers.
      if(workspace&&result?.nativeWorkspace)result.nativeWorkspace.peers=clone(workspace.peers);
      return result;
    };
  }
  ide.applyNativeWorkspace=(project,{label='Edit project group',expectedProject}={})=>{
    if(ide.runState!=='design')throw new Error('Stop execution before editing a project group.');
    if(expectedProject!==undefined&&JSON.stringify(ide.project)!==expectedProject)throw new Error('Project changed while the group dialog was open. Reopen it to keep the newer edits.');
    const next=normalizeProject(project);validateWorkspace(next);sourceFiles(next);
    const before=ide.project,saved=savedFor(next);remember();
    if(!ledger.record(before,next,label))return false;
    enter(next,saved,true);ide.status(label+'; save writes all open group members.');return true;
  };
  ide.addNativeProject=(project,options={})=>{
    const current=ide.project.nativeWorkspace?ide.project:createProjectWorkspace(ide.project);
    return ide.applyNativeWorkspace(addWorkspaceProject(current,project,options),{label:'Add project to group',expectedProject:options.expectedProject});
  };
  ide.chooseNativeProject=()=>{
    if(ide.runState!=='design')return false;
    const expectedProject=JSON.stringify(ide.project),input=el('input',{type:'file',multiple:true,hidden:true,'aria-label':'Add existing project files'});ide.root.append(input);
    input.addEventListener('change',()=>{const files=[...input.files];input.remove();ide.importBrowserFiles(files,{addProject:true,expectedProject});},{once:true});
    input.addEventListener('cancel',()=>input.remove(),{once:true});input.click();return true;
  };
  ide.openNativeGroupDialog=async()=>{
    if(ide.runState!=='design')return false;
    const expectedProject=JSON.stringify(ide.project);
    if(!ide.project.nativeWorkspace){
      const path=el('input',{'aria-label':'Project group path',class:'dialog-input',value:ide.project.name+'.vbg'});
      return await modal('Create Project Group',{width:560,content:el('div',{},el('label',{},'Group manifest path:',path),el('p',{},'Create a native .vbg around the current project without discarding its edits. Add other projects through Project > Add Existing Project to Group.')),
        buttons:[{label:'Create Group',value:true,primary:true,action:()=>ide.applyNativeWorkspace(createProjectWorkspace(ide.project,{path:path.value}),{label:'Create project group',expectedProject})},{label:'Cancel',value:false}]});
    }
    let working=clone(ide.project),selected=projectFile(working);
    const list=el('select',{'aria-label':'Projects in group',size:Math.min(8,Math.max(3,working.nativeWorkspace.order.length)),class:'dialog-input',style:{width:'100%'}});
    const active=el('select',{'aria-label':'Active project',class:'dialog-input'}),startup=el('select',{'aria-label':'Startup project',class:'dialog-input'});
    const path=el('input',{'aria-label':'Project manifest path',class:'dialog-input',style:{width:'100%'}}),dependencies=el('pre',{'aria-label':'Project dependency order','aria-live':'polite',style:{whiteSpace:'pre-wrap',maxHeight:'130px',overflow:'auto'}});
    const refresh=()=>{
      const projects=workspaceProjects(working),paths=projects.map(projectFile),priorActive=active.value,priorStartup=startup.value;
      if(!paths.includes(selected))selected=projectFile(working);
      list.replaceChildren(...projects.map(p=>option(projectFile(p),p.name+' — '+projectFile(p))));list.value=selected;path.value=selected;
      active.replaceChildren(...projects.map(p=>option(projectFile(p),p.name)));startup.replaceChildren(...projects.map(p=>option(projectFile(p),p.name)));
      active.value=paths.includes(priorActive)?priorActive:projectFile(working);startup.value=paths.includes(priorStartup)?priorStartup:working.nativeWorkspace.startupPath;
      const d=workspaceDependencies(working);dependencies.textContent=d.diagnostics.length?d.diagnostics.map(item=>item.message).join('\n'):'Dependency order: '+d.order.join(' → ');
      up.disabled=paths.indexOf(selected)<=0;down.disabled=paths.indexOf(selected)>=paths.length-1;remove.disabled=paths.length<=1;
    };
    const stage=fn=>async()=>{try{working=fn();refresh();}catch(error){await alertDialog(error.message,'Project Group');}};
    const reorder=delta=>{const order=[...working.nativeWorkspace.order],at=order.indexOf(selected),to=at+delta;if(to<0||to>=order.length)return working;[order[at],order[to]]=[order[to],order[at]];return reorderWorkspaceProjects(working,order);};
    const up=el('button',{type:'button',onclick:stage(()=>reorder(-1))},'Move Up'),down=el('button',{type:'button',onclick:stage(()=>reorder(1))},'Move Down');
    const remove=el('button',{type:'button',onclick:stage(()=>removeWorkspaceProject(working,selected))},'Remove from Group');
    const move=el('button',{type:'button',onclick:stage(()=>{const old=selected,next=moveWorkspaceProject(working,old,path.value);selected=next.nativeWorkspace.order[working.nativeWorkspace.order.indexOf(old)];if(active.value===old)active.selectedOptions[0].value=selected;if(startup.value===old)startup.selectedOptions[0].value=selected;return next;})},'Apply Path');
    list.addEventListener('change',()=>{selected=list.value;refresh();});
    const content=el('div',{},el('label',{},'Projects in display order:',list),el('div',{style:{display:'flex',gap:'6px',margin:'8px 0'}},up,down,remove),el('label',{},'Rename / move the selected project manifest:',path),move,el('label',{},'Active project:',active),el('label',{},'Startup project:',startup),dependencies,
      el('p',{},'Removal detaches a project; its latest files are retained. Moving a VBP rebases its member paths and source-project references. No disk files change until you save.'),
      el('p',{},'Group changes are undoable. Undo later edits in each project before undoing a group change. Dependency order is planning metadata; the browser still runs one active project at a time.'));
    refresh();
    return await modal('Project Group',{width:670,content,buttons:[{label:'OK',value:true,primary:true,action:()=>{
      const next=setWorkspaceStartup(working,startup.value);ide.applyNativeWorkspace(next,{label:'Edit project group',expectedProject});
      if(active.value!==projectFile(ide.project))ide.switchNativeProject(active.value,{interactive:false});
    }},{label:'Cancel',value:false}]});
  };
}
