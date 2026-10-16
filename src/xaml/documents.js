import {formStamp,MAX_XAML_LENGTH,validateXamlDocument,nextXamlRevision} from './contract.js';
import {formToXaml,compileFormXaml,synchronizeFormXaml,xamlEnabled} from './forms.js';
import {normalizeProject} from '../project/model.js';
import {renameXamlCode} from './rename.js';

const clone = value => structuredClone(value);
const moduleFor = (project,id) => { const module=project.modules.find(m=>m.id===id);if(!module?.form)throw new Error('The XAML form module no longer exists.');return module; };
export {formStamp};
export function readXamlDocument(module,options={}) {
  if(!module?.form)throw new TypeError('XAML authoring requires a form module.');
  const state=module.xaml;
  if(state===undefined)return validateXamlDocument({version:1,revision:0,text:formToXaml(module.form,options),appliedText:null,base:formStamp(module.form),conflict:false});
  validateXamlDocument(state);
  return clone(state);
}
function renameChanges(before,after) {
  const oldNodes=[before,...before.controls??[],...before.menus??[]], next=new Map([after,...after.controls??[],...after.menus??[]].map(n=>[n.id,n]));
  const groups=new Map();
  for(const old of oldNodes) {
    const changed=next.get(old.id);if(!changed)continue;
    const key=old.name.toLowerCase(),g=groups.get(key)??{old:old.name,names:new Set()};g.names.add(changed.name);groups.set(key,g);
  }
  const result=[];
  for(const g of groups.values()) {
    if(g.names.size!==1)throw new Error('Rename every member of a control array together; its VB6 event method is shared.');
    const name=[...g.names][0];if(name!==g.old)result.push([g.old,name]);
  }
  return result;
}
/** Build a proposal without changing live state. The caller owns the history
 * transaction and must recheck project identity/revision before committing it. */
export function prepareXamlEdit(project,moduleId,text,{expectedRevision,expectedBase,resolveConflict=false,schema}={}) {
  if(!xamlEnabled(project))throw new Error('XAML authoring is disabled for this project.');
  if(typeof text!=='string'||text.length>MAX_XAML_LENGTH)throw new RangeError('XAML source exceeds the document limit.');
  const original=moduleFor(project,moduleId),state=readXamlDocument(original,{schema});
  if(expectedRevision!==undefined&&expectedRevision!==state.revision)throw new Error('The XAML source changed before this edit could be applied.');
  if(expectedBase!==undefined&&expectedBase!==formStamp(original.form))throw new Error('The designer changed before this edit could be applied.');
  const next=clone(project),module=moduleFor(next,moduleId),changedBase=state.base!==formStamp(original.form);
  const nextState={...state,revision:nextXamlRevision(state),text,appliedText:state.appliedText??state.text,conflict:state.conflict||changedBase};
  module.xaml=nextState;
  const result=compileFormXaml(text,{form:original.form,settings:project.settings,schema,uri:module.name+'.xaml'});
  if(nextState.conflict&&!resolveConflict) return {project:next,module,result,applied:false,conflict:true};
  if(!result.success)return {project:next,module,result,applied:false,conflict:nextState.conflict};
  try {
    const changes=renameChanges(original.form,result.form);
    const renamed=renameXamlCode(project,moduleId,changes);
    module.form=result.form;module.name=result.form.name;
    if(next.startup?.toLowerCase()===original.name.toLowerCase())next.startup=module.name;
    for(const m of next.modules)Object.assign(m,renamed.get(m.id));
    // Validate the whole renamed project before publishing any part of it.
    normalizeProject(next);
    // A compact resource can expand into a much larger native model. Validate
    // the complete persisted result BEFORE marking the retained draft applied.
    const applied=validateXamlDocument({...nextState,appliedText:text,base:formStamp(module.form),conflict:false});
    Object.assign(nextState,applied);
    return {project:next,module,result,applied:true,conflict:false};
  } catch(error) {
    // Whole-project normalization can fail after touching more than the form.
    // Roll back from the original snapshot, not a partially normalized proposal.
    const failed=clone(project),failedModule=moduleFor(failed,moduleId);failedModule.xaml=nextState;
    result.success=false;result.form=null;
    result.diagnostics.push({code:'VBXAML2101',message:error.message,severity:'error',start:0,end:0,range:{start:{line:0,character:0},end:{line:0,character:0}},line:1,column:1});
    return {project:failed,module:failedModule,result,applied:false,conflict:nextState.conflict};
  }
}

/** Called inside the existing designer/property-grid transaction, before history
 * captures its after snapshot. Never overwrites an invalid/conflicting draft. */
export function synchronizeXamlProject(before,after,{schema}={}) {
  if(!xamlEnabled(after))return;
  const pending=[],beforeById=new Map(before.modules.map(m=>[m.id,m]));
  for(const module of after.modules) {
    if(!module.form||module.xaml===undefined)continue;
    const old=beforeById.get(module.id),stamp=formStamp(module.form),state=readXamlDocument(module,{schema});
    if(state.base===stamp)continue;
    const baseline=old?.form??module.form,hadDraft=state.conflict||state.text!==(state.appliedText??state.text);
    const source=state.appliedText??state.text;
    const sync=synchronizeFormXaml(source,baseline,module.form,{schema,settings:after.settings});
    const next={...state,revision:nextXamlRevision(state),base:stamp,appliedText:sync.text,conflict:hadDraft};
    if(hadDraft)next.text=state.text;
    else {next.text=sync.text;if(sync.regenerated&&sync.previousText!==sync.text)next.previousText=sync.previousText;}
    pending.push([module,validateXamlDocument(next)]);
  }
  // Publish only after every module has synchronized successfully.
  for(const [module,state] of pending)module.xaml=state;
}

/** Explicit recovery command: keep the prior draft as a recoverable backup. */
export function useDesignerXaml(project,moduleId,{schema}={}) {
  if(!xamlEnabled(project))throw new Error('XAML authoring is disabled.');
  const next=clone(project),module=moduleFor(next,moduleId),state=readXamlDocument(module,{schema}),text=formToXaml(module.form,{schema});
  module.xaml=validateXamlDocument({version:1,revision:nextXamlRevision(state),text,appliedText:text,base:formStamp(module.form),conflict:false,previousText:state.text});
  return next;
}
