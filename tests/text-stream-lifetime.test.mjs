import test from 'node:test';
import assert from 'node:assert/strict';
import {VirtualFileSystem} from '../src/runtime/filesystem.js';
import {run,main,error} from './helpers/compiler-runtime.mjs';

const operations={
 Read:stream=>stream.Read(1),ReadLine:stream=>stream.ReadLine(),ReadAll:stream=>stream.ReadAll(),
 Skip:stream=>stream.Skip(1),SkipLine:stream=>stream.SkipLine(),
 Write:stream=>stream.Write('stale'),WriteLine:stream=>stream.WriteLine('stale'),
 WriteBlankLines:stream=>stream.WriteBlankLines(1),Close:stream=>stream.Close(),
 AtEndOfStream:stream=>stream.AtEndOfStream,AtEndOfLine:stream=>stream.AtEndOfLine,
 Line:stream=>stream.Line,Column:stream=>stream.Column,
};
for(const close of ['stream','file','reset'])for(const [name,invoke] of Object.entries(operations)) {
 test(`TextStream ${name} rejects slot reuse after ${close} close`,()=>{
  const fs=new VirtualFileSystem(),fso=fs.fso();fs.write('/first','first');
  const stale=fso.OpenTextFile('/first');
  if(close==='stream')stale.Close();else fs.close(close==='file'?1:undefined);
  const replacement=fso.CreateTextFile('/replacement');replacement.Write('keep');
  const before=fs.snapshot(),position=fs.seek(1),handle=fs.handle(1);
  error(()=>invoke(stale),52);
  assert.deepEqual(fs.snapshot(),before);assert.equal(fs.seek(1),position);
  assert.equal(fs.handle(1),handle);replacement.Write(' live');replacement.Close();
  assert.equal(fs.read('/replacement'),'keep live');
 });
}
test('A stale stream cannot read from a newly opened reader at its old file slot',()=>{
 const fs=new VirtualFileSystem(),fso=fs.fso();fs.write('/one','old');fs.write('/two','private');
 const stale=fso.OpenTextFile('/one');fs.close();const live=fso.OpenTextFile('/two');
 error(()=>stale.Read(1),52);assert.equal(live.ReadAll(),'private');live.Close();
});
test('Create argument validation is independent of whether the file exists',()=>{
 const fs=new VirtualFileSystem(),fso=fs.fso();fs.write('/existing','preserve');
 for(const path of ['/existing','/absent'])for(const [value,code] of [[null,94],['invalid',13]]) {
  const before=fs.snapshot();error(()=>fso.OpenTextFile(path,2,value),code);
  assert.deepEqual(fs.snapshot(),before);assert.equal(fs.handles.size,0);
 }
});
test('Failed reads, writes and line reads leave TextStream counters unchanged',()=>{
 const fs=new VirtualFileSystem(),fso=fs.fso();fs.write('/read','a\r\nb');
 const stream=fso.OpenTextFile('/read');
 error(()=>stream.Read(100),62);assert.equal(stream.Line,1);assert.equal(stream.Column,1);
 fs.open('/read','binary',2);fs.lock(2,2,3);error(()=>stream.ReadLine(),70);
 assert.equal(stream.Line,1);assert.equal(stream.Column,1);assert.equal(fs.seek(1),1);
 fs.close(2);assert.equal(stream.ReadLine(),'a');assert.equal(stream.Line,2);stream.Close();
 const writer=fso.CreateTextFile('/write');writer.Write('ab');
 error(()=>writer.Write('漢'),5);assert.equal(writer.Line,1);assert.equal(writer.Column,3);assert.equal(fs.read('/write'),'ab');writer.Close();
});
test('TextStream handle ownership is enforced in compiled VB through Reset and On Error',async()=>{
 const {output,vm}=await run(main(`Dim fs As Object, oldStream As Object, newStream As Object
Set fs=CreateObject("Scripting.FileSystemObject")
Set oldStream=fs.CreateTextFile("/old")
oldStream.Write "old"
Reset
Set newStream=fs.CreateTextFile("/new")
newStream.Write "kept"
On Error Resume Next
oldStream.Write "corruption"
Debug.Print Err.Number
oldStream.Close
Debug.Print Err.Number
Err.Clear
newStream.WriteLine " alive"
Debug.Print Err.Number
newStream.Close`));
 assert.deepEqual(output,['52','52','0']);assert.equal(vm.fs.read('/old'),'old');assert.equal(vm.fs.read('/new'),'kept alive\r\n');
});

for(const [name,operation] of [
 ['CreateTextFile overwrite',(fso,value)=>fso.CreateTextFile('/existing',value)],
 ['CreateTextFile unicode',(fso,value)=>fso.CreateTextFile('/existing',true,value)],
 ['DeleteFile force',(fso,value)=>fso.DeleteFile('/existing',value)],
 ['CopyFile overwrite',(fso,value)=>fso.CopyFile('/existing','/copy',value)],
 ['File.Delete force',(fso,value)=>fso.GetFile('/existing').Delete(value)],
 ['File.Copy overwrite',(fso,value)=>fso.GetFile('/existing').Copy('/copy',value)],
])for(const [value,code] of [[null,94],['not a Boolean',13]])test(`${name} rejects ${value} before mutation`,()=>{
 const fs=new VirtualFileSystem(),fso=fs.fso();fs.write('/existing','preserve');fs.write('/copy','unchanged');
 const before=fs.snapshot();error(()=>operation(fso,value),code);assert.deepEqual(fs.snapshot(),before);assert.equal(fs.handles.size,0);
});
