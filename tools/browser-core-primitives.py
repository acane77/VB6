#!/usr/bin/env python3
"""Real DOM/popup/download/stream coverage for shared core primitives.

CI uses a real HTTP origin and every supported engine. Explicit memory mode is
for offline development only; it never counts as HTTP/WebCrypto verification.
"""
import functools
import hashlib
import http.server
import json
import os
from pathlib import Path
import shutil
import subprocess
import threading
import unittest
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / 'reports/core-primitives-browser'
DIGEST = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass

class CorePrimitives(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        REPORT.mkdir(parents=True, exist_ok=True)
        result = subprocess.run(['node', '--input-type=module', '-e',
            "import {bundle} from './tools/bundle.mjs';process.stdout.write(bundle('tests/fixtures/core-browser-entry.js','CoreTest'));"],
            cwd=ROOT, check=True, capture_output=True, text=True)
        cls.html = '<!doctype html><meta charset="utf-8"><title>Core primitives acceptance</title><body><main id="root"></main><script>' + result.stdout.replace('</script', '<\\/script') + '</script>'
        (REPORT / 'fixture.html').write_text(cls.html)
        cls.transport = os.environ.get('VB6_TEST_TRANSPORT', 'http')
        if cls.transport not in ('http', 'file', 'memory'):
            raise ValueError('Unknown test transport')
        cls.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(ROOT)))
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f'http://127.0.0.1:{cls.server.server_port}/reports/core-primitives-browser/fixture.html'
        cls.pw = sync_playwright().start()
        cls.engine = os.environ.get('VB6_BROWSER', 'chromium')
        options = {}
        if cls.engine == 'chromium':
            executable = os.environ.get('CHROMIUM_PATH') or shutil.which('chromium')
            if executable:
                options['executable_path'] = executable
            options['args'] = ['--no-sandbox']
        cls.browser = getattr(cls.pw, cls.engine).launch(**options)
        (REPORT / 'environment.json').write_text(json.dumps({'engine': cls.engine, 'version': cls.browser.version,
            'transport': cls.transport, 'bundleSha256': hashlib.sha256(result.stdout.encode()).hexdigest()}, indent=2))

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        self.context = self.browser.new_context(accept_downloads=True)
        self.context.set_default_timeout(6000)
        self.errors = []
        self.addCleanup(self.close_context)
        self.context.on('page', lambda p: p.on('pageerror', lambda error: self.errors.append(str(error))))
        self.page = self.context.new_page()
        if self.transport == 'memory':
            self.page.set_content(self.html)
        elif self.transport == 'file':
            self.page.goto((REPORT / 'fixture.html').as_uri())
        else:
            self.page.goto(self.url)
        self.page.wait_for_function('typeof CoreTest === "object"')

    def close_context(self):
        # unittest also runs cleanups when setUp fails; tearDown alone leaks
        # contexts after a navigation or initialization error.
        self.context.close()
        self.assertEqual(self.errors, [], 'Uncaught browser errors')

    def js(self, script, arg=None):
        return self.page.evaluate(script, arg)

    def popup(self):
        self.js('''() => document.body.append(CoreTest.el('button',{id:'open',onclick:()=>{
            window.child=window.open('about:blank','core-test');
        }},'Open popup'))''')
        with self.page.expect_popup() as opened:
            self.page.locator('#open').click()
        popup = opened.value
        # The open() navigation can replace the initial empty document. Initialize
        # and register the committed document, not the transient one returned in
        # the click task (Firefox otherwise loses both the button and listeners).
        # This is a lifecycle barrier, not a sleep, retry or larger timeout.
        popup.wait_for_load_state('load')
        popup.evaluate('''() => {
            const core=opener.CoreTest;
            opener.popupDocument=document;
            document.body.append(core.el('button',{id:'focus',document},'Focus popup'));
            opener.releaseA=core.registerUIDocument(document);
            opener.releaseB=core.registerUIDocument(document);
        }''')
        popup.locator('#focus').click()
        self.assertTrue(self.js('() => popupDocument===child.document'))
        return popup

    def test_01_text_safe_dom_and_initial_values(self):
        actual = self.js('''() => {
          const {el}=CoreTest;
          const n=el('section',{'aria-hidden':false,spellcheck:false,dataset:{itemId:7},style:{'--core-size':'12px','margin-left':'3px'}},
            '<img src=x onerror=alert(1)>',[null,false,[0,el('strong',{},'nested')]]);
          document.body.append(n);
          const select=el('select',{value:'b'},el('option',{value:'a'},'A'),el('option',{value:'b'},'B'));
          const legacy=el('textarea',{value:''},'source'), direct=el('textarea',{value:'direct'});
          const svg=el('svg',{namespace:'http://www.w3.org/2000/svg'},el('path',{namespace:'http://www.w3.org/2000/svg',d:'M0 0L1 1'}));
          return [n.textContent,n.querySelectorAll('img').length,n.getAttribute('aria-hidden'),n.spellcheck,n.dataset.itemId,
            n.style.getPropertyValue('--core-size'),n.style.marginLeft,select.value,legacy.value,direct.value,svg.firstChild.namespaceURI];
        }''')
        self.assertEqual(actual, ['<img src=x onerror=alert(1)>0nested', 0, 'false', False, '7', '12px', '3px', 'b', 'source', 'direct', 'http://www.w3.org/2000/svg'])

    def test_02_event_options_and_ref_use_real_input(self):
        self.js('''() => {window.hits=0;window.lifetime=new AbortController();
          document.body.append(CoreTest.el('button',{id:'once',onclick:[()=>hits++,{once:true}],ref:n=>window.created=n},'Once'));
          document.body.append(CoreTest.el('button',{id:'abort',onclick:[()=>hits+=10,{signal:lifetime.signal}]},'Abortable'));}''')
        self.page.locator('#once').click()
        self.page.locator('#once').click()
        self.page.locator('#abort').click()
        self.js('() => lifetime.abort()')
        self.page.locator('#abort').click()
        self.assertEqual(self.js('() => [hits,created===document.querySelector("#once")]'), [11, True])

    def test_03_popup_reference_count_focus_and_closed_cleanup(self):
        popup = self.popup()
        self.assertEqual(self.js('() => [CoreTest.uiDocuments().length,CoreTest.uiDocument()===child.document]'), [2, True])
        self.assertTrue(self.js('() => {releaseA();return CoreTest.uiDocuments().includes(child.document)}'))
        self.assertTrue(self.js('() => CoreTest.el("input").ownerDocument===child.document'))
        popup.close()
        self.page.wait_for_function('CoreTest.uiDocuments().length===1')
        self.assertTrue(self.js('() => CoreTest.uiDocument()===document'))
        self.assertFalse(self.js('() => releaseB()'))

    def test_04_dialog_ownership_across_popup(self):
        popup = self.popup()
        self.js('() => child.document.body.append(CoreTest.el("div",{class:"ide-modal-cover",document:child.document}))')
        self.assertTrue(self.js('() => CoreTest.hasUIDialog()'))
        popup.close()
        self.page.wait_for_function('!CoreTest.hasUIDialog()')

    def test_05_iframe_focus_explicit_owner_and_reference_cleanup(self):
        actual = self.js('''() => {
          const f=document.createElement('iframe');document.body.append(f);const doc=f.contentDocument;
          const off=CoreTest.registerUIDocument(doc),input=CoreTest.el('input',{document:doc});doc.body.append(input);input.focus();
          const results=[CoreTest.uiDocument()===doc,CoreTest.uiDocument(input)===doc,CoreTest.uiDocument(document)===document,input.ownerDocument===doc];
          off();f.remove();results.push(CoreTest.uiDocuments().length);return results;
        }''')
        self.assertEqual(actual, [True, True, True, True, 1])

    def test_06_actual_cross_realm_blob_download_preserves_bytes_and_mime(self):
        self.js('''() => {
          const f=document.createElement('iframe');document.body.append(f);window.foreignBlob=new f.contentWindow.Blob(['cross-realm'],{type:'application/x-vb6'});
          const create=URL.createObjectURL.bind(URL);window.downloadMime=null;
          URL.createObjectURL=blob=>{window.downloadMime=blob.type;return create(blob)};
          document.body.append(CoreTest.el('button',{id:'save',onclick:()=>{window.releaseDownload=CoreTest.download('Core.txt',foreignBlob)}},'Save'));
        }''')
        with self.page.expect_download() as saved:
            self.page.locator('#save').click()
        download = saved.value
        self.assertEqual(download.suggested_filename, 'Core.txt')
        self.assertEqual(Path(download.path()).read_bytes(), b'cross-realm')
        self.assertEqual(self.js('() => downloadMime'), 'application/x-vb6')
        self.assertEqual(self.js('() => [releaseDownload(),releaseDownload(),document.querySelectorAll("a[download]").length]'), [True, False, 0])

    def test_07_failed_download_and_preabort_release_resources(self):
        actual = self.js('''() => {
          const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL),click=HTMLAnchorElement.prototype.click;
          let created=0,revoked=0;URL.createObjectURL=b=>{created++;return create(b)};URL.revokeObjectURL=u=>{revoked++;revoke(u)};
          HTMLAnchorElement.prototype.click=()=>{throw new Error('activation failed')};let message='';
          try{CoreTest.download('fail.txt','data')}catch(e){message=e.message}finally{HTMLAnchorElement.prototype.click=click}
          const c=new AbortController();c.abort('cancel');let reason;
          try{CoreTest.download('never.txt','data','text/plain',{signal:c.signal})}catch(e){reason=e}
          return [created,revoked,message,reason,document.querySelectorAll('a[download]').length];
        }''')
        self.assertEqual(actual, [1, 1, 'activation failed', 'cancel', 0])

    def test_08_debounce_browser_timers_and_abort(self):
        actual = self.js('''async () => {
          const seen=[],c=new AbortController(),owner={value:5};
          const fn=CoreTest.debounce(function(n){seen.push(this.value+n);return this.value+n},10,{signal:c.signal});
          fn.call(owner,1);fn.call(owner,2);const result=fn.flush();fn.call(owner,3);c.abort();
          await new Promise(resolve=>setTimeout(resolve,25));return [seen,result,fn.pending()];
        }''')
        self.assertEqual(actual, [[7], 7, False])

    def test_09_sha256_cross_realm_native_and_portable(self):
        actual = self.js('''async () => {
          const f=document.createElement('iframe');document.body.append(f);const data=new f.contentWindow.Uint8Array([0,97,98,99,0]);
          const view=new f.contentWindow.DataView(data.buffer,1,3);
          return [await CoreTest.sha256Hex(view,null),await CoreTest.sha256Hex(view)];
        }''')
        self.assertEqual(actual, [DIGEST, DIGEST])

    def test_10_http_uses_actual_webcrypto(self):
        if self.transport == 'memory':
            self.skipTest('Memory transport is not a secure HTTP origin; native WebCrypto is tested in CI')
        self.assertTrue(self.js('() => typeof crypto.subtle?.digest === "function"'))
        self.assertEqual(self.js('async () => CoreTest.sha256Hex(new Uint8Array([97,98,99]),crypto.subtle)'), DIGEST)

    def test_11_stream_abort_interrupts_a_pending_browser_read(self):
        actual = self.js('''async () => {
          const c=new AbortController();let cancelled=false;
          const source=new ReadableStream({cancel(reason){cancelled=reason==='cancel'}});
          const result=CoreTest.sha256Stream(source,{signal:c.signal});c.abort('cancel');let reason;
          try{await result}catch(e){reason=e}return [reason,cancelled,source.locked];
        }''')
        self.assertEqual(actual, ['cancel', True, False])

    def test_12_stream_yields_to_browser_timers(self):
        actual = self.js('''async () => {
          const c=new AbortController();let closed=false;
          function* bytes(){try{for(let i=0;i<10000;i++)yield new Uint8Array(8192)}finally{closed=true}}
          setTimeout(()=>c.abort('timer'),0);let reason;
          try{await CoreTest.sha256Stream(bytes(),{signal:c.signal,yieldEvery:16384})}catch(e){reason=e}
          return [reason,closed];
        }''')
        self.assertEqual(actual, ['timer', True])

    def test_13_signal_cancellation_and_history_transaction_in_browser(self):
        actual = self.js('''async () => {
          const s=new CoreTest.Signal(),c=new AbortController(),seen=[];
          s.once('event',()=>{seen.push(1);s.emit('event')});s.on('event',()=>seen.push(2),{signal:c.signal});s.emit('event');c.abort();s.emit('event');
          const h=new CoreTest.History(),apply=(m,s)=>{m.text=s;return m};h.beginTransaction('Macro');h.recordValue('m','','a',apply);h.recordValue('m','a','ab',apply,'Edit',true);h.commitTransaction();
          const back=h.undo({text:'ab'}),forward=h.redo(back);return [seen,back.text,forward.text,h.undoLabel,h.undoStack.length];
        }''')
        self.assertEqual(actual, [[1, 2, 2], '', 'ab', 'Macro', 1])

    def test_14_portable_filenames_and_escaping(self):
        actual = self.js("value => [CoreTest.safeName('CON.txt'),CoreTest.safeName(' ... '),CoreTest.safeName('bad/name. '),CoreTest.safeName(null),CoreTest.safeName('a'.repeat(120)).length,CoreTest.escapeHTML(value)]", "<b>\"&'")
        self.assertEqual(actual, ['_CON.txt', 'Project1', 'bad_name', 'Project1', 100, '&lt;b&gt;&quot;&amp;&#39;'])

if __name__ == '__main__':
    unittest.main(verbosity=2)
