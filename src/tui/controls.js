import {TUI_PROFILES} from './cells.js';
/** The shared model/event implementation remains the authority. These are paint
 * capabilities, not replacement controls. Native islands deliberately preserve
 * graphics, rich content, and third-party browser/OCX interaction. */
export const TUI_CONTROL_CAPABILITIES = Object.freeze(Object.fromEntries([
  ...['Label','TextBox','CommandButton','CheckBox','OptionButton','ComboBox','ListBox','HScrollBar','VScrollBar','Timer','DriveListBox','DirListBox','FileListBox','Shape','Line','Data','TreeView','ListView','ProgressBar','Slider','StatusBar','Toolbar','RichTextBox','MSFlexGrid','MSHFlexGrid','DataGrid','DTPicker','MonthView','UpDown','ImageList','CommonDialog','Adodc'].map(type=>[type,'cells']),
  ...['Form','MDIForm','Frame','PictureBox','TabStrip','SSTab'].map(type=>[type,'container']),
  ...['Image','MSChart','OLE','WebBrowser'].map(type=>[type,'native'])
]));
export class TuiControlRegistry {
  constructor(){this.adapters=new Map();}
  register(type,paint,{capability='cells'}={}) {
    if(typeof type!=='string'||!type||typeof paint!=='function'||!['cells','container','native'].includes(capability))throw new TypeError('Invalid TUI adapter');
    if(this.adapters.has(type))throw new Error(`TUI adapter already registered: ${type}`);
    const adapter={paint,capability};this.adapters.set(type,adapter);return ()=>{if(this.adapters.get(type)===adapter)this.adapters.delete(type);};
  }
  capability(type){return this.adapters.get(type)?.capability??TUI_CONTROL_CAPABILITIES[type]??'native';}
  paint(buffer,state,profile){return (this.adapters.get(state.type)?.paint??paintControl)(buffer,state,profile);}
}
export function paintControl(b,s,profile='turbo') {
  const p=TUI_PROFILES[profile]||TUI_PROFILES.turbo,w=b.columns,h=b.rows,fg=s.disabled?8:p.foreground,bg=p.background;
  const line=(x,y,text,width=w-x,selected=false,mnemonics=false)=>b.text(x,y,text,{width:Math.max(0,width),foreground:selected?p.accent:fg,background:selected?p.selection:bg,hotkey:p.accent,mnemonics});
  function paintRows(){
    for(const row of s.rows){
      if(![row.x,row.y,row.width,row.height??1].every(Number.isSafeInteger)||row.width<=0)continue;
      const height=Math.max(1,row.height||1);if(row.y>=h||row.y+height<=0)continue;
      const ink=row.disabled?8:row.selected?p.accent:fg,paper=row.selected?p.selection:bg;
      b.pushClip(row.x,row.y,row.width,height);
      try{b.fill(row.x,row.y,row.width,height,' ',ink,paper);b.text(row.x,row.y,row.text,{width:row.width,foreground:ink,background:paper});}
      finally{b.popClip();}
      if(row.separator&&row.x>0)b.fill(row.x-1,Math.max(0,row.y),1,Math.max(0,Math.min(h,row.y+height)-Math.max(0,row.y)),'│',p.border,bg);
    }
  }
  b.fill(0,0,w,h,' ',fg,bg);const middle=Math.floor((h-1)/2);
  switch(s.type) {
    case 'CommandButton': {b.fill(0,0,w,h,' ',s.focused?p.accent:fg,s.pressed?p.selection:p.button);const label=`[ ${s.caption||s.name} ]`,x=Math.max(0,Math.floor((w-Array.from(label).length)/2));b.text(x,middle,label,{width:w-x,foreground:s.focused?p.accent:fg,background:s.pressed?p.selection:p.button,mnemonics:s.mnemonics!==false,hotkey:p.accent});break;}
    case 'Label':{const text=s.caption||s.text||'',length=Array.from(text).length,x=s.alignment==='right'?Math.max(0,w-length):s.alignment==='center'?Math.max(0,Math.floor((w-length)/2)):0;line(x,0,text,w-x,false,s.mnemonics!==false);break;}
    case 'CheckBox':case 'OptionButton':line(0,middle,(s.type==='OptionButton'?`(${s.checked?'•':' '}) `:`[${s.indeterminate?'▒':s.checked?'X':' '}] `)+s.caption,w,false,s.mnemonics!==false);break;
    case 'TextBox':case 'RichTextBox':case 'DTPicker':case 'ComboBox':case 'DriveListBox': {
      const lines=String(s.text??'').split(/\r?\n/),start=Math.max(0,Math.floor(s.scrollRow||0)),offset=Math.max(0,Math.floor(s.scrollColumn||0));
      for(let y=0;y<Math.min(h,lines.length-start);y++){const visible=Array.from(lines[start+y]).slice(offset,offset+w).join('');line(0,y,s.password?'•'.repeat(Array.from(visible).length):visible,w-(['ComboBox','DriveListBox','DTPicker'].includes(s.type)?1:0));}
      if(['ComboBox','DriveListBox','DTPicker'].includes(s.type))line(w-1,0,'▼',1);break;
    }
    case 'HScrollBar':case 'VScrollBar':case 'Slider':case 'ProgressBar': {
      const vertical=s.type==='VScrollBar'||s.vertical,extent=vertical?h:w,ratio=Math.max(0,Math.min(1,(s.value-s.min)/(s.max-s.min||1)));
      if(s.type==='ProgressBar'){const filled=Math.round(w*ratio);b.fill(0,middle,filled,1,'█',p.selection,bg);b.fill(filled,middle,w-filled,1,'░',fg,bg);break;}
      for(let n=0;n<extent;n++)b.put(vertical?Math.floor(w/2):n,vertical?n:middle,n===0?(vertical?'▲':'◄'):n===extent-1?(vertical?'▼':'►'):'░',fg,bg);
      const n=extent<3?0:1+Math.round((extent-3)*(s.reverse?1-ratio:ratio));b.put(vertical?Math.floor(w/2):n,vertical?n:middle,'█',p.accent,bg);break;
    }
    case 'UpDown':if(!s.rows?.length){line(0,0,'▲');if(h>1)line(0,h-1,'▼');break;}
      // Native stepper button rectangles also cover horizontal orientation.
      paintRows();break;
    case 'Line':b.fill(0,middle,w,1,'─',fg,bg);break;
    case 'Shape':b.frame(0,0,w,h,{foreground:fg,background:bg});break;
    case 'Timer':case 'ImageList':case 'CommonDialog':line(0,0,({Timer:'◷',ImageList:'▧',CommonDialog:'[…]'}[s.type]));break;
    default:
      if(s.rows?.length)paintRows();
      else line(0,0,s.text||s.caption||s.name);
  }
  return b;
}
