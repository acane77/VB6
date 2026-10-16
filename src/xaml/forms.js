import {xamlEnabled,MAX_XAML_LENGTH,formStamp} from './contract.js';
import {createStaticValues,objectProperties} from './static-values.js';
import {patchNativeSource,patchWinUISource} from './source-edits.js';
import {createWinUISchema,compileXaml,escapeXml,diagnostic,isXmlName,PRESENTATION_NS,XAML_NS} from '../../packages/xaml-compiler/src/index.js';
import {CONTROL_DEFAULTS,createControl,createForm,newProject,normalizeProject,newId} from '../project/model.js';
import {LAYOUT_DEFAULTS,validateLayout} from '../layout/contract.js';
import {arrangeFormEdit,parentIds} from '../layout/model.js';

export const VB6_XAML_NS = 'urn:vb6:forms';
export {xamlEnabled};
const clone = value => structuredClone(value);
const nativeTypes = ['Form','MDIForm','Menu','Control',...Object.keys(CONTROL_DEFAULTS)];
const common = createControl('CommandButton').properties;
const propertyType = value => typeof value === 'number' ? 'Double' : typeof value === 'boolean' ? 'Boolean' : typeof value === 'object' ? 'Json' : 'String';
const extraNumbers = 'Index Align Appearance BorderStyle WindowState MDIChild ControlBox MinButton MaxButton Moveable NegotiateMenus FontUnderline FontStrikethru';
const extraStrings = 'DataSource DataField DataMember Picture Icon';
export function createVb6XamlSchema() {
  const schema = createWinUISchema();
  const members = Object.fromEntries(Object.entries({...common,...LAYOUT_DEFAULTS}).map(([k,v]) => [k,propertyType(v)]));
  for (const key of extraNumbers.split(' ')) members[key] = 'Double';
  for (const key of extraStrings.split(' ')) members[key] = 'String';
  members.Children = {type:'Object',collection:true};
  schema.registerType(VB6_XAML_NS,'Component',{members,contentProperty:'Children',runtimeNameProperty:null,assignableTo:[{namespaceURI:PRESENTATION_NS,name:'UIElement'}]});
  for (const name of nativeTypes) {
    const defaults = ['Form','MDIForm'].includes(name) ? createForm().form.properties : CONTROL_DEFAULTS[name] ?? {};
    const own = Object.fromEntries(Object.entries(defaults).map(([k,v]) => [k,propertyType(v)]));
    if (name === 'Menu') Object.assign(own,{Caption:'String',Checked:'Double',Shortcut:'String',WindowList:'Double'});
    if (name === 'Form' || name === 'MDIForm') own.Menus = {type:'Object',collection:true};
    schema.registerType(VB6_XAML_NS,name,{base:'Component',members:own,contentProperty:'Children',runtimeNameProperty:null});
  }
  schema.registerType(VB6_XAML_NS,'Designer',{members:Object.fromEntries(Object.entries({Id:'String',Order:'Int32',Type:'String',State:'Json',Properties:'Json',HasName:'Boolean',HasParent:'Boolean',PropertyOrder:'Json'}).map(([k,type]) => [k,{type,attached:true}]))});
  return schema;
}
const jsonValue = value => {
  const stack = [[value,0]]; let count = 0;
  while (stack.length) {
    const [node,depth] = stack.pop();
    if (++count > 100000 || depth > 64) throw new RangeError('Native XAML metadata limit exceeded.');
    if (node === null || ['string','boolean'].includes(typeof node)) continue;
    if (typeof node === 'number') { if (!Number.isFinite(node)) throw new TypeError('Metadata numbers must be finite.'); continue; }
    if (typeof node !== 'object') throw new TypeError('Only JSON data is allowed in XAML metadata.');
    for (const [key,v] of Object.entries(node)) {
      if (['__proto__','prototype','constructor'].includes(key)) throw new TypeError('Unsafe metadata property ' + key + '.');
      stack.push([v,depth+1]);
    }
  }
  return clone(value);
};
const quote = value => escapeXml(typeof value === 'string' && value.startsWith('{') ? '{}' + value : String(value));
const jsonText = value => quote(JSON.stringify(jsonValue(value)));
const structural = new Set(['id','name','type','parent','properties','controls','menus']);

/** Lossless VB6 vocabulary: native dimensions stay in twips, Boolean flags stay
 * 0/-1, control arrays keep Name+Index, and unknown metadata is explicit JSON data. */
export function formToXaml(form, options = {}) {
  const schema = options.schema ?? createVb6XamlSchema(), lines = [], newline = options.newline ?? '\n';
  const controls = form.controls ?? [], menus = form.menus ?? [];
  const indices = new Map([controls,menus].flatMap(list=>list.map((node,index)=>[node,index])));
  const controlParents = parentIds(controls), menuParents = parentIds(menus), active = new Set(), emitted = new Set();
  const children = list => { const map = new Map(); for (const node of list) { const parent = (list === controls ? controlParents : menuParents).get(node.id) ?? null; const items=map.get(parent)??[];items.push(node);map.set(parent,items); } return map; };
  const controlChildren = children(controls), menuChildren = children(menus);
  function write(node, depth, order = null, list = controls, root = false) {
    if(depth>128)throw new RangeError('Native XAML hierarchy exceeds 128 levels.');
    if (active.has(node.id) || emitted.has(node.id)) throw new Error('Duplicate or cyclic native XAML identity.');
    active.add(node.id); emitted.add(node.id);
    const known = nativeTypes.includes(node.type), tag = 'vb:' + (known ? node.type : 'Control'), type = schema.getType(VB6_XAML_NS,known ? node.type : 'Control');
    const attrs = root ? [`xmlns="${PRESENTATION_NS}"`,`xmlns:x="${XAML_NS}"`,`xmlns:vb="${VB6_XAML_NS}"`] : [];
    attrs.push(`Name="${quote(node.name)}"`,`vb:Designer.Id="${quote(node.id)}"`);
    if (!known) attrs.push(`vb:Designer.Type="${quote(node.type)}"`);
    if (order !== null) attrs.push(`vb:Designer.Order="${order}"`);
    const properties = node.properties ?? {}, extras = {};
    if (!Object.hasOwn(properties,'Name')) attrs.push('vb:Designer.HasName="False"');
    else if (properties.Name !== node.name) extras.Name = properties.Name;
    if (!root && !Object.hasOwn(node,'parent')) attrs.push('vb:Designer.HasParent="False"');
    for (const [key,value] of Object.entries(properties)) {
      if (key === 'Name') continue;
      const member = isXmlName(key) && schema.member(type,key,{'':VB6_XAML_NS});
      if (member && !member.collection && member.type === propertyType(value)) attrs.push(`${key}="${member.type === 'Json' ? jsonText(value) : quote(value)}"`);
      else extras[key] = value;
    }
    if (Object.keys(extras).length) {attrs.push(`vb:Designer.Properties="${jsonText(extras)}"`);attrs.push(`vb:Designer.PropertyOrder="${jsonText(Object.keys(properties))}"`);}
    const state = Object.fromEntries(Object.entries(node).filter(([k]) => !structural.has(k)));
    if (root && Object.hasOwn(node,'parent')) state.parent = node.parent;
    if (Object.keys(state).length) attrs.push(`vb:Designer.State="${jsonText(state)}"`);
    const nested = (list === controls ? controlChildren : menuChildren).get(root ? null : node.id) ?? [];
    const hasMenus = root && menus.length;
    const pad = '  '.repeat(depth);
    lines.push(pad + '<' + tag + ' ' + attrs.join(' ') + (!nested.length && !hasMenus ? ' />' : '>'));
    if (hasMenus) {
      lines.push(pad+'  <'+tag+'.Menus>');
      for (const menu of menuChildren.get(null) ?? []) write(menu,depth+2,indices.get(menu),menus);
      lines.push(pad+'  </'+tag+'.Menus>');
    }
    for (const child of nested) write(child,depth+1,indices.get(child),list);
    if (nested.length || hasMenus) lines.push(pad+'</'+tag+'>');
    active.delete(node.id);
  }
  write(form,0,null,controls,true);
  if (emitted.size !== controls.length+menus.length+1) throw new Error('The form contains unreachable controls or menus.');
  const text=lines.join(newline)+newline;
  if(text.length>MAX_XAML_LENGTH)throw new RangeError('XAML source exceeds the document limit.');
  return text;
}

const aliases = {Page:'Form',Window:'Form',UserControl:'Form',Canvas:'PictureBox',Grid:'PictureBox',StackPanel:'PictureBox',Border:'PictureBox',Button:'CommandButton',TextBlock:'Label',TextBox:'TextBox',PasswordBox:'TextBox',CheckBox:'CheckBox',RadioButton:'OptionButton',ComboBox:'ComboBox',ListBox:'ListBox',ProgressBar:'ProgressBar',Slider:'Slider',ScrollBar:'HScrollBar',Image:'Image',Rectangle:'Shape',Ellipse:'Shape',Line:'Line',RichEditBox:'RichTextBox'};
const nativeEvent = {Click:'Click',TextChanged:'Change',PasswordChanged:'Change',SelectionChanged:'Click',ValueChanged:'Change',GotFocus:'GotFocus',LostFocus:'LostFocus',KeyDown:'KeyDown',KeyUp:'KeyUp',Loaded:'Load',Unloaded:'Unload',SizeChanged:'Resize'};
const plain = objectProperties;
const design = node => Object.fromEntries(node.properties.filter(p => p.member.namespaceURI === VB6_XAML_NS && p.member.owner === 'Designer').map(p => [p.member.name,p.value.value]));
const toColor = value => {
  if (typeof value === 'number') return value;
  const colors = {black:'#000000',white:'#ffffff',red:'#ff0000',green:'#008000',blue:'#0000ff',yellow:'#ffff00',gray:'#808080',grey:'#808080'};
  const text = colors[String(value).toLowerCase()] ?? String(value), match = /^#(?:ff)?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(text);
  if (!match) throw new TypeError('VB6 colors require an opaque #RRGGBB color or a supported named color.');
  return parseInt(match[1],16) | parseInt(match[2],16)<<8 | parseInt(match[3],16)<<16;
};

/** Compile into the existing form model. No XAML engine is added to exported apps. */
export function compileFormXaml(text, {form:previous,settings={},schema=createVb6XamlSchema(),uri=''} = {}) {
  const compilation = compileXaml(text,{schema,uri}), diagnostics = [...compilation.diagnostics], sourceMap = [], controls = [], menus = [], identities = new Set(), orders = new WeakMap();
  const error = (message,source,code='VBXAML2001') => diagnostics.push(diagnostic(compilation.syntax.source,code,message,source?.start ?? 0,source?.end ?? text.length));
  if (!compilation.success) return {success:false,form:null,compilation,diagnostics,sourceMap};
  const previousNodes = [previous,...previous?.controls??[],...previous?.menus??[]].filter(Boolean);
  const previousById=new Map(previousNodes.map(n=>[n.id,n])),previousByName=new Map();
  for(const node of previousNodes){const key=JSON.stringify([node.name.toLowerCase(),node.type,node.properties?.Index]);const list=previousByName.get(key)??[];list.push(node);previousByName.set(key,list);}
  let sequence = 0, expandedLength = 0;
  const statics=createStaticValues(compilation);
  const constant=(value,scopes)=>jsonValue(statics.constant(value,scopes));
  const usedNames=new Set(compilation.nodes.map(n=>n.name??plain(n).Name?.value?.value).filter(n=>typeof n==='string').map(n=>n.toLowerCase()));
  function lower(node,parent=null,root=false,list=controls,inheritedResources=[]) {
    if (node.kind !== 'Object') { error('A form child must be a control object.',node.source); return null; }
    const native = node.type.namespaceURI === VB6_XAML_NS, originalValues = plain(node), metadata = design(node);
    let scopes=inheritedResources,properties=node.properties;
    try {
      scopes=[statics.dictionary(originalValues.Resources?.value,inheritedResources),...inheritedResources];
      if(!native)properties=statics.properties(node,scopes);
    } catch(e){error(e.message,node.source);}
    const values=plain({properties});
    let type = native ? metadata.Type ?? node.type.name : node.type.namespaceURI===PRESENTATION_NS ? aliases[node.type.name] : null;
    if(!native&&node.type.name==='ScrollBar') {
      try{if(values.Orientation&&statics.convert(values.Orientation.value,values.Orientation.member,scopes)==='Vertical')type='VScrollBar';}catch(e){error(e.message,values.Orientation.source);}
    }
    if (!type || root && !['Form','MDIForm'].includes(type) || !root && ['Form','MDIForm'].includes(type)) { error('The VB6 form target cannot lower '+node.type.name+'.',node.source); return null; }
    for (const [key] of Object.entries(node.directives)) if (!['Name','Key','Class','DefaultBindMode'].includes(key)) error('The VB6 target does not implement x:'+key+'.',node.source);
    if (node.template) { error('WinUI templates cannot be silently converted to VB6 controls.',node.source); return null; }
    let name = metadata.Name ?? (native ? values.Name?.value.value : node.name) ?? (root ? previous?.name ?? 'Form1' : null);
    if(name===null){do{name=type+(++sequence);}while(usedNames.has(name.toLowerCase()));usedNames.add(name.toLowerCase());}
    if (!/^[A-Za-z_]\w*$/.test(name)) error('Invalid VB6 component name '+name+'.',node.source);
    if (root && node.directives.Class && node.directives.Class !== name) error('x:Class must match the VB6 form module name.',node.source);
    const index=values.Index?.value?.value;
    const prior = previousById.get(metadata.Id) ?? previousByName.get(JSON.stringify([name.toLowerCase(),type,index]))?.find(n=>!identities.has(n.id));
    const id = metadata.Id ?? prior?.id ?? newId();
    if (typeof id !== 'string' || !id || id.length > 512 || identities.has(id)) error('Duplicate or invalid component identity.',node.source);
    identities.add(id);
    let extraState = {}, extraProperties = {};
    try {
      extraState = jsonValue(metadata.State ?? {}); extraProperties = jsonValue(metadata.Properties ?? {});
      if (!extraState || Array.isArray(extraState) || typeof extraState !== 'object' || !extraProperties || Array.isArray(extraProperties) || typeof extraProperties !== 'object') throw new Error('Designer metadata must be a JSON object.');
      if (Object.keys(extraState).some(k => structural.has(k) && !(root && k === 'parent'))) throw new Error('Designer.State cannot override structural form fields.');
    } catch (e) { error(e.message,node.source); }
    const exact = native && metadata.Id !== undefined;
    const defaults = exact ? {} : root ? createForm(name).form.properties : createControl(type,name,0,0).properties;
    const target = {...extraState,id,name,type,properties:{...defaults,...extraProperties}};
    if(metadata.Order!==undefined&&(!Number.isInteger(metadata.Order)||metadata.Order<0))error('Designer.Order must be a nonnegative integer.',node.source);
    if(parent&&metadata.HasParent===false)error('A nested component cannot omit its parent identity.',node.source);
    if(!root&&((type==='Menu')!==(list===menus)))error('Menus must be inside a native Form.Menus collection.',node.source);
    if (metadata.HasName !== false && !Object.hasOwn(extraProperties,'Name')) target.properties.Name = name;
    if (!root && metadata.HasParent !== false) target.parent = parent?.name ?? null;
    if (parent && parent.properties.Index !== undefined) target.nativeParentId = parent.id;
    const mapping = {id,name,type,tag:node.type.name,native,start:node.source.start,end:node.source.end,properties:{},order:metadata.Order ?? list.length};
    sourceMap.push(mapping);
    const set = (key,value,p,encoding='direct') => { target.properties[key]=value; if(p)mapping.properties[key]={fromStyle:!!p.fromStyle,start:p.source.start,end:p.source.end,name:p.member.attached?p.member.owner+'.'+p.member.name:p.member.name,encoding}; };
    if (!native && ['Canvas','Grid','StackPanel','Border'].includes(node.type.name)) { set('BorderStyle',0);set('Caption',''); }
    if (!native && node.type.name === 'Ellipse') set('Shape',2);
    if (!native && ['Grid','StackPanel'].includes(node.type.name)) {
      if (settings.anchoring !== true) error('Enable anchoring and automatic layout to lower '+node.type.name+'.',node.source,'VBXAML2002');
      else {
        set('LayoutMode',node.type.name === 'Grid'?5:values.Orientation?.value.value === 'Horizontal'?1:2);
        if(node.type.name==='Grid'){set('LayoutGridColumns','1fr');set('LayoutGridRows','1fr');}
      }
    }
    const children = [], deferred = [];
    for (const p of properties) {
      const key = p.member.name;
      if (p.member.namespaceURI === VB6_XAML_NS && p.member.owner === 'Designer') continue;
      if (key === 'Resources') continue;
      if (p.value.kind === 'Collection' && ['Children','Menus','Content','Child'].includes(key)) {
        if(!root&&type!=='Menu'&&!['Frame','PictureBox','SSTab','TabStrip','UserControl'].includes(type)&&nativeTypes.includes(type))error(type+' cannot host child controls.',p.source);
        else children.push(...p.value.items.map(child=>({child,menu:key==='Menus'})));
        continue;
      }
      if (p.value.kind === 'Object' && ['Content','Child'].includes(key)) {
        if(!native&&!['Form','MDIForm','PictureBox'].includes(type))error('Object content requires a supported native container; '+type+' cannot host this content.',p.source);
        else children.push({child:p.value,menu:false});
        continue;
      }
      if (p.member.kind === 'event') { deferred.push(p);continue; }
      try {
        if (native) { if(key!=='Name')set(key,constant(p.value,scopes),p); continue; }
        if(key==='Items'&&['ListBox','ComboBox'].includes(type)) {
          if(p.value.kind!=='Collection')throw new Error('Items must be a collection.');
          const selected=[];
          const items=p.value.items.map((item,index)=>{
            if(item.kind==='Literal'){if(typeof item.value!=='string')throw new Error('Native list items must be strings.');return item.value;}
            if(item.kind!=='Object'||item.type.namespaceURI!==PRESENTATION_NS||!['ListBoxItem','ComboBoxItem'].includes(item.type.name))throw new Error('Native list items require strings or simple item containers.');
            const ip=plain(item);
            if(item.properties.some(p=>!['Content','IsSelected'].includes(p.member.name))||Object.keys(item.directives).length)throw new Error('Styled, named or behavioral item containers cannot be flattened.');
            const content=constant(ip.Content?.value??{kind:'Literal',value:''},scopes);
            if(typeof content!=='string')throw new Error('Native list item content must be a string.');
            if(ip.IsSelected&&constant(ip.IsSelected.value,scopes))selected.push(index);
            return content;
          });
          if(selected.length>1)throw new Error('Multiple selected item containers require runtime selection-state support.');
          if(selected.length&&values.SelectedIndex&&constant(values.SelectedIndex.value,scopes)!==selected[0])throw new Error('SelectedIndex conflicts with item selection.');
          set('List',items,p);if(selected.length)set('ListIndex',selected[0]);
          continue;
        }
        if (key === 'Inlines') {
          const items=p.value.kind==='Collection'?p.value.items:[p.value];
          if (items.some(v=>v.kind!=='Literal')) throw new Error('Only plain TextBlock text is supported by the VB6 Label target.');
          set('Caption',items.map(v=>v.value).join(''),p);continue;
        }
        if (key === 'RowDefinitions' || key === 'ColumnDefinitions') {
          const dimension=key==='RowDefinitions'?'Height':'Width';
          if(p.value.kind!=='Collection')throw new Error('Grid definitions must be a collection.');
          const tracks=p.value.items.map(n=>{
            const props=plain(n),property=props[dimension];
            const size=property?statics.convert(property.value,property.member,scopes):{unit:'star',value:1};
            if (Object.keys(props).some(k=>k!==dimension)) throw new Error('Grid definition min/max constraints are not yet lowered.');
            return size.unit==='star'?size.value+'fr':size.unit==='auto'?'hug':String(size.value*15);
          });set(key==='RowDefinitions'?'LayoutGridRows':'LayoutGridColumns',tracks.join(' '),p);continue;
        }
        const v = statics.convert(p.value,p.member,scopes);
        if (key === 'Name') continue;
        if (p.member.attached && p.member.owner === 'Canvas' && ['Left','Top'].includes(key)) set(key,Number(v)*15,p,'dip');
        else if (p.member.attached && p.member.owner === 'Grid' && ['Row','Column','RowSpan','ColumnSpan'].includes(key)) { if(settings.anchoring!==true)throw new Error('Grid placement requires automatic layout.');set('Layout'+key,v,p); }
        else if (key === 'Width' || key === 'Height') { if(v==='Auto'&&!root&&settings.anchoring===true&&[1,2,5].includes(parent?.properties.LayoutMode))set('Layout'+key+'Mode',1,p);else {if(typeof v!=='number'||v<0)throw new Error('Dimensions must be nonnegative and finite; Auto needs an automatic-layout parent.');set(root?'Client'+key:key,v*15,p,'dip');if(root)set(key,v*15+(key==='Width'?120:450));} }
        else if (['MinWidth','MinHeight','MaxWidth','MaxHeight'].includes(key)) { if(settings.anchoring!==true||typeof v!=='number')throw new Error('Layout constraints require finite values and automatic layout.');set(key.replace('Min','Minimum').replace('Max','Maximum'),v*15,p,'dip'); }
        else if (['Content','Title'].includes(key)) set('Caption',String(v),p);
        else if (key === 'Text') set(type==='Label'?'Caption':'Text',String(v),p);
        else if (key === 'Password') {set('Text',String(v),p);set('PasswordChar','*');}
        else if (key === 'FontFamily') set('FontName',v,p);
        else if (key === 'FontSize') set('FontSize',v*0.75,p,'font');
        else if (key === 'FontWeight') {if(!['Normal','Bold','400','700'].includes(String(v)))throw new Error('VB6 supports normal or bold font weights.');set('FontBold',v==='Bold'||Number(v)===700?-1:0,p,'bold');}
        else if (key === 'FontStyle') {if(v==='Oblique')throw new Error('Oblique is not equivalent to VB6 FontItalic.');set('FontItalic',v==='Italic'?-1:0,p,'italic');}
        else if (key === 'Visibility') set('Visible',v==='Visible'?-1:0,p,'visibility');
        else if (['IsEnabled','IsTabStop','IsReadOnly','AcceptsReturn'].includes(key)) set({IsEnabled:'Enabled',IsTabStop:'TabStop',IsReadOnly:'Locked',AcceptsReturn:'MultiLine'}[key],v?-1:0,p,'flag');
        else if (key === 'IsChecked') {if(v===null&&type!=='CheckBox')throw new Error('Null IsChecked requires CheckBox.');set('Value',v===null?2:v?1:0,p,'checked');}
        else if (['Background','Foreground','Fill','Stroke'].includes(key)) {
          set({Background:'BackColor',Foreground:'ForeColor',Fill:'FillColor',Stroke:'BorderColor'}[key],toColor(v),p,'color');
          if(key==='Fill')set('FillStyle',0);
          if(key==='Background'&&type==='Label')set('BackStyle',1);
        }
        else if (['TabIndex','Tag','MaxLength','Value','SmallChange','LargeChange','PasswordChar','TickFrequency'].includes(key)) set(key,v,p);
        else if (['Minimum','Maximum','SelectedIndex'].includes(key)) set({Minimum:'Min',Maximum:'Max',SelectedIndex:'ListIndex'}[key],v,p);
        else if (key === 'TextAlignment') {if(!['Left','Right','Center'].includes(v))throw new Error('Unsupported VB6 text alignment.');set('Alignment',['Left','Right','Center'].indexOf(v),p,'alignment');}
        else if (key === 'Orientation' && node.type.name === 'StackPanel') set('LayoutMode',v==='Horizontal'?1:2,p,'orientation');
        else if (key === 'Spacing' && node.type.name === 'StackPanel') set('LayoutGap',v*15,p,'dip');
        else if (key === 'RowSpacing' || key === 'ColumnSpacing') set(key==='RowSpacing'?'LayoutCrossGap':'LayoutGap',v*15,p,'dip');
        else if (p.member.owner === 'ToolTipService' && key==='ToolTip') set('ToolTipText',String(v),p);
        else if(key==='Orientation'&&['Slider','ScrollBar'].includes(node.type.name)) {if(node.type.name==='Slider')set('Orientation',v==='Vertical'?1:0,p);}
        else if(key==='StepFrequency'&&node.type.name==='Slider'){if(v<=0)throw new Error('Slider.StepFrequency must be positive.');set('SmallChange',v,p);}
        else if(key==='SelectionMode'&&type==='ListBox')set('MultiSelect',['Single','Multiple','Extended'].indexOf(v),p);
        else if(key==='IsEditable'&&type==='ComboBox')set('Style',v?0:2,p);
        else if(key==='Margin'||key==='Padding') {
          if(settings.anchoring!==true)throw new Error(key+' requires automatic layout.');
          if(key==='Padding'&&!['Form','MDIForm','PictureBox'].includes(type))throw new Error('Padding is supported only on native layout containers.');
          if(v.some(n=>n<0))throw new Error('Negative '+key+' cannot be represented by native automatic layout.');
          for(const [i,side] of ['Left','Top','Right','Bottom'].entries())set('Layout'+key+side,v[i]*15,p,'dip');
        }
        else if(['HorizontalAlignment','VerticalAlignment'].includes(key)) {
          if(settings.anchoring!==true)throw new Error('Alignment requires automatic layout.');
          const mode=parent?.properties.LayoutMode,vertical=key==='VerticalAlignment';
          if(mode===5)set(vertical?'LayoutAlign':'LayoutJustifySelf',['Top','Center','Bottom','Stretch'].indexOf(vertical?v:({Left:'Top',Right:'Bottom'}[v]??v)),p);
          else if(mode===(vertical?1:2))set('LayoutAlign',['Top','Center','Bottom','Stretch'].indexOf(vertical?v:({Left:'Top',Right:'Bottom'}[v]??v)),p);
          else throw new Error(key+' requires a Grid or a matching StackPanel cross axis.');
        }
        else throw new Error('No faithful VB6 lowering exists for '+node.type.name+'.'+key+'.');
      } catch(e) {error(e.message,p.source);}
    }
    if(!native) {
      if(type==='ComboBox'&&!values.IsEditable)set('Style',2);
      if(['ListBox','ComboBox'].includes(type)&&values.Items) {
        const index=target.properties.ListIndex;
        if(index<-1||index>=target.properties.List.length)error('SelectedIndex is outside the item collection.',values.SelectedIndex?.source??node.source);
        if(type==='ComboBox'&&index>=0)set('Text',target.properties.List[index]);
      }
      if(settings.anchoring===true&&parent&&[1,2,5].includes(parent.properties.LayoutMode)) {
        const mode=parent.properties.LayoutMode;
        if(mode===5){if(!properties.some(p=>p.member.owner==='Grid'&&p.member.name==='Row'))set('LayoutRow',0);if(!properties.some(p=>p.member.owner==='Grid'&&p.member.name==='Column'))set('LayoutColumn',0);}
        if(mode!==5)set('LayoutShrink',0);
        for(const axis of ['Width','Height']) {
          const authored=values[axis];
          if(!authored||statics.convert(authored.value,authored.member,scopes)==='Auto') {
            const vertical=axis==='Height',main=mode===(vertical?2:1),alignment=values[vertical?'VerticalAlignment':'HorizontalAlignment'];
            const align=alignment?statics.convert(alignment.value,alignment.member,scopes):'Stretch';
            set('Layout'+axis+'Mode',!main&&align==='Stretch'?2:1);
          }
        }
      }
    }
    if (metadata.PropertyOrder !== undefined) {
      const order=metadata.PropertyOrder;
      if(!Array.isArray(order)||order.some(k=>typeof k!=='string')||new Set(order).size!==order.length)error('Invalid native property order metadata.',node.source);
      else target.properties=Object.fromEntries([...order.filter(k=>Object.hasOwn(target.properties,k)),...Object.keys(target.properties).filter(k=>!order.includes(k))].map(k=>[k,target.properties[k]]));
    }
    // Native property overrides on a WinUI object are explicit, and take precedence.
    if (!native) Object.assign(target.properties,extraProperties);
    for (const p of deferred) {
      const event=nativeEvent[p.member.name],expected=(root?'Form':name)+'_'+event;
      if(!event||p.value.kind!=='Literal'||p.value.value.toLowerCase()!==expected.toLowerCase())error('Use the VB6 event method '+expected+'; arbitrary handler forwarding is not silently generated.',p.source);
    }
    // Count each flat native node once before adding it or descending further.
    // Shared resources can expand far beyond the input length; waiting for the
    // final document stamp would first allocate the entire oversized model.
    // JSON encoding also accounts for escaped characters in persisted values.
    expandedLength+=JSON.stringify(target).length+(root?',"controls":[],"menus":[]'.length:list.length?1:0);
    if(expandedLength>MAX_XAML_LENGTH)throw new RangeError('Expanded XAML form exceeds the document limit.');
    if (root) { target.controls=controls;target.menus=menus; }
    else {list.push(target);orders.set(target,mapping.order);}
    for (const {child,menu} of children) lower(child,root?null:target,false,menu?menus:list,scopes);
    return target;
  }
  let form = null;
  try {
    form = lower(compilation.root,null,true);
    for (const list of [controls,menus]) list.sort((a,b)=>orders.get(a)-orders.get(b));
    if (form) {
      const project = newProject(),module=project.modules[0];module.name=form.name;module.form=form;project.startup=form.name;project.settings={...project.settings,...settings};
      normalizeProject(project);validateLayout(project);
      if(settings.anchoring===true)arrangeFormEdit(clone(form),form,[]);
      if(JSON.stringify(form).length>MAX_XAML_LENGTH)throw new RangeError('Expanded XAML form exceeds the document limit.');
    }
  } catch(e) {error(e.message,compilation.root?.source);}
  const success = !!form && !diagnostics.some(d=>d.severity==='error');
  return {success,form:success?form:null,compilation,diagnostics,sourceMap};
}

/** Source-preserving designer synchronization is accepted only after compiling
 * the candidate and comparing its complete native model with the designer. */
export function synchronizeFormXaml(text,before,after,options={}) {
  if(formStamp(before)===formStamp(after))return {text,regenerated:false};
  const newline=text.includes('\r\n')?'\r\n':'\n';
  const canonical=()=>formToXaml(after,{...options,newline});
  const regenerate=()=>({text:canonical(),regenerated:true,previousText:text});
  try {
    const compiled=compileFormXaml(text,{...options,form:before});
    if(!compiled.success||formStamp(compiled.form)!==formStamp(before))return regenerate();
    // Expose the compiler syntax beside the native source map to the pure edit
    // planners. No live project or editor state is mutated during planning.
    const source={...compiled,syntax:compiled.compilation.syntax};
    const native=compiled.sourceMap.every(m=>m.native);
    const candidate=native
      ?patchNativeSource(text,before,after,source,formToXaml(before,options),canonical(),parentIds)
      :patchWinUISource(text,before,after,source);
    if(candidate===null||candidate.length>MAX_XAML_LENGTH)return regenerate();
    const verified=compileFormXaml(candidate,{...options,form:after});
    if(!verified.success||formStamp(verified.form)!==formStamp(after))return regenerate();
    return {text:candidate,regenerated:false};
  } catch {return regenerate();}
}
