import {UIWorkbenchModel} from './workbench-model.js';
import {IntelligentUIPanel} from './workbench.js';
import {observeUIHost} from './host-lifecycle.js';
import {renderContentPreview} from '../../packages/intelligent-ui/src/content-view.js';
import {createUIActionHandler} from './actions.js';
import {createStudioUIExtensions} from './extensions.js';
import {el} from '../core/core.js';
import {modal} from '../ide/ui.js';
import {configureThreadUI} from '../agents/thread-view.js';
import {UISurface} from '../../packages/intelligent-ui/src/surface.js';
import {UIRuntime} from '../../packages/intelligent-ui/src/runtime.js';
import {compile} from '../../packages/intelligent-ui/src/compiler.js';
import {McpUIService} from '../../packages/intelligent-ui/src/mcp.js';
import {IntelligentThreadContent} from './thread.js';
import {vb6UIFactories} from './controls.js';
import {configureIntelligentUIResource} from './adapter.js';
import {INTELLIGENT_UI_WORKER_SOURCE,INTELLIGENT_UI_MCP_HTML} from './payload.js';

export function installIntelligentUI(ide,studioAPI){
  if(ide.intelligentUI)return ide.intelligentUI;
  configureIntelligentUIResource(INTELLIGENT_UI_MCP_HTML);
  const agentAPI=ide.codingAgents,listeners=new Set();
  const host={enabled:true,contextRevision:0,workbench:new UIWorkbenchModel(),adapter:agentAPI.adapter,conversations:agentAPI.conversations,
    onChange(fn){listeners.add(fn);return()=>listeners.delete(fn);},
    setEnabled(value){if(host.disposed)return;host.enabled=!!value;host.lifecycle.check();},
    surfaceOptions(options){return host.extensions.surfaceOptions(options);},
    open(){if(host.disposed)throw new Error('Intelligent UI host is disposed.');let panel=ide.documents.tools.get('tool:intelligent-ui');if(!panel)panel=new IntelligentUIPanel(ide,host);ide.documents.openTool(panel);return panel;}
  };
  host.action=createUIActionHandler(host,{
    copy:text=>ide.root.ownerDocument.defaultView.navigator.clipboard.writeText(text),
    openLink:url=>ide.root.ownerDocument.defaultView.open(url,'_blank','noopener,noreferrer'),openAgent:()=>agentAPI.open(),
    review:async({type,origin,text,content,context,signal})=>{
      const previewRoot=el('div'),blocks=content||context?.content,preview=blocks?.length?renderContentPreview(previewRoot,blocks):null;
      let abort;const value=await modal('Intelligent UI — Review action',{width:680,content:el('div',{class:'agent-review'},el('p',{},origin+' requests '+type+'.'),el('p',{},type==='link'?'Opening this link may contact an external service.':type==='context'?'Replace this view’s model context for the next confirmed run. No message is sent or queued.':'Queue this reviewed content. Sending it still requires the coding agent’s provider and permission confirmation.'),el('pre',{class:'agent-log',tabindex:0},text),previewRoot),buttons:[{label:'Cancel',value:false,primary:true},{label:type==='link'?'Open link':type==='context'?'Replace reviewed context':'Queue reviewed message',value:true}],onReady:({finish})=>{abort=()=>finish(false);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();}}).finally(()=>{signal?.removeEventListener('abort',abort);preview?.dispose();});return value===true;
    }
  });
  host.extensions=createStudioUIExtensions(ide,host);
  host.lifecycle=observeUIHost(host,agentAPI,event=>{for(const fn of listeners)try{fn(event);}catch{}});
  host.dispose=()=>{if(host.disposed)return;host.setEnabled(false);host.disposed=true;host.lifecycle.dispose();ide.documents.tools.get('tool:intelligent-ui')?.dispose();host.extensions.dispose();host.workbench.dispose();listeners.clear();};
  ide.intelligentUI=host;configureThreadUI((view,markdown)=>new IntelligentThreadContent(view,host,markdown));
  const menu=ide.menu.bind(ide),command=ide.command.bind(ide);
  ide.menu=name=>{const items=menu(name);if(name==='Tools')items.unshift({label:'Intelligent UI…',id:'intelligentUI',icon:'form'});return items;};
  ide.command=(id,...args)=>id==='intelligentUI'?host.open():command(id,...args);
  studioAPI.IntelligentUI={compile,UIRuntime,UISurface,McpUIService,UIWorkbenchModel,vb6UIFactories,installIntelligentUI};
  const agentPanel=ide.documents.tools.get('tool:coding-agents');if(agentPanel?.threadView){agentPanel.threadView.version=-1;agentPanel.threadView.update(agentAPI.agent.thread,{taskId:host.conversations.activeId,busy:agentAPI.agent.busy});}
  return host;
}
