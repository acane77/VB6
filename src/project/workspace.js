/** Transactional native group authoring. No filesystem access or COM activation. */
import {normalizeProject} from './model.js';
import {sourceFiles} from './formats.js';
import {parseNativeProject,parseVBG,workspaceProjects,validateWorkspace,MAX_NATIVE_PROJECTS} from './native-project.js';
import {cleanProjectPath,relativeProjectPath,resolveProjectPath} from './frx.js';
import {bytesOf,equalBytes,decodeNativeText,nativePathValue} from './native-text.js';
import {toBase64} from './binary-assets.js';
import {sourceProjectReference as sourceReference,resolveReferencePath,rebaseProjectReference} from './references.js';
export const sourceProjectReference=sourceReference;

const clone=value=>structuredClone(value);
const key=value=>String(value).toLowerCase();
const fail=message=>{throw new Error('Project group: '+message);};
export const projectManifestPath=project=>project.nativeProject?.path||project.name+'.vbp';
const asset=value=>({encoding:'base64',data:toBase64(bytesOf(value))});
function manifestPath(path,extension){path=cleanProjectPath(path);if(!path.toLowerCase().endsWith(extension))fail('Expected a '+extension+' path');return path;}
function checked(project){const result=normalizeProject(project);validateWorkspace(result);return result;}
function member(project,path){const found=workspaceProjects(project).find(p=>key(projectManifestPath(p))===key(path));if(!found)fail('Unknown member: '+path);return found;}
function pack(project,projects,activePath=projectManifestPath(project)){
  const active=projects.find(p=>key(projectManifestPath(p))===key(activePath));if(!active)fail('The active project must remain a member');
  const result=clone(active);result.nativeWorkspace={...clone(project.nativeWorkspace),peers:projects.filter(p=>p!==active).map(clone)};result.storageFormat=project.storageFormat;
  validateWorkspace(result);return result;
}
function nativeMember(project,path=projectManifestPath(project)){
  const result=checked(project);if(result.nativeWorkspace)fail('Nested project groups are not supported');
  path=manifestPath(path,'.vbp');
  const old=projectManifestPath(result);result.references=(result.references||[]).map(r=>rebaseProjectReference(r,old,path));
  if(result.nativeProject?.document){result.nativeProject.path=path;return result;}
  result.nativeProject={...result.nativeProject,path,entries:result.nativeProject?.entries||[]};
  const files=sourceFiles(result),document=decodeNativeText(bytesOf(files[path])),meta=parseNativeProject(document.text);
  result.nativeProject={path,originalPath:path,document,entries:meta.rawEntries,
    files:meta.files.map(f=>{const resolved=resolveProjectPath(Object.keys(files),path,f.path),m=result.modules.find(m=>key(m.sourcePath||m.name+(m.form?'.frm':m.kind==='class'?'.cls':'.bas'))===key(resolved));return {...f,resolved,moduleId:m?.id||null,relocated:false};}),
    baseline:{name:result.name,description:result.description||'',startup:result.startup,references:clone(result.references),entries:clone(meta.rawEntries)}};
  result.storageFormat='native';return result;
}

export function createProjectWorkspace(project,{path=project.name+'.vbg',projectPath=projectManifestPath(project)}={}){
  if(project.nativeWorkspace)fail('The project already belongs to a group');
  const result=nativeMember(project,projectPath);projectPath=projectManifestPath(result);path=manifestPath(path,'.vbg');
  const output=sourceFiles(result);if(Object.keys(output).some(p=>key(p)===key(path)))fail('Group path collides with an existing file: '+path);
  const text='VBGROUP 5.0\r\nStartupProject='+nativePathValue(relativeProjectPath(path,projectPath))+'\r\n';
  const document=decodeNativeText(bytesOf(text)),group=parseVBG(document.text),files=Object.create(null);
  for(const [p,value]of Object.entries(output))files[p]=asset(value);files[path]=asset(text);
  result.nativeWorkspace={version:1,path,originalPath:path,document,order:[projectPath],originalOrder:[projectPath],startupPath:projectPath,originalStartupPath:projectPath,
    references:group.records.map(r=>({...r,resolved:projectPath,relocated:false})),peers:[],files};
  return checked(result);
}

export function addWorkspaceProject(project,incoming,{path=projectManifestPath(incoming),index,activate=false}={}){
  const next=checked(project);if(!next.nativeWorkspace)fail('Create a project group first');
  const projects=workspaceProjects(next),w=next.nativeWorkspace;
  if(projects.length>=MAX_NATIVE_PROJECTS)fail('A group may contain at most 32 projects');
  const added=nativeMember(incoming,path);path=projectManifestPath(added);
  if(projects.some(p=>key(projectManifestPath(p))===key(path)))fail('Duplicate project path: '+path);
  if(projects.some(p=>key(p.name)===key(added.name)))fail('Duplicate project name: '+added.name);
  const current=sourceFiles(next),existing=new Map(Object.entries(current).map(([p,b])=>[key(p),b]));
  const baseline=new Map(Object.keys(w.files).map(p=>[key(p),p]));
  for(const [p,bytes]of Object.entries(sourceFiles(added))){
    if(key(p)===key(w.path))fail('Project output collides with group manifest');
    if(existing.has(key(p))&&!equalBytes(existing.get(key(p)),bytes))fail('Conflicting shared or companion file: '+p);
    if(!baseline.has(key(p))){w.files[p]=asset(bytes);baseline.set(key(p),p);}
  }
  index??=w.order.length;if(!Number.isInteger(index)||index<0||index>w.order.length)fail('Invalid insertion index');
  w.order.splice(index,0,projectManifestPath(added));w.membershipEdited=true;projects.push(added);
  const result=pack(next,projects,activate?projectManifestPath(added):projectManifestPath(next));sourceFiles(result);return result;
}

export function removeWorkspaceProject(project,path,{startupPath,activePath}={}){
  const next=checked(project),w=next.nativeWorkspace;if(!w)fail('No project group is open');
  const removed=member(next,path),removedPath=projectManifestPath(removed),projects=workspaceProjects(next).filter(p=>key(projectManifestPath(p))!==key(removedPath));
  if(!projects.length)fail('A project group must retain at least one project');
  // Validate all authors before detaching; removal must not hide an existing
  // conflict or discard the only edited copy of a shared source/resource.
  const originalOutput=sourceFiles(next);
  // Keep the latest bytes of detached, exclusively owned files. Do not change
  // the shared-file baseline: that would make an unchanged peer undo an edit.
  const owned=new Set(projects.flatMap(p=>Object.keys(sourceFiles(p)).map(key)));
  for(const [p,bytes]of Object.entries(sourceFiles(removed)))if(!owned.has(key(p))){const prior=Object.keys(w.files).find(n=>key(n)===key(p));w.files[prior||p]=asset(bytes);}
  w.order=w.order.filter(p=>key(p)!==key(removedPath));w.membershipEdited=true;
  w.startupPath=startupPath||(key(w.startupPath)===key(removedPath)?w.order[0]:w.startupPath);
  const active=activePath||(key(projectManifestPath(next))===key(removedPath)?w.startupPath:projectManifestPath(next));
  const result=pack(next,projects,active),output=sourceFiles(result);
  const remaining=new Map(Object.entries(output).map(([p,b])=>[key(p),b]));
  for(const [p,bytes]of Object.entries(originalOutput))if(owned.has(key(p))&&!equalBytes(bytes,remaining.get(key(p)))){
    fail('Cannot remove '+removed.name+': edits to shared file '+p+' would be lost. Save and reopen the group to synchronize shared copies before removing this project.');
  }
  return result;
}

export function reorderWorkspaceProjects(project,order){
  const next=checked(project);if(!next.nativeWorkspace)fail('No project group is open');
  if(!Array.isArray(order)||order.length!==next.nativeWorkspace.order.length)fail('Supply each project exactly once');
  const canonical=order.map(path=>projectManifestPath(member(next,path)));
  if(new Set(canonical.map(key)).size!==canonical.length)fail('Duplicate project in ordering');
  if(canonical.some((p,i)=>p!==next.nativeWorkspace.order[i])){next.nativeWorkspace.order=canonical;next.nativeWorkspace.membershipEdited=true;}
  return checked(next);
}
export function setWorkspaceStartup(project,path){const next=checked(project);if(!next.nativeWorkspace)fail('No project group is open');next.nativeWorkspace.startupPath=projectManifestPath(member(next,path));return next;}

export function workspaceDependencies(project){
  validateWorkspace(project);const projects=workspaceProjects(project),paths=projects.map(projectManifestPath),lookup=new Map(paths.map(p=>[key(p),p]));
  const dependencies=new Map(paths.map(p=>[p,[]])),diagnostics=[];
  for(const p of projects)for(const r of p.references||[]){
    const ref=sourceProjectReference(r);if(ref===null)continue;
    const owner=projectManifestPath(p),resolved=resolveReferencePath(owner,ref),target=lookup.get(key(resolved));
    if(!target){diagnostics.push({severity:'error',source:owner,message:'Referenced project is not an open group member: '+ref});continue;}
    if(!dependencies.get(owner).includes(target))dependencies.get(owner).push(target);
  }
  const pending=new Map([...dependencies].map(([p,refs])=>[p,new Set(refs)])),order=[];
  while(pending.size){const ready=paths.find(p=>pending.has(p)&&pending.get(p).size===0);if(!ready)break;pending.delete(ready);order.push(ready);for(const refs of pending.values())refs.delete(ready);}
  // Report actual cycle edges, separately from projects blocked behind a cycle.
  const state=new Map(),stack=[],cycles=[],seen=new Set();
  const visit=path=>{if(state.get(path)===2)return;if(state.get(path)===1){const cycle=stack.slice(stack.indexOf(path)).concat(path),signature=[...new Set(cycle)].sort().join('\0');if(!seen.has(signature)){seen.add(signature);cycles.push(cycle);}return;}state.set(path,1);stack.push(path);for(const dep of dependencies.get(path))visit(dep);stack.pop();state.set(path,2);};
  for(const p of paths)visit(p);
  for(const cycle of cycles)diagnostics.push({severity:'error',source:cycle[0],message:'Circular project reference: '+cycle.join(' → ')});
  return {projects:paths,dependencies:Object.fromEntries(dependencies),order,blocked:paths.filter(p=>pending.has(p)),cycles,diagnostics};
}
export function workspaceBuildOrder(project){const result=workspaceDependencies(project);if(result.diagnostics.length)fail(result.diagnostics.map(d=>d.message).join('\n'));return result.order;}

export function moveWorkspaceProject(project,path,destination){
  const next=checked(project),w=next.nativeWorkspace;if(!w)fail('No project group is open');
  const projects=workspaceProjects(next),moving=member(next,path),old=projectManifestPath(moving);destination=manifestPath(destination,'.vbp');
  if(old===destination)return next;
  const output=sourceFiles(next);
  if(key(old)!==key(destination)&&Object.keys(output).some(p=>key(p)===key(destination)))fail('Destination already exists: '+destination);
  for(const p of projects){
    const owner=projectManifestPath(p),newOwner=key(owner)===key(old)?destination:owner;
    p.references=(p.references||[]).map(r=>rebaseProjectReference(r,owner,newOwner,{movedFrom:old,movedTo:destination}));
    if(key(owner)===key(old))p.nativeProject.path=destination;
  }
  w.order=w.order.map(p=>key(p)===key(old)?destination:p);if(key(w.startupPath)===key(old))w.startupPath=destination;
  for(const r of w.references||[])if(key(r.resolved)===key(old)){r.resolved=destination;r.relocated=true;}
  w.membershipEdited=true;
  const result=pack(next,projects,key(projectManifestPath(next))===key(old)?destination:projectManifestPath(next));sourceFiles(result);return result;
}
