#!/usr/bin/env python3
"""Real GPU selection/retry and live Options regressions; no hardware speed claims."""
import argparse, functools, http.server, json, os, shutil, threading, traceback
from pathlib import Path
from playwright.sync_api import sync_playwright
from rendering_launch import rendering_launch_flags

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'reports/rendering/recovery'
OUT.mkdir(parents=True, exist_ok=True)
parser = argparse.ArgumentParser()
parser.add_argument('--require-webgpu', action='store_true')
parser.add_argument('--require-webgl2', action='store_true')
parser.add_argument('--software-gpu', action='store_true')
parser.add_argument('--headed', action='store_true')
parser.add_argument('--offline', action='store_true', help='Inline local bundles; required GPU backends still must execute')
args = parser.parse_args()
required = 'webgpu' if args.require_webgpu else 'webgl2' if args.require_webgl2 else 'canvas2d'
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args): pass
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=ROOT))
threading.Thread(target=server.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{server.server_port}/'
flags = rendering_launch_flags(software_gpu=args.software_gpu)
results = []
def load(page, ide=False):
    if args.offline: page.set_content((ROOT/'dist/VB6-Studio-Web.html').read_text() if ide else '<!doctype html><body></body>')
    else: page.goto(url+('dist/VB6-Studio-Web.html' if ide else 'tests/fixtures/rendering.html'))
    if not ide: page.add_script_tag(content=(ROOT/'dist/vb6-rendering.js').read_text())
def check(value, message):
    if not value: raise AssertionError(message)
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or p.chromium.executable_path,
        headless=not args.headed, args=flags, ignore_default_args=['--hide-scrollbars'])
    def case(name, action):
        context = browser.new_context(viewport={'width':1280,'height':900})
        page = context.new_page(); errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        try:
            details = action(page)
            check(not errors, str(errors))
            results.append({'name':name,'passed':True,'details':details}); print('PASS',name,flush=True)
        except Exception as error:
            results.append({'name':name,'passed':False,'error':str(error)}); traceback.print_exc(); print('FAIL',name,flush=True)
        finally: context.close()
    def adapter_selection(page, compatibility=False):
        load(page)
        return page.evaluate('''async({compatibility,required})=>{
          const {WebGPUPainter,PaintScene}=VB6Rendering;
          const gpu=navigator.gpu;if(!gpu){if(required==='webgpu')throw Error('WebGPU API required');return {skipped:'WebGPU API unavailable'};}
          const original=gpu.requestAdapter, calls=[];
          gpu.requestAdapter=function(options){calls.push({...options});
            if(compatibility ? options.featureLevel!=='compatibility' : options.powerPreference==='high-performance')return Promise.resolve(null);
            return original.call(this,options);
          };
          const canvas=document.createElement('canvas');document.body.append(canvas);let painter;
          try {
            painter=await WebGPUPainter.create(canvas,{timeout:15000});
            const s=new PaintScene(8,4);s.add([0,0,8,4],[1,0,0,1]);s.native([0,0,1,1],s.clip);s.add([4,0,4,4],[0,1,0,1]);
            const image=document.createElement('canvas');image.width=image.height=1;const ctx=image.getContext('2d');ctx.fillStyle='#0000ff';ctx.fillRect(0,0,1,1);
            s.add([2,2,2,2],[1,1,1,1],{page:{canvas:image,width:1,height:1,revision:1}});
            const output=await painter.render(s,{readback:true});
            for(let y=0;y<4;y++)for(let x=0;x<8;x++){
              const expected=x===0&&y===0?[0,0,0,0]:x>=2&&x<4&&y>=2?[0,0,255,255]:x>=4?[0,255,0,255]:[255,0,0,255];
              if(expected.some((v,c)=>output.data[(y*8+x)*4+c]!==v))throw Error('incorrect recovered GPU pixels at '+x+','+y);
            }
            if(!painter.stats.outputVerified)throw Error('Startup output not verified');
            if(compatibility ? painter.adapterInfo.request.featureLevel!=='compatibility' : Object.keys(painter.adapterInfo.request).length)throw Error('Wrong recovered adapter request');
            return {calls,adapter:painter.adapterInfo,pixelsChecked:32,stats:painter.stats};
          } finally {gpu.requestAdapter=original;painter?.dispose();canvas.remove();}
        }''', {'compatibility':compatibility,'required':required})
    if required == 'webgpu':
        case('null high-performance selection recovers with actual default GPU rendering',adapter_selection)
        case('compatibility selection renders ordered holes and textures with actual GPU readback',lambda page:adapter_selection(page,True))
    def webgl_selection(page):
        load(page)
        return page.evaluate('''async()=>{
          const {WebGLPainter,PaintScene}=VB6Rendering;
          const canvas=document.createElement('canvas'),original=canvas.getContext,calls=[];document.body.append(canvas);
          canvas.getContext=function(type,options){calls.push(options.powerPreference);return options.powerPreference==='high-performance'?null:original.call(this,type,options);};
          const painter=new WebGLPainter(canvas);
          try {const scene=new PaintScene(4,4);scene.add([0,0,4,4],[1,0,0,1]);painter.render(scene);const data=new Uint8Array(64),gl=painter.gl;
            gl.readPixels(0,0,4,4,gl.RGBA,gl.UNSIGNED_BYTE,data);
            if(data.some((v,i)=>v!==[255,0,0,255][i%4]))throw Error('incorrect recovered WebGL2 output');
            if(calls.join(',')!=='high-performance,default')throw Error('incorrect context selection');return {calls,pixelsChecked:16};
          }finally{painter.dispose();canvas.remove();}
        }''')
    if required in ('webgpu','webgl2'): case('WebGL2 default context recovers after a rejected high-performance hint',webgl_selection)
    def options_retry(page):
        load(page,ide=True);page.wait_for_function('window.vb6Studio?.rendering');page.evaluate('vb6Studio.rendering.ready')
        page.evaluate('''async backend=>{
          const r=vb6Studio.rendering;window.savedFactory=r.factory;window.savedProject=JSON.stringify(vb6Studio.project.settings);
          window.selectionCalls=[];r.factory=async(name,...rest)=>{selectionCalls.push(name);if(name!=='canvas2d')throw Error('simulated startup unavailable');return savedFactory(name,...rest);};
          await vb6Studio.setRenderingPolicy({backend,fallbacks:['canvas2d','html']});
          if(r.backend!=='canvas2d')throw Error('fallback not reproduced');
          window.savedPolicy=JSON.stringify(r.policy);window.storageSnapshot=()=>{try{return JSON.stringify(localStorage);}catch{return 'denied';}};window.savedStorage=storageSnapshot();
          window.statusListeners=new Set();const add=document.addEventListener,remove=document.removeEventListener;
          document.addEventListener=function(type,fn,...rest){if(type==='vb-rendering-status')statusListeners.add(fn);return add.call(this,type,fn,...rest);};
          document.removeEventListener=function(type,fn,...rest){if(type==='vb-rendering-status')statusListeners.delete(fn);return remove.call(this,type,fn,...rest);};
          vb6Studio.optionsDialog();
        }''',required if required!='canvas2d' else 'webgpu')
        page.get_by_role('tab', name='Rendering',exact=True).click()
        check('Canvas2D' in page.locator('[data-renderer-status]').inner_text(),'stale initial status')
        page.get_by_label('UI rendering backend').select_option('html')
        with page.expect_download() as download:
            page.get_by_role('button',name='Save Diagnostics...',exact=True).click()
        report=json.loads(Path(download.value.path()).read_text())
        check(report['renderer']['active']=='canvas2d','diagnostic file omitted actual fallback')
        check(report['renderer']['attempts'][0]['reason']=='simulated startup unavailable','failure reason lost')
        check(report['environment']['secureContext']==page.evaluate('isSecureContext'),'secure context misreported')
        page.evaluate('''()=>{const r=vb6Studio.rendering;r.factory=async(...args)=>{selectionCalls.push(args[0]);return savedFactory(...args);};}''')
        page.get_by_role('button',name='Retry Renderer',exact=True).click()
        page.wait_for_function('!vb6Studio.rendering.getStats().initializing && !document.querySelector("[data-renderer-status]").textContent.includes("Checking")')
        page.evaluate('vb6Studio.rendering.ready')
        actual=page.evaluate('vb6Studio.rendering.backend')
        check(actual==required,'retry did not recover required backend: '+actual)
        check(page.get_by_label('UI rendering backend').input_value()=='html','retry altered draft choice')
        label={'webgpu':'WebGPU (default)','webgl2':'WebGL2','canvas2d':'Canvas2D'}[actual]
        check('Active: '+label+'.' in page.locator('[data-renderer-status]').inner_text(),'live recovery status not updated')
        check(page.evaluate('JSON.stringify(vb6Studio.rendering.policy)===savedPolicy'),'retry changed saved policy')
        check(page.evaluate('storageSnapshot()===savedStorage'),'retry wrote preferences')
        check(page.evaluate('JSON.stringify(vb6Studio.project.settings)===savedProject'),'retry changed project')
        # Repeated identical publications must not write DOM or create an idle loop.
        writes=page.evaluate('''()=>{const root=document.querySelector('[data-renderer-status]').parentElement,o=new MutationObserver(()=>{});o.observe(root,{subtree:true,childList:true,attributes:true,characterData:true});for(let i=0;i<20;i++)vb6Studio.rendering.publish();const n=o.takeRecords().length;o.disconnect();return n;}''')
        check(writes==0,'unchanged status writes DOM: '+str(writes))
        page.screenshot(path=str(OUT/f'options-{required}.png'))
        page.get_by_role('button',name='Cancel',exact=True).click();page.wait_for_function('statusListeners.size===0')
        check(page.evaluate('JSON.stringify(vb6Studio.rendering.policy)===savedPolicy'),'Cancel applied draft HTML')
        # Closing while retry is pending must detach listeners and ignore late UI work.
        page.evaluate('''()=>{vb6Studio.optionsDialog();window.originalRetry=vb6Studio.retryRendering;vb6Studio.retryRendering=()=>new Promise(resolve=>window.finishRetry=resolve);}''')
        page.get_by_role('tab',name='Rendering',exact=True).click();page.get_by_role('button',name='Retry Renderer',exact=True).click()
        page.get_by_role('button',name='Cancel',exact=True).click();page.wait_for_function('statusListeners.size===0')
        page.evaluate('finishRetry();vb6Studio.retryRendering=originalRetry');page.wait_for_timeout(50)
        return {'active':actual,'unchangedStatusDOMWrites':writes,'diagnostics':report,'listenersAfterClose':page.evaluate('statusListeners.size')}
    case('Options live retry, draft isolation, downloadable diagnostics and modal cleanup',options_retry)
    report={'schema':1,'browser':browser.version,'requiredBackend':required,'flags':flags,'physicalHardwareQualified':False,'fixtureTransport':'inline-local-bundles' if args.offline else 'http','results':results}
    (OUT/f'{required}-{ "headed" if args.headed else "headless"}.json').write_text(json.dumps(report,indent=2))
    browser.close()
server.shutdown()
raise SystemExit(0 if all(r['passed'] for r in results) else 1)
