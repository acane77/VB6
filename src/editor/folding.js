import {sourceStatements} from '../language/source-context.js';
import {tokenize} from '../language/lexer.js';

/** Structural, line-only folds over the original VB source. Matching a closer
 * never consumes an unrelated opener. Incomplete branches and procedures are
 * discarded, rather than hiding an arbitrary part of the next procedure. */
export function vb6FoldingRanges(source,{maxRanges=10000}={}) {
  source=String(source);if(!Number.isSafeInteger(maxRanges)||maxRanges<0||maxRanges>10000)throw new RangeError('Invalid folding range limit.');
  if(!maxRanges)return [];
  const {statements}=sourceStatements(source),stack=[],conditional=[],regions=[],candidates=[];
  const add=(start,end,kind='region')=>{if(end>start)candidates.push({startLine:start,endLine:end,kind});};
  const close=(type,line)=>{
    let i=stack.length-1;while(i>=0&&stack[i].type!==type)i--;
    if(i<0)return;add(stack[i].line,line);stack.length=i;
  };
  for(const statement of statements){
    const line=statement.line-1,last=statement.endLine-1,clean=statement.clean.trim().replace(/^\d+\s+/,''),directive=clean.match(/^#(If|ElseIf|Else|End\s+If)\b/i);
    if(directive){
      const kind=directive[1].toLowerCase();
      if(kind==='if')conditional.push({line,depth:stack.length});
      else if(conditional.length){const frame=conditional.at(-1);stack.length=Math.min(stack.length,frame.depth);if(kind.startsWith('end')){conditional.pop();add(frame.line,last);}}
      continue;
    }
    let text;try{text=tokenize(statement.text).filter(t=>t.type!=='eof').map(t=>t.type==='string'?'""':t.raw).join(' ').replace(/^\d+\s+/,'');}catch{continue;}
    if(last>line)add(line,last);
    const ending=text.match(/^End\s+(Sub|Function|Property|If|Select|With|Type|Enum)\b/i);
    if(ending){close(ending[1].toLowerCase(),last);continue;}
    if(/^Next\b/i.test(text)){
      const count=(text.match(/,/g)||[]).length+1;for(let i=0;i<count;i++)close('for',last);continue;
    }
    if(/^Loop\b/i.test(text)){close('do',last);continue;}
    if(/^Wend\b/i.test(text)){close('while',last);continue;}
    const procedure=text.match(/^(?:(?:Public|Private|Friend|Static)\s+)*(Sub|Function|Property\s+(?:Get|Let|Set)|Type|Enum)\b/i);
    if(procedure){stack.length=0;stack.push({type:procedure[1].toLowerCase().split(' ')[0],line});continue;}
    const opening=text.match(/^(For|Do|While|With|Select\s+Case)\b/i);
    if(opening)stack.push({type:opening[1].toLowerCase().split(' ')[0],line});
    else if(/^If\b.*\bThen\s*$/i.test(text)&&source[statement.end]!==':')stack.push({type:'if',line});
  }
  const lines=source.split('\n');let comment=-1;
  for(let line=0;line<=lines.length;line++){
    const text=lines[line]||'',region=text.match(/^\s*'\s*#(Region|End\s+Region|EndRegion)\b/i),isComment=!region&&/^\s*(?:'|(?:\d+\s+)?Rem(?:\s|$))/i.test(text);
    if(isComment){if(comment<0)comment=line;}else if(comment>=0){add(comment,line-1,'comment');comment=-1;}
    if(region){if(region[1].toLowerCase()==='region')regions.push(line);else if(regions.length)add(regions.pop(),line);}
  }
  // A user region may cross language blocks. Only nested/disjoint folds are
  // presented; same-line alternatives prefer the outermost structural range.
  candidates.sort((a,b)=>a.startLine-b.startLine||b.endLine-a.endLine);
  const result=[],ends=[];let previousStart=-1;
  for(const range of candidates){
    while(ends.length&&range.startLine>ends.at(-1))ends.pop();
    if(range.startLine===previousStart||ends.length&&range.endLine>ends.at(-1))continue;
    result.push(range);previousStart=range.startLine;ends.push(range.endLine);if(result.length===maxRanges)break;
  }
  return result;
}
