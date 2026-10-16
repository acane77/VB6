import {VBError} from '../language/errors.js';
import {coerce,vbString} from './values.js';

/** Per-VM Dir enumeration. Patterns never cross directory boundaries. */
export function fileLibrary(vm) {
  const fs=vm.fs;let enumeration=null,index=0;
  return {
    FileLen:path=>fs.readBytes(vbString(path)).length,
    FileDateTime:path=>fs.fileDateTime(vbString(path)),
    GetAttr:path=>fs.getAttributes(vbString(path)),
    SetAttr:(path,attributes)=>fs.setAttributes(vbString(path),coerce(attributes,'Integer')),
    FileAttr:(number,returnType)=>{const h=fs.handle(coerce(number,'Integer'));if(coerce(returnType,'Integer')!==1)throw new VBError('Invalid procedure call or argument',5);return {input:1,output:2,random:4,append:8,binary:32}[h.mode];},
    FileCopy:(source,destination)=>fs.copy(vbString(source),vbString(destination)),
    ChDir:path=>{path=fs.canonical(vbString(path));if(!fs.directories.has(path))throw new VBError('Path not found',76);fs.cwd=path;},
    MkDir:path=>{fs.makeDirectory(vbString(path));},
    RmDir:path=>fs.removeDirectory(vbString(path)),
    Dir(path,attributes=0) {
      if(path!==undefined) {
        attributes=coerce(attributes,'Integer');
        if(attributes<0||attributes>63)throw new VBError('Invalid procedure call or argument',5);
        enumeration=attributes===8?[]:fs.find(vbString(path),attributes);index=0;
      } else if(enumeration===null)throw new VBError('Invalid procedure call or argument',5);
      if(index===enumeration.length){enumeration=null;return '';}
      return enumeration[index++].split('/').at(-1);
    },
    Kill(path) {
      path=vbString(path);
      if(!/[?*]/.test(path)){fs.remove(path);return;}
      const matches=fs.find(path,39).filter(p=>fs.files.has(p));
      if(!matches.length)throw new VBError('File not found',53);
      // Do not leave half a wildcard operation committed after a lock failure.
      for(const p of matches)fs.assertRemovable(p);
      for(const p of matches)fs.remove(p);
    },
  };
}
