#!/usr/bin/env python3
"""Real backend resource, rounded-paint and suspension regressions.

Every requested backend must execute; fallback is a failure. HTTP and file are
selected by the existing CI suite runner. GPU flags are confined to this explicit
software-driver qualification, never to the application. Pixel assertions use
zero tolerance and save the failing images before reporting a failure.
"""
import functools
import http.server
import io
import json
import os
from pathlib import Path
import shlex
import shutil
import threading
import time
import traceback
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright
from rendering_pixels import compare_pixels

ROOT = Path(__file__).resolve().parents[1]
ENGINE = os.environ.get('VB6_BROWSER', 'chromium')
TRANSPORT = os.environ.get('VB6_TEST_TRANSPORT', 'http')
BACKEND = os.environ.get('VB6_FIGMA_CODE_GPU') or 'canvas2d'
if ENGINE not in ('chromium', 'firefox', 'webkit') or TRANSPORT not in ('http', 'file'):
    raise ValueError('Unsupported qualification engine/transport')
if BACKEND not in ('canvas2d', 'webgpu', 'webgl2') or (BACKEND != 'canvas2d' and ENGINE != 'chromium'):
    raise ValueError('Required GPU qualification uses Chromium')
# Keep pixels alongside suite logs: every owning CI artifact includes reports/ci.
OUT = ROOT / 'reports' / 'ci' / f'rendering-resources-{ENGINE}-{BACKEND}-{TRANSPORT}'
OUT.mkdir(parents=True, exist_ok=True)
BUNDLE = (ROOT / 'dist/vb6-rendering.js').read_text()
RESULTS = []

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass

server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
URL = ((ROOT / 'tests/fixtures/rendering.html').as_uri() if TRANSPORT == 'file' else
       f'http://127.0.0.1:{server.server_port}/tests/fixtures/rendering.html')


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def exact(name, expected, actual):
    (OUT / (name + '-expected.png')).write_bytes(expected)
    (OUT / (name + '-actual.png')).write_bytes(actual)
    difference = compare_pixels(expected, actual)
    require(difference['changedPixels'] == 0, name + ': ' + str(difference))
    return difference


def png(image):
    output = io.BytesIO()
    image.save(output, format='PNG')
    return output.getvalue()


with sync_playwright() as pw:
    options = {'headless': True}
    if ENGINE == 'chromium':
        options['executable_path'] = os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or pw.chromium.executable_path
        flags = ['--no-sandbox']
        if BACKEND != 'canvas2d':
            flags += ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
                      '--use-vulkan=swiftshader', '--enable-gpu', '--ignore-gpu-blocklist',
                      '--enable-features=Vulkan', '--use-webgpu-adapter=swiftshader',
                      '--disable-vulkan-surface', '--disable-gpu-rasterization',
                      '--disable-partial-raster', '--run-all-compositor-stages-before-draw']
        flags += shlex.split(os.environ.get('RENDERING_BROWSER_FLAGS', ''))
        options.update(args=flags, ignore_default_args=['--hide-scrollbars'])
    browser = getattr(pw, ENGINE).launch(**options)

    def case(name, action, dpr=1):
        start = time.perf_counter()
        errors = []
        context = browser.new_context(viewport={'width': 640, 'height': 480}, device_scale_factor=dpr)
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        record = {'name': name, 'dpr': dpr, 'passed': False}
        try:
            page.goto(URL)
            page.add_script_tag(content=BUNDLE)
            page.evaluate('backend=>{window.requiredBackend=backend;window.afterFrames=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));}', BACKEND)
            record['details'] = action(page)
            require(not errors, 'Uncaught page errors: ' + str(errors))
            record['passed'] = True
            print('PASS', name, dpr, flush=True)
        except Exception as failure:
            record['error'] = str(failure)
            traceback.print_exc(limit=3)
            try:
                page.screenshot(path=str(OUT / (name + f'-{dpr}-failure.png')), timeout=5000)
            except Exception:
                pass
            print('FAIL', name, dpr, str(failure), flush=True)
        finally:
            record.update(pageErrors=errors, milliseconds=round((time.perf_counter() - start) * 1000, 2))
            RESULTS.append(record)
            (OUT / 'results.json').write_text(json.dumps({'browser': ENGINE, 'version': browser.version,
                'backend': BACKEND, 'transport': TRANSPORT, 'softwareGpu': BACKEND != 'canvas2d',
                'physicalHardwareQualified': False, 'passed': all(r['passed'] for r in RESULTS), 'cases': RESULTS}, indent=2))
            context.close()

    def shared_textures(page):
        details = page.evaluate('''async()=>{
          const R=VB6Rendering, source=document.createElement('canvas');source.width=source.height=32;
          const context=source.getContext('2d');context.fillStyle='blue';context.fillRect(0,0,32,32);
          const resource={canvas:source,width:32,height:32,revision:0};
          const scene=new R.PaintScene(32,32);scene.add(scene.clip,[1,1,1,1],{page:resource});scene.seal();
          const painters=[];for(let i=0;i<2;i++){
            const canvas=document.createElement('canvas');canvas.id='shared'+i;canvas.style.cssText='display:block;width:32px;height:32px';document.body.append(canvas);
            const painter=await R.createPainter(requiredBackend,canvas,{timeout:15000,preserveDrawingBuffer:true});
            painter.render(scene);painters.push(painter);
          }
          const before=painters.map(p=>({...p.stats}));context.fillStyle='red';context.fillRect(3,5,7,9);R.markTextureDirty(resource,[3,5,7,9]);
          for(const p of painters)p.render(scene);await afterFrames();
          window.painters=painters;return painters.map((p,i)=>({name:p.name,
            textureBytes:(p.stats.textureUploadedBytes||0)-(before[i].textureUploadedBytes||0),
            instanceBytes:(p.stats.instanceUploadedBytes||0)-(before[i].instanceUploadedBytes||0),
            partialUploads:(p.stats.partialTextureUploads||0)-(before[i].partialTextureUploads||0)}));
        }''')
        expected = Image.new('RGB', (32, 32), 'blue')
        ImageDraw.Draw(expected).rectangle((3, 5, 9, 13), fill='red')
        for index, detail in enumerate(details):
            require(detail['name'] == BACKEND, str(detail))
            if BACKEND != 'canvas2d':
                require(detail['textureBytes'] == 252 and detail['partialUploads'] == 1 and detail['instanceBytes'] == 0, str(detail))
            exact(f'shared-{index}', png(expected), page.locator('#shared' + str(index)).screenshot())
        page.evaluate('painters.forEach(p=>p.dispose())')
        return details

    def changed_instance(page):
        detail = page.evaluate('''async()=>{
          const R=VB6Rendering,c=document.createElement('canvas');c.id='grid';c.style.cssText='display:block;width:100px;height:100px';document.body.append(c);
          const p=window.gridPainter=await R.createPainter(requiredBackend,c,{timeout:15000,preserveDrawingBuffer:true});
          const make=changed=>{const s=new R.PaintScene(100,100);for(let i=0;i<10000;i++)s.add([i%100,Math.floor(i/100),1,1],i===changed?[1,0,0,1]:[0,0,1,1]);return s.seal();};
          p.render(make(-1));const before={...p.stats};p.render(make(5017));await afterFrames();
          return {name:p.name,bytes:(p.stats.instanceUploadedBytes||0)-(before.instanceUploadedBytes||0),
            uploads:(p.stats.instanceUploads||0)-(before.instanceUploads||0),commands:10000};
        }''')
        require(detail['name'] == BACKEND, str(detail))
        if BACKEND != 'canvas2d':
            require(detail['bytes'] == 96 and detail['uploads'] == 1, str(detail))
        expected = Image.new('RGB', (100, 100), 'blue')
        expected.putpixel((17, 50), (255, 0, 0))
        exact('changed-instance', png(expected), page.locator('#grid').screenshot())
        page.evaluate('gridPainter.dispose()')
        return detail

    def atlas_churn(page):
        detail = page.evaluate('''async()=>{
          const R=VB6Rendering,c=document.createElement('canvas');c.id='atlas';c.style.cssText='display:block;width:128px;height:32px';document.body.append(c);
          const painter=await R.createPainter(requiredBackend,c,{timeout:15000,preserveDrawingBuffer:true});
          const atlas=new R.TextAtlas(document,{size:64,maxPages:2}),style={font:'10px monospace',fontSize:'10px',color:'rgb(0, 0, 0)',direction:'ltr'};
          let peak=0;for(let frame=0;frame<120;frame++){
            atlas.begin();const glyph=atlas.text('v'+frame,style,[2,2,60,12]);if(!glyph)throw Error('Atlas stopped painting at '+frame);
            const s=new R.PaintScene(128,32);s.add(s.clip,[1,1,1,1]);s.add(glyph.rect,[1,1,1,1],{page:glyph.page,uv:glyph.uv});
            atlas.end();painter.render(s.seal());peak=Math.max(peak,atlas.getStats().allocatedBytes);
            if(frame%20===0)await afterFrames();
          }
          await afterFrames();const before=atlas.getStats();for(let i=0;i<50;i++)atlas.text('v119',style,[2,2,60,12]);
          const stats=atlas.getStats();window.atlasResources={painter,atlas};
          return {name:painter.name,...stats,peak,warmMeasurements:stats.measurements-before.measurements};
        }''')
        require(detail['name'] == BACKEND and detail['capacityMisses'] == 0 and detail['evictions'] > 0, str(detail))
        require(detail['peak'] <= detail['budgetBytes'] and detail['warmMeasurements'] == 0, str(detail))
        image = page.locator('#atlas').screenshot()
        (OUT / 'atlas-churn.png').write_bytes(image)
        with Image.open(io.BytesIO(image)) as displayed:
            require(any(min(pixel[:3]) < 100 for pixel in displayed.convert('RGB').getdata()), 'Final atlas glyph disappeared')
        released = page.evaluate('''()=>{const {painter,atlas}=atlasResources,old=[...atlas.pages];atlas.dispose();painter.dispose();return old.every(p=>p.canvas.width===1&&p.canvas.height===1)}''')
        require(released, 'Atlas backing stores were retained')
        return detail

    def rounded_paint(page):
        page.evaluate('''()=>{document.body.innerHTML=`<style>
          body{background:white;font:14px sans-serif}.box{position:absolute;background:#80c0e0;border:4px solid #163c72;box-sizing:border-box}
          #one{left:24px;top:24px;width:176px;height:88px;border-radius:24px 12px 30px 8px;overflow:hidden}
          #one>div{position:absolute;left:-12px;top:32px;width:210px;height:44px;background:#ffd040}
          #two{left:244px;top:24px;width:160px;height:96px;border-radius:70% 30% / 40% 60%;border-width:12px 8px;border-color:red green blue purple}
          #three{left:440px;top:24px;width:120px;height:88px;border-radius:18px;box-shadow:12px 16px 0 #345678}
          #four{left:72px;top:204px;width:140px;height:64px;border-radius:12px;box-shadow:28px 8px 18px 4px #111;outline:4px solid red;outline-offset:14px}
          #five{left:300px;top:208px;width:160px;height:80px;border-radius:120px 20px 80px 10px / 90px 60px 10px 80px}
          #button{position:absolute;left:24px;top:360px}
          </style><div class=box id=one><div></div></div><div class=box id=two></div><div class=box id=three></div><div class=box id=four></div><div class=box id=five></div><button id=button>Count</button>`;
          window.clicks=0;document.querySelector('#button').onclick=()=>clicks++;
        }''')
        page.evaluate('afterFrames()')
        expected = page.screenshot()
        detail = page.evaluate('''async()=>{
          const r=window.paintRenderer=new VB6Rendering.UIRenderer(document,{backend:requiredBackend,fallbacks:['html'],text:'native'});
          await r.ready;await afterFrames();return r.getStats();
        }''')
        require(detail['active'] == BACKEND, str(detail['attempts']))
        require(detail['last'].get('gpuRoundedBoxes', 0) >= 4, 'Rounded boxes all fell back: ' + str(detail['last']))
        difference = exact('rounded-' + str(page.evaluate('devicePixelRatio')), expected, page.screenshot())
        page.locator('#button').click()
        require(page.evaluate('clicks') == 1, 'Overlay swallowed native input')
        page.evaluate('paintRenderer.dispose()')
        return {'active': detail['active'], 'last': detail['last'], 'pixels': difference}

    def native_text_and_print(page):
        page.evaluate('''()=>{document.body.innerHTML=`<style>body{font:16px monospace;background:white}p{margin:16px;width:max-content}#upper{text-transform:uppercase}#features{font-feature-settings:"liga" 0}#tabs{white-space:pre}</style><p id=upper>uppercase remains native</p><p id=features>office ffi</p><p id=tabs>left\\tright</p>`;}''')
        page.evaluate('afterFrames()')
        expected = page.screenshot()
        before = page.evaluate('''async()=>{
          const r=window.textRenderer=new VB6Rendering.UIRenderer(document,{backend:requiredBackend,fallbacks:['html'],text:'gpu'});
          await r.ready;await afterFrames();return r.getStats();
        }''')
        require(before['active'] == BACKEND and before['last']['nativeText'] >= 3 and before['last']['gpuText'] == 0, str(before))
        exact('native-text', expected, page.screenshot())
        suspended = page.evaluate('''()=>{
          dispatchEvent(new Event('beforeprint'));const before=textRenderer.metrics.frames;textRenderer.renderNow({force:true});
          return {unchanged:before===textRenderer.metrics.frames,hidden:textRenderer.canvas.style.visibility==='hidden',queued:textRenderer.frame};
        }''')
        require(suspended['unchanged'] and suspended['hidden'] and suspended['queued'] is None, str(suspended))
        page.evaluate('''async()=>{dispatchEvent(new Event('afterprint'));await afterFrames();}''')
        after = page.evaluate('textRenderer.getStats()')
        require(after['active'] == BACKEND and after['frames'] > before['frames'], str(after))
        require(page.evaluate('textRenderer.canvas.style.visibility') == 'visible', 'Print left the overlay hidden')
        exact('after-print', expected, page.screenshot())
        page.evaluate('textRenderer.dispose()')
        return {'before': before['last'], 'after': after['last'], 'suspended': suspended}

    def canvas_loss(page):
        detail = page.evaluate('''async()=>{
          document.body.innerHTML='<div style="width:100px;height:100px;background:blue"></div>';
          const r=new VB6Rendering.UIRenderer(document,{backend:'canvas2d',fallbacks:['html']});await r.ready;
          if(r.backend!=='canvas2d')throw Error('Canvas backend did not initialize');
          r.canvas.dispatchEvent(new Event('contextlost'));await r.ready;
          const result={active:r.backend,layers:document.querySelectorAll('[data-vb-render-layer]').length};r.dispose();return result;
        }''')
        require(detail['active'] == 'html' and detail['layers'] == 0, str(detail))
        return {'simulatedContextLossEvent': True, **detail}

    case('independent-shared-texture-cursors', shared_textures)
    case('single-instance-edit-in-10000', changed_instance)
    case('bounded-atlas-churn', atlas_churn)
    for scale in [1, 1.25, 1.5, 2]:
        case('rounded-paint-exact', rounded_paint, scale)
    case('native-text-and-print', native_text_and_print)
    if BACKEND == 'canvas2d':
        case('canvas-context-loss-fallback', canvas_loss)
    browser.close()
server.shutdown()
server.server_close()
raise SystemExit(0 if RESULTS and all(result['passed'] for result in RESULTS) else 1)
