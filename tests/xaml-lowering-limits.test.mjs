import test from 'node:test';
import assert from 'node:assert/strict';
import {compileFormXaml,createVb6XamlSchema} from '../src/xaml/forms.js';
import {PRESENTATION_NS,XAML_NS} from '../packages/xaml-compiler/src/index.js';
const schema=createVb6XamlSchema();
const page=content=>`<Page xmlns="${PRESENTATION_NS}" xmlns:x="${XAML_NS}" x:Name="Form1">${content}</Page>`;

test('resource expansion stops during lowering before constructing every repeated control',()=>{
  const text=page('<Page.Resources><x:String x:Key="Caption">'+'a'.repeat(50000)+'</x:String></Page.Resources><Canvas>'+Array.from({length:64},(_,i)=>`<Button x:Name="Button${i}" Content="{StaticResource Caption}"/>`).join('')+'</Canvas>');
  const result=compileFormXaml(text,{schema});
  assert.equal(result.success,false);
  assert.equal(result.form,null);
  assert.match(result.diagnostics.at(-1).message,/Expanded XAML form exceeds/);
  assert.ok(result.sourceMap.length<66,'Abort lowering instead of materializing the entire expanded form.');
});

test('expansion budget accounts for escaped JSON characters, not just string lengths',()=>{
  const text=page('<Page.Resources><x:String x:Key="Caption">'+'\\'.repeat(50000)+'</x:String></Page.Resources><Canvas>'+Array.from({length:32},(_,i)=>`<Button x:Name="Button${i}" Content="{StaticResource Caption}"/>`).join('')+'</Canvas>');
  const result=compileFormXaml(text,{schema});
  assert.equal(result.success,false);
  assert.match(result.diagnostics.at(-1).message,/Expanded XAML form exceeds/);
  assert.ok(result.sourceMap.length<34);
});

test('resource-backed Grid row and column definitions use the consuming GridLength converter',()=>{
  const text=page('<Page.Resources><x:String x:Key="Column">2*</x:String><x:String x:Key="Row">40</x:String><x:String x:Key="Auto">Auto</x:String></Page.Resources><Grid x:Name="Grid1"><Grid.ColumnDefinitions><ColumnDefinition Width="{StaticResource Column}"/></Grid.ColumnDefinitions><Grid.RowDefinitions><RowDefinition Height="{StaticResource Row}"/><RowDefinition Height="{StaticResource Auto}"/></Grid.RowDefinitions><Button/></Grid>');
  const result=compileFormXaml(text,{schema,settings:{anchoring:true}});
  assert.equal(result.success,true,JSON.stringify(result.diagnostics));
  const grid=result.form.controls.find(c=>c.name==='Grid1');
  assert.equal(grid.properties.LayoutGridColumns,'2fr');
  assert.equal(grid.properties.LayoutGridRows,'600 hug');
});

test('shared resource expansion below the document limit remains valid',()=>{
  const text=page('<Page.Resources><x:String x:Key="Caption">'+'a'.repeat(50000)+'</x:String></Page.Resources><Canvas>'+Array.from({length:16},(_,i)=>`<Button x:Name="Button${i}" Content="{StaticResource Caption}"/>`).join('')+'</Canvas>');
  const result=compileFormXaml(text,{schema});
  assert.equal(result.success,true,JSON.stringify(result.diagnostics));
  assert.equal(result.form.controls.length,17);
  assert.equal(result.form.controls.at(-1).properties.Caption.length,50000);
});
