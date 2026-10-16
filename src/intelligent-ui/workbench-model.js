import {UIError, boundedData, record, LIMITS} from '../../packages/intelligent-ui/src/safety.js';

export const WORKBENCH_LIMITS=Object.freeze({documents:16,source:LIMITS.source,dataText:100000,history:64,historyBytes:2000000,workspaceBytes:4000000,fileBytes:1000000});
let sequence=0;
const fail=message=>{throw new UIError('workbench',message);};
const text=(value,max,name)=>{if(typeof value!=='string'||value.length>max)fail(name+' must contain at most '+max+' characters.');return value;};
const title=value=>{value=text(value,100,'Document title').trim();return value||'Untitled';};
const bytes=value=>JSON.stringify(value).length*2;
const content=doc=>({title:doc.title,source:doc.source,dataText:doc.dataText});
const same=(a,b)=>a.title===b.title&&a.source===b.source&&a.dataText===b.dataText;
const freeze=value=>{if(value&&typeof value==='object'){for(const v of Object.values(value))freeze(v);Object.freeze(value);}return value;};

/** Memory-only editable drafts. Files never contain grants, connections, tasks or live references. */
export class UIWorkbenchModel {
  constructor(){this.documents=new Map();this.activeId='';this.listeners=new Set();this.revision=0;this.disposed=false;}
  get active(){return this.documents.get(this.activeId)||null;}
  onChange(listener){this.listeners.add(listener);return()=>this.listeners.delete(listener);}
  live(){if(this.disposed)fail('Workbench is disposed.');}
  notify(type){this.revision++;for(const listener of this.listeners)try{listener({type,revision:this.revision,id:this.activeId});}catch{}}
  usage(replacement,except){let total=0;for(const doc of this.documents.values())if(doc.id!==except)total+=bytes(content(doc));return total+(replacement?bytes(replacement):0);}
  create({title:label='Untitled',source='',dataText='{}'}={}){
    this.live();if(this.documents.size>=WORKBENCH_LIMITS.documents)fail('Close a document before opening another (limit 16).');
    const draft={title:title(label),source:text(source,WORKBENCH_LIMITS.source,'Source'),dataText:text(dataText,WORKBENCH_LIMITS.dataText,'JSON data')};
    if(this.usage(draft)>WORKBENCH_LIMITS.workspaceBytes)fail('Workbench draft memory limit reached.');
    const doc={id:'draft-'+(++sequence),...draft,revision:1,undo:[],redo:[],checkpoint:content(draft),saved:null,snapshot:null};
    this.documents.set(doc.id,doc);this.activeId=doc.id;this.notify('create');return doc;
  }
  select(id){this.live();if(!this.documents.has(id))fail('Document is no longer open.');if(id===this.activeId)return this.active;this.checkpoint();this.activeId=id;this.notify('select');return this.active;}
  edit(patch){
    this.live();const doc=this.active;if(!doc)fail('Open a document first.');
    if(!record(patch)||Object.keys(patch).some(key=>!['title','source','dataText'].includes(key)))fail('Invalid document edit.');
    const next={title:title(patch.title??doc.title),source:text(patch.source??doc.source,WORKBENCH_LIMITS.source,'Source'),dataText:text(patch.dataText??doc.dataText,WORKBENCH_LIMITS.dataText,'JSON data')};
    if(same(doc,next))return false;
    if(this.usage(next,doc.id)>WORKBENCH_LIMITS.workspaceBytes)fail('Workbench draft memory limit reached.');
    Object.assign(doc,next);doc.revision++;doc.redo=[];this.notify('edit');return true;
  }
  checkpoint(){const doc=this.active;if(!doc||same(doc,doc.checkpoint))return;doc.undo.push(doc.checkpoint);doc.checkpoint=content(doc);this.trim(doc);}
  trim(doc){while(doc.undo.length>WORKBENCH_LIMITS.history||bytes(doc.undo)+bytes(doc.redo)>WORKBENCH_LIMITS.historyBytes){if(doc.undo.length)doc.undo.shift();else if(doc.redo.length)doc.redo.shift();else break;}}
  undo(){return this.travel('undo','redo');}
  redo(){return this.travel('redo','undo');}
  travel(from,to){
    this.live();const doc=this.active;if(!doc)return false;this.checkpoint();
    const stack=doc[from],next=stack.at(-1);if(!next)return false;
    if(this.usage(next,doc.id)>WORKBENCH_LIMITS.workspaceBytes)fail('Close another draft before restoring this history entry.');
    stack.pop();doc[to].push(content(doc));Object.assign(doc,next);doc.checkpoint=content(doc);doc.revision++;this.trim(doc);this.notify(from);return true;
  }
  get canUndo(){return !!this.active&&(this.active.undo.length>0||!same(this.active,this.active.checkpoint));}
  get canRedo(){return !!this.active?.redo.length;}
  dirty(doc=this.active){return !!doc&&(!doc.saved||!same(doc,doc.saved));}
  markSaved(id=this.activeId,revision=this.active?.revision){const doc=this.documents.get(id);if(doc&&doc.revision===revision){doc.saved=content(doc);this.notify('saved');return true;}return false;}
  duplicate(){if(!this.active)fail('Open a document first.');const current=this.active;this.checkpoint();return this.create({...content(current),title:(current.title+' copy').slice(0,100)});}
  close(id=this.activeId,{discard=false,expectedRevision}={}){
    this.live();const doc=this.documents.get(id);if(!doc)return false;
    if(expectedRevision!==undefined&&doc.revision!==expectedRevision)fail('Document changed during confirmation. Review it again.');
    if(this.dirty(doc)&&!discard)fail('Export or confirm discarding the unsaved document first.');
    this.documents.delete(id);if(this.activeId===id)this.activeId=this.documents.keys().next().value||'';this.notify('close');return true;
  }
  data(doc=this.active){
    if(!doc)fail('Open a document first.');let value;
    try{value=JSON.parse(doc.dataText);}catch(error){throw new UIError('data_json','Invalid preview JSON: '+error.message);}
    const clean=boundedData(value,250000);if(!record(clean))fail('Preview JSON must be an object.');return clean;
  }
  setSnapshot(value,id=this.activeId){const doc=this.documents.get(id);if(!doc)return;
    if(value===null){doc.snapshot=null;return;}
    const snapshot=boundedData(value,128000);if(!record(snapshot.state))fail('Invalid preview state.');doc.snapshot=freeze(snapshot);
  }
  clearSnapshots(){for(const doc of this.documents.values())doc.snapshot=null;}
  exportDocument(doc=this.active){if(!doc)fail('Open a document first.');return JSON.stringify({format:'vb6-intelligent-ui',version:1,...content(doc)},null,2)+'\n';}
  importDocument(value,{name='Imported UI',sourceOnly=false}={}){
    this.live();text(value,WORKBENCH_LIMITS.fileBytes,'Import');
    if(sourceOnly)return this.create({title:name.slice(0,100),source:value});
    let parsed;try{parsed=JSON.parse(value);}catch{fail('The document is not valid JSON. Use a .dil or .txt file for plain source.');}
    const clean=boundedData(parsed,WORKBENCH_LIMITS.fileBytes);
    if(!record(clean)||clean.format!=='vb6-intelligent-ui'||clean.version!==1||Object.keys(clean).some(key=>!['format','version','title','source','dataText'].includes(key)))fail('Unsupported Intelligent UI document format.');
    for(const key of ['title','source','dataText'])if(typeof clean[key]!=='string')fail('Document is missing '+key+'.');
    const doc=this.create(clean);this.markSaved();return doc;
  }
  dispose(){if(this.disposed)return;this.disposed=true;this.documents.clear();this.listeners.clear();this.activeId='';}
}

/** Compiler offsets and editor selection both use UTF-16 offsets, including CRLF and emoji. */
export function sourceLocation(source,offset=0){
  offset=Math.max(0,Math.min(source.length,Number.isFinite(offset)?Math.floor(offset):0));
  const prefix=source.slice(0,offset),last=prefix.lastIndexOf('\n');
  return {offset,line:prefix.split('\n').length,column:offset-last};
}

/** Reject expanding replacements before allocating their result. No regular expressions or $ substitutions. */
export function replaceAllLiteral(source,query,replacement,limit=WORKBENCH_LIMITS.source){
  text(source,limit,'Source');text(query,1000,'Search');text(replacement,1000,'Replacement');
  if(!query)return source;let count=0,at=0;
  while((at=source.indexOf(query,at))!==-1){count++;at+=query.length;}
  if(source.length+count*(replacement.length-query.length)>limit)fail('Replacement exceeds the source character limit.');
  return source.split(query).join(replacement);
}
