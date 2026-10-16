import test from 'node:test';
import assert from 'node:assert/strict';
import {createControl,createForm,newProject} from '../src/project/model.js';
import {formToXaml,createVb6XamlSchema} from '../src/xaml/forms.js';
import {prepareXamlEdit,readXamlDocument,useDesignerXaml,synchronizeXamlProject,formStamp} from '../src/xaml/documents.js';
import {MAX_XAML_LENGTH,xamlBuildDiagnostics} from '../src/xaml/contract.js';
const schema=createVb6XamlSchema();
const project=()=>{const p=newProject();p.settings.xaml=true;p.modules[0].form.controls=[createControl('CommandButton','Button1',0,0)];return p;};
const rename=(p,changes)=>{let text=readXamlDocument(p.modules[0],{schema}).text;text=text.replace(/Name="([^"]+)"/g,(s,n)=>changes[n]?'Name="'+changes[n]+'"':s);return prepareXamlEdit(p,p.modules[0].id,text,{schema});};
const good=r=>{assert.equal(r.applied,true,JSON.stringify(r.result.diagnostics));return r;};
test('control rename never rewrites another form, a local shadow, unrelated object members or comments',()=>{
 const p=project(),m=p.modules[0],other=createForm('Other');other.form.controls=[createControl('CommandButton','Button1',0,0)];p.modules.push(other);
 m.code='Private Sub Button1_Click()\r\n Button1.Caption = "Button1" \' Button1\r\nEnd Sub\r\nPrivate Sub Shadow()\r\n Dim Button1 As String\r\n Button1 = "unchanged"\r\n Me.Button1.Caption = "bound"\r\nEnd Sub\r\nPrivate Sub Members()\r\n Dim obj As Object\r\n obj.Button1 = 3\r\n Other.Button1.Caption = "other"\r\nEnd Sub\r\n';
 other.code='Private Sub Button1_Click()\n Button1.Caption = "Other"\n Form1.Button1.Caption = "bound"\nEnd Sub\n';
 const original=structuredClone(p),r=good(rename(p,{Button1:'Confirm'}));
 assert.match(r.module.code,/Sub Confirm_Click/);assert.match(r.module.code,/ Confirm.Caption = "Button1" ' Button1/);assert.match(r.module.code,/Dim Button1 As String\r\n Button1 =/);assert.match(r.module.code,/Me.Confirm.Caption/);assert.match(r.module.code,/obj.Button1 =/);assert.match(r.module.code,/Other.Button1.Caption/);
 assert.match(r.project.modules[1].code,/Sub Button1_Click/);assert.match(r.project.modules[1].code,/Form1.Confirm.Caption/);assert.deepEqual(p,original);
});
test('With blocks, typed form instances, brackets and continued member references bind to the renamed control',()=>{
 const p=project(),m=p.modules[0];m.code='Sub Test()\n Dim f As Form1\n f.[Button1].Caption = "a"\n With Me\n .Button1.Caption = "b"\n End With\n Me. _\n Button1.Caption = "c"\nEnd Sub\n';const r=good(rename(p,{Button1:'Accept'}));assert.match(r.module.code,/f.\[Accept\]/);assert.match(r.module.code,/\.Accept.Caption = "b"/);assert.match(r.module.code,/Me\. _\n Accept.Caption/);
});
test('simultaneous control swaps and their event procedures do not cascade',()=>{
 const p=project(),m=p.modules[0];m.form.controls.push(createControl('CommandButton','Other',0,0));m.code='Sub Button1_Click()\n Button1.Caption = Other.Caption\nEnd Sub\nSub Other_Click()\n Other.Caption = Button1.Caption\nEnd Sub\n';const r=good(rename(p,{Button1:'Other',Other:'Button1'}));assert.equal(r.module.code,'Sub Other_Click()\n Other.Caption = Button1.Caption\nEnd Sub\nSub Button1_Click()\n Button1.Caption = Other.Caption\nEnd Sub\n');
});
test('form rename updates startup and bound type references without touching locals',()=>{
 const p=project(),m=p.modules[0];m.code='Sub Test()\n Dim f As Form1\n Set f = New Form1\n Form1.Button1.Caption = "Form1"\nEnd Sub\nSub Shadow()\n Dim Form1 As String\n Form1 = "local"\nEnd Sub\n';const r=good(rename(p,{Form1:'MainWindow'}));assert.equal(r.project.startup,'MainWindow');assert.match(r.module.code,/As MainWindow/);assert.match(r.module.code,/New MainWindow/);assert.match(r.module.code,/MainWindow.Button1/);assert.match(r.module.code,/Dim Form1 As String\n Form1 =/);
});
test('name capture rejects the whole proposal while retaining its draft',()=>{
 const p=project(),m=p.modules[0];m.code='Sub Test()\n Dim Confirm As String\n Button1.Caption = "x"\nEnd Sub\n';const original=structuredClone(p),r=rename(p,{Button1:'Confirm'});assert.equal(r.applied,false);assert.match(r.result.diagnostics.map(d=>d.message).join('\n'),/capture/);assert.deepEqual(r.module.form,m.form);assert.equal(r.module.code,m.code);assert.deepEqual(p,original);assert.match(r.module.xaml.text,/Name="Confirm"/);
});
test('event procedure name collision is diagnosed before any mutation',()=>{
 const p=project(),m=p.modules[0];m.code='Sub Button1_Click()\nEnd Sub\nSub Confirm_Click()\nEnd Sub\n';const r=rename(p,{Button1:'Confirm'});assert.equal(r.applied,false);assert.match(r.result.diagnostics.map(d=>d.message).join('\n'),/collide/);assert.equal(r.module.code,m.code);
});
test('inactive conditional branches are not guessed from the current configuration',()=>{
 const p=project(),m=p.modules[0];m.code='#If False Then\nSub Other()\n Button1.Caption = "inactive"\nEnd Sub\n#End If\n';const r=rename(p,{Button1:'Confirm'});assert.equal(r.applied,false);assert.match(r.result.diagnostics.map(d=>d.message).join('\n'),/inactive conditional/);
});
test('control array members rename together while preserving Index and identities',()=>{
 const p=project(),m=p.modules[0],c=m.form.controls[0];c.properties.Index=0;const d=createControl('CommandButton','Button1',0,0);d.properties.Index=1;m.form.controls.push(d);m.code='Sub Button1_Click(Index As Integer)\n Button1(Index).Caption = "yes"\nEnd Sub\n';const r=good(rename(p,{Button1:'Choice'}));assert.match(r.module.code,/Sub Choice_Click/);assert.match(r.module.code,/Choice\(Index\)/);assert.deepEqual(r.module.form.controls.map(c=>[c.id,c.properties.Index]),[[c.id,0],[d.id,1]]);
});
for(const [name,mutate] of [
 ['nonboolean conflict',s=>s.conflict='false'],['unsafe revision',s=>s.revision=Number.MAX_SAFE_INTEGER+1],['oversized source',s=>s.text=' '.repeat(MAX_XAML_LENGTH+1)],['oversized applied source',s=>s.appliedText=' '.repeat(MAX_XAML_LENGTH+1)],['nonstring backup',s=>s.previousText={}],['oversized backup',s=>s.previousText=' '.repeat(MAX_XAML_LENGTH+1)],
])test('editor and build share validation: '+name,()=>{
 const p=project(),m=p.modules[0];m.xaml=readXamlDocument(m,{schema});m.xaml.appliedText=m.xaml.text;mutate(m.xaml);assert.throws(()=>readXamlDocument(m,{schema}),/Invalid/);assert.equal(xamlBuildDiagnostics(p)[0].code,'VBXAML2201');
});
test('revision exhaustion is rejected by edit/recovery without unsafe increment',()=>{
 const p=project(),m=p.modules[0];m.xaml=readXamlDocument(m,{schema});m.xaml.revision=Number.MAX_SAFE_INTEGER;assert.throws(()=>prepareXamlEdit(p,m.id,m.xaml.text,{schema}),/exhausted/);assert.throws(()=>useDesignerXaml(p,m.id,{schema}),/exhausted/);assert.equal(m.xaml.revision,Number.MAX_SAFE_INTEGER);
});
test('expectedBase protects asynchronous imports against designer changes',()=>{
 const p=project(),m=p.modules[0],base=formStamp(m.form),text=formToXaml(m.form,{schema});m.form.controls[0].properties.Caption='Changed';assert.throws(()=>prepareXamlEdit(p,m.id,text,{schema,expectedRevision:0,expectedBase:base}),/designer changed/);
});
test('multi-module synchronization publishes no partial document states on failure',()=>{
 const p=project(),second=createForm('Other');p.modules.push(second);for(const m of p.modules){m.xaml=readXamlDocument(m,{schema});m.xaml.appliedText=m.xaml.text;}second.xaml.revision=Number.MAX_SAFE_INTEGER;const after=structuredClone(p);for(const m of after.modules)m.form.properties.Caption+=' changed';const saved=after.modules.map(m=>structuredClone(m.xaml));assert.throws(()=>synchronizeXamlProject(p,after,{schema}),/exhausted/);assert.deepEqual(after.modules.map(m=>m.xaml),saved);
});

for(const value of [null,false,0,''])test('malformed persisted state is not treated as an absent document: '+JSON.stringify(value),()=>{const p=project();p.modules[0].xaml=value;assert.throws(()=>readXamlDocument(p.modules[0]),/Invalid/);assert.equal(xamlBuildDiagnostics(p).length,1);});
test('oversized model stamps are rejected with the other persisted fields',()=>{const p=project(),m=p.modules[0];m.xaml=readXamlDocument(m);m.xaml.base='x'.repeat(MAX_XAML_LENGTH+1);assert.throws(()=>readXamlDocument(m),/Invalid/);assert.equal(xamlBuildDiagnostics(p).length,1);});

test('native member attributes follow their bound procedure/control, not description strings',()=>{
 const p=project(),m=p.modules[0];m.code='Private Sub Button1_Click()\nEnd Sub\n';m.attributes=['Attribute VB_Name = "Form1"','Attribute Button1_Click.VB_Description = "Button1_Click stays as text"','Attribute Button1.VB_VarHelpID = -1'];
 const r=good(rename(p,{Button1:'Accept',Form1:'Main'}));assert.deepEqual(r.module.attributes,['Attribute VB_Name = "Main"','Attribute Accept_Click.VB_Description = "Button1_Click stays as text"','Attribute Accept.VB_VarHelpID = -1']);assert.equal(m.attributes[0],'Attribute VB_Name = "Form1"');
});

test('unchanged native attributes remain isolated in a successful proposal',()=>{const p=project(),m=p.modules[0];m.attributes=['Attribute VB_Name = "Form1"'];const r=good(prepareXamlEdit(p,m.id,readXamlDocument(m).text,{schema}));r.module.attributes.push('new');assert.equal(m.attributes.length,1);});
