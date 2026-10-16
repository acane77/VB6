import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {McpSkillCatalog} from '../src/mcp/skill-catalog.js';
import {createBuiltinSkills} from '../src/mcp/skills.js';
const definition=(name='review',extra={})=>({path:'vb6/'+name,frontmatter:{name,description:'Review the current project',license:'MIT',metadata:{version:'1',custom:['a',42]}},body:'# Review\n\nRead references/GUIDE.md.\n',files:{'references/GUIDE.md':'# Guide\n\nUnicode 🙂 and accents ąę.\n'},...extra});
const digest=bytes=>'sha256:'+createHash('sha256').update(bytes).digest('hex');
async function verify(catalog) {
  for(const skill of await catalog.list()) {
    assert.deepEqual(await catalog.get(skill.uri),skill);
    assert.ok(skill.resources.some(file=>file.uri===skill.uri));
    assert.equal(new Set(skill.resources.map(file=>file.uri)).size,skill.resources.length);
    for(const file of skill.resources) {
      const resource=catalog.read(file.uri)[0],bytes=resource.blob===undefined?Buffer.from(resource.text):Buffer.from(resource.blob,'base64');
      assert.equal(bytes.length,file.size,file.uri);assert.equal(digest(bytes),file.digest,file.uri);
    }
    const raw=catalog.read(skill.uri)[0].text,header=raw.split('\n---\n')[0].slice(4);
    // Every generated YAML key/value is a JSON scalar or flow collection, so parsing
    // each line exactly verifies all fields rather than a curated projection.
    const frontmatter=Object.fromEntries(header.split('\n').map(line=>{const split=line.indexOf(': ');return [JSON.parse(line.slice(0,split)),JSON.parse(line.slice(split+2))];}));
    assert.deepEqual(frontmatter,skill.frontmatter);
  }
}
test('skills: all built-in manifests match every served byte and all frontmatter fields',async()=>{
  const catalog=createBuiltinSkills();assert.equal((await catalog.list()).length,6);assert.equal(catalog.resources().length,12);await verify(catalog);
});
test('skills: file and directory reads are exact, shallow and independently addressable',async()=>{
  const catalog=new McpSkillCatalog([definition('review',{directories:['empty']})]);await verify(catalog);
  assert.deepEqual(catalog.directory('skill://vb6/review').map(r=>[r.name,r.mimeType]),[['review','text/markdown'],['empty','inode/directory'],['references','inode/directory']]);
  assert.deepEqual(catalog.directory('skill://vb6/review/references').map(r=>r.name),['GUIDE.md']);
  assert.deepEqual(catalog.directory('skill://vb6/review/empty'),[]);
  for(const uri of ['skill://vb6/review/','skill://vb6/review/SKILL.md','skill://vb6/missing'])assert.throws(()=>catalog.directory(uri),error=>error.code===-32602);
  assert.throws(()=>catalog.read('skill://vb6/review'),error=>error.code===-32602);
  await assert.rejects(catalog.get('skill://vb6/review/references/GUIDE.md'),error=>error.code===-32602);
});
test('skills: bytes, frontmatter, manifests and returned metadata are isolated from mutation',async()=>{
  const bytes=new Uint8Array([0,255,128]),input=definition('review',{files:{'assets/binary.bin':{bytes}}});
  const catalog=new McpSkillCatalog([input]);bytes[0]=100;input.frontmatter.metadata.version='changed';input.body='changed';
  const entry=(await catalog.list())[0];entry.frontmatter.metadata.version='tampered';entry.resources.length=0;
  catalog.resources()[0].uri='tampered';catalog.directory('skill://vb6/review')[0].name='tampered';catalog.read('skill://vb6/review/SKILL.md')[0].text='tampered';
  assert.equal((await catalog.list())[0].frontmatter.metadata.version,'1');assert.equal(catalog.read('skill://vb6/review/assets/binary.bin')[0].blob,'AP+A');await verify(catalog);
});
test('skills: UTF-8 BOM, lone surrogates and binary data have exact transport digests',async()=>{
  const catalog=new McpSkillCatalog([definition('review',{files:{'bom.txt':'\uFEFFdata','surrogate.txt':'x\uD800y','binary.bin':{bytes:new Uint8Array([0,255,239,187,191])}}})]);
  await verify(catalog);assert.equal(catalog.read('skill://vb6/review/bom.txt')[0].text,'\uFEFFdata');
});
test('skills: nested manifests include supporting content, duplicate names remain separate identities',async()=>{
  const catalog=new McpSkillCatalog([definition('review'),definition('review',{path:'vb6/review/workflows/review'})]);
  const entries=await catalog.list();assert.equal(entries.length,2);assert.equal(entries[0].resources.length,4);assert.equal(entries[1].resources.length,2);
  assert.ok(catalog.directory('skill://vb6/review').some(r=>r.uri==='skill://vb6/review/workflows'));
  assert.deepEqual(catalog.directory('skill://vb6/review/workflows').map(r=>r.uri),['skill://vb6/review/workflows/review']);await verify(catalog);
});
for(const path of ['../review','vb6//review','vb6/./review','vb6/%2e%2e/review','vb6/review?x=1','vb6/review#x','vb6\\review'])test('skills: rejects unsafe skill path '+path,()=>assert.throws(()=>new McpSkillCatalog([definition('review',{path})])));
for(const path of ['../secret','/absolute','references/../../secret','references/%2fsecret','references\\secret','SKILL.md'])test('skills: rejects unsafe or reserved file '+path,()=>assert.throws(()=>new McpSkillCatalog([definition('review',{files:{[path]:'data'}})])));
test('skills: files cannot collide with directories or generated SKILL.md',()=>{
  assert.throws(()=>new McpSkillCatalog([definition('review',{files:{'references':'file','references/child.md':'child'}})]),/file and a directory/);
  assert.throws(()=>new McpSkillCatalog([definition(),definition()]),/duplicate/);
});
test('skills: validates frontmatter, names, file types and bounded content',()=>{
  for(const frontmatter of [{name:'different',description:'x'},{name:'UPPER',description:'x'},{name:'review'}, {name:'review',description:'',extra:1}])assert.throws(()=>new McpSkillCatalog([definition('review',{frontmatter})]));
  for(const file of [null,1,{text:'x',bytes:new Uint8Array(1)},{bytes:[1,2]},{text:'x',mimeType:'text/html;script=x'}])assert.throws(()=>new McpSkillCatalog([definition('review',{files:{'test.bin':file}})]));
  assert.throws(()=>new McpSkillCatalog([definition('review',{files:{'huge.txt':'x'.repeat(1024*1024+1)}})]),/byte limit/);
  assert.throws(()=>new McpSkillCatalog(Array(129).fill(definition())),/128 skills/);
});
test('skills: empty publisher has no invented root directory or files',async()=>{
  const catalog=new McpSkillCatalog();assert.deepEqual(await catalog.list(),[]);assert.deepEqual(catalog.resources(),[]);assert.throws(()=>catalog.directory('skill://'));
});
