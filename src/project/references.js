/** Known VBP reference paths; unknown vendor records remain opaque. No resolution I/O. */
import {cleanProjectPath,relativeProjectPath} from './frx.js';
import {unquote,quote,nativePathValue} from './native-text.js';
const guid='\\{[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\}';
const library=new RegExp('^(\\*\\\\G'+guid+'#[^#]*#[^#]*#)([^#]*)(#.*)$','i');
const component=new RegExp('^("?'+guid+'#[^;"\\r\\n]+"?\\s*;\\s*)(.+)$','i');
export function projectReferencePath(reference){
  if(!reference||typeof reference.value!=='string')return null;
  const value=unquote(reference.value);let match;
  if(reference.kind==='Reference'){
    match=value.match(/^(\*\\A)(.+)$/i);if(match)return {type:'project',prefix:match[1],path:unquote(match[2]),pathQuoted:match[2].trim().startsWith('"'),suffix:''};
    match=value.match(library);if(match)return {type:'library',prefix:match[1],path:unquote(match[2]),pathQuoted:match[2].trim().startsWith('"'),suffix:match[3]};
  }else if(reference.kind==='Object'){
    match=reference.value.trim().match(component);if(match)return {type:'object',prefix:match[1],path:unquote(match[2]),pathQuoted:match[2].trim().startsWith('"'),suffix:''};
  }
  return null;
}
export function sourceProjectReference(reference){const parsed=projectReferencePath(reference);return parsed?.type==='project'?parsed.path:null;}
export function resolveReferencePath(owner,reference){
  if(typeof reference!=='string'||/^[\\/]|^[a-z]:|[\r\n\0]/i.test(reference))return null;
  const parent=cleanProjectPath(owner).split('/').slice(0,-1).join('/');
  try{return cleanProjectPath((parent?parent+'/':'')+reference);}catch{return null;}
}
export function rebaseProjectReference(reference,from,to,{movedFrom,movedTo}={}){
  const result=structuredClone(reference),parsed=projectReferencePath(reference);if(!parsed)return result;
  // Absolute system/COM paths are retained as metadata, never opened or fetched.
  if(/^[\\/]|^[a-z]:/i.test(parsed.path))return result;
  // Bare OCX/DLL names in Object records use the registered component, not a
  // project-relative directory. Explicit relative component paths can be rebased.
  if(parsed.type==='object'&&!/[\\/]/.test(parsed.path))return result;
  const resolved=resolveReferencePath(from,parsed.path);
  if(!resolved){if(from!==to)throw new Error('Cannot rebase reference outside the selected workspace: '+parsed.path);return result;}
  const target=parsed.type==='project'&&movedFrom&&resolved.toLowerCase()===movedFrom.toLowerCase()?movedTo:resolved;
  if(from===to&&target===resolved)return result;
  const path=relativeProjectPath(to,target),value=parsed.prefix+(parsed.pathQuoted?quote(path):nativePathValue(path))+parsed.suffix;
  result.value=parsed.type!=='object'&&reference.value.trim().startsWith('"')?quote(value):value;
  return result;
}
