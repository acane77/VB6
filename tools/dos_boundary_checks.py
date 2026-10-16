"""Production boundaries: canonical control geometry, editing and picker events.

Assertions use real keyboard/pointer input. Native IME windows and cross-origin
content are deliberately not claimed by the presentation lifecycle checks.
"""
import json
from playwright.sync_api import expect


def run_boundary_checks(browser, root, report, seed):
    page=browser.new_page(viewport={'width':1280,'height':950})
    passed,errors=[],[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    try:
        page.set_content('<!doctype html><style>'+ (root/'dist/vb6-controls.css').read_text()+'</style><body>')
        page.add_script_tag(content=(root/'dist/vb6-runtime.js').read_text())
        page.evaluate('''async seed=>{
          const p=structuredClone(seed),m=p.modules[0];p.id='tui-boundaries';
          Object.assign(m.form.properties,{ClientWidth:10500,ClientHeight:7500,StartUpPosition:0,Left:120,Top:120});
          const kinds=['CommandButton','RichTextBox','DTPicker','DriveListBox'];
          m.form.controls=m.form.controls.filter(c=>kinds.includes(c.type));
          kinds.forEach((type,i)=>{const c=m.form.controls.find(c=>c.type===type);Object.assign(c.properties,{Left:300,Top:300+i*1350,Width:3000,Height:type==='RichTextBox'?1200:450});});
          m.code='Option Explicit';
          const button=m.form.controls.find(c=>c.type==='CommandButton');button.properties.Caption='A complete caption';button.properties.Width=1200;
          const container=document.createElement('div');container.style.cssText='position:absolute;inset:0';document.body.append(container);
          window.host=await VB6Runtime.mountApplication(p,container,{persist:false,rendering:false,nativeWindows:false,presentation:{mode:'dos',profile:'commander',formLayout:'readable'}});
          window.presenter=host.tuiPresentation;window.c=name=>host.forms[0].controls.find(c=>c.type===name);
          window.assertTUI=(value,message)=>{if(!value)throw Error(message);};window.originalProject=JSON.stringify(host.project);
          c('RichTextBox').set('Text','Bold plain');c('RichTextBox').SelStart=0;c('RichTextBox').SelLength=4;c('RichTextBox').set('SelBold',-1);
          c('DTPicker').input.value='2024-02-28';c('DTPicker').input.min='2024-02-01';c('DTPicker').input.max='2024-03-02';
          const drive=c('DriveListBox');drive.items=['Alpha','Disabled','Gamma'];drive.props.ListIndex=0;drive.itemsRevision++;drive.refresh();drive.input.options[1].disabled=true;
          window.events=[];for(const field of [c('DTPicker').input,drive.input])for(const event of ['input','change'])field.addEventListener(event,()=>events.push(field.type+':'+event));
        }''',seed)
        page.wait_for_function("presenter.controls.get(c('RichTextBox').node)?.buffer&&presenter.frame===0")
        page.evaluate('''()=>{
          const button=c('CommandButton'),entry=presenter.controls.get(button.node),r=button.node.getBoundingClientRect();
          assertTUI(entry.buffer.toText().includes('A complete caption'),'caption clipped');
          assertTUI(r.width>button.node.offsetWidth,'readable coordinate transform missing');
          assertTUI(JSON.stringify(host.project)===originalProject,'presentation rewrote authored project');
          window.authoredWidth=button.props.Width;
        }''')
        passed.append('readable form coordinates fit captions without mutating authored geometry')
        rich=page.locator('[data-type="RichTextBox"] [contenteditable]')
        rich.focus();rich.press('Control+Home');rich.press('Control+Shift+ArrowRight')
        page.wait_for_function("presenter.controls.get(c('RichTextBox').node).buffer.styles.some(Boolean)")
        page.evaluate('''()=>{
          const node=c('RichTextBox').node,b=presenter.controls.get(node).buffer;
          assertTUI(node.hasAttribute('data-tui-rich-editor')&&!node.hasAttribute('data-tui-editing'),'rich editor fell back');
          assertTUI(b.toText().includes('Bold plain'),'rich text lost characters');
          assertTUI(Array.from(b.styles).some(n=>n&1),'bold run lost');
          assertTUI(c('RichTextBox').get('TextRTF').includes('\\\\b'),'RTF changed');
        }''')
        rich.press('Z');page.wait_for_function("c('RichTextBox').get('Text').startsWith('Z')")
        rich.press('Control+z');page.wait_for_function("c('RichTextBox').get('Text')==='Bold plain'")
        passed.append('rich glyph attributes, real selection, typing and undo use the canonical controller')
        date=page.locator('[data-type="DTPicker"] input');date.focus();date.press('F4')
        dialog=page.get_by_role('dialog',name='Choose date',exact=True);expect(dialog).to_be_visible()
        page.wait_for_function("presenter.pickers.active&&presenter.chrome.entries.get(presenter.pickers.active.popup)?.buffer")
        page.keyboard.press('ArrowRight');page.keyboard.press('Enter');expect(date).to_have_value('2024-02-29')
        page.evaluate("assertTUI(events.join(',')==='date:input,date:change','date dispatched duplicate/missing events')")
        date.press('F4');page.keyboard.press('PageDown');page.keyboard.press('Escape');expect(date).to_have_value('2024-02-29')
        passed.append('calendar leap-day navigation, user commit, bounds and cancellation retain field ownership')
        drive=page.locator('[data-type="DriveListBox"] select');drive.focus();drive.press('F4')
        expect(page.get_by_role('dialog',name='Choose value',exact=True)).to_be_visible();page.keyboard.press('ArrowDown');page.keyboard.press('Enter')
        expect(drive).to_have_value('2');page.evaluate("assertTUI(c('DriveListBox').get('ListIndex')===2,'VB6 ListIndex differs')")
        drive.press('F4');page.keyboard.press('Home');page.keyboard.press('Escape');expect(drive).to_have_value('2')
        passed.append('collapsed selects skip disabled items and cancel without changing ListIndex')
        page.evaluate("()=>{const input=document.createElement('input');input.type='color';input.id='test-color';input.style.cssText='position:absolute;left:300px;top:360px;width:100px;height:40px';host.forms[0].content.append(input);}")
        color=page.locator('#test-color');color.click();expect(page.get_by_role('dialog',name='Choose color',exact=True)).to_be_visible()
        page.get_by_label('RGB hexadecimal color',exact=True).fill('#123abc');page.keyboard.press('Enter');expect(color).to_have_value('#123abc')
        passed.append('EGA/color picker retains arbitrary RGB via validated canonical field writes')
        page.screenshot(path=str(report/'boundary-runtime.png'))
        page.evaluate('''()=>{
          assertTUI(!presenter.metrics.failures&&!presenter.chrome.metrics.fallbacks,'paint error or fallback');
          host.setPresentation({mode:'dos',profile:'turbo',formLayout:'authored'});presenter.flush();
          assertTUI(!host.forms[0].node.hasAttribute('data-tui-form-space'),'form-space lease retained');
          assertTUI(c('CommandButton').props.Width===authoredWidth,'authored Width changed');
          host.dispose();assertTUI(presenter.surfacePixels===0,'device pixels leaked');
          assertTUI(!document.querySelector('.vb-tui-picker'),'picker leaked');
        }''')
        passed.append('coordinate, picker, rich editor and device-surface leases restore independently')
        assert not errors,errors
        (report/'boundaries.json').write_text(json.dumps({'passed':passed,'errors':errors},indent=2))
        return passed
    except Exception:
        page.screenshot(path=str(report/'boundary-failure.png'))
        (report/'boundary-failure.json').write_text(json.dumps({'passed':passed,'errors':errors,'state':page.evaluate("()=>({metrics:window.presenter?.metrics,rich:window.c?.('RichTextBox')?.node.outerHTML,richCells:window.presenter?.controls.get(c('RichTextBox').node)?.buffer?.toText(),picker:window.presenter?.pickers.active?.popup.outerHTML})")},indent=2))
        raise
    finally:
        page.evaluate('window.host?.dispose()');page.close()
