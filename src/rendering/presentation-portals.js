/** Optional presentation inheritance for menus/dialogs rendered outside a host.
 * The semantic control owns the portal; a visual subscriber owns only its paint.
 * No module imports a presentation backend through this bridge. */
const roots=new WeakMap(),bindings=new WeakMap();
export function registerPresentationRoot(root,attach) {
  if(roots.has(root)||typeof attach!=='function')throw new TypeError('Invalid presentation root');
  const entry={attach};roots.set(root,entry);
  return ()=>{if(roots.get(root)===entry)roots.delete(root);};
}
export function bindPresentationPortal(owner,portal) {
  const previous=bindings.get(portal);previous?.();
  let boundary=owner?.nodeType===1?owner:owner?.parentElement;
  while(boundary&&!roots.has(boundary)) {
    if(boundary.hasAttribute('data-tui-boundary'))break;
    boundary=boundary.parentElement;
  }
  const release=roots.get(boundary)?.attach(portal)||(()=>{});let disposed=false;
  const off=()=>{if(disposed)return;disposed=true;release();if(bindings.get(portal)===off)bindings.delete(portal);};
  bindings.set(portal,off);return off;
}
