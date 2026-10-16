import {VBError} from '../language/errors.js';
import {VBArray,vbString} from './values.js';

const folded=value=>value.toLowerCase();
function part(value) {
  const text=vbString(value);
  if(!text.length||text.includes('\0'))throw new VBError('Invalid procedure call or argument',5);
  return text;
}
const encode=parts=>parts.some(p=>p.includes('/'))?'@v1/'+parts.map(encodeURIComponent).join('/'):parts.join('/');
function decode(key) {
  const parts=key.split('/');
  if(parts.length===3)return parts; // Existing snapshots were not percent-encoded.
  if(parts.length!==4||parts.shift()!=='@v1')return null;
  try{return parts.map(decodeURIComponent);}catch{return null;}
}
/** Project-private settings, persisted through the existing host hook.
 * Keeps the established app/section/key snapshot shape; percent-escapes new
 * component separators. Windows-style case-insensitive lookup, not host registry.
 */
export function settingsLibrary(vm) {
  const rows=()=>Object.keys(vm.settings).map(key=>({key,parts:decode(key)})).filter(row=>row.parts);
  const match=(row,parts)=>parts.every((p,i)=>folded(row.parts[i])===folded(p));
  const changed=()=>vm.host.persist?.();
  return {
    SaveSetting(app,section,key,value) {
      const parts=[part(app),part(section),part(key)],text=vbString(value);
      const found=rows().filter(row=>match(row,parts));
      const target=found[0]?.key??encode(parts);
      for(const row of found.slice(1))delete vm.settings[row.key];
      Object.defineProperty(vm.settings,target,{value:text,enumerable:true,writable:true,configurable:true});
      changed();
    },
    GetSetting(app,section,key,fallback='') {
      const parts=[part(app),part(section),part(key)],text=vbString(fallback);
      const direct=encode(parts);if(Object.hasOwn(vm.settings,direct))return vm.settings[direct];
      const found=rows().find(row=>match(row,parts));
      return found?vm.settings[found.key]:text;
    },
    GetAllSettings(app,section) {
      const parts=[part(app),part(section)],found=rows().filter(row=>match(row,parts));
      if(!found.length)return undefined;
      const result=new VBArray([[0,found.length-1],[0,1]],'String');result.dynamic=true;
      for(let i=0;i<found.length;i++) {
        result.set([i,0],found[i].parts[2]);result.set([i,1],vm.settings[found[i].key]);
      }
      return result;
    },
    DeleteSetting(app,section,key) {
      const parts=[part(app),part(section)];if(key!==undefined)parts.push(part(key));
      const found=rows().filter(row=>match(row,parts));
      if(!found.length)throw new VBError('Invalid procedure call or argument',5);
      for(const row of found)delete vm.settings[row.key];
      changed();
    },
  };
}
