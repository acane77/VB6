import test from 'node:test';import assert from 'node:assert/strict';
import {VirtualFileSystem} from '../src/runtime/filesystem.js';
import {fileLibrary} from '../src/runtime/file-library.js';
import {run,main,error} from './helpers/compiler-runtime.mjs';
const create=()=>{const fs=new VirtualFileSystem();return {fs,lib:fileLibrary({fs})};};
test('Independent append handles never overwrite intervening writes',()=>{
 const {fs}=create();fs.write('/a','start');fs.open('/a','append',1);fs.open('/a','append',2);
 fs.print(1,'A',false);fs.print(2,'B',false);fs.print(1,'C',false);assert.equal(fs.read('/a'),'startABC');assert.equal(fs.seek(2),8);
});
test('Sequential Seek overwrites at cursor and zero-fills gaps atomically',()=>{
 const {fs}=create();fs.open('/a','output',1);fs.print(1,'abcdef',false);fs.seek(1,3);fs.print(1,'XY',false);assert.equal(fs.read('/a'),'abXYef');
 fs.seek(1,9);fs.print(1,'Z',false);assert.equal(fs.read('/a'),'abXYef\0\0Z');
 fs.seek(1,2147483647);const before=fs.read('/a');error(()=>fs.print(1,'large',false),7);assert.equal(fs.read('/a'),before);assert.equal(fs.seek(1),2147483647);
});
test('Line Input recognizes CR and CRLF; standalone LF is retained in VB mode',()=>{
 const {fs}=create();fs.write('/a','a\rb\r\nc\nd');fs.open('/a','input',1);
 assert.equal(fs.lineInput(1),'a');assert.equal(fs.lineInput(1),'b');assert.equal(fs.lineInput(1),'c\nd');error(()=>fs.lineInput(1),62);
});
test('Line Input consumes delimiters under the same lock and preserves cursor on failure',()=>{
 const {fs}=create();fs.write('/a','abc\r\nnext');fs.open('/a','input',1);fs.open('/a','binary',2);fs.lock(2,4,5);
 error(()=>fs.lineInput(1),70);assert.equal(fs.seek(1),1);fs.close(2);assert.equal(fs.lineInput(1),'abc');assert.equal(fs.seek(1),6);
});
test('Open rejects unknown access/sharing before creating or truncating',()=>{
 const {fs}=create();fs.write('/a','preserved');
 for(const [access,sharing] of [['bogus','shared'],['write','bogus']]){error(()=>fs.open('/a','output',1,128,access,sharing),54);assert.equal(fs.read('/a'),'preserved');assert.equal(fs.handles.size,0);}
 error(()=>fs.open('/missing/file','output',1),76);assert.equal(fs.exists('/missing/file'),false);
});
test('Directory operations validate parents, nonempty descendants, cwd and persistence',()=>{
 const {fs,lib}=create();error(()=>lib.MkDir('/missing/child'),76);lib.MkDir('/parent');lib.MkDir('/parent/child');error(()=>lib.MkDir('/PARENT'),58);
 error(()=>lib.RmDir('/parent'),75);lib.ChDir('/PARENT/CHILD');error(()=>lib.RmDir('/parent/child'),75);lib.ChDir('/');lib.RmDir('/parent/child');lib.RmDir('/parent');
 error(()=>lib.RmDir('/parent'),76);error(()=>lib.RmDir('/'),75);assert.equal(fs.dirty,true);assert.deepEqual(fs.snapshot().directories,['/']);
});
test('Dir is scoped, case-insensitive, handles extensionless DOS patterns and resets',()=>{
 const {fs,lib}=create();fs.write('/docs/Z.TXT','');fs.write('/docs/a.txt','');fs.write('/docs/plain','');fs.write('/docs/sub/hidden.txt','');
 assert.equal(lib.Dir('/DOCS/*.txt'),'a.txt');assert.equal(lib.Dir(),'Z.TXT');assert.equal(lib.Dir(),'');error(()=>lib.Dir(),5);
 assert.deepEqual([lib.Dir('/docs/*.*'),lib.Dir(),lib.Dir(),lib.Dir()],['a.txt','plain','Z.TXT','']);
 assert.equal(lib.Dir('/docs/a.?xt'),'a.txt');assert.equal(lib.Dir(),'');assert.equal(lib.Dir('/no/match'),'');
});
test('Dir attribute filtering and directory inclusion do not return descendants',()=>{
 const {fs,lib}=create();fs.write('/normal','');fs.write('/hidden','');fs.setAttributes('/hidden',2);fs.write('/system','');fs.setAttributes('/system',4);fs.makeDirectory('/folder');
 assert.equal(lib.Dir('/*'),'normal');assert.equal(lib.Dir(),'');
 assert.deepEqual([lib.Dir('/*',18),lib.Dir(),lib.Dir(),lib.Dir()],['folder','hidden','normal','']);assert.equal(lib.Dir('/*',8),'');
 error(()=>lib.Dir('/*',-1),5);
});
test('Read-only metadata, file modes and timestamps survive snapshots without aliases',()=>{
 const {fs,lib}=create();fs.write('/a','€');assert.equal(lib.FileLen('/a'),1);const modified=lib.FileDateTime('/a');assert.ok(modified instanceof Date);modified.setFullYear(1900);assert.notEqual(lib.FileDateTime('/a').getFullYear(),1900);
 lib.SetAttr('/A',3);assert.equal(lib.GetAttr('/a'),3);error(()=>fs.write('/a','x'),70);error(()=>lib.Kill('/a'),70);error(()=>fs.open('/a','output',1),70);
 const snapshot=fs.snapshot(),restored=new VirtualFileSystem(snapshot);snapshot.metadata['/a'].attributes=0;assert.equal(restored.getAttributes('/a'),3);assert.equal(restored.read('/A'),'€');
 fs.open('/a','input',1);assert.equal(lib.FileAttr(1,1),1);error(()=>lib.FileAttr(1,2),5);error(()=>lib.SetAttr('/a',0),55);fs.close();
});
for(const [mode,value] of [['input',1],['output',2],['random',4],['append',8],['binary',32]])test('FileAttr '+mode,()=>{
 const {fs,lib}=create();fs.write('/a','');fs.open('/a',mode,1);assert.equal(lib.FileAttr(1,1),value);
});
test('Wildcard Kill preflights open/readonly files before deleting any match',()=>{
 const {fs,lib}=create();fs.write('/a.txt','a');fs.write('/b.txt','b');fs.open('/b.txt','input',1);error(()=>lib.Kill('/*.txt'),55);assert.equal(fs.exists('/a.txt'),true);
 fs.close();lib.Kill('/*.txt');assert.equal(fs.files.size,0);error(()=>lib.Kill('/*.txt'),53);
});
test('Copy/rename validate destinations without losing source or metadata',()=>{
 const {fs}=create();fs.write('/source','value');fs.write('/target','keep');error(()=>fs.copy('/source','/target',false),58);assert.equal(fs.read('/target'),'keep');
 error(()=>fs.rename('/source','/missing/dest'),76);assert.equal(fs.read('/source'),'value');error(()=>fs.rename('/absent','/absent'),53);
 fs.setAttributes('/source',2);fs.rename('/source','/renamed');assert.equal(fs.getAttributes('/renamed'),2);assert.equal(fs.exists('/source'),false);
});
test('TextStream supports positions, CR/LF boundaries, skip and optional empty lines',()=>{
 const {fs}=create(),fso=fs.fso(),w=fso.CreateTextFile('/a');w.Write('ab');assert.equal(w.Column,3);w.WriteLine();w.WriteBlankLines(1);w.WriteLine('cd');assert.equal(w.Line,4);w.Close();
 const r=fso.OpenTextFile('/a');assert.equal(r.Read(1),'a');assert.equal(r.Column,2);r.Skip(1);assert.equal(r.AtEndOfLine,-1);r.SkipLine();assert.equal(r.Line,2);assert.equal(r.ReadLine(),'');assert.equal(r.ReadAll(),'cd\r\n');assert.equal(r.AtEndOfStream,-1);r.Close();error(()=>r.Line,52);
});
test('FSO modes, overwrite, close, encoding and cursor errors cannot corrupt files',()=>{
 const {fs}=create(),fso=fs.fso();fs.write('/a','keep');
 error(()=>fso.CreateTextFile('/a',false),58);error(()=>fso.CreateTextFile('/a',true,true),5);error(()=>fso.OpenTextFile('/a',2,false,-1),5);assert.equal(fs.read('/a'),'keep');
 error(()=>fso.OpenTextFile('/absent',2),53);assert.equal(fs.exists('/absent'),false);error(()=>fso.OpenTextFile('/a',3),5);
 const w=fso.OpenTextFile('/a',8);error(()=>w.Write('漢'),5);assert.equal(fs.read('/a'),'keep');error(()=>w.AtEndOfStream,54);w.Close();error(()=>w.Write('x'),52);
});
test('FSO descriptors are live, collections expose Count/Item, and paths are available',()=>{
 const {fs}=create(),fso=fs.fso();const dir=fso.CreateFolder('/d');fs.write('/d/a.txt','a');fs.makeDirectory('/d/sub');assert.equal(dir.Files.Count,1);assert.equal(dir.Files.Item('a.txt').Size,1);assert.equal(dir.SubFolders.Count,1);assert.equal(dir.ParentFolder.IsRootFolder,-1);
 const file=fso.GetFile('/d/a.txt');fs.write('/d/a.txt','longer');assert.equal(file.Size,6);file.Name='b.txt';assert.equal(file.Path,'/d/b.txt');error(()=>{file.Name='../escape';},5);
 assert.equal(fso.GetExtensionName('/d/a.tar.gz'),'gz');assert.equal(fso.GetBaseName('/d/a.tar.gz'),'a.tar');assert.equal(fso.GetParentFolderName('/d/a.txt'),'/d');
 file.Attributes=1;error(()=>file.Delete(),70);file.Delete(true);assert.equal(fso.FileExists('/d/b.txt'),0);
});
test('Runtime filesystem intrinsics and FSO named arguments execute from VB source',async()=>{
 assert.deepEqual((await run(main(`Dim fs As Object, stream As Object, folder As Object, x As Object
MkDir "/data"
Set fs = CreateObject("Scripting.FileSystemObject")
Set stream = fs.CreateTextFile(FileName:="/data/log.txt", Overwrite:=True)
stream.WriteLine Text:="hello"
stream.WriteBlankLines Lines:=1
stream.Close
SetAttr "/data/log.txt", vbHidden
Debug.Print GetAttr("/data/log.txt"), Dir("/data/*", vbHidden), FileLen("/data/log.txt"), TypeName(FileDateTime("/data/log.txt"))
Set stream = fs.OpenTextFile(FileName:="/data/log.txt")
Debug.Print stream.Read(Characters:=2), stream.Column
stream.SkipLine
Debug.Print stream.Line, stream.AtEndOfLine
stream.Close
Set folder = fs.GetFolder("/data")
Debug.Print folder.Files.Count
For Each x In folder.Files
Debug.Print x.Name
Next`))).output,['2 log.txt 9 Date','he 3','2 -1','1','log.txt']);
});
