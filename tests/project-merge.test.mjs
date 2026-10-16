import test from 'node:test';
import assert from 'node:assert/strict';
import {newProject} from '../src/project/model.js';
import {mergedProject,mergeProjectReferences,mergeProjectResources} from '../src/project/import-merge.js';
import {setResourceString,listResourceStrings,setResource} from '../src/project/res.js';
import {importFiles,sourceFiles} from '../src/project/formats.js';
import {toBase64} from '../src/project/binary-assets.js';

const p=name=>{const p=newProject(name);p.modules[0].name=name+'Form';p.modules[0].form.name=name+'Form';p.modules[0].form.properties.Name=name+'Form';p.modules[0].code='';return p;};
const resource=(id,value)=>setResourceString({fileName:'Data.res',entries:[]},id,value);
const asset=data=>({encoding:'base64',data:toBase64(Uint8Array.from(data))});

test('add-existing retains incoming references in priority order and deduplicates',()=>{
  const a=p('A'),b=p('B');a.references=[{kind:'Reference',value:'vendor-a'}];b.references=[{kind:'Reference',value:'VENDOR-A'},{kind:'Object',value:'vendor-b'}];
  const result=mergedProject(a,b);assert.deepEqual(result.references,[...a.references,b.references[1]]);assert.equal(result.modules.length,2);assert.equal(result.name,'A');
});
test('add-existing preserves decoded resources through native export/reimport',async()=>{
  const a=p('A'),b=p('B');b.resources=resource(101,'incoming');
  const next=mergedProject(a,b),reopened=(await importFiles(new Map(Object.entries(sourceFiles(next))))).project;
  assert.equal(listResourceStrings(reopened.resources)[0].text,'incoming');assert.equal(a.resources,undefined);
});
test('merge resources combines independent IDs inside the same string block',()=>{
  const a=resource(101,'first'),b=resource(102,'second'),result=mergeProjectResources(a,b);
  assert.deepEqual(listResourceStrings(result).map(s=>[s.id,s.text]),[[101,'first'],[102,'second']]);assert.equal(listResourceStrings(a).length,1);
});
test('resource conflicts fail transactionally, not last-writer-wins',()=>{
  const a=p('A'),b=p('B');a.resources=resource(101,'first');b.resources=resource(101,'second');const before=JSON.stringify([a,b]);
  assert.throws(()=>mergedProject(a,b),/Conflicting resource string ID 101/);assert.equal(JSON.stringify([a,b]),before);
});
test('opaque resource conflicts cannot silently replace the target payload',()=>{
  const a=setResource({entries:[]},{type:10,name:4,data:'AA=='}),b=setResource({entries:[]},{type:10,name:4,data:'AQ=='});
  assert.throws(()=>mergeProjectResources(a,b),/Conflicting resource/);
});
test('identical resources are idempotent',()=>assert.deepEqual(mergeProjectResources(resource(101,'same'),resource(101,'same')),resource(101,'same')));
test('binary companions compare bytes and retain target spelling',()=>{
  const a=p('A'),b=p('B');a.assets['Img/Picture.frx']=asset([0,255]);b.assets['img/picture.FRX']={...asset([0,255]),extra:'producer metadata'};
  const next=mergedProject(a,b);assert.deepEqual(Object.keys(next.assets),['Img/Picture.frx']);
});
test('source/asset collision detects slash and dot aliases',()=>{
  const a=p('A'),b=p('B');a.assets['code/M.bas']=asset([1]);b.modules[0].sourcePath='code\\.\\M.bas';assert.throws(()=>mergedProject(a,b),/already uses/);
});
test('incoming resource file cannot overwrite a source or opaque asset',()=>{
  const a=p('A'),b=p('B');a.assets['Data.res']=asset([1]);b.resources=resource(1,'text');assert.throws(()=>mergedProject(a,b),/Conflicting resource file/);
});
test('incoming unresolved native membership is rejected rather than omitted',async()=>{
  const incoming=(await importFiles(new Map([['Missing.vbp','Type=Exe\nForm=Missing.frm\nName="Missing"']]))).project;
  assert.throws(()=>mergedProject(p('A'),incoming),/unresolved or read-only/);
});
test('virtual data files merge without changing current startup/settings',()=>{
  const a=p('A'),b=p('B');a.vfs.files['keep.txt']='keep';b.vfs.files['new.txt']='new';b.startup='Sub Main';b.settings.gridSize=360;
  const next=mergedProject(a,b);assert.equal(next.vfs.files['new.txt'],'new');assert.equal(next.vfs.files['keep.txt'],'keep');assert.equal(next.startup,a.startup);assert.equal(next.settings.gridSize,a.settings.gridSize);
});
test('virtual file conflicts do not mutate either project',()=>{
  const a=p('A'),b=p('B');a.vfs.files['a.txt']='one';b.vfs.files['A.txt']='two';const before=JSON.stringify([a,b]);assert.throws(()=>mergedProject(a,b),/Conflicting virtual/);assert.equal(JSON.stringify([a,b]),before);
});
for(const value of ['bad\nName=Injected','bad\rvalue','bad\0value'])test('references reject line injection '+JSON.stringify(value),()=>assert.throws(()=>mergeProjectReferences([],[{kind:'Reference',value}]),/Invalid native reference/));
test('invalid kinds do not become VBP records',()=>assert.throws(()=>mergeProjectReferences([],[{kind:'Name',value:'x'}]),/Invalid native reference/));
test('add-existing carries portable data connections and commands',()=>{
  const a=p('A'),b=p('B');b.dataSources={version:1,connections:[{name:'Catalog',provider:'json'}],commands:[{name:'Products',connection:'Catalog'}]};
  const next=mergedProject(a,b);assert.equal(next.dataSources.connections[0].name,'Catalog');assert.equal(next.dataSources.commands[0].name,'Products');assert.equal(a.dataSources,undefined);
});
test('data connection conflicts fail before changing any source modules',()=>{
  const a=p('A'),b=p('B');a.dataSources={version:1,connections:[{name:'Catalog',provider:'json',path:'a.json'}],commands:[]};b.dataSources={version:1,connections:[{name:'Catalog',provider:'json',path:'b.json'}],commands:[]};
  const before=JSON.stringify(a);assert.throws(()=>mergedProject(a,b),/Conflicting data source/);assert.equal(JSON.stringify(a),before);
});
