import {compileFilePattern,FILE_PATTERN_BUDGET} from './file-pattern.js';
import {readInputField} from './sequential-codec.js';
import {openTextStream,fileSystemObject} from './text-stream.js';
import { VBError } from '../language/lexer.js';
import {encodeANSI,decodeANSI} from './binary-codec.js';
const MAX_FILE=20*1024*1024;
const integer=(value,min,max,message='Invalid procedure call or argument')=>{value=Number(value);if(!Number.isInteger(value)||value<min||value>max)throw new VBError(message,5);return value;};
function toBase64(bytes){let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);}
/** Isolated per-project text/binary disk. No implicit access to the host disk. */
export class VirtualFileSystem {
  constructor(snapshot={}){
    this.files=new Map(Object.entries(snapshot.files||{}).map(([name,data])=>[name,data?.encoding==='base64'?Uint8Array.from(atob(data.data),c=>c.charCodeAt(0)):String(data)]));
    this.directories=new Set(['/',...(snapshot.directories||[])]);this.handles=new Map();this.cwd='/';this.dirty=false;this.locks=[];
    const now=Date.now();this.metadata=new Map();
    for(const name of this.files.keys()){this.inferDirectories(name);const m=snapshot.metadata?.[name];this.metadata.set(name,{attributes:Number.isInteger(m?.attributes)?m.attributes&39:32,modified:Number.isFinite(m?.modified)?m.modified:now});}
    for(const name of this.directories){const m=snapshot.metadata?.[name];this.metadata.set(name,{attributes:16|(Number.isInteger(m?.attributes)?m.attributes&39:0),modified:Number.isFinite(m?.modified)?m.modified:now});}
  }
  normalize(path){const raw=String(path).replace(/\\/g,'/').replace(/^[A-Za-z]:/,'');const result=[];for(const p of ((raw.startsWith('/')?'':this.cwd+'/')+raw).split('/')){if(!p||p==='.')continue;if(p==='..')result.pop();else result.push(p);}return '/'+result.join('/');}
  canonical(path){const p=this.normalize(path);if(this.files.has(p)||this.directories.has(p))return p;const key=p.toLowerCase();for(const name of this.files.keys())if(name.toLowerCase()===key)return name;for(const name of this.directories)if(name.toLowerCase()===key)return name;const i=p.lastIndexOf('/'),parent=p.slice(0,i)||'/';for(const name of this.directories)if(name.toLowerCase()===parent.toLowerCase())return (name==='/'?'':name)+p.slice(i);return p;}
  inferDirectories(path){const parts=this.normalize(path).split('/');parts.pop();let current='';for(const part of parts.slice(1)){current+='/'+part;this.directories.add(current);}}
  requireParent(path){const p=this.canonical(path),parent=p.slice(0,p.lastIndexOf('/'))||'/';if(!this.directories.has(parent))throw new VBError('Path not found',76);return p;}
  entry(path){const p=this.canonical(path);if(!this.files.has(p))throw new VBError('File not found: '+path,53);return this.files.get(p);}
  read(path){const data=this.entry(path);return data instanceof Uint8Array?decodeANSI(data):data;}
  readBytes(path){const data=this.entry(path);return data instanceof Uint8Array?data.slice():encodeANSI(data);}
  getAttributes(path){path=this.canonical(path);if(!this.files.has(path)&&!this.directories.has(path))throw new VBError('File not found',53);return this.metadata.get(path)?.attributes??(this.directories.has(path)?16:32);}
  setAttributes(path,attributes){path=this.canonical(path);const old=this.getAttributes(path);if(!Number.isInteger(attributes)||attributes<0||(attributes&~39)!==0)throw new VBError('Invalid procedure call or argument',5);if([...this.handles.values()].some(h=>h.path===path))throw new VBError('File already open',55);this.metadata.set(path,{attributes:attributes|(old&16),modified:this.metadata.get(path)?.modified??Date.now()});this.dirty=true;}
  fileDateTime(path){path=this.canonical(path);this.getAttributes(path);return new Date(this.metadata.get(path)?.modified??0);}
  assertWritable(path){if(this.files.has(path)&&(this.getAttributes(path)&1))throw new VBError('Permission denied',70);}
  assertRemovable(path,force=false){path=this.canonical(path);this.entry(path);if([...this.handles.values()].some(h=>h.path===path))throw new VBError('File already open',55);if(!force)this.assertWritable(path);return path;}
  store(path,value){if(value.length>MAX_FILE)throw new VBError('Virtual file exceeds 20 MiB limit',7);path=this.canonical(path);if(this.directories.has(path))throw new VBError('Path/file access error',75);this.assertWritable(path);this.inferDirectories(path);const attributes=(this.metadata.get(path)?.attributes??0)|32;this.files.set(path,value);this.metadata.set(path,{attributes,modified:Date.now()});this.dirty=true;}
  write(path,text){this.store(path,String(text));}
  writeBytes(path,bytes){this.store(path,Uint8Array.from(bytes));}
  exists(path){return this.files.has(this.canonical(path));}
  remove(path,force=false){path=this.assertRemovable(path,force);this.files.delete(path);this.metadata.delete(path);this.dirty=true;}
  copy(source,destination,overwrite=true){source=this.canonical(source);destination=this.requireParent(destination);this.assertRemovable(source,true);if(source===destination)throw new VBError('Permission denied',70);if(this.exists(destination)){if(!overwrite)throw new VBError('File already exists',58);this.assertRemovable(destination);}const data=this.entry(source);this.store(destination,data instanceof Uint8Array?data.slice():data);}
  rename(source,destination){source=this.canonical(source);destination=this.requireParent(destination);this.entry(source);if(source===destination)return;if(this.files.has(destination)||this.directories.has(destination))throw new VBError('File already exists',58);const value=this.entry(source);this.assertRemovable(source,true);const metadata=this.metadata.get(source);this.files.set(destination,value);this.files.delete(source);this.metadata.delete(source);if(metadata)this.metadata.set(destination,{...metadata});this.dirty=true;}
  makeDirectory(path){path=this.requireParent(path);if(this.files.has(path)||this.directories.has(path))throw new VBError('File already exists',58);this.directories.add(path);this.metadata.set(path,{attributes:16,modified:Date.now()});this.dirty=true;return path;}
  removeDirectory(path){path=this.canonical(path);if(!this.directories.has(path))throw new VBError('Path not found',76);if(path==='/'||this.cwd===path||this.cwd.startsWith(path+'/')||[...this.files.keys(),...this.directories].some(p=>p.startsWith(path+'/')))throw new VBError('Path/file access error',75);this.directories.delete(path);this.metadata.delete(path);this.dirty=true;}
  find(pattern,attributes=0){
    pattern=this.normalize(pattern);const i=pattern.lastIndexOf('/'),parent=this.canonical(pattern.slice(0,i)||'/'),leaf=pattern.slice(i+1);
    if(!this.directories.has(parent))return [];
    const matches=compileFilePattern(leaf),budget={remaining:FILE_PATTERN_BUDGET},prefix=parent==='/'?'/':parent+'/';
    return [...this.files.keys(),...(attributes&16?this.directories:[])].filter(path=>{
      if(path===parent||!path.startsWith(prefix))return false;const name=path.slice(prefix.length);if(name.includes('/')||!matches(name,budget))return false;
      const flags=this.getAttributes(path);return !(flags&2)&&!(flags&4)||(!(flags&2)||!!(attributes&2))&&(!(flags&4)||!!(attributes&4));
    }).sort((a,b)=>a.toLowerCase()<b.toLowerCase()?-1:a.toLowerCase()>b.toLowerCase()?1:0);
  }
  freeFile(range=0){integer(range,0,1);const start=range?256:1,end=range?511:255;for(let n=start;n<=end;n++)if(!this.handles.has(n))return n;throw new VBError('Too many files',67);}
  open(path,mode,number,recordLength=128,access,sharing='shared'){
    number=Number(number);if(!Number.isInteger(number)||number<1||number>511||this.handles.has(number))throw new VBError('Bad file number',52);
    mode=String(mode).toLowerCase();if(!['input','output','append','binary','random'].includes(mode))throw new VBError('Bad file mode',54);
    const binary=mode==='binary'||mode==='random';recordLength=mode==='random'?integer(recordLength,1,32767):1;
    access=String(access||((mode==='input')?'read':binary?'read write':'write')).toLowerCase();sharing=String(sharing).toLowerCase();
    if(!['read','write','read write'].includes(access)||!['shared','lock read','lock write','lock read write'].includes(sharing))throw new VBError('Bad file mode',54);
    if(mode==='input'&&access!=='read'||['output','append'].includes(mode)&&access!=='write')throw new VBError('Bad file mode',54);
    path=this.canonical(path);if(access.includes('write'))this.assertWritable(path);
    for(const h of this.handles.values())if(h.path===path){
      if(mode==='output'||h.mode==='output'||h.sharing==='lock read write'||sharing==='lock read write'||h.sharing==='lock read'&&access.includes('read')||h.sharing==='lock write'&&access.includes('write')||sharing==='lock read'&&h.access.includes('read')||sharing==='lock write'&&h.access.includes('write'))throw new VBError('Permission denied',70);
    }
    if(!this.exists(path)){this.requireParent(path);if(mode==='input'||access==='read')throw new VBError('File not found',53);binary?this.writeBytes(path,[]):this.write(path,'');}
    if(mode==='output')this.write(path,'');
    const content=binary?this.readBytes(path):this.read(path);
    this.handles.set(number,{path,mode,number,content,position:mode==='append'?content.length:0,lastRecord:0,recordLength,access,sharing});
  }
  handle(number){const h=this.handles.get(Number(number));if(!h)throw new VBError('Bad file number',52);return h;}
  close(number){if(number===undefined){for(const n of [...this.handles.keys()])this.close(n);return;}this.handle(number);this.handles.delete(Number(number));this.locks=this.locks.filter(l=>l.number!==Number(number));}
  requireAccess(h,action){if(!h.access.includes(action))throw new VBError('Bad file mode',54);}
  assertUnlocked(h,start,end){if(this.locks.some(l=>l.path===h.path&&l.number!==h.number&&start<l.end&&end>l.start))throw new VBError('Permission denied',70);}
  refresh(h){h.content=['binary','random'].includes(h.mode)?this.readBytes(h.path):this.read(h.path);return h;}
  print(number,text,newline=true){
    const h=this.refresh(this.handle(number));this.requireAccess(h,'write');if(!['output','append'].includes(h.mode))throw new VBError('Bad file mode',54);
    const addition=String(text)+(newline?'\r\n':''),start=h.mode==='append'?h.content.length:h.position,end=start+addition.length;
    if(end>MAX_FILE)throw new VBError('Virtual file exceeds 20 MiB limit',7);this.assertUnlocked(h,start,end);
    const content=h.content.slice(0,start)+'\0'.repeat(Math.max(0,start-h.content.length))+addition+h.content.slice(end);
    this.write(h.path,content);h.content=content;h.position=end;
  }
  lineInput(number,acceptLF=false){
    const h=this.refresh(this.handle(number));this.requireAccess(h,'read');if(h.mode!=='input')throw new VBError('Bad file mode',54);if(h.position>=h.content.length)throw new VBError('Input past end of file',62);
    let end=h.position;while(end<h.content.length&&h.content[end]!=='\r'&&(!acceptLF||h.content[end]!=='\n'))end++;
    let next=end;if(next<h.content.length){next++;if(h.content[end]==='\r'&&h.content[next]==='\n')next++;}
    this.assertUnlocked(h,h.position,next);const text=h.content.slice(h.position,end);h.position=next;return text;
  }
  inputValue(number,type='Variant'){
    const h=this.refresh(this.handle(number));this.requireAccess(h,'read');
    if(!['input','binary'].includes(h.mode))throw new VBError('Bad file mode',54);
    const text=h.content instanceof Uint8Array?decodeANSI(h.content):h.content;
    const result=readInputField(text,h.position,type);this.assertUnlocked(h,h.position,result.next);h.position=result.next;return result.value;
  }
  input(number,count){const h=this.refresh(this.handle(number));this.requireAccess(h,'read');if(!['input','binary'].includes(h.mode))throw new VBError('Bad file mode',54);count=integer(count,0,MAX_FILE);if(h.position+count>h.content.length)throw new VBError('Input past end of file',62);this.assertUnlocked(h,h.position,h.position+count);const s=h.content.slice(h.position,h.position+count);h.position+=count;return s instanceof Uint8Array?decodeANSI(s):s;}
  eof(number){const h=this.refresh(this.handle(number));return h.position>=h.content.length?-1:0;}
  lof(number){return this.refresh(this.handle(number)).content.length;}
  loc(number){const h=this.handle(number);return h.mode==='random'?h.lastRecord:h.mode==='binary'?h.position:Math.trunc(h.position/128);}
  seek(number,position){const h=this.handle(number),unit=h.mode==='random'?h.recordLength:1;if(position!==undefined)h.position=(integer(position,1,2147483647)-1)*unit;return Math.floor(h.position/unit)+1;}
  bytePosition(h,position){const unit=h.mode==='random'?h.recordLength:1;return position===undefined?h.position:(integer(position,1,2147483647)-1)*unit;}
  put(number,position,bytes){const h=this.refresh(this.handle(number));this.requireAccess(h,'write');if(!['binary','random'].includes(h.mode))throw new VBError('Bad file mode',54);if(h.mode==='random'&&bytes.length>h.recordLength)throw new VBError('Bad record length',59);const start=this.bytePosition(h,position),size=h.mode==='random'?h.recordLength:bytes.length,end=start+size;if(end>MAX_FILE)throw new VBError('Virtual file exceeds 20 MiB limit',7);this.assertUnlocked(h,start,end);const content=new Uint8Array(Math.max(end,h.content.length));content.set(h.content);content.set(bytes,start);this.writeBytes(h.path,content);h.content=content;h.position=end;h.lastRecord=Math.floor(start/h.recordLength)+1;}
  get(number,position,decode){const h=this.refresh(this.handle(number));this.requireAccess(h,'read');if(!['binary','random'].includes(h.mode))throw new VBError('Bad file mode',54);const start=this.bytePosition(h,position),end=h.mode==='random'?start+h.recordLength:h.content.length;if(start>=h.content.length||end>h.content.length)throw new VBError('Input past end of file',62);const result=decode(h.content.subarray(start,end));this.assertUnlocked(h,start,h.mode==='random'?end:start+result.bytesRead);h.position=h.mode==='random'?end:start+result.bytesRead;h.lastRecord=Math.floor(start/h.recordLength)+1;return result.value;}
  lock(number,start,end,unlock=false){const h=this.handle(number),unit=h.mode==='random'?h.recordLength:1;start=start===undefined?0:(integer(start,1,2147483647)-1)*unit;end=end===undefined?(start===0?Infinity:start+unit):integer(end,1,2147483647)*unit;if(end<=start)throw new VBError('Invalid lock range',5);if(unlock){const i=this.locks.findIndex(l=>l.number===h.number&&l.start===start&&l.end===end);if(i<0)throw new VBError('Permission denied',70);this.locks.splice(i,1);}else{this.assertUnlocked(h,start,end);this.locks.push({number:h.number,path:h.path,start,end});}}
  snapshot(){return {version:3,files:Object.fromEntries([...this.files].map(([name,data])=>[name,data instanceof Uint8Array?{encoding:'base64',data:toBase64(data)}:data])),directories:[...this.directories],metadata:Object.fromEntries([...this.metadata].map(([name,value])=>[name,{...value}]))};}
  textStream(...args){return openTextStream(this,...args);}
  fso(){return fileSystemObject(this);}
}
