#!/usr/bin/env python3
"""Native-raster investigation, not an acceptance test or a reference updater.

Runs independent variants in disposable documents. It never changes shipped
styles, the strict 40-case suite, or a reference based on the observed result.
"""
import argparse
import functools
import hashlib
import http.server
import json
import os
from pathlib import Path
import threading
from playwright.sync_api import sync_playwright
from rendering_launch import rendering_launch_flags
from rendering_pixels import compare_pixels

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'reports/rendering/edge-diagnostics'
VARIANTS = {
    'unchanged': '',
    'identity-transform': "document.querySelector('.designer-form').style.transform='none'",
    'button-appearance': "document.querySelectorAll('.vb-command').forEach(n=>n.style.appearance='none')",
    'button-isolation': "document.querySelectorAll('.vb-command').forEach(n=>n.style.isolation='isolate')",
    'form-isolation': "document.querySelector('.designer-form').style.isolation='isolate'",
    'button-paint-containment': "document.querySelectorAll('.vb-command').forEach(n=>n.style.contain='paint')",
    'grid-canvas2d': "vb6Studio.designer.grid.releaseGPU();vb6Studio.designer.grid.invalidate()",
    'plane-composition': "document.querySelector('.designer-plane').style.transform='translateZ(0)'",
}

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--headed', action='store_true')
    options = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=ROOT))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    report = {'diagnosticOnly': True, 'variants': []}
    flags = rendering_launch_flags(software_gpu=True)
    report['flags'] = flags
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or pw.chromium.executable_path,
                                        headless=not options.headed, args=flags, ignore_default_args=['--hide-scrollbars'])
            report['browser'] = browser.version
            for name, expression in VARIANTS.items():
                context = browser.new_context(viewport={'width': 1280, 'height': 800}, device_scale_factor=1.25)
                try:
                    page = context.new_page()
                    page.goto(f'http://127.0.0.1:{server.server_port}/dist/VB6-Studio-Web.html')
                    page.wait_for_function('window.vb6Studio?.rendering')
                    page.evaluate('vb6Studio.rendering.ready')
                    page.evaluate('vb6Studio.designer.grid.gpuReady')
                    page.evaluate('vb6Studio.setRenderingPolicy({backend:"html"})')
                    if expression:
                        page.evaluate(expression)
                    for theme in ['fluent', 'fluent-dark']:
                        page.evaluate('theme=>{Object.assign(vb6Studio.appearance,{theme,reduceMotion:true});vb6Studio.applyAppearance()}', theme)
                        previous = None
                        samples = []
                        for frame in range(12):
                            page.evaluate('async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))}')
                            current = page.screenshot(caret='initial')
                            delta = compare_pixels(previous, current) if previous else None
                            samples.append({'frame': frame, 'sha256': hashlib.sha256(current).hexdigest(), 'difference': delta})
                            if frame == 0 or delta and delta['changedPixels']:
                                (OUT/f'{name}-{theme}-{frame}.png').write_bytes(current)
                            previous = current
                        state = page.evaluate('''()=>({grid:vb6Studio.designer.grid.backend,
                          formTransform:getComputedStyle(document.querySelector('.designer-form')).transform,
                          commands:[...document.querySelectorAll('.vb-command')].map(n=>{
                            const s=getComputedStyle(n);return {text:n.textContent,rect:n.getBoundingClientRect().toJSON(),
                              appearance:s.appearance,shadow:s.boxShadow,background:s.backgroundImage,contain:s.contain,
                              isolation:s.isolation,transform:s.transform};})})''')
                        record = {'variant': name, 'theme': theme, 'samples': samples, 'state': state}
                        report['variants'].append(record)
                        print(json.dumps({'variant': name, 'theme': theme, 'grid': state['grid'],
                                          'differences': [s['difference'] for s in samples[3:]]}), flush=True)
                        (OUT/'diagnostics.json').write_text(json.dumps(report, indent=2))
                finally:
                    context.close()
            browser.close()
    finally:
        (OUT/'diagnostics.json').write_text(json.dumps(report, indent=2))
        server.shutdown()

if __name__ == '__main__':
    main()
