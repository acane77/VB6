import {DOMTuiRenderer} from './dom.js';
import {normalizeDOSSettings} from './cells.js';
const sessions=new WeakMap();
/** The runtime is bundled normally. A trusted host selects presentation via
 * fixed, validated attributes; no injected executable script or sandbox escape. */
export function installRuntimeTUI(container,options={}) {
  const document=container.ownerDocument||container,root=document.documentElement;
  const requested=options.presentation??(root.hasAttribute('data-vb-dos')?{mode:'dos',profile:root.getAttribute('data-vb-dos'),cellWidth:Number(root.getAttribute('data-dos-cell-width')),cellHeight:Number(root.getAttribute('data-dos-cell-height'))}:{});
  const settings=normalizeDOSSettings(requested);let renderer=sessions.get(document);
  if(settings.mode!=='dos'){renderer?.dispose();sessions.delete(document);return null;}
  if(renderer&&!renderer.disposed)renderer.configure(settings);else {renderer=new DOMTuiRenderer(document,{settings});sessions.set(document,renderer);}
  return renderer;
}
