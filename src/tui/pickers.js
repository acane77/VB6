import {EGA} from './cells.js';

export function parseCalendarDate(text){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(text||''))return null;
  const [year,month,day]=text.split('-').map(Number);if(year<1||month<1||month>12||day<1||day>31)return null;
  const date=new Date(0);date.setUTCHours(0,0,0,0);date.setUTCFullYear(year,month-1,day);
  return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day?date:null;
}
export function calendarISO(date){return String(date.getUTCFullYear()).padStart(4,'0')+'-'+String(date.getUTCMonth()+1).padStart(2,'0')+'-'+String(date.getUTCDate()).padStart(2,'0');}
export function calendarMove(date,days=0,months=0){
  const value=new Date(date);if(months){const day=value.getUTCDate();value.setUTCDate(1);value.setUTCMonth(value.getUTCMonth()+months);const last=new Date(value);last.setUTCMonth(last.getUTCMonth()+1,0);value.setUTCDate(Math.min(day,last.getUTCDate()));}
  value.setUTCDate(value.getUTCDate()+days);return value;
}

/** The browser owns canonical form fields and their value/change listeners.
 * Only user-triggered activation opens these same-document presentation portals.
 * No file/clipboard/security permission and no cross-origin access is involved. */
export class TuiPickers{
  constructor(owner){
    this.owner=owner;this.active=null;
    owner.listen(owner.document,'pointerdown',event=>this.pointer(event),true);
    owner.listen(owner.document,'keydown',event=>this.key(event),true);
    owner.listen(owner.document,'click',event=>{if(this.active?.field===this.field(event.target))event.preventDefault();},true);
  }
  field(target){
    const field=target?.closest?.('select,input[type=date],input[type=color]');
    if(!field||!this.owner.owns(field)||field.disabled||field.readOnly||field.closest('[hidden],[inert],.designer-form')||this.owner.settings.editing==='native')return null;
    if(field.tagName==='SELECT'&&(field.multiple||field.size>1))return null;
    return field;
  }
  pointer(event){
    if(event.button!==0)return;
    const active=this.active;
    if(active&&!active.popup.contains(event.target)&&event.target!==active.field)this.close(false);
    const field=this.field(event.target);if(!field)return;
    event.preventDefault();
    if(this.active?.field===field)this.close(true);else this.open(field);
  }
  key(event){
    if(this.active){
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();this.close(true);return;}
      if(event.key==='Tab'){
        const nodes=[...this.active.popup.querySelectorAll('button:not(:disabled),input:not(:disabled)')].filter(n=>n.tabIndex>=0);
        const index=nodes.indexOf(this.owner.document.activeElement),next=(index+(event.shiftKey?-1:1)+nodes.length)%nodes.length;
        if(nodes.length){event.preventDefault();event.stopPropagation();nodes[next].focus();}return;
      }
      return;
    }
    const field=this.field(event.target);if(!field)return;
    if(event.key==='F4'||event.altKey&&event.key==='ArrowDown'||field.tagName==='SELECT'&&[' ','Enter'].includes(event.key)){
      event.preventDefault();event.stopPropagation();this.open(field);
    }
  }
  button(text,action,label=text){
    const b=this.owner.document.createElement('button');b.type='button';b.textContent=text;b.setAttribute('aria-label',label);b.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();action();});return b;
  }
  open(field){
    this.close(false);if(!this.field(field))return;
    const doc=this.owner.document,popup=doc.createElement('div');popup.className='vb-tui-picker';popup.setAttribute('role','dialog');popup.setAttribute('aria-label',field.type==='date'?'Choose date':field.type==='color'?'Choose color':'Choose value');
    popup.tabIndex=-1;doc.body.append(popup);
    const rect=field.getBoundingClientRect(),state={field,popup,previousExpanded:field.getAttribute('aria-expanded')};this.active=state;
    field.setAttribute('aria-expanded','true');state.off=this.owner.attachPortal(popup);
    if(field.tagName==='SELECT')this.select(state);else if(field.type==='date')this.calendar(state);else this.color(state);
    const width=popup.offsetWidth,height=popup.offsetHeight;
    popup.style.left=Math.max(0,Math.min(rect.left,this.owner.view.innerWidth-width))+'px';
    popup.style.top=Math.max(0,rect.bottom+height<=this.owner.view.innerHeight?rect.bottom:rect.top-height)+'px';
    this.owner.chrome.scan(popup);this.owner.requestPaint();
    (state.focus||popup).focus({preventScroll:true});
  }
  commit(state,value){
    if(this.active!==state||!state.field.isConnected||state.field.disabled||state.field.readOnly||state.field.closest('[inert]')){this.close(false);return;}
    const field=state.field,before=field.value;
    if(field.tagName==='SELECT')field.selectedIndex=value;else field.value=value;
    // Native value sanitization and validity constraints remain authoritative.
    if(field.validity&&(field.validity.rangeUnderflow||field.validity.rangeOverflow||field.validity.stepMismatch||field.validity.badInput)){field.value=before;return;}
    if(field.value!==before){field.dispatchEvent(new this.owner.view.Event('input',{bubbles:true}));field.dispatchEvent(new this.owner.view.Event('change',{bubbles:true}));}
    this.close(true);const control=field.closest('.vb-control');if(control)this.owner.invalidate(control);
  }
  select(state){
    const {field,popup}=state,list=this.owner.document.createElement('div');list.className='vb-tui-picker-list';list.setAttribute('role','listbox');
    let buttons=[],index=Math.max(0,field.selectedIndex),search='',last=0;
    for(let i=0;i<field.options.length&&i<10000;i++){
      const option=field.options[i],button=this.button(option.textContent||' ',()=>this.commit(state,i));
      button.setAttribute('role','option');button.setAttribute('aria-selected',String(i===field.selectedIndex));button.disabled=option.disabled||option.parentElement?.disabled||false;button.tabIndex=i===index?0:-1;list.append(button);buttons.push(button);
    }
    if(buttons[index]?.disabled){buttons[index].tabIndex=-1;index=buttons.findIndex(b=>!b.disabled);if(index>=0)buttons[index].tabIndex=0;}
    popup.append(list);state.focus=buttons[index]||popup;
    const focus=next=>{if(!buttons.length)return;next=Math.max(0,Math.min(buttons.length-1,next));const direction=next>=index?1:-1;while(buttons[next]?.disabled&&next>=0&&next<buttons.length)next+=direction;if(!buttons[next])return;if(buttons[index])buttons[index].tabIndex=-1;index=next;buttons[index].tabIndex=0;buttons[index].focus();buttons[index].scrollIntoView({block:'nearest'});};
    popup.addEventListener('keydown',event=>{
      const moves={ArrowUp:index-1,ArrowDown:index+1,Home:0,End:buttons.length-1,PageUp:index-10,PageDown:index+10};
      if(Object.hasOwn(moves,event.key)){event.preventDefault();event.stopPropagation();focus(moves[event.key]);}
      else if(event.key.length===1&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&event.key!==' '){
        event.preventDefault();event.stopPropagation();const now=Date.now();search=now-last>750?'':search;last=now;search+=event.key.toLocaleLowerCase();
        for(let n=1;n<=buttons.length;n++){const at=(index+n)%buttons.length;if(!buttons[at].disabled&&buttons[at].textContent.toLocaleLowerCase().startsWith(search)){focus(at);break;}}
      }
    });
  }
  calendar(state){
    const {field,popup}=state,now=new Date();
    let active=parseCalendarDate(field.value)||parseCalendarDate(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`);
    const min=parseCalendarDate(field.min),max=parseCalendarDate(field.max),allowed=date=>date.getUTCFullYear()>=1&&date.getUTCFullYear()<=9999&&(!min||date>=min)&&(!max||date<=max);
    if(min&&active<min)active=new Date(min);if(max&&active>max)active=new Date(max);
    const draw=(focus=false)=>{
      popup.replaceChildren();const head=this.owner.document.createElement('div');head.className='vb-tui-calendar-head';
      const shift=n=>{const next=calendarMove(active,0,n);if(allowed(next)){active=next;draw(true);}};
      head.append(this.button('◄',()=>shift(-1),'Previous month'),this.button(`${active.getUTCFullYear()} / ${String(active.getUTCMonth()+1).padStart(2,'0')}`,()=>{},'Current month'),this.button('►',()=>shift(1),'Next month'));popup.append(head);
      const grid=this.owner.document.createElement('div');grid.className='vb-tui-calendar-grid';grid.setAttribute('role','grid');
      for(const name of ['Su','Mo','Tu','We','Th','Fr','Sa']){const h=this.owner.document.createElement('span');h.textContent=name;grid.append(h);}
      const first=new Date(active);first.setUTCDate(1);const start=calendarMove(first,-first.getUTCDay());
      for(let n=0;n<42;n++){
        const date=calendarMove(start,n),iso=calendarISO(date),b=this.button(String(date.getUTCDate()).padStart(2,' '),()=>this.commit(state,iso),iso);
        b.setAttribute('role','gridcell');b.setAttribute('aria-selected',String(iso===field.value));b.disabled=!allowed(date);b.tabIndex=iso===calendarISO(active)?0:-1;
        if(date.getUTCMonth()!==active.getUTCMonth())b.classList.add('outside-month');grid.append(b);
        if(iso===calendarISO(active))state.focus=b;
      }
      popup.append(grid);this.owner.chrome.scan(popup);this.owner.chrome.invalidate(popup);this.owner.requestPaint();if(focus)state.focus?.focus({preventScroll:true});
    };
    popup.addEventListener('keydown',event=>{
      const days={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7,Home:-active.getUTCDay(),End:6-active.getUTCDay()},months={PageUp:-1,PageDown:1};
      if(Object.hasOwn(days,event.key)||Object.hasOwn(months,event.key)){
        event.preventDefault();event.stopPropagation();const next=calendarMove(active,days[event.key]||0,(months[event.key]||0)*(event.ctrlKey?12:1));if(allowed(next)){active=next;draw(true);}
      }
    });draw();
  }
  color(state){
    const {popup,field}=state,grid=this.owner.document.createElement('div');grid.className='vb-tui-color-grid';
    for(const color of EGA){const b=this.button(color,()=>this.commit(state,color),color);b.style.backgroundColor=color;grid.append(b);}
    const hex=this.owner.document.createElement('input');hex.type='text';hex.value=field.value;hex.maxLength=7;hex.setAttribute('aria-label','RGB hexadecimal color');
    const apply=()=>{if(/^#[0-9a-f]{6}$/i.test(hex.value))this.commit(state,hex.value);else hex.setAttribute('aria-invalid','true');};
    hex.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();event.stopPropagation();apply();}});
    popup.append(grid,hex,this.button('Apply',apply));state.focus=hex;
  }
  close(focus=false){const state=this.active;if(!state)return;this.active=null;state.off?.();state.popup.remove();state.previousExpanded===null?state.field.removeAttribute('aria-expanded'):state.field.setAttribute('aria-expanded',state.previousExpanded);if(focus&&state.field.isConnected)state.field.focus({preventScroll:true});}
  configure(){this.close(false);}
  dispose(){this.close(false);}
}
