import {LAYOUT_CONSTANTS} from '../layout/contract.js';
import {installScalarLibrary} from './scalar-library.js';
import {installComLibrary} from './com-library.js';
import {errorDescription} from './error-messages.js';
import {stringLibrary} from './strings.js';
import {financialLibrary} from './financial-library.js';
import {randomLibrary} from './random.js';
import {numberFormatLibrary} from './number-format.js';
import {settingsLibrary} from './settings-library.js';
import {characterLibrary} from './character-library.js';
import {fileLibrary} from './file-library.js';
import {ResourceStore} from './resources.js';
import {asDate,dateAdd,dateDiff,datePart,dateSerial,timeSerial,weekday,weekdayName,monthName} from './calendar.js';
import {BUILTIN_SIGNATURES,signatureParameters} from './signatures.js';
import {DisconnectedRecordset} from '../data/recordset.js';
import {recordLength} from './binary-codec.js';
import { VBError } from '../language/lexer.js';
import { lower } from '../core/core.js';
import { NOTHING, MISSING, VBErrorValue, explicitErrorValue, VBArray, VBCollection, VBDictionary, VBCurrency, VBDecimal, decimal, numeric, vbString, coerce, bankersRound, truth, binary } from './values.js';

import {VB_CONSTANTS} from './constants.js';
export {VB_CONSTANTS};
const vbDate=asDate;
function requireLength(n){n=bankersRound(numeric(n));if(n<0||n>10000000)throw new VBError('Invalid procedure call or argument',5);return n;}
function vbFormat(value,pattern='') {
  if(value===null)return '';
  const fmt=String(pattern);
  if(!fmt)return vbString(value);
  if(/^(currency|fixed|standard|percent|scientific|general number|yes\/no|true\/false|on\/off)$/i.test(fmt)){
    const n=numeric(value);switch(fmt.toLowerCase()){case 'currency':return '$'+n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});case 'fixed':return n.toFixed(2);case 'standard':return n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});case 'percent':return (n*100).toFixed(2)+'%';case 'scientific':return n.toExponential(2).toUpperCase();case 'yes/no':return n?'Yes':'No';case 'true/false':return n?'True':'False';case 'on/off':return n?'On':'Off';default:return String(n);}
  }
  if(value instanceof Date||/[ydhns]/i.test(fmt)&&!/[0#]/.test(fmt)){
    const d=vbDate(value);if(/^short date$/i.test(fmt))return d.toLocaleDateString('en-US');if(/^long date$/i.test(fmt))return d.toLocaleDateString('en-US',{dateStyle:'full'});if(/^long time$/i.test(fmt))return d.toLocaleTimeString('en-US');if(/^short time$/i.test(fmt))return d.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',hour12:false});if(/^general date$/i.test(fmt))return d.toLocaleString('en-US');
    const pad=x=>String(x).padStart(2,'0'),h=d.getHours();const tokens={yyyy:d.getFullYear(),yy:String(d.getFullYear()).slice(-2),mmmm:d.toLocaleString('en-US',{month:'long'}),mmm:d.toLocaleString('en-US',{month:'short'}),mm:pad(d.getMonth()+1),m:d.getMonth()+1,dddd:d.toLocaleString('en-US',{weekday:'long'}),ddd:d.toLocaleString('en-US',{weekday:'short'}),dd:pad(d.getDate()),d:d.getDate(),hh:pad(/am\/pm/i.test(fmt)?h%12||12:h),h:/am\/pm/i.test(fmt)?h%12||12:h,nn:pad(d.getMinutes()),n:d.getMinutes(),ss:pad(d.getSeconds()),s:d.getSeconds(),'am/pm':h>=12?'PM':'AM'};
    return fmt.replace(/"[^"]*"|am\/pm|yyyy|mmmm|dddd|mmm|ddd|yy|mm|dd|hh|nn|ss|[mdhns]/gi,t=>t.startsWith('"')?t.slice(1,-1):String(tokens[t.toLowerCase()]));
  }
  const sections=fmt.split(';'),n=numeric(value),section=n<0&&sections[1]?sections[1]:n===0&&sections[2]?sections[2]:sections[0];let v=sections.length>1?Math.abs(n):n;if(section.includes('%'))v*=100;
  const decimals=(section.match(/\.([0#]+)/)||[])[1]||'',zeros=(decimals.match(/0/g)||[]).length;let result=v.toLocaleString('en-US',{useGrouping:section.includes(','),minimumFractionDigits:zeros,maximumFractionDigits:decimals.length});
  const prefix=section.match(/^[^0#.,]+/)?.[0]||'',suffix=section.match(/[^0#.,]+$/)?.[0]||'';return prefix.replace(/"/g,'')+result+suffix.replace(/"/g,'');
}
export const MemoryRecordset=DisconnectedRecordset;
export function createLibrary(vm) {
  const resources=new ResourceStore(vm.program.sourceProject?.resources,vm.program.settings?.resourceLanguage);
  const functions={
    Erl:()=>vm.lastErrorErl||0,
    Error:(number=vm.err?.Number||0)=>errorDescription(coerce(number,'Long')),
    ...financialLibrary(),
    LoadResString:id=>resources.string(id),LoadResData:(id,format)=>resources.data(id,format),LoadResPicture:(id,format=0)=>resources.picture(id,format),
    Abs:x=>x instanceof VBDecimal?x.absolute():x instanceof VBCurrency?new VBCurrency(x.raw<0n?-x.raw:x.raw,true):Math.abs(numeric(x)),Sgn:x=>Math.sign(numeric(x)),Int:x=>x instanceof VBDecimal?x.integer(true):Math.floor(numeric(x)),Fix:x=>x instanceof VBDecimal?x.integer():Math.trunc(numeric(x)),Sqr:x=>{if(numeric(x)<0)throw new VBError('Invalid procedure call',5);return Math.sqrt(numeric(x));},Exp:x=>Math.exp(numeric(x)),Log:x=>{if(numeric(x)<=0)throw new VBError('Invalid procedure call',5);return Math.log(numeric(x));},Sin:x=>Math.sin(numeric(x)),Cos:x=>Math.cos(numeric(x)),Tan:x=>Math.tan(numeric(x)),Atn:x=>Math.atan(numeric(x)),Round:(x,n=0)=>{if(x instanceof VBCurrency||x instanceof VBDecimal)return x.round(bankersRound(numeric(n)));n=numeric(n);if(n<0||n>28)throw new VBError('Invalid procedure call',5);return bankersRound(numeric(x)*10**n)/10**n;},
    ...randomLibrary(),
    CDec:x=>decimal(explicitErrorValue(x)),CByte:x=>coerce(explicitErrorValue(x),'Byte'),CInt:x=>coerce(explicitErrorValue(x),'Integer'),CLng:x=>coerce(explicitErrorValue(x),'Long'),CSng:x=>coerce(explicitErrorValue(x),'Single'),CDbl:x=>coerce(explicitErrorValue(x),'Double'),CCur:x=>coerce(explicitErrorValue(x),'Currency'),CStr:x=>x instanceof VBErrorValue?x.toString():vbString(x),CBool:x=>coerce(explicitErrorValue(x),'Boolean'),CDate:vbDate,CVDate:vbDate,CVar:x=>x,CVErr:number=>new VBErrorValue(number),IsError:x=>x instanceof VBErrorValue?-1:0,
    Val:x=>{const s=String(x).replace(/\s/g,'');if(/^&h/i.test(s))return parseInt(s.slice(2),16)||0;if(/^&o/i.test(s))return parseInt(s.slice(2),8)||0;return parseFloat(s)||0;},Str:x=>(numeric(x)>=0?' ':'')+String(numeric(x)),Hex:x=>(bankersRound(numeric(x))>>>0).toString(16).toUpperCase(),Oct:x=>(bankersRound(numeric(x))>>>0).toString(8),
    Len:x=>x?.__fields?recordLength(x):x==null?(x===null?null:0):x instanceof VBArray?x.data.length:String(x).length,LenB:x=>String(x??'').length*2,Left:(s,n)=>s===null?null:vbString(s).slice(0,requireLength(n)),Right:(s,n)=>s===null?null:(n=requireLength(n),n?vbString(s).slice(-n):''),Mid:(s,start,n)=>{if(s===null)return null;start=bankersRound(numeric(start));if(start<1)throw new VBError('Invalid procedure call',5);return n===undefined?vbString(s).slice(start-1):vbString(s).substr(start-1,requireLength(n));},
    Trim:s=>s===null?null:vbString(s).replace(/^ +| +$/g,''),LTrim:s=>s===null?null:vbString(s).replace(/^ +/,''),RTrim:s=>s===null?null:vbString(s).replace(/ +$/,''),UCase:s=>s===null?null:vbString(s).toUpperCase(),LCase:s=>s===null?null:vbString(s).toLowerCase(),Space:n=>' '.repeat(requireLength(n)),StrReverse:s=>vbString(s).split('').reverse().join(''),
    ...stringLibrary(vm),...characterLibrary(),
    Format:vbFormat,...numberFormatLibrary(vm.host.numberFormat),FormatDateTime:(d,style=0)=>{style=coerce(style,'Integer');if(style<0||style>4)throw new VBError('Invalid procedure call or argument',5);return vbFormat(vbDate(d),['General Date','Long Date','Short Date','Long Time','Short Time'][style]);},
    Array:(...a)=>VBArray.from(a,vm.currentFrame?.module.optionBase||0),LBound:(a,d=1)=>{if(!(a instanceof VBArray)||!a.bounds[d-1])throw new VBError('Subscript out of range',9);return a.bounds[d-1][0];},UBound:(a,d=1)=>{if(!(a instanceof VBArray)||!a.bounds[d-1])throw new VBError('Subscript out of range',9);return a.bounds[d-1][1];},
    IsArray:x=>x instanceof VBArray?-1:0,IsEmpty:x=>x===undefined?-1:0,IsNull:x=>x===null?-1:0,IsNumeric:x=>{if(x===undefined||x===null||x===NOTHING||x===MISSING||x instanceof VBErrorValue||x instanceof Date||typeof x==='object'&&!(x instanceof VBCurrency)&&!(x instanceof VBDecimal))return 0;try{numeric(x);return -1;}catch{return 0;}},IsDate:x=>{if(x===null||x===undefined||typeof x==='object'&&!(x instanceof Date))return 0;try{asDate(x);return -1;}catch{return 0;}},IsObject:x=>x!==null&&x!==MISSING&&!(x instanceof VBErrorValue)&&typeof x==='object'&&!(x instanceof Date)&&!(x instanceof VBArray)&&!(x instanceof VBCurrency)&&!(x instanceof VBDecimal)&&!x.__fields?-1:0,IsMissing:x=>x===MISSING?-1:0,
    TypeName:x=>x instanceof VBErrorValue?'Error':x===MISSING?'Error':x instanceof VBCollection?'Collection':x instanceof VBDictionary?'Dictionary':x===NOTHING?'Nothing':x===undefined?'Empty':x===null?'Null':x instanceof VBArray?x.type+'()':x instanceof Date?'Date':x instanceof VBDecimal?'Decimal':x instanceof VBCurrency?'Currency':typeof x==='string'?'String':typeof x==='number'?'Double':x.__type||x.constructor?.name||'Object',VarType:x=>x instanceof VBErrorValue||x===MISSING?10:x===undefined?0:x===null?1:x instanceof VBArray?8192+({byte:17,integer:2,long:3,single:4,double:5,currency:6,date:7,string:8,object:9,boolean:11,variant:12}[String(x.type).toLowerCase()]||12):x instanceof Date?7:x instanceof VBDecimal?14:x instanceof VBCurrency?6:typeof x==='string'?8:typeof x==='number'?5:9,
    IIf:(test,a,b)=>truth(test)?a:b,Choose:(index,...a)=>a[Math.trunc(numeric(index))-1]??null,Switch:(...a)=>{for(let i=0;i<a.length;i+=2)if(truth(a[i]))return a[i+1];return null;},
    Now:()=>new Date(),Date:()=>{const d=new Date();d.setHours(0,0,0,0);return d;},Time:()=>{const d=new Date(),r=new Date(1899,11,30);r.setHours(d.getHours(),d.getMinutes(),d.getSeconds());return r;},Timer:()=>{const d=new Date();return d.getHours()*3600+d.getMinutes()*60+d.getSeconds()+d.getMilliseconds()/1000;},DateValue:d=>{d=vbDate(d);d.setHours(0,0,0,0);return d;},TimeValue:d=>{const v=vbDate(d),r=new Date(1899,11,30);r.setHours(v.getHours(),v.getMinutes(),v.getSeconds());return r;},Year:d=>vbDate(d).getFullYear(),Month:d=>vbDate(d).getMonth()+1,Day:d=>vbDate(d).getDate(),Hour:d=>vbDate(d).getHours(),Minute:d=>vbDate(d).getMinutes(),Second:d=>vbDate(d).getSeconds(),Weekday:weekday,MonthName:monthName,WeekdayName:weekdayName,
    DateSerial:dateSerial,TimeSerial:timeSerial,DateAdd:dateAdd,DateDiff:dateDiff,DatePart:datePart,

    RGB:(r,g,b)=>Math.min(255,Math.max(0,Math.trunc(numeric(r))))+(Math.min(255,Math.max(0,Math.trunc(numeric(g))))<<8)+(Math.min(255,Math.max(0,Math.trunc(numeric(b))))<<16),QBColor:n=>{const colors=[0,8388608,32768,8421376,128,8388736,32896,12632256,8421504,16711680,65280,16776960,255,16711935,65535,16777215];if(n<0||n>15)throw new VBError('Invalid procedure call',5);return colors[n];},
    MsgBox:(text,style=0,title)=>vm.host.msgBox?.(vbString(text),Number(style),title===undefined?vm.program.name:vbString(title))??1,InputBox:(text,title,def='')=>vm.host.inputBox?.(vbString(text),title===undefined?vm.program.name:vbString(title),vbString(def))??'',DoEvents:()=>vm.doEvents(),
    CallByName:(object,name,callType,...args)=>vm.callByName(object,vbString(name),coerce(callType,'Long'),args,vm.currentFrame),
    CreateObject:name=>vm.createObject(vbString(name)),
    FreeFile:(range=0)=>vm.fs.freeFile(range),EOF:n=>vm.fs.eof(n),LOF:n=>vm.fs.lof(n),Loc:n=>vm.fs.loc(n),Seek:(n,pos)=>vm.fs.seek(n,pos),Input:(n,h)=>vm.fs.input(h,numeric(n)),Reset:()=>vm.fs.close(),CurDir:()=>vm.fs.cwd,...fileLibrary(vm),
    ...settingsLibrary(vm),
    Beep:()=>vm.host.beep?.(),Environ:()=>'',Command:()=>'',Shell:()=>{throw new VBError('Launching native executables is not permitted in the browser runtime',453);},
  };
  const map=new Map(Object.entries({...VB_CONSTANTS,...(vm.program.settings?.anchoring===true?LAYOUT_CONSTANTS:{})}).map(([k,v])=>[lower(k),v]));
  for(const [name,fn]of Object.entries(functions)){if(name in BUILTIN_SIGNATURES)fn.vbParams=signatureParameters(BUILTIN_SIGNATURES[name]);if(['IsObject','IsMissing','IsArray','IsError','IsEmpty','IsNull','TypeName','VarType','CallByName'].includes(name))fn.vbRawArgs=true;map.set(lower(name),fn);}
  functions.CallByName.vbParams=[{name:'object'},{name:'procname'},{name:'calltype'}];functions.CallByName.vbVariadic=true;
  // The $ forms are String-returning intrinsics; unlike Variant forms they reject Null.
  for(const name of ['Error','Left','Right','Mid','Trim','LTrim','RTrim','UCase','LCase','Space','String','Chr','ChrW','Str','Hex','Oct','Format','Input','Dir','Environ','Command']){
    const base=functions[name],fn=(...args)=>{const result=base(...args);if(result===null)throw new VBError('Invalid use of Null',94);return result;};fn.vbParams=base.vbParams;map.set(lower(name)+'$',fn);
  }
  return installComLibrary(installScalarLibrary(map,vm),vm);
}
