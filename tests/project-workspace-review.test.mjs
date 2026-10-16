import test from 'node:test';
import assert from 'node:assert/strict';
import {importFiles,sourceFiles} from '../src/project/formats.js';
import {workspaceProjects,selectWorkspaceProject} from '../src/project/native-project.js';
import {addWorkspaceProject,createProjectWorkspace,moveWorkspaceProject,removeWorkspaceProject,workspaceBuildOrder} from '../src/project/workspace.js';
import {equalBytes,bytesOf} from '../src/project/native-text.js';
import {writeRES,setResourceString,listResourceStrings} from '../src/project/res.js';
import {toBase64} from '../src/project/binary-assets.js';
import {rebaseProjectReference,projectReferencePath} from '../src/project/references.js';

const load=async files=>(await importFiles(new Map(Object.entries(files)))).project;
const text=value=>new TextDecoder().decode(bytesOf(value));
const unchanged=(before,project)=>assert.equal(JSON.stringify(project),before);
async function group({resource=false,opaque=false}={}){
  const source=opaque?'Shared.frm':'Shared.bas';
  const files={
    'Suite.vbg':'VBGROUP 5.0\r\nStartupProject=A.vbp\r\nProject=B.vbp\r\n',
    'Shared.bas':'Attribute VB_Name = "M"\r\nOption Explicit\r\n',
  };
  for(const name of ['A','B'])files[name+'.vbp']='Type=Exe\r\nName="'+name+'"\r\n'+(opaque?'Form='+source:'Module=M; '+source)+'\r\nStartup="Sub Main"\r\n'+(resource?'ResFile32="Shared.res"\r\n':'');
  if(resource)files['Shared.res']=writeRES(setResourceString({fileName:'Shared.res',entries:[]},1,'Original'));
  if(opaque){delete files['Shared.bas'];files[source]='VERSION 5.00\r\nBegin VB.Form M\r\nPersistState = "Shared.frx":0000\r\nEnd\r\nAttribute VB_Name = "M"\r\n';files['Shared.frx']=Uint8Array.of(0,255,10);}
  return load(files);
}

test('removing the only edited shared-source copy rejects without losing work',async()=>{
  const p=await group();p.modules[0].code+="\n' keep this shared edit\n";const before=JSON.stringify(p);
  assert.throws(()=>removeWorkspaceProject(p,'A.vbp'),/shared file.*Shared.bas/i);
  unchanged(before,p);assert.match(text(sourceFiles(p)['Shared.bas']),/keep this shared edit/);
});
test('removing a shared-source peer leaves another project\'s newer edit intact',async()=>{
  const p=await group();p.nativeWorkspace.peers[0].modules[0].code+="\n' newer peer\n";
  const next=removeWorkspaceProject(p,'A.vbp');assert.equal(next.name,'B');assert.match(text(sourceFiles(next)['Shared.bas']),/newer peer/);
});
test('identical edits in surviving shared-source copies allow removal',async()=>{
  const p=await group();for(const m of workspaceProjects(p))m.modules[0].code+="\n' same edit\n";
  const next=removeWorkspaceProject(p,'A.vbp');assert.ok(equalBytes(sourceFiles(next)['Shared.bas'],sourceFiles(p)['Shared.bas']));
});
test('removal cannot silently resolve divergent shared-source edits by dropping one author',async()=>{
  const p=await group();p.modules[0].code+="\n' first";p.nativeWorkspace.peers[0].modules[0].code+="\n' second";const before=JSON.stringify(p);
  assert.throws(()=>removeWorkspaceProject(p,'A.vbp'),/Conflicting edits to shared file/);unchanged(before,p);
});
test('removing the only edited shared RES copy rejects transactionally',async()=>{
  const p=await group({resource:true});p.resources=setResourceString(p.resources,1,'Edited');const before=JSON.stringify(p);
  assert.throws(()=>removeWorkspaceProject(p,'A.vbp'),/shared file.*Shared.res/i);unchanged(before,p);
});
test('synchronized shared RES copies permit removal',async()=>{
  const p=await group({resource:true});for(const member of workspaceProjects(p))member.resources.entries=setResourceString(member.resources,1,'Edited').entries;
  const next=removeWorkspaceProject(p,'A.vbp');assert.equal(listResourceStrings(next.resources)[0].text,'Edited');
});
test('removing the only changed opaque FRX copy rejects without changing the original',async()=>{
  const p=await group({opaque:true});p.assets['Shared.frx'].data=toBase64(Uint8Array.of(42,128,255));const before=JSON.stringify(p);
  assert.throws(()=>removeWorkspaceProject(p,'A.vbp'),/shared file.*Shared.frx/i);unchanged(before,p);
});
test('saving and reopening shared edits permits subsequent project removal',async()=>{
  const p=await group();p.modules[0].code+="\n' synchronized\n";const files=sourceFiles(p),reopened=await load(files),next=removeWorkspaceProject(reopened,'A.vbp');
  assert.ok(equalBytes(sourceFiles(next)['Shared.bas'],files['Shared.bas']));
});
test('shared-copy protection applies when removing an inactive project',async()=>{
  let p=await group();p.modules[0].code+="\n' inactive edit\n";p=selectWorkspaceProject(p,'B.vbp');const before=JSON.stringify(p);
  assert.throws(()=>removeWorkspaceProject(p,'A.vbp'),/shared file.*Shared.bas/i);unchanged(before,p);
});

async function referencedGroup(){
  const a=await load({'A.vbp':'Type=Exe\r\nName="A"\r\nModule=M; A.bas\r\nStartup="Sub Main"\r\nReference=*\\AB.vbp\r\n','A.bas':'Attribute VB_Name = "M"\r\nOption Explicit\r\n'});
  const b=await load({'B.vbp':'Type=Exe\r\nName="B"\r\nModule=N; B.bas\r\nStartup="Sub Main"\r\n','B.bas':'Attribute VB_Name = "N"\r\nOption Explicit\r\n'});
  return addWorkspaceProject(createProjectWorkspace(a),b);
}
for(const destination of ["library/John 's Library.vbp",'library/A "quoted" B.vbp','library/Name;Suffix.vbp'])test('relocated source references roundtrip '+destination,async()=>{
  const g=await referencedGroup(),next=moveWorkspaceProject(g,'B.vbp',destination),reopened=await load(sourceFiles(next));
  assert.deepEqual(workspaceBuildOrder(reopened),[destination,'A.vbp']);
});
for(const kind of ['Reference','Object'])test('relative library/component paths with manifest apostrophes stay quoted: '+kind,()=>{
  const guid='{00025E01-0000-0000-C000-000000000046}';
  const r={kind,value:kind==='Reference'?'*\\G'+guid+'#0.0#0#lib\\a.dll#Library':guid+'#1.0#0; lib\\a.ocx'};
  const out=rebaseProjectReference(r,"John 's App/A.vbp",'B.vbp');
  const full=out.value;const parsed=projectReferencePath(out);
  assert.ok(full.includes('"'),full);assert.equal(parsed.path,"John 's App\\lib\\a."+(kind==='Reference'?'dll':'ocx'));
});
