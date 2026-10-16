import {VBError} from '../language/errors.js';
import {coerce,vbString,VBCollection} from './values.js';
import {encodeANSI} from './binary-codec.js';
import {signatureParameters} from './signatures.js';
const signatures=(object,entries)=>{for(const [name,signature] of Object.entries(entries))object[name].vbParams=signatureParameters(signature);return object;};

/** Scripting.TextStream over the private project disk. The ANSI codec is
 * Windows-1252. Unicode/DBCS streams require a native/encoding adapter and are
 * rejected before a file is created or truncated, not silently treated as ANSI.
 */
export function openTextStream(fs,path,mode=1,create=false,format=0) {
  mode=coerce(mode,'Integer');format=coerce(format,'Integer');path=vbString(path);create=coerce(create,'Boolean');
  if(![1,2,8].includes(mode)||![0,-2].includes(format))throw new VBError('Invalid procedure call or argument',5);
  if(!fs.exists(path)&&!create)throw new VBError('File not found',53);
  const number=fs.freeFile();
  if(!fs.exists(path)&&mode===1){fs.requireParent(path);fs.write(path,'');}
  fs.open(path,mode===1?'input':mode===8?'append':'output',number);
  let line=1,column=1,previousCR=false;
  // Numeric file slots are reusable (including after Close/Reset in VB code).
  // A stream owns this handle instance, not whichever file later occupies it.
  const owned=fs.handle(number);
  const handle=()=>{
    if(fs.handles.get(number)!==owned)throw new VBError('Bad file number',52);
    return owned;
  };
  function advance(text) {
    for(const ch of text) {
      if(ch==='\r'){line++;column=1;previousCR=true;}
      else if(ch==='\n'){if(!previousCR)line++;column=1;previousCR=false;}
      else {column++;previousCR=false;}
    }
  }
  function read(count) {handle();const text=fs.input(number,coerce(count,'Long'));advance(text);return text;}
  function readLine() {
    const h=fs.refresh(handle()),start=h.position,text=fs.lineInput(number,true);
    advance(h.content.slice(start,h.position));return text;
  }
  function write(value,newline) {
    handle();const text=vbString(value);encodeANSI(text); // Fail before modifying disk/cursor.
    fs.print(number,text,newline);advance(text+(newline?'\r\n':''));
  }
  return signatures({
    __type:'TextStream',
    Read:read,ReadLine:readLine,
    ReadAll(){const h=fs.refresh(handle());return read(h.content.length-h.position);},
    Skip(count){read(count);},SkipLine(){readLine();},
    Write(value){write(value,false);},WriteLine(value=''){write(value,true);},
    WriteBlankLines(count){count=coerce(count,'Long');if(count<0||count>1000000)throw new VBError('Invalid procedure call or argument',5);write('\r\n'.repeat(count),false);},
    Close(){handle();fs.close(number);},
    get AtEndOfStream(){const h=handle();fs.requireAccess(h,'read');return fs.eof(number);},
    get AtEndOfLine(){const h=fs.refresh(handle());fs.requireAccess(h,'read');return h.position>=h.content.length||/[\r\n]/.test(h.content[h.position])?-1:0;},
    get Line(){handle();return line;},get Column(){handle();return column;},
  },{Read:'characters',ReadLine:'',ReadAll:'',Skip:'characters',SkipLine:'',Write:'text',WriteLine:'text?',WriteBlankLines:'lines',Close:''});
}

export function fileSystemObject(fs) {
  const leaf=p=>vbString(p).replace(/\\/g,'/').replace(/\/$/,'').split('/').at(-1);
  const extension=p=>{const name=leaf(p),i=name.lastIndexOf('.');return i<0?'':name.slice(i+1);};
  const file=path=>{
    path=fs.canonical(vbString(path));fs.entry(path);
    return signatures({__type:'File',get Name(){return leaf(path);},set Name(name){name=vbString(name);if(!name||/[\\/]/.test(name)||name==='.'||name==='..')throw new VBError('Invalid procedure call or argument',5);const target=fs.normalize(path+'/../'+vbString(name));fs.rename(path,target);path=target;},
      get Path(){return path;},get Size(){return fs.readBytes(path).length;},
      get Attributes(){return fs.getAttributes(path);},set Attributes(value){fs.setAttributes(path,coerce(value,'Integer'));},
      get DateLastModified(){return fs.fileDateTime(path);},
      Delete(force=false){fs.remove(path,coerce(force,'Boolean'));},Copy(destination,overwrite=true){fs.copy(path,vbString(destination),coerce(overwrite,'Boolean'));},
      Move(destination){destination=vbString(destination);fs.rename(path,destination);path=fs.canonical(destination);},
      OpenAsTextStream(mode=1,format=0){return openTextStream(fs,path,mode,false,format);},
    },{Delete:'force?',Copy:'destination,overwrite?',Move:'destination',OpenAsTextStream:'iomode?,format?'});
  };
  const collection=(paths,wrap)=>{const result=new VBCollection();for(const path of paths)result.Add(wrap(path),leaf(path));return result;};
  const folder=path=>{
    path=fs.canonical(vbString(path));if(!fs.directories.has(path))throw new VBError('Path not found',76);
    return {__type:'Folder',get Name(){return leaf(path);},get Path(){return path;},
      get IsRootFolder(){return path==='/'?-1:0;},get Attributes(){return fs.getAttributes(path);},
      get Files(){return collection(fs.find(path+'/*',39).filter(p=>fs.files.has(p)),file);},
      get SubFolders(){return collection(fs.find(path+'/*',23).filter(p=>fs.directories.has(p)),folder);},
      get ParentFolder(){if(path==='/')throw new VBError('Path not found',76);return folder(fs.normalize(path+'/..'));},
    };
  };
  return signatures({
    __type:'FileSystemObject',FileExists:p=>fs.exists(vbString(p))?-1:0,FolderExists:p=>fs.directories.has(fs.canonical(vbString(p)))?-1:0,
    CreateTextFile(path,overwrite=true,unicode=false){path=vbString(path);if(coerce(unicode,'Boolean'))throw new VBError('Unicode text streams are not supported by this portable codec',5);if(!coerce(overwrite,'Boolean')&&fs.exists(path))throw new VBError('File already exists',58);return openTextStream(fs,path,2,true);},
    OpenTextFile:(...args)=>openTextStream(fs,...args),DeleteFile:(p,force=false)=>fs.remove(vbString(p),coerce(force,'Boolean')),CopyFile:(a,b,overwrite=true)=>fs.copy(vbString(a),vbString(b),coerce(overwrite,'Boolean')),
    MoveFile:(a,b)=>fs.rename(vbString(a),vbString(b)),GetFile:file,GetFolder:folder,
    GetAbsolutePathName:p=>fs.normalize(vbString(p)),GetFileName:leaf,GetBaseName:p=>leaf(p).replace(/\.[^.]*$/,''),GetExtensionName:extension,
    GetParentFolderName:p=>{const text=vbString(p).replace(/\\/g,'/').replace(/\/$/,'');const i=text.lastIndexOf('/');return i<0?'':text.slice(0,i);},
    BuildPath:(a,b)=>{a=vbString(a);b=vbString(b);return a.replace(/[\\/]$/,'')+'/'+b.replace(/^[\\/]/,'');},
    CreateFolder:p=>folder(fs.makeDirectory(vbString(p))),
  },{FileExists:'filespec',FolderExists:'folderspec',CreateTextFile:'filename,overwrite?,unicode?',OpenTextFile:'filename,iomode?,create?,format?',DeleteFile:'filespec,force?',CopyFile:'source,destination,overwrite?',MoveFile:'source,destination',GetFile:'filespec',GetFolder:'folderspec',GetAbsolutePathName:'path',GetFileName:'path',GetBaseName:'path',GetExtensionName:'path',GetParentFolderName:'path',BuildPath:'path,name',CreateFolder:'foldername'});
}
