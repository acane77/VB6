/** One media listener per query/window, shared by IDEs, previews and applications.
 * Preferences are transient: never write an OS choice into authored settings.
 * MediaQueryList compatibility: https://developer.mozilla.org/en-US/docs/Web/API/MediaQueryList
 */
export const THEME_MEDIA_QUERIES=Object.freeze({
  dark:'(prefers-color-scheme: dark)',
  reducedMotion:'(prefers-reduced-motion: reduce)',
  reducedTransparency:'(prefers-reduced-transparency: reduce)',
  moreContrast:'(prefers-contrast: more)',
  forcedColors:'(forced-colors: active)'
});
const windows=new WeakMap();
const defaults=Object.freeze(Object.fromEntries(Object.keys(THEME_MEDIA_QUERIES).map(key=>[key,false])));
const read=media=>Object.freeze(Object.fromEntries(Object.keys(THEME_MEDIA_QUERIES).map(key=>[key,media[key]?.matches===true])));
const equal=(a,b)=>Object.keys(THEME_MEDIA_QUERIES).every(key=>a[key]===b[key]);
function listen(media,callback) {
  if(typeof media?.addEventListener==='function') {
    media.addEventListener('change',callback);
    return ()=>media.removeEventListener('change',callback);
  }
  if(typeof media?.addListener==='function') {
    media.addListener(callback);
    return ()=>media.removeListener(callback);
  }
  return ()=>{};
}
export function observeThemeEnvironment(view,callback) {
  if(!view)return {get snapshot(){return defaults;},media:Object.freeze({}),refresh:()=>defaults,dispose:()=>{}};
  let state=windows.get(view);
  if(!state) {
    const media={};
    for(const [key,query] of Object.entries(THEME_MEDIA_QUERIES)) {
      try{media[key]=view.matchMedia?.(query);}catch{media[key]=null;}
    }
    state={media:Object.freeze(media),snapshot:read(media),listeners:new Set(),releases:[]};
    const refresh=()=>{
      const next=read(media);
      if(equal(next,state.snapshot))return state.snapshot;
      state.snapshot=next;
      for(const listener of [...state.listeners]) {
        if(!state.listeners.has(listener))continue;
        try{listener(next);}catch(error){
          if(typeof view.reportError==='function')view.reportError(error);
          else queueMicrotask(()=>{throw error;});
        }
      }
      return next;
    };
    state.refresh=refresh;
    // Some embedded hosts share MediaQueryList instances; attach only once.
    for(const item of new Set(Object.values(media)))state.releases.push(listen(item,refresh));
    windows.set(view,state);
  }
  let disposed=false;
  // Refresh stale BFCache/media state before subscribing the new consumer.
  state.refresh();
  const listener=value=>callback(value);
  state.listeners.add(listener);
  return {media:state.media,get snapshot(){return state.snapshot;},refresh:state.refresh,dispose(){
    if(disposed)return;disposed=true;state.listeners.delete(listener);
    if(!state.listeners.size){for(const release of state.releases)release();windows.delete(view);}
  }};
}
/** Shared bounded writes. Removal is idempotent too (important for observers). */
export function writeThemeAttributes(target,attributes) {
  let changed=false;
  for(const [name,value] of Object.entries(attributes)) {
    const next=value==null?null:String(value);
    if(target.getAttribute(name)===next)continue;
    if(next===null)target.removeAttribute(name);else target.setAttribute(name,next);
    changed=true;
  }
  return changed;
}
export function dispatchThemeEvent(target,name,detail) {
  const EventClass=target.ownerDocument?.defaultView?.CustomEvent||globalThis.CustomEvent;
  target.dispatchEvent(new EventClass(name,{bubbles:true,detail}));
}
