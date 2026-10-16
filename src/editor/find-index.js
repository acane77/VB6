import {isIdentifierPart} from '../language/source-scanner.js';

/** One cached search index per editor. Literal replacements are assembled in a
 * single pass; they never repeatedly copy the entire module for each match. */
export class FindIndex {
  constructor(){this.scans=0;this.clear();}
  clear(){this.text=null;this.key=null;this.matches=[];}
  search(text,query,{matchCase=false,wholeWord=false,scope=null}={}) {
    text=String(text);query=String(query);
    const start=scope?.start??0,end=scope?.end??text.length;
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||end>text.length)throw new RangeError('Invalid search scope.');
    const key=JSON.stringify([query,!!matchCase,!!wholeWord,start,end]);
    if(text===this.text&&key===this.key)return this.matches;
    this.text=text;this.key=key;this.scans++;this.matches=[];if(!query||start===end)return this.matches;
    const escaped=query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const expression=new RegExp(escaped,'g'+(matchCase?'':'i'));
    expression.lastIndex=start;
    let match;
    while((match=expression.exec(text))&&match.index+match[0].length<=end){
      const a=match.index,b=a+match[0].length;
      // Match VB source identifiers, not JavaScript's ASCII-only \b. Type
      // characters belong to the preceding name; punctuation itself is searchable.
      if(wholeWord&&(isIdentifierPart(text.charCodeAt(a-1))||isIdentifierPart(text.charCodeAt(b))||
        isIdentifierPart(text.charCodeAt(b-1))&&/[$%&!#@]/.test(text[b]||'\0')))continue;
      this.matches.push({start:a,end:b});
    }
    return this.matches;
  }
  next(offset,direction=1) {
    if(!this.matches.length)return null;
    let lo=0,hi=this.matches.length;
    while(lo<hi){const mid=(lo+hi)>>>1;if(direction>0?this.matches[mid].start<offset:this.matches[mid].end<=offset)lo=mid+1;else hi=mid;}
    const index=direction>0?(lo===this.matches.length?0:lo):(lo===0?this.matches.length-1:lo-1);
    return {...this.matches[index],index,count:this.matches.length};
  }
}
export function replaceMatches(source,matches,replacement) {
  source=String(source);replacement=String(replacement);const parts=[];let end=0;
  for(const match of matches){if(!Number.isInteger(match.start)||!Number.isInteger(match.end)||match.start<end||match.end<match.start||match.end>source.length)throw new RangeError('Invalid or overlapping replacement range.');parts.push(source.slice(end,match.start),replacement);end=match.end;}
  parts.push(source.slice(end));return parts.join('');
}

/** A same-document text move is one source transaction. Moving into the original
 * selection is a no-op. UTF-16 offsets are retained, including surrogate pairs. */
export function moveSourceSelection(source,start,end,destination,copy=false) {
  if(![start,end,destination].every(Number.isInteger)||start<0||end<start||end>source.length||destination<0||destination>source.length)throw new RangeError('Invalid text move range.');
  if(start===end||!copy&&destination>=start&&destination<=end)return {text:source,start,end,changed:false};
  const selected=source.slice(start,end),base=copy?source:source.slice(0,start)+source.slice(end),at=!copy&&destination>end?destination-(end-start):destination;
  const text=base.slice(0,at)+selected+base.slice(at);return {text,start:at,end:at+selected.length,changed:text!==source};
}

/** Selection scope has left/right affinities so replacements at either edge
 * remain inside it. The scope is independent of the current find selection. */
export function mapFindScope(scope,change,length) {
  if(!scope)return null;
  const left=value=>value<=change.start?value:value>=change.oldEnd?value+change.delta:change.start;
  const right=value=>value>=change.oldEnd?value+change.delta:value<=change.start?value:change.newEnd;
  const start=Math.max(0,Math.min(length,left(scope.start)));
  return {start,end:Math.max(start,Math.min(length,right(scope.end)))};
}
