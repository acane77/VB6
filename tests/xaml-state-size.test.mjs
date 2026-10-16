import test from 'node:test';
import assert from 'node:assert/strict';
import {createControl,createForm,newProject} from '../src/project/model.js';
import {formToXaml,createVb6XamlSchema} from '../src/xaml/forms.js';
import {prepareXamlEdit,readXamlDocument,useDesignerXaml,synchronizeXamlProject,formStamp} from '../src/xaml/documents.js';
import {MAX_XAML_LENGTH} from '../src/xaml/contract.js';
const schema=createVb6XamlSchema();
const project=()=>{const p=newProject();p.settings.xaml=true;p.modules[0].form.controls=[createControl('CommandButton','Button1',0,0)];return p;};

test('compact shared resources cannot publish an oversized expanded model stamp',()=>{
 const p=project(),m=p.modules[0],original=structuredClone(p),initial=readXamlDocument(m,{schema});
 const text='<Page xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" x:Name="Form1"><Page.Resources><x:String x:Key="C">'+'c'.repeat(100000)+'</x:String></Page.Resources><Canvas>'+'<Button Content="{StaticResource C}"/>'.repeat(21)+'</Canvas></Page>';
 const r=prepareXamlEdit(p,m.id,text,{schema});assert.equal(r.applied,false);assert.equal(r.result.form,null);assert.deepEqual(r.module.form,m.form);assert.deepEqual(p,original);
 const state=readXamlDocument(r.module,{schema});assert.equal(state.text,text);assert.equal(state.appliedText,initial.text);assert.equal(state.base,initial.base);assert.equal(state.revision,1);assert.match(r.result.diagnostics.at(-1).message,/Expanded XAML form exceeds/);
});
test('new authoring documents validate JSON-expanded stamps as well as source length',()=>{
 const p=project(),m=p.modules[0];m.form.properties.Caption='\\'.repeat(1050000);
 assert.ok(formToXaml(m.form,{schema}).length<MAX_XAML_LENGTH);assert.ok(formStamp(m.form).length>MAX_XAML_LENGTH);assert.throws(()=>readXamlDocument(m,{schema}),/Invalid/);assert.equal(m.xaml,undefined);
});
test('recovery cannot replace a valid document with an oversized new model stamp',()=>{
 const p=project(),m=p.modules[0];m.xaml=readXamlDocument(m,{schema});m.xaml.appliedText=m.xaml.text;m.form.properties.Caption='\\'.repeat(1050000);const saved=structuredClone(m.xaml);
 assert.throws(()=>useDesignerXaml(p,m.id,{schema}),/Invalid/);assert.deepEqual(m.xaml,saved);
});
test('oversized synchronized model rejects all pending document changes atomically',()=>{
 const p=project();p.modules.push(createForm('Other'));for(const m of p.modules){m.xaml=readXamlDocument(m,{schema});m.xaml.appliedText=m.xaml.text;}
 const after=structuredClone(p),saved=after.modules.map(m=>structuredClone(m.xaml));after.modules[0].form.properties.Caption='Small edit';after.modules[1].form.properties.Caption='\\'.repeat(1050000);
 assert.throws(()=>synchronizeXamlProject(p,after,{schema}),/Invalid/);assert.deepEqual(after.modules.map(m=>m.xaml),saved);
});
