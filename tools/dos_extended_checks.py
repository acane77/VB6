"""Production-runtime TUI contracts; input remains owned by the canonical DOM.

No generated event is used as a substitute for a keyboard/pointer interaction.
The composition case verifies only the presentation's event lifecycle, not an
operating-system IME candidate window. Native-origin suites remain separate.
"""
import json
from playwright.sync_api import expect


def run_extended_checks(browser, root, report, seed):
    page = browser.new_page(viewport={'width': 1280, 'height': 1000}, device_scale_factor=1.25)
    passed, errors = [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    try:
        css = (root / 'dist/vb6-controls.css').read_text()
        page.set_content('<!doctype html><html><head><style>' + css +
                         '</style><style>html,body{margin:0;width:100%;height:100%}</style></head><body></body></html>')
        page.add_script_tag(content=(root / 'dist/vb6-runtime.js').read_text())
        page.evaluate('''async seed=>{
          window.assertTUI=(value,message)=>{if(!value)throw Error(message);};
          const p=structuredClone(seed),m=p.modules[0];p.id='DOS-Extended';p.name='DOS-Extended';
          Object.assign(m.form.properties,{ClientWidth:15000,ClientHeight:13500,StartUpPosition:0,Left:150,Top:150});
          const types=['TextBox','CommandButton','CheckBox','ComboBox','PictureBox','MSChart','Image','Frame','TabStrip','RichTextBox'];
          m.form.controls=m.form.controls.filter(c=>types.includes(c.type));
          for(let i=0;i<types.length;i++){
            const c=m.form.controls.find(c=>c.type===types[i]);
            Object.assign(c.properties,{Left:300+(i%3)*4500,Top:300+Math.floor(i/3)*2700,Width:3840,Height:1920});
            if(c.type==='TextBox')Object.assign(c.properties,{Text:'abcdef',Height:480});
            if(c.type==='ComboBox')Object.assign(c.properties,{List:['Alpha','Beta','Gamma'],ListIndex:0,Height:480,Style:0});
            if(c.type==='PictureBox')Object.assign(c.properties,{ScaleMode:3,BackColor:0});
            if(c.type==='Image')c.properties.Stretch=0;
          }
          const secret=structuredClone(m.form.controls.find(c=>c.type==='TextBox'));secret.id+='secret';secret.name='SecretTest';
          Object.assign(secret.properties,{Top:1350,PasswordChar:'*',Text:'private-value'});m.form.controls.push(secret);
          const hostContainer=document.createElement('div');hostContainer.style.cssText='position:absolute;inset:0';document.body.append(hostContainer);
          window.host=await VB6Runtime.mountApplication(p,hostContainer,{persist:false,rendering:false,nativeWindows:false,
            presentation:{mode:'dos',profile:'commander',cellWidth:8,cellHeight:16}});
          window.presenter=host.tuiPresentation;window.form=host.forms[0];
          window.control=name=>form.controls.find(c=>c.model.name===name);
          window.cells=name=>presenter.controls.get(control(name).node).buffer;
          window.originalInput=control('TextBoxTest').input;window.originalModel=JSON.stringify(host.project);
        }''', seed)
        page.wait_for_function('presenter.frame===0 && presenter.chrome.entries.size>=5')

        def check(name, script):
            page.evaluate(script)
            passed.append(name)

        def settle():
            page.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')

        text = page.locator('[data-control="TextBoxTest"] input')
        text.click()
        text.press('Home')
        text.press('Shift+ArrowRight')
        text.press('Shift+ArrowRight')
        settle()
        check('real keyboard selection remains cell-painted without replacing the native editor', '''()=>{
          const c=control('TextBoxTest'),b=cells('TextBoxTest');
          assertTUI(c.input===originalInput,'editor replaced');
          assertTUI(c.input.selectionStart===0&&c.input.selectionEnd===2,'native selection changed');
          assertTUI(c.node.hasAttribute('data-tui-cell-editor')&&!c.node.hasAttribute('data-tui-editing'),'active editor fell back');
          assertTUI(getComputedStyle(presenter.controls.get(c.node).canvas).visibility==='visible','selection canvas hidden');
          assertTUI((b.colors[0]>>4)===3&&(b.colors[1]>>4)===3&&(b.colors[2]>>4)===1,'selection color/extent differs');
        }''')
        text.press('Z')
        expect(text).to_have_value('Zcdef')
        settle()
        check('typing replaces selected UTF-16 storage and repaints the native caret', '''()=>{
          assertTUI(control('TextBoxTest').get('Text')==='Zcdef','VB6 storage differs');
          const b=cells('TextBoxTest');assertTUI(b.toText().startsWith('Zcdef'),'display differs');
          assertTUI((b.colors[1]>>4)===14,'caret did not follow native insertion point');
        }''')
        text.press('Control+z')
        expect(text).to_have_value('abcdef')
        passed.append('native undo stays functional while cell-painted')
        page.evaluate("control('TextBoxTest').set('Locked',-1);control('TextBoxTest').refresh()")
        text.press('End')
        text.press('Q')
        expect(text).to_have_value('abcdef')
        check('locked text retains selection but rejects real keyboard mutation', '''()=>{
          assertTUI(control('TextBoxTest').input.readOnly,'native locked flag missing');
          control('TextBoxTest').set('Locked',0);control('TextBoxTest').refresh();
        }''')
        # Explicitly a composition lifecycle contract, not native IME qualification.
        page.evaluate("originalInput.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:'a'}))")
        page.wait_for_function("control('TextBoxTest').node.hasAttribute('data-tui-editing')")
        page.evaluate("originalInput.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:''}))")
        page.wait_for_function("!control('TextBoxTest').node.hasAttribute('data-tui-editing')")
        passed.append('composition lifecycle exposes the real input until composition ends')
        check('password snapshots expose only display bullets', '''()=>{
          const snap=JSON.stringify(presenter.snapshot());assertTUI(!snap.includes('private-value'),'password leaked');
          assertTUI(cells('SecretTest').toText().includes('••••'),'masked cells missing');
        }''')
        page.evaluate("control('TextBoxTest').set('Text','שלום');control('TextBoxTest').refresh()")
        page.wait_for_function("control('TextBoxTest').node.hasAttribute('data-tui-editing')")
        passed.append('bidirectional text retains native shaping rather than pretending scalar order is correct')
        text.fill('abcdef')
        combo = page.locator('[data-control="ComboBoxTest"] input')
        combo.focus()
        combo.press('Home')
        combo.press('Shift+ArrowRight')
        settle()
        check('editable combos keep active selection in cells before opening their list', '''()=>{
          const c=control('ComboBoxTest');assertTUI(c.node.hasAttribute('data-tui-cell-editor')&&!c.node.hasAttribute('data-tui-editing'),'combo editor fell back');
          assertTUI((cells('ComboBoxTest').colors[0]>>4)===3,'combo selection not painted');
        }''')
        combo.press('F4')
        page.locator('body > .vb-combo-popup[data-tui-root] .vb-tui-chrome-surface').wait_for()
        check('combo popup inherits its owner palette and independent boundary', '''()=>{
          const popup=control('ComboBoxTest').combo.popup;
          assertTUI(popup.dataset.vbDos==='commander'&&presenter.portals.has(popup),'popup palette/lease missing');
          assertTUI(!document.documentElement.hasAttribute('data-vb-dos'),'popup rethemed document');
        }''')
        combo.press('ArrowDown')
        combo.press('ArrowDown')
        combo.press('Enter')
        expect(combo).to_have_value('Gamma')
        check('real combo keys update VB6 value and release popup resources', '''()=>{
          assertTUI(control('ComboBoxTest').get('ListIndex')===2,'combo selection differs');
          assertTUI(presenter.portals.size===0,'popup leaked');
        }''')
        combo.press('F4')
        combo.press('Escape')
        expect(combo).to_have_value('Gamma')
        passed.append('popup cancellation preserves the last committed selection')

        page.evaluate("window.dialogResult=null;void host.msgBox('A character-painted question',4,'TUI Dialog').then(value=>dialogResult=value)")
        page.locator('.vb-dialog-actions .vb-tui-chrome-surface').wait_for()
        page.get_by_role('button', name='No', exact=True).click()
        page.wait_for_function('dialogResult===7')
        check('MsgBox cell chrome retains original result and modal lifetime', '''()=>{
          assertTUI(!host.stage.inert&&presenter.portals.size===0,'modal lease or inert state leaked');
        }''')
        page.evaluate("window.dialogResult=null;void host.inputBox('Native field prompt','TUI Input','initial').then(value=>dialogResult=value)")
        field = page.get_by_role('textbox', name='Native field prompt', exact=True)
        field.fill('preserved input')
        field.press('Enter')
        page.wait_for_function("dialogResult==='preserved input'")
        passed.append('InputBox preserves original field, Enter result and focus restoration')
        page.evaluate('''()=>{
          const picture=control('PictureBoxTest');picture.draw('rect',[0,0,256,128],255,true);
        }''')
        page.wait_for_function("presenter.controls.get(control('PictureBoxTest').node)?.buffer && control('PictureBoxTest').node.hasAttribute('data-tui-graphics')")
        check('live retained drawing is projected from canonical graphics without replacing its canvas', '''()=>{
          window.picture=control('PictureBoxTest');window.nativeCanvas=picture.surface.canvas;
          const b=cells('PictureBoxTest');assertTUI(Array.from(b.colors).some(value=>(value&15)===4||(value&15)===12),'red drawing absent');
          window.firstGraphic=JSON.stringify(b.snapshot());picture.draw('rect',[0,0,256,128],65280,true);
        }''')
        page.wait_for_function("JSON.stringify(cells('PictureBoxTest').snapshot())!==firstGraphic")
        check('drawing invalidation updates cells even without a DOM mutation', '''()=>{
          assertTUI(picture.surface.canvas===nativeCanvas&&nativeCanvas.isConnected,'canonical graphics changed');
          host.setPresentation({mode:'dos',profile:'commander',graphics:'braille'});
        }''')
        page.wait_for_function("cells('PictureBoxTest')?.glyphs[0]>=0x2800")
        check('Braille projection uses 2x4 samples and reversible policy', '''()=>{
          assertTUI(Array.from(cells('PictureBoxTest').glyphs).every(c=>c>=0x2800&&c<=0x28ff),'not Braille cells');
          host.setPresentation({mode:'dos',profile:'commander',graphics:'native'});presenter.flush();
          assertTUI(!picture.node.hasAttribute('data-tui-graphics'),'native graphics remained hidden');
          assertTUI(getComputedStyle(nativeCanvas).opacity==='1','native graphics invisible');
          host.setPresentation({mode:'dos',profile:'commander',graphics:'blocks'});
        }''')
        page.wait_for_function("control('PictureBoxTest').node.hasAttribute('data-tui-graphics')")
        # Data image needs no URL permission and its natural object-fit is retained.
        page.evaluate('''()=>{
          const source=document.createElement('canvas');source.width=source.height=16;const g=source.getContext('2d');g.fillStyle='#ffffff';g.fillRect(0,0,16,16);
          control('ImageTest').set('Picture',source.toDataURL());control('ImageTest').refresh();
        }''')
        page.wait_for_function("presenter.controls.get(control('ImageTest').node)?.buffer")
        check('nonstretch images keep their authored centered natural-size projection', '''()=>{
          const b=cells('ImageTest'),colored=Array.from(b.colors).filter(c=>(c&15)===15||(c>>4)===15).length;
          assertTUI(colored>0&&colored<b.glyphs.length/4,'image was stretched over the entire control');
        }''')
        check('frame and tab outlines are cells, retain hit rectangles and share resize ownership', '''()=>{
          assertTUI(presenter.chrome.entries.get(form.node).frame,'form outline missing');
          assertTUI(presenter.resizeOwners.get(form.node)===2,'shared resize ownership lost');
          assertTUI(document.querySelectorAll('.vb-tui-frame-surface').length>=4,'container outlines absent');
          const nodes=[form.node,...form.controls.map(c=>c.node)],bounds=()=>JSON.stringify(nodes.map(n=>{const r=n.getBoundingClientRect();return [r.x,r.y,r.width,r.height];}));
          const before=bounds();host.setPresentation({mode:'dos',profile:'turbo',cellWidth:9,cellHeight:18});presenter.flush();
          assertTUI(bounds()===before,'palette/metric change moved hit targets');
          assertTUI(JSON.stringify(host.project)===originalModel,'presentation mutated project');
        }''')
        check('screen JSON, ANSI and B800 exports use strict detached display data', '''()=>{
          const api=VB6Runtime.RuntimeAPI.TUI,screen=presenter.screen(),restored=api.deserializeScreen(api.serializeScreen(screen));
          assertTUI(screen.toText()===restored.toText(),'snapshot roundtrip differs');
          assertTUI(api.serializeB800(screen).length===screen.columns*screen.rows*2,'B800 layout wrong');
          const ansi=api.serializeANSI(screen);assertTUI(ansi.endsWith('\\x1b[0m'),'ANSI attributes leaked');
          assertTUI(!screen.toText().includes('private-value'),'screen capture leaked password');
          assertTUI(screen.toText().includes('Command'),'screen omitted live controls');
        }''')
        page.screenshot(path=str(report / 'extended-runtime.png'), full_page=True)
        page.emulate_media(forced_colors='active')
        check('forced colors expose original controls and suppress presentation canvases', '''()=>{
          const node=control('TextBoxTest').node;assertTUI(getComputedStyle(node.querySelector('.vb-tui-surface')).display==='none','forced colors kept bitmap paint');
          assertTUI(getComputedStyle(node.querySelector('input')).opacity==='1','forced colors hid native input');
        }''')
        page.emulate_media(forced_colors='none', media='print')
        check('print exposes the original document without TUI overlays', '''()=>{
          assertTUI(getComputedStyle(document.querySelector('.vb-tui-chrome-surface')).display==='none','chrome printed');
        }''')
        page.emulate_media(media='screen')
        settle()
        check('all extended paths release presentation and keep canonical control identity', '''()=>{
          assertTUI(presenter.metrics.failures===0,'control paint failure');
          assertTUI(presenter.chrome.metrics.fallbacks===0,'chrome paint failure or unexpected budget fallback');
          host.setPresentation({mode:'classic'});
          assertTUI(originalInput===control('TextBoxTest').input&&originalInput.isConnected,'classic restoration replaced input');
          assertTUI(presenter.disposed&&!presenter.controls.size&&!presenter.chrome.entries.size&&!presenter.resizeOwners.size,'presentation resources retained');
          assertTUI(!document.querySelector('.vb-tui-surface,.vb-tui-chrome-surface'),'canvases leaked');
          assertTUI(!document.getElementById('vb6-tui-style'),'style lease leaked');
          host.dispose();host.dispose();
        }''')
        assert not errors, errors
        (report / 'extended-runtime.json').write_text(json.dumps({'passed': passed, 'errors': errors}, indent=2))
        return passed
    except Exception:
        page.screenshot(path=str(report / 'extended-runtime-failure.png'), full_page=True)
        state = page.evaluate('''()=>({metrics:window.presenter?.metrics,chromeMetrics:window.presenter?.chrome.metrics,
          controls:window.host?.forms[0]?.controls.map(c=>({name:c.model.name,text:c.type==='TextBox'&&c.input?.type!=='password'?c.input?.value:undefined,html:c.node.outerHTML.slice(0,1500)}))})''')
        (report / 'extended-runtime-failure.json').write_text(json.dumps({'passed': passed, 'errors': errors, 'state': state}, indent=2))
        raise
    finally:
        page.evaluate('window.host?.dispose()')
        page.close()
