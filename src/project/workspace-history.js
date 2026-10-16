/** Shared structural undo barriers over independent, bounded project histories.
 * A group change can be undone only after later edits in every participating
 * project have been undone. This prevents old group snapshots erasing peers.
 * Host views and function-valued sparse edits stay in memory, never in projects.
 */
import {workspaceProjects,selectWorkspaceProject,validateWorkspace} from './native-project.js';

const emptyHistory=()=>({undo:[],redo:[],revision:0,clean:0,sequence:0});
const entryBytes=entry=>entry.bytes??(entry.before.length+entry.after.length)*2;

export class WorkspaceHistory {
  constructor(history){this.history=history;this.sessions=new Map();this.activeId=null;}
  session(project){
    let state=this.sessions.get(project.id);
    if(!state){state={id:project.id,name:project.name,...emptyHistory(),view:null};this.sessions.set(project.id,state);}
    state.name=project.name;return state;
  }
  remember(project,view){
    const state=this.session(project),snapshot=this.history.capture();
    state.undo=snapshot.undo;state.redo=snapshot.redo;state.revision=snapshot.revision;state.clean=snapshot.clean;state.sequence=snapshot.sequence;
    if(view!==undefined)state.view=view;this.activeId=project.id;return state;
  }
  enter(project){
    const state=this.session(project);
    this.history.restore({undo:state.undo,redo:state.redo,revision:state.revision,clean:state.clean,sequence:state.sequence});
    this.activeId=project.id;return state.view;
  }
  reset(){this.sessions.clear();this.activeId=null;}
  record(before,after,label='Edit project group'){
    validateWorkspace(before);validateWorkspace(after);
    const a=JSON.stringify(before),b=JSON.stringify(after);if(a===b)return false;
    this.remember(before);
    const members=new Map([...workspaceProjects(before),...workspaceProjects(after)].map(p=>[p.id,p]));
    const entry={kind:'workspace',before:a,after:b,label,participants:[...members.keys()],revisions:new Map()};
    entry.bytes=(a.length+b.length)*2;
    // One immutable snapshot pair is shared by all histories, not copied N times.
    for(const p of members.values()){
      const state=this.session(p),beforeRevision=state.revision,afterRevision=Math.max(state.sequence,beforeRevision)+1;
      entry.revisions.set(p.id,{beforeRevision,afterRevision});
      state.undo=[...state.undo,entry];state.redo=[];state.revision=afterRevision;state.sequence=afterRevision;
      let size=state.undo.reduce((n,e)=>n+entryBytes(e),0);
      while(state.undo.length>1&&(state.undo.length>this.history.limit||size>this.history.maxBytes)){const e=state.undo.shift();size-=entryBytes(e);}
    }
    this.enter(after);return true;
  }
  /** Returns null for an ordinary project edit; throws before mutating on conflict. */
  step(method,current){
    if(!['undo','redo'].includes(method))throw new Error('Unknown history direction');
    this.remember(current);
    const from=method==='undo'?'undo':'redo',to=method==='undo'?'redo':'undo',entry=this.session(current)[from].at(-1);
    if(entry?.kind!=='workspace')return null;
    for(const id of entry.participants){
      const state=this.sessions.get(id);
      if(state?.[from].at(-1)!==entry)throw new Error('Cannot '+method+' this group change: '+(state?.name||'a project')+' has later or discarded history. '+(method==='undo'?'Undo its later edits first.':'Redo the required earlier edits first.'));
    }
    let result=JSON.parse(method==='undo'?entry.before:entry.after);validateWorkspace(result);
    // Keep the active project when it exists on both sides of the barrier.
    const same=workspaceProjects(result).find(p=>p.id===current.id);
    if(same&&result.nativeWorkspace)result=selectWorkspaceProject(result,same.nativeProject.path);
    for(const id of entry.participants){
      const state=this.sessions.get(id),revision=entry.revisions.get(id);
      state[from].pop();state[to].push(entry);
      state.revision=method==='undo'?revision.beforeRevision:revision.afterRevision;
      state.sequence=Math.max(state.sequence,revision.afterRevision);
    }
    this.enter(result);return result;
  }
}
