/** Observe identity, not individual stream tokens. Re-entering a task never revives an old approval. */
export function observeUIHost(host,agentAPI,notify){
  let task=host.conversations.active,thread=task?.agent?.thread,epoch=host.adapter.workspaceEpoch,enabled=host.enabled,disposed=false;
  const check=()=>{
    if(disposed)return;const next=host.conversations.active,nextThread=next?.agent?.thread,nextEpoch=host.adapter.workspaceEpoch;
    if(next===task&&nextThread===thread&&nextEpoch===epoch&&enabled===host.enabled)return;
    const type=nextEpoch!==epoch?'workspace':enabled!==host.enabled?'enabled':'task';
    task=next;thread=nextThread;epoch=nextEpoch;enabled=host.enabled;host.contextRevision=(host.contextRevision||0)+1;
    if(type==='workspace')host.workbench?.clearSnapshots();
    notify({type,revision:host.contextRevision});
  };
  const offAgent=agentAPI.onChange(check),offAdapter=host.adapter.onChange(check);
  return {check,dispose(){if(disposed)return;disposed=true;offAgent();offAdapter();}};
}
