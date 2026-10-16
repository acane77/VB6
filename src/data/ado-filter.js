// ADO criteria are not SQL: AND and OR have equal, left-to-right precedence.
// https://learn.microsoft.com/en-us/office/client-developer/access/desktop-database-reference/filter-property-ado
import {VBError} from '../language/lexer.js';
import {coerce,binary,truth} from '../runtime/values.js';

const fail=(message,number=3251)=>{throw new VBError(message,number);};
const fold=value=>String(value).toLowerCase();
const clause=/\s*(?:\[((?:[^\]]|\]\])+)\]|([A-Za-z_][\w$]*))\s*(<=|>=|<>|=|<|>|LIKE\b)\s*(?:'((?:[^']|'')*)'|#([^#]+)#|\$?([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?))\s*/iy;

/** Bounded, non-evaluating parser shared by ADO Filter and Find. */
export function compileADOFilter(text,column,convert,isText,{single=false}={}){
  if(typeof text!=='string')fail('Filter must be a string',13);
  if(text.length>16384)fail('Filter length limit exceeded',7);
  if(!text.trim())return null;
  let offset=0,count=0;
  const whitespace=()=>{while(/\s/.test(text[offset]||'')&&offset<text.length)offset++;};
  function term(depth){
    whitespace();
    if(text[offset]==='('){
      if(single)fail('Find accepts one comparison clause');
      if(depth>=64)fail('Filter nesting limit exceeded',7);
      offset++;const group=expression(depth+1);whitespace();
      if(text[offset++]!==')')fail('Unclosed filter group');
      return {...group,grouped:true};
    }
    if(++count>128)fail('Filter clause limit exceeded',7);
    clause.lastIndex=offset;const match=clause.exec(text);
    if(!match)fail('Unsupported or malformed ADO criteria; Null values are not allowed');
    offset=clause.lastIndex;
    const col=column(match[1]?.replace(/\]\]/g,']')??match[2]),op=match[3].toUpperCase();
    let value=match[4]!==undefined?match[4].replace(/''/g,"'"):match[5]!==undefined?
      /^'.*'$/s.test(match[5])?match[5]:coerce(match[5],'Date'):match[6];
    let test;
    if(op==='LIKE'){
      if(!isText(col))fail('LIKE requires a text field',3001);
      const pattern=fold(value),left=/^[*%]/.test(pattern),right=/[*%]$/.test(pattern);
      const body=pattern.slice(left?1:0,right?-1:undefined);
      if(/[*%]/.test(body)||left&&!right&&body)fail('LIKE supports trailing or surrounding wildcards only');
      test=row=>{const v=row[col.Name];if(v==null)return false;const s=fold(v);return left&&right?s.includes(body):right?s.startsWith(body):s===body;};
    }else{
      value=convert({...col,DefinedSize:0},value);
      test=row=>row[col.Name]!=null&&truth(binary(op,row[col.Name],value,'text'));
    }
    return {test,hasOr:false,grouped:false};
  }
  function expression(depth){
    const terms=[term(depth)],joins=[];
    while(true){
      whitespace();if(offset===text.length||text[offset]===')')break;
      const join=/^(AND|OR)\b/i.exec(text.slice(offset));
      if(!join||single)fail(single?'Find accepts one comparison clause':'Malformed ADO filter operator');
      offset+=join[0].length;joins.push(join[1].toUpperCase());terms.push(term(depth));
    }
    // ADO forbids joining an explicitly OR-grouped clause to another clause
    // with AND. Distribute the expression into OR'ed AND-groups instead.
    if(joins.includes('AND')&&terms.some(t=>t.grouped&&t.hasOr))fail('ADO cannot AND an OR-group; use OR of AND-groups');
    return {hasOr:joins.includes('OR')||terms.some(t=>t.hasOr),test:row=>{
      let value=terms[0].test(row);
      for(let i=1;i<terms.length;i++)value=joins[i-1]==='AND'?value&&terms[i].test(row):value||terms[i].test(row);
      return value;
    }};
  }
  const parsed=expression(0);whitespace();if(offset!==text.length)fail('Unexpected closing filter group');
  return parsed.test;
}
