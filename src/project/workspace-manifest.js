/** Lossless until membership is deliberately edited; unknown VBG rows survive. */
import {linesOf,preferredEOL,nativePathValue,replaceLineValue} from './native-text.js';
import {relativeProjectPath} from './frx.js';

export function editedWorkspaceManifest(workspace){
  if(!workspace.membershipEdited)return null;
  const w=workspace,lines=linesOf(w.document.text),eol=preferredEOL(w.document.text);
  const references=new Map((w.references||[]).map(r=>[r.index,r]));
  const template=new Map();let startupTemplate;
  for(const r of w.references||[]){
    if(r.key.toLowerCase()==='startupproject')startupTemplate=lines[r.index];
    else if(r.resolved&&!template.has(r.resolved.toLowerCase()))template.set(r.resolved.toLowerCase(),lines[r.index]);
  }
  const row=(key,path,line)=>{
    const value=nativePathValue(relativeProjectPath(w.path,path));
    const result=line?replaceLineValue(line,value,true):key+'='+value+eol;
    return /[\r\n]$/.test(result)?result:result+eol;
  };
  const block=w.order.map(path=>row('Project',path,template.get(path.toLowerCase()))).join('')+row('StartupProject',w.startupPath,startupTemplate);
  let output='',inserted=false;
  for(let i=0;i<lines.length;i++){
    const ref=references.get(i),managed=ref&&(ref.resolved||ref.key.toLowerCase()==='startupproject');
    if(!inserted&&(managed||/^\s*\[/.test(lines[i]))){if(output&&!/[\r\n]$/.test(output))output+=eol;output+=block;inserted=true;}
    if(!managed)output+=lines[i];
  }
  if(!inserted){if(output&&!/[\r\n]$/.test(output))output+=eol;output+=block;}
  return output;
}
