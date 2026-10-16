import test from 'node:test';
import assert from 'node:assert/strict';
import {createControl,newProject} from '../src/project/model.js';
import {formToXaml,compileFormXaml,synchronizeFormXaml,createVb6XamlSchema} from '../src/xaml/forms.js';
import {PRESENTATION_NS,XAML_NS} from '../packages/xaml-compiler/src/index.js';
const schema=createVb6XamlSchema();
const form=()=>{const f=newProject().modules[0].form;f.controls=[createControl('CommandButton','B',0,0)];return f;};
const wrap=body=>`<Page xmlns="${PRESENTATION_NS}" xmlns:x="${XAML_NS}" x:Name="Form1">${body}</Page>`;
const load=text=>{const r=compileFormXaml(text,{schema});assert.equal(r.success,true,JSON.stringify(r.diagnostics));return r.form;};
const verify=(text,before,after,{preserve=true,settings={}}={})=>{const r=synchronizeFormXaml(text,before,after,{schema,settings});assert.equal(r.regenerated,!preserve,r.text);const c=compileFormXaml(r.text,{form:after,schema,settings});assert.equal(c.success,true,JSON.stringify(c.diagnostics));assert.deepEqual(c.form,after);if(!preserve)assert.equal(r.previousText,text);return r.text;};

test('add/delete native attributes and JSON fields without losing trivia',()=>{
 const a=form(),text=formToXaml(a,{schema}).replace('<vb:CommandButton','<!-- retained -->\n  <vb:CommandButton'),b=structuredClone(a);b.controls[0].properties.TabIndex=5;b.controls[0].properties['Vendor.Point']={x:3,y:4};delete b.controls[0].properties.ToolTipText;
 const next=verify(text,a,b);assert.match(next,/<!-- retained -->/);assert.match(next,/TabIndex="5"/);assert.match(next,/Designer.Properties/);
});
test('native property elements retain comments while replacing scalar text',()=>{
 const a=form();a.controls[0].properties.Caption='Original';const text=formToXaml(a,{schema}).replace('Caption="Original"','').replace(/(<vb:CommandButton[^>]+)\/>/,'$1><vb:CommandButton.Caption><!-- keep -->Original</vb:CommandButton.Caption></vb:CommandButton>');assert.deepEqual(load(text),a);
 const b=structuredClone(a);b.controls[0].properties.Caption='New < & " caption';const next=verify(text,a,b);assert.match(next,/<vb:CommandButton.Caption><!-- keep -->New &lt; &amp; &quot; caption/);
});
test('native single-quote attributes preserve delimiter and XML escaping',()=>{
 const a=form(),text=formToXaml(a,{schema}).replace(/Caption="Command"/,'Caption=\'Command\''),b=structuredClone(a);b.controls[0].properties.Caption="it’s 'quoted' & safe";const next=verify(text,a,b);assert.match(next,/Caption='it’s &apos;quoted&apos; &amp; safe'/);
});
test('new control insertion preserves sibling comments and CRLF',()=>{
 const a=form(),text=formToXaml(a,{schema,newline:'\r\n'}).replace('<vb:CommandButton','<!-- B stays -->\r\n  <vb:CommandButton'),b=structuredClone(a);b.controls.push(createControl('TextBox','NewBox',20,30));const next=verify(text,a,b);assert.match(next,/<!-- B stays -->/);assert.equal(/(?<!\r)\n/.test(next),false);
});
test('insert a child into a self-closing native container with aliased prefixes',()=>{
 const a=form();a.controls=[createControl('Frame','Parent',0,0)];const text=formToXaml(a,{schema}).replaceAll('vb:','native:').replace('xmlns:vb=','xmlns:native='),b=structuredClone(a),child=createControl('TextBox','Child',0,0);child.parent='Parent';b.controls.push(child);verify(text,a,b);
});
test('insert nested new subtree and menu property collection',()=>{
 const a=form(),text=formToXaml(a,{schema}),b=structuredClone(a),frame=createControl('Frame','Frame1',0,0),child=createControl('TextBox','Child',0,0);child.parent=frame.name;b.controls.push(frame,child);b.menus=[{id:'file',name:'FileMenu',type:'Menu',properties:{Caption:'File'},parent:null},{id:'open',name:'OpenMenu',type:'Menu',properties:{Caption:'Open'},parent:'FileMenu'}];verify(text,a,b);
});
test('explicit Children property collection receives newly added controls',()=>{
 const a=form(),canonical=formToXaml(a,{schema}),start=canonical.indexOf('  <vb:CommandButton'),end=canonical.lastIndexOf('</vb:Form>');const text=canonical.slice(0,start)+'<vb:Form.Children>\n'+canonical.slice(start,end)+'</vb:Form.Children>\n'+canonical.slice(end),b=structuredClone(a);b.controls.push(createControl('Label','L',1,2));const next=verify(text,a,b);assert.match(next,/<vb:Form.Children>/);
});
test('native z-order changes update Order without reformatting sibling elements',()=>{
 const a=form();a.controls.push(createControl('TextBox','T',0,0));const text=formToXaml(a,{schema}).replace('<vb:CommandButton','<!-- first in source -->\n  <vb:CommandButton'),b=structuredClone(a);b.controls.reverse();const next=verify(text,a,b);assert.match(next,/<!-- first in source -->/);assert.ok(next.indexOf('<vb:CommandButton')<next.indexOf('<vb:TextBox'));
});
test('deleting a native subtree keeps comments on surviving siblings',()=>{
 const a=form(),frame=createControl('Frame','P',0,0),child=createControl('TextBox','C',0,0);child.parent='P';a.controls.push(frame,child);const text=formToXaml(a,{schema}).replace('<vb:CommandButton','<!-- keep B -->\n  <vb:CommandButton'),b=structuredClone(a);b.controls=b.controls.filter(c=>c.name==='B');const next=verify(text,a,b);assert.match(next,/<!-- keep B -->/);assert.doesNotMatch(next,/Name="C"/);
});
test('reparenting retains recoverable original source on canonical fallback',()=>{
 const a=form();a.controls.push(createControl('Frame','P',0,0));const text=formToXaml(a,{schema}),b=structuredClone(a);b.controls[0].parent='P';verify(text,a,b,{preserve:false});
});
test('invalid baseline source never masquerades as a successful incremental edit',()=>{
 const a=form(),b=structuredClone(a);b.controls[0].properties.Caption='Changed';verify('<broken>',a,b,{preserve:false});
});
test('native properties can be edited before canonical identities are added',()=>{
 const text='<v:Form xmlns:v="urn:vb6:forms" Name="Form1"><v:CommandButton Name="B" Caption="old"/></v:Form>',a=load(text),b=structuredClone(a);b.controls[0].properties.Caption='new';const next=verify(text,a,b);assert.match(next,/Caption="new"/);assert.doesNotMatch(next,/Designer.Id/);
});
test('WinUI literals and attached Canvas positions retain WinUI source',()=>{
 const text=wrap('<Canvas><!-- keep WinUI --><Button x:Name="B" Canvas.Left="10" Width="40" Content="old"/></Canvas>'),a=load(text),b=structuredClone(a),button=b.controls.find(c=>c.name==='B');button.properties.Left=300;button.properties.Width=900;button.properties.Caption='new';const next=verify(text,a,b);assert.match(next,/<!-- keep WinUI -->/);assert.match(next,/Width="60"/);assert.match(next,/Canvas.Left="20"/);assert.match(next,/Content="new"/);
});
test('editing style-derived values creates local overrides, not mutations of a shared setter',()=>{
 const text=wrap('<Page.Resources><Style x:Key="S" TargetType="Button"><Setter Property="Width" Value="40"/></Style></Page.Resources><Canvas><Button x:Name="B" Style="{StaticResource S}"/><Button x:Name="C" Style="{StaticResource S}"/></Canvas>'),a=load(text),b=structuredClone(a);b.controls.find(c=>c.name==='B').properties.Width=900;const next=verify(text,a,b);assert.match(next,/<Setter Property="Width" Value="40"\/>/);assert.match(next,/<Button[^>]*Width="60"[^>]*x:Name="B"/);
});
test('WinUI property-element text edits preserve the original property syntax',()=>{
 const text=wrap('<Button x:Name="B"><Button.Content><!-- caption -->old</Button.Content></Button>'),a=load(text),b=structuredClone(a);b.controls[0].properties.Caption='New';const next=verify(text,a,b);assert.match(next,/<Button.Content><!-- caption -->New<\/Button.Content>/);
});
test('native-only changes remain explicit metadata overrides in WinUI source',()=>{
 const text=wrap('<Button x:Name="B" Content="old"/>'),a=load(text),b=structuredClone(a);b.controls[0].properties.MousePointer=2;b.controls[0].properties['Vendor.Point']={x:1,y:2};const next=verify(text,a,b);assert.match(next,/Designer.Properties/);assert.match(next,/<Button/);
});
test('WinUI rename updates names/event references and keeps component identity',()=>{
 const text=wrap('<Button x:Name="B" Click="B_Click"/>'),a=load(text),b=structuredClone(a);b.controls[0].name='Accept';b.controls[0].properties.Name='Accept';const next=verify(text,a,b);assert.match(next,/x:Name="Accept"/);assert.match(next,/Click="Accept_Click"/);assert.match(next,/Designer.Id/);
});
test('WinUI Boolean/font/color reverse encodings preserve exact native values',()=>{
 const text=wrap('<Button x:Name="B" FontSize="12" FontWeight="Normal" FontStyle="Normal" Background="#123456" IsEnabled="True"/>'),a=load(text),b=structuredClone(a),p=b.controls[0].properties;Object.assign(p,{FontSize:12,FontBold:-1,FontItalic:-1,BackColor:0x998877,Enabled:0});const next=verify(text,a,b);assert.match(next,/FontSize="16"/);assert.match(next,/FontWeight="Bold"/);assert.match(next,/Background="#778899"/);assert.match(next,/IsEnabled="False"/);
});
test('native incremental edits remain exact across a deterministic mutation corpus',()=>{
 let a=form(),text=formToXaml(a,{schema});
 for(let i=0;i<60;i++) {
  const b=structuredClone(a);if(i%6===0)b.controls.push(createControl('TextBox','T'+i,i*10,i*20));else if(i%6===1)b.controls.reverse();else if(i%6===2)b.controls[0].properties.Caption='A & B <'+i+'>';else if(i%6===3)b.controls[0].properties['Vendor.Record']={index:i,text:'{literal}'};else if(i%6===4&&b.controls.length>1)b.controls.pop();else b.controls[0].properties.TabIndex=i;
  text=verify(text,a,b);a=b;
 }
});
