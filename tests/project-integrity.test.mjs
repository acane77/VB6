import test from 'node:test';
import assert from 'node:assert/strict';
import {newProject} from '../src/project/model.js';
import {sourceFiles,importFiles,serializeVBP} from '../src/project/formats.js';
import {normalizedEntries,validateWorkspace} from '../src/project/native-project.js';
import {cleanProjectPath,fromBase64 as fromFRX} from '../src/project/frx.js';
import {fromBase64} from '../src/project/binary-assets.js';
import {projectReferencePath,rebaseProjectReference} from '../src/project/references.js';
import {createProjectWorkspace,addWorkspaceProject,moveWorkspaceProject} from '../src/project/workspace.js';
import {mergedProject} from '../src/project/import-merge.js';
import {readZip,writeZip} from '../src/project/zip.js';
const text=value=>new TextDecoder().decode(typeof value==='string'?new TextEncoder().encode(value):value);
const guid='{00025E01-0000-0000-C000-000000000046}';
const reference=path=>({kind:'Reference',value:'*\\G'+guid+'#0.0#0#'+path+'#DAO library'});
const load=async files=>(await importFiles(new Map(Object.entries(files)))).project;
async function project(name,dir='',extra=''){
  return load({[dir+name+'.vbp']:'Type=Exe\r\nModule='+name+'; '+name+'.bas\r\nName="'+name+'"\r\nStartup="Sub Main"\r\n'+extra,[dir+name+'.bas']:'Attribute VB_Name = "'+name+'"\r\nOption Explicit\r\n'});
}
for(const path of [undefined,null,7,{},['A.bas']])test('native paths reject non-string values '+JSON.stringify(path),()=>assert.throws(()=>cleanProjectPath(path),/string/));
for(const paths of [['a','a/b'],['a/b','A'],['a','a.b','a/b'],['d/f','D/f/a']])test('project file/directory conflict '+paths.join(', '),()=>assert.throws(()=>normalizedEntries(paths.map(p=>[p,''])),/File\/directory/));
for(const paths of [['a','a/b'],['a/b','A'],['a','a.b','a/b']])test('ZIP writer preflights file/directory conflict '+paths.join(', '),()=>assert.throws(()=>writeZip(Object.fromEntries(paths.map(p=>[p,'']))),/File\/directory/));
for(const [option,value]of [['maxFiles',NaN],['maxFiles',Infinity],['maxFiles',-1],['maxFiles',1.5],['maxExpandedBytes',NaN],['maxExpandedBytes',Infinity],['maxExpandedBytes',-1]])test('ZIP limits fail closed '+option+' '+value,async()=>await assert.rejects(()=>readZip(writeZip({}),{[option]:value}),/Invalid ZIP limit/));
test('base64 binary and FRX decoders enforce the decoded byte limit',()=>{const data=Buffer.alloc(20*1024*1024+1).toString('base64');for(const decode of [fromBase64,fromFRX])assert.throws(()=>decode(data),/20 MiB|oversized/);});
test('known library reference rebases path and preserves GUID/version/locale/description',()=>{
  const r=reference('lib\\dao.dll'),out=rebaseProjectReference(r,'old/A.vbp','new/B.vbp');
  assert.equal(out.value,reference('..\\old\\lib\\dao.dll').value);assert.equal(projectReferencePath(out).type,'library');assert.equal(r.value,reference('lib\\dao.dll').value);
});
test('absolute registered-library paths and opaque reference forms are unchanged',()=>{
  for(const r of [reference('C:\\Windows\\dao.dll'),{kind:'Reference',value:'*\\G{vendor}#opaque'},{kind:'Object',value:guid+'#1.0#0; dao.ocx'}])assert.deepEqual(rebaseProjectReference(r,'old/A.vbp','new/B.vbp'),r);
});
test('explicit relative component paths rebase while preserving quoted filenames',()=>{
  const r={kind:'Object',value:'"'+guid+'#1.0#0"; "controls\\Component.ocx"'};
  assert.equal(rebaseProjectReference(r,'old/A.vbp','new/B.vbp').value,'"'+guid+'#1.0#0"; "..\\old\\controls\\Component.ocx"');
});
test('whole-value and inner-path quote styles survive reference rebasing',()=>{
  assert.equal(rebaseProjectReference({kind:'Reference',value:'"*\\A..\\B.vbp"'},'old/A.vbp','deeper/new/A.vbp').value,'"*\\A..\\..\\B.vbp"');
  assert.equal(rebaseProjectReference({kind:'Reference',value:'*\\A"..\\B.vbp"'},'old/A.vbp','deeper/new/A.vbp').value,'*\\A"..\\..\\B.vbp"');
});
test('moving a relative reference that escapes the selected root fails atomically',async()=>{
  const p=await project('A','','Reference=*\\A..\\outside.vbp\r\n'),g=createProjectWorkspace(p),before=JSON.stringify(g);
  assert.throws(()=>moveWorkspaceProject(g,'A.vbp','nested/A.vbp'),/outside the selected workspace/);assert.equal(JSON.stringify(g),before);
});
test('Add Existing rebases imported library and source-project references',async()=>{
  const a=await project('A','app/'),b=await project('B','lib/','Reference='+reference('deps\\dao.dll').value+'\r\nReference=*\\AC.vbp\r\n');
  const merged=mergedProject(a,b),f=sourceFiles(merged);assert.ok(text(f['app/A.vbp']).includes('Reference=*\\A..\\lib\\C.vbp'));assert.ok(text(f['app/A.vbp']).includes(reference('..\\lib\\deps\\dao.dll').value));
});
test('adding at a different VBP path rebases its own library dependencies',async()=>{
  const g=createProjectWorkspace(await project('A')),b=await project('B','old/','Reference='+reference('lib\\dao.dll').value+'\r\n');
  const next=addWorkspaceProject(g,b,{path:'new/B.vbp'});assert.ok(text(sourceFiles(next)['new/B.vbp']).includes(reference('..\\old\\lib\\dao.dll').value));
});
test('related documents retain membership and bytes in an existing native VBP',async()=>{
  const a=await project('A','app/');const b=await load({'lib/B.vbp':'Type=Exe\r\nName="B"\r\nRelatedDoc=docs\\note.txt\r\n','lib/docs/note.txt':'keep\0bytes'});
  const next=mergedProject(a,b),files=sourceFiles(next);assert.match(text(files['app/A.vbp']),/RelatedDoc=..\\lib\\docs\\note.txt/);assert.equal(text(files['lib/docs/note.txt']),'keep\0bytes');
  const reopened=await load(files);assert.ok(reopened.nativeProject.files.some(f=>f.kind==='related'&&f.resolved==='lib/docs/note.txt'));
});
test('related documents retain membership when adding to a browser-created project',async()=>{
  const b=await load({'B.vbp':'Name="B"\r\nRelatedDoc=docs\\note.txt\r\n','docs/note.txt':'note'}),next=mergedProject(newProject(),b);
  assert.match(text(sourceFiles(next)[next.name+'.vbp']),/RelatedDoc=docs\\note.txt/);
});
test('missing related documents fail rather than silently dropping membership',async()=>{
  const b=await load({'B.vbp':'Name="B"\r\nRelatedDoc=missing.txt\r\n'});assert.throws(()=>mergedProject(newProject(),b),/unresolved or read-only/);
});
for(const mutate of [p=>p.references=[{kind:'Reference',value:'x\nModule=X; x.bas'}],p=>p.nativeProject={entries:[{key:'Vendor\nModule',value:'x'}]},p=>p.nativeProject={entries:[{key:'Vendor',value:'x\nName=Injected'}]},p=>p.modules[0].nativeKind='Form\nInjected',p=>p.description='a\r\nName=Injected'])test('fresh VBP rejects injected metadata '+mutate.toString(),()=>{const p=newProject();mutate(p);assert.throws(()=>serializeVBP(p),/Invalid/);});
test('fresh VBP description is emitted and quotes are escaped',()=>{const p=newProject();p.description='Uses "quotes"';assert.match(serializeVBP(p),/Description="Uses ""quotes"""/);});
test('group history identities are unique stable strings',async()=>{
  const a=createProjectWorkspace(await project('A')),b=await project('B');b.id=a.id;assert.throws(()=>addWorkspaceProject(a,b),/identity/);
  const g=addWorkspaceProject(a,{...b,id:'separate'});for(const id of [a.id,7,{},'bad\0id']){const copy=structuredClone(g);copy.nativeWorkspace.peers[0].id=id;assert.throws(()=>validateWorkspace(copy),/identity/);}
});

test('fresh VBP settings cannot disguise reserved records with whitespace',()=>{const p=newProject();p.nativeProject={entries:[{key:' Name',value:'Injected'}]};assert.throws(()=>serializeVBP(p),/Invalid project setting/);});

test('grouping a browser project with generated native metadata materializes its manifest',async()=>{
  const b=await load({'B.vbp':'Name="B"\r\nRelatedDoc=docs\\note.txt\r\n','docs/note.txt':'note'}),p=mergedProject(newProject(),b),path=p.name+'.vbp';
  assert.equal(p.nativeProject.document,undefined);const g=createProjectWorkspace(p);assert.ok(g.nativeProject.document);assert.equal(g.nativeProject.originalPath,path);
  const files=sourceFiles(moveWorkspaceProject(g,path,'moved/New.vbp'));assert.equal(files[path],undefined);assert.match(text(files['moved/New.vbp']),/RelatedDoc=..\\docs\\note.txt/);await load(files);
});
