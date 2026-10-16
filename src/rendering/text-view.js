/** Explicit trusted presentation extension shared across independently bundled
 * editors. The binding lives on its own DOM node, not on a process-global map.
 * A disposed registration cannot retire a later replacement. */
const key=Symbol.for('vb6.rendering.text-view.v1');
export function registerTextView(node,provider){
  if(!node?.ownerDocument||typeof provider?.read!=='function'||typeof provider?.subscribe!=='function')throw new TypeError('A text-view provider is required');
  const binding=Object.freeze({read:provider.read,subscribe:provider.subscribe,configure:provider.configure});
  Object.defineProperty(node,key,{value:binding,configurable:true});node.setAttribute('data-vb-text-view','');
  node.dispatchEvent(new node.ownerDocument.defaultView.CustomEvent('vb-text-view-changed',{bubbles:true}));
  return ()=>{if(node[key]!==binding)return;delete node[key];node.removeAttribute('data-vb-text-view');node.dispatchEvent(new node.ownerDocument.defaultView.CustomEvent('vb-text-view-changed',{bubbles:true}));};
}
export function textViewFor(node){return Object.getOwnPropertyDescriptor(node,key)?.value||null;}
