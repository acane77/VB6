import {xamlBuildDiagnostics} from '../xaml/contract.js';
import {el,clone,download} from '../core/core.js';
import {promptDialog,alertDialog,modal} from './ui.js';
import {XamlEditor} from '../editor/xaml-editor.js';
import {createVb6XamlSchema,compileFormXaml,xamlEnabled} from '../xaml/forms.js';
import {readXamlDocument,prepareXamlEdit,synchronizeXamlProject,useDesignerXaml} from '../xaml/documents.js';
import {escapeXml} from '../../packages/xaml-compiler/src/index.js';

function snapshot(project,id) {
  return JSON.stringify({id,startup:project.startup,modules:project.modules.map(m=>({id:m.id,name:m.name,code:m.code,attributes:m.attributes,...(m.id===id?{form:m.form,xaml:m.xaml}:{} )}))});
}
function restore(project,text) {
  const value=JSON.parse(text);
  for(const record of value.modules) {
    const module=project.modules.find(m=>m.id===record.id);if(!module)throw new Error('A module needed by XAML undo is missing.');
    module.name=record.name;module.code=record.code;
    if(Object.hasOwn(record,'attributes'))module.attributes=record.attributes;else delete module.attributes;
    if(record.id===value.id){module.form=record.form;if(record.xaml)module.xaml=record.xaml;else delete module.xaml;}
  }
  project.startup=value.startup;return project;
}

/** Optional installer. The normal VB6 designer/runtime/exporter continue to own
 * the form model. Turning the gate off removes every XAML window/menu command. */
export function installXaml(ide) {
  if(ide.xaml)return ide.xaml;
  const schema=createVb6XamlSchema(),controller={ide,schema,tools:new Map(),results:new Map(),syncing:false,selecting:false,lastEdit:0,lastModule:null};
  ide.xaml=controller;
  const current=id=>ide.project.modules.find(m=>m.id===(id??ide.activeModule?.id));
  const writable=id=>xamlEnabled(ide.project)&&ide.runState==='design'&&!!current(id)?.form&&!ide.documents.designers.get(id)?.locked;
  controller.report=error=>{ide.status(error.message??String(error));return alertDialog(error.message??String(error),'XAML');};
  function commit(project,id,label,merge=false) {
    const before=snapshot(ide.project,id),after=snapshot(project,id);
    if(before===after)return false;
    ide.project=project;ide.visualRevision++;
    ide.history.recordValue('xaml:'+project.id+':'+id,before,after,restore,label,merge);
    ide.markDirty();ide.renderAll();controller.sync();return true;
  }
  controller.apply=(id,text,{resolveConflict=false,typing=true,expectedRevision,expectedBase}={})=>{
    if(!writable(id))throw new Error('End the program and unlock the form before editing XAML.');
    const project=ide.project,revision=ide.visualRevision,module=current(id),source=readXamlDocument(module,{schema});
    const proposal=prepareXamlEdit(project,id,text,{schema,expectedRevision:expectedRevision??source.revision,expectedBase,resolveConflict});
    if(project!==ide.project||revision!==ide.visualRevision)throw new Error('The project changed while the XAML edit was compiling.');
    controller.results.set(id,{text,result:proposal.result,form:proposal.module.form,settings:JSON.stringify(project.settings)});
    const now=performance.now(),merge=typing&&controller.lastModule===id&&now-controller.lastEdit<700;
    controller.lastEdit=typing?now:0;controller.lastModule=typing?id:null;
    commit(proposal.project,id,'Edit '+module.name+' XAML',merge);
    return proposal;
  };
  function resultFor(module,text) {
    const settings=JSON.stringify(ide.project.settings),old=controller.results.get(module.id);
    if(old?.text===text&&old.form===module.form&&old.settings===settings)return old.result;
    const result=compileFormXaml(text,{form:module.form,settings:ide.project.settings,schema,uri:module.name+'.xaml'});
    controller.results.set(module.id,{text,result,form:module.form,settings});return result;
  }
  function refresh(tool) {
    const module=current(tool.moduleId);if(!module?.form||!xamlEnabled(ide.project))return;
    try {
      const state=readXamlDocument(module,{schema}),result=resultFor(module,state.text);
      tool.editor.setAppearance(ide.appearance);
      tool.editor.setDocument(state.text,{compilation:result.compilation,diagnostics:result.diagnostics,readOnly:!writable(module.id),conflict:state.conflict,message:state.previousText&&!state.conflict&&!result.diagnostics.length?'The previous authored source is available under Previous Source. Current native XAML is synchronized.':''});
      const win=ide.documents.mdi.windows.get(tool.key);if(win)win.label.textContent=module.name+' (XAML)';
    } catch(error) {tool.editor.input.readOnly=true;tool.editor.note.textContent=error.message;}
  }
  function selectFromSource(id,offset) {
    if(controller.selecting||!xamlEnabled(ide.project)||ide.runState!=='design')return;
    const module=current(id),tool=controller.tools.get(id);if(!module?.form||!tool)return;
    const hit=resultFor(module,tool.editor.text).sourceMap.filter(m=>m.start<=offset&&offset<=m.end).at(-1);
    if(!hit)return;
    if(ide.activeModule?.id!==id){controller.selecting=true;try{ide.openDocument(id,'form');ide.documents.mdi.activate(tool.key,false);}finally{controller.selecting=false;}}
    const designer=ide.documents.designers.get(id);
    if(!designer||designer.module?.id!==id)return;
    const ids=hit.id===module.form.id?[]:[hit.id];
    if(JSON.stringify([...designer.selection])===JSON.stringify(ids))return;
    controller.selecting=true;try{designer.select(ids);}finally{controller.selecting=false;}
  }
  function selectFromDesigner(designer) {
    if(controller.selecting||!xamlEnabled(ide.project)||!designer.module)return;
    const tool=controller.tools.get(designer.module.id);if(!tool||tool.editor.input.ownerDocument.activeElement===tool.editor.input)return;
    const module=current(designer.module.id);if(!module?.form)return;
    const id=designer.primaryId??module.form.id,hit=resultFor(module,tool.editor.text).sourceMap.find(m=>m.id===id);
    if(hit){controller.selecting=true;try{tool.editor.reveal(hit.start,hit.start,false);}finally{controller.selecting=false;}}
  }
  function installSelection(designer) {
    if(designer.xamlSelection)return;
    designer.xamlSelection=designer.on('selection',()=>selectFromDesigner(designer));
  }
  async function action(id,editor,moduleId) {
    try {
      if(['undo','redo','save','run','stop'].includes(id))return ide.command(id);
      const module=current(moduleId);if(!module?.form)throw new Error('The form was removed.');
      if(id==='download')return download(module.name+'.xaml',editor.text,'application/xaml+xml;charset=utf-8');
      if(!writable(moduleId))throw new Error('The XAML form is read-only.');
      const actionProject=ide.project,actionRevision=ide.visualRevision,sourceRevision=readXamlDocument(module,{schema}).revision,sourceVersion=editor.version;
      const recheck=()=>{if(actionProject!==ide.project||actionRevision!==ide.visualRevision||sourceVersion!==editor.version||readXamlDocument(current(moduleId),{schema}).revision!==sourceRevision||!writable(moduleId))throw new Error('The form or XAML source changed while this action was pending.');};
      if(id==='designer') {
        if(await modal('Use Designer XAML',{content:el('p',{},'Replace this draft with the current designer form? The current source will remain available as Previous Source.'),buttons:[{label:'Use Designer',value:true,primary:true},{label:'Cancel',value:false}]})){recheck();commit(useDesignerXaml(ide.project,moduleId,{schema}),moduleId,'Use Designer XAML');}
      } else if(id==='apply') {
        const state=readXamlDocument(module,{schema});
        if(!state.conflict||await modal('Apply XAML Draft',{content:el('p',{},'This draft predates designer edits. Apply it to replace the current form? Undo restores both source and designer.'),buttons:[{label:'Apply Draft',value:true,primary:true},{label:'Cancel',value:false}]})){recheck();controller.apply(moduleId,editor.text,{resolveConflict:true,typing:false,expectedRevision:sourceRevision});}
      } else if(id==='restore') {
        const backup=module.xaml?.previousText;if(typeof backup!=='string')throw new Error('There is no previous-source backup.');
        controller.apply(moduleId,backup,{typing:false});
      } else if(id==='import') {
        const input=el('input',{type:'file',accept:'.xaml,.xml,text/xml,application/xml'}),project=ide.project;
        input.addEventListener('change',async()=>{try{const file=input.files?.[0];if(!file)return;if(file.size>8_000_000)throw new RangeError('XAML file is too large.');const text=await file.text();if(ide.project!==project)throw new Error('The project changed while reading the XAML file.');recheck();controller.apply(moduleId,text,{typing:false,expectedRevision:sourceRevision});}catch(error){controller.report(error);}});input.click();
      } else if(id==='rename') {
        const offset=editor.input.selectionStart,version=editor.version,project=ide.project;
        const name=await promptDialog('Rename XAML symbol','New name:','');if(name===null)return;
        if(project!==ide.project||version!==editor.version)throw new Error('The source changed while the rename dialog was open.');recheck();
        // Native Name represents a VB6 control array, not an ordinary XAML
        // namescope entry. Rename all matching native nodes atomically.
        const syntax=editor.service.analyze(editor.uri).syntax,element=syntax.elements.findLast(e=>e.start<=offset&&offset<=e.end),attr=element?.attributes.find(a=>a.name==='Name'&&a.start<=offset&&offset<=a.end);
        if(attr&&element.namespaceURI==='urn:vb6:forms') {
          if(!/^[A-Za-z_]\w*$/.test(name))throw new Error('Invalid VB6 name.');
          const edits=syntax.elements.filter(e=>e.namespaceURI==='urn:vb6:forms').flatMap(e=>e.attributes.filter(a=>a.name==='Name'&&a.value.toLowerCase()===attr.value.toLowerCase()).map(a=>({start:a.valueStart,end:a.valueEnd,text:escapeXml(name)})));
          editor.edit(edits);
        } else editor.edit(editor.service.rename(editor.uri,offset,name).edits);
      }
    } catch(error){controller.report(error);}
  }
  controller.open=(id=ide.activeModule?.id)=>{
    if(!xamlEnabled(ide.project))return null;
    const module=current(id);if(!module?.form)return null;
    let tool=controller.tools.get(id);
    if(!tool) {
      const editor=new XamlEditor({uri:'vb6-xaml://'+ide.project.id+'/'+id+'.xaml',schema,onEdit:text=>controller.apply(id,text),onSelect:offset=>selectFromSource(id,offset),onCommand:(command,editor)=>action(command,editor,id),onError:error=>controller.report(error)});
      tool={key:'tool:xaml:'+id,moduleId:id,title:module.name+' (XAML)',glyph:'code',width:850,height:580,root:editor.root,editor};
      tool.refresh=()=>refresh(tool);tool.dispose=()=>{editor.dispose();controller.tools.delete(id);controller.results.delete(id);};controller.tools.set(id,tool);
    }
    const designer=ide.documents.designers.get(id);if(designer)installSelection(designer);
    ide.documents.openTool(tool);tool.editor.input.focus();return tool;
  };
  controller.sync=()=>{
    if(controller.syncing)return;controller.syncing=true;
    try {
      for(const [id,tool]of [...controller.tools]) {
        if(!xamlEnabled(ide.project)||!current(id)?.form)ide.documents.closeTool(tool.key);
        else refresh(tool);
      }
    } finally {controller.syncing=false;}
  };
  const menu=ide.menu.bind(ide),designerMenu=ide.designerMenu.bind(ide),command=ide.command.bind(ide),record=ide.record.bind(ide),update=ide.updateCommandState.bind(ide),factory=ide.documents.designer.bind(ide.documents);
  ide.menu=name=>{const items=menu(name);if(xamlEnabled(ide.project)&&name==='View')items.push(null,{id:'xamlView',label:'XAML Source',enabled:!!ide.activeModule?.form});return items;};
  ide.designerMenu=()=>{const items=designerMenu();if(xamlEnabled(ide.project))items.push(null,{id:'xamlView',label:'XAML Source'});return items;};
  ide.command=(id,...args)=>{
    if(id==='xamlView')return controller.open();
    if(ide.runState==='design'&&(/^(?:run|startWithBreak|stepInto|stepOver|stepOut)$/.test(id)||/^export|^build|^make/i.test(id))) {const error=xamlBuildDiagnostics(ide.project)[0];if(error)return controller.report(new Error(error.message));}
    return command(id,...args);
  };
  ide.record=(before,...args)=>{
    try{synchronizeXamlProject(before,ide.project,{schema});}
    catch(error){ide.status('XAML source retained: '+error.message);for(const module of ide.project.modules)if(module.xaml)module.xaml.conflict=true;}
    const result=record(before,...args);controller.sync();return result;
  };
  ide.updateCommandState=(...args)=>{const result=update(...args);controller.sync();return result;};
  ide.documents.designer=module=>{const designer=factory(module);installSelection(designer);return designer;};
  for(const designer of ide.documents.designers.values())installSelection(designer);
  controller.sync();return controller;
}
