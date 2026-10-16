import {assertData,DATA_LIMITS,resultFromRows,sameValue,pathValue} from './common.js';
import {fieldValue} from './recordset.js';

// Count UTF-8 without allocating a second encoded copy. Isolated UTF-16
// surrogates become the three-byte replacement character, as in TextEncoder.
function textBytes(text,limit=DATA_LIMITS.bytes){
  let bytes=0;assertData(text.length<=limit,'CSV file is too large',7);
  for(const character of text){const code=character.codePointAt(0);bytes+=code<128?1:code<2048?2:code<65536?3:4;assertData(bytes<=limit,'CSV file is too large',7);}
  return bytes;
}
function validateHeaders(headers){
  assertData(headers.length>0&&headers.length<=1024,'CSV column limit exceeded',7);
  assertData(headers.every(name=>typeof name==='string'&&name)&&new Set(headers.map(name=>name.toLowerCase())).size===headers.length,'CSV headers must be nonempty and unique');
}
export function parseCSV(text){
  text=String(text).replace(/^\uFEFF/,'');textBytes(text);
  const records=[];let row=[],value='',quoted=false,closed=false,cells=0;
  const cell=()=>{assertData(row.length<1024,'CSV column limit exceeded',7);if(records.length)assertData(++cells<=DATA_LIMITS.cells,'CSV cell limit exceeded',7);row.push(value);value='';closed=false;};
  const record=()=>{cell();if(!records.length)validateHeaders(row);else{assertData(records.length<=DATA_LIMITS.rows,'CSV row limit exceeded',7);assertData(row.length===records[0].length,'CSV records have inconsistent column counts');}records.push(row);row=[];};
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quoted){if(ch==='"'){if(text[i+1]==='"'){value+='"';i++;}else{quoted=false;closed=true;}}else value+=ch;continue;}
    if(ch==='"'){assertData(!value&&!closed,'Unexpected quote in CSV');quoted=true;}
    else if(ch===',')cell();
    else if(ch==='\n'||ch==='\r'){if(ch==='\r'&&text[i+1]==='\n')i++;record();}
    else{assertData(!closed,'Unexpected characters after a quoted CSV field');value+=ch;}
  }
  assertData(!quoted,'Unterminated CSV field');if(value||row.length||closed)record();
  if(!records.length)return [];
  const headers=records.shift();return records.map(row=>Object.fromEntries(headers.map((key,i)=>[key,row[i]])));
}
export function writeCSV(rows,headers){
  assertData(Array.isArray(rows),'CSV rows must be an array',13);headers??=Object.keys(rows[0]||{});
  assertData(Array.isArray(headers),'CSV headers must be an array',13);
  if(!headers.length&&!rows.length)return '';
  validateHeaders(headers);assertData(rows.length<=DATA_LIMITS.rows&&rows.length*headers.length<=DATA_LIMITS.cells,'CSV allocation limit exceeded',7);
  const parts=[];let bytes=0;
  const quote=value=>{const text=String(value??'');let size=textBytes(text);for(const ch of text)if(ch==='"')size++;bytes+=size+2;assertData(bytes<=DATA_LIMITS.bytes,'CSV file is too large',7);return '"'+text.replace(/"/g,'""')+'"';};
  const append=values=>{bytes+=Math.max(0,headers.length-1)+2;assertData(bytes<=DATA_LIMITS.bytes,'CSV file is too large',7);parts.push(values.map(quote).join(',')+'\r\n');};
  append(headers);
  for(const row of rows){assertData(row&&typeof row==='object'&&!Array.isArray(row),'CSV rows must be objects',13);append(headers.map(key=>row[key]));}
  return parts.join('');
}
export class FileDataProvider {
  constructor(context,config){this.context=context;this.config=config;}
  open(){assertData(this.config.provider!=='csv'||!(this.config.fields||[]).some(f=>f.path&&f.path!==f.name),'CSV mappings must use their header names',3251);this.path=this.context.fs.normalize(this.config.database||'/data.json');assertData(this.context.fs.exists(this.path),'Data file not found',53);}
  read(){const text=this.context.fs.read(this.path);return this.config.provider==='csv'?parseCSV(text):JSON.parse(text);}
  execute(text=''){
    assertData(!text||text===this.path,'File providers expose the file as a recordset; SQL requires SQLite',3251);
    const result=resultFromRows(this.read(),this.config.fields);
    if(!this.config.readOnly&&this.config.keyField)result.write=(kind,row,before)=>{
      const rows=this.read(),key=this.config.keyField;
      const mapped=rows.map(raw=>Object.fromEntries(result.columns.map(c=>[c.Name,fieldValue(c,pathValue(raw,c.path)??null)])));
      const merge=(raw,value)=>{for(const column of result.columns){let node=raw;const path=String(column.path||column.Name).split('.');for(const part of path.slice(0,-1)){assertData(!['__proto__','constructor','prototype'].includes(part),'Invalid JSON write field');node=node[part]??={};}const last=path.at(-1);assertData(!['__proto__','constructor','prototype'].includes(last),'Invalid JSON write field');node[last]=column.Type===11&&value[column.Name]!=null?Boolean(value[column.Name]):value[column.Name];}return raw;};
      if(kind==='insert'){assertData(row[key]!=null&&!mapped.some(r=>sameValue(r[key],row[key])),'A unique key is required',3197);rows.push(merge({},row));}
      else{
        const index=mapped.findIndex(r=>sameValue(r[key],before[key]));
        assertData(index>=0&&result.columns.every(c=>sameValue(mapped[index][c.Name]??null,before[c.Name])),'Data file record changed since it was read',3197);
        if(kind==='delete')rows.splice(index,1);else{assertData(!mapped.some((r,i)=>i!==index&&sameValue(r[key],row[key])),'Duplicate key',3197);rows[index]=merge(rows[index],row);}
      }
      this.context.fs.write(this.path,this.config.provider==='csv'?writeCSV(rows,result.columns.map(c=>c.Name)):JSON.stringify(rows,null,2));this.context.persist?.();
    };
    return result;
  }
  schema(){return resultFromRows(this.execute().columns.map(c=>({COLUMN_NAME:c.Name,DATA_TYPE:c.Type})));}
  close(){}
}
