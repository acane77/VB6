import {VBError} from '../language/errors.js';

// Dir patterns are filename globs, not VB Like or JavaScript regex syntax.
// A shared budget bounds the whole enumeration, including failed candidates.
export const FILE_PATTERN_BUDGET=10000000;
const MAX_PATTERN=4096;
export function compileFilePattern(pattern) {
  if(typeof pattern!=='string')throw new TypeError('File pattern must be a string');
  if(pattern.length>MAX_PATTERN)throw new VBError('File pattern exceeds runtime limit',7);
  pattern=pattern.toLowerCase().replace(/\*+/g,'*');
  // Retain the portable disk's DOS-style extensionless matching contract.
  if(pattern==='*.*')pattern='*';
  const withoutExtension=pattern.endsWith('.*')?pattern.slice(0,-2):null;
  function matches(name,glob,budget) {
    let input=0,position=0,star=-1,restart=0;
    while(input<name.length){
      if(--budget.remaining<0)throw new VBError('File enumeration exceeds runtime work limit',7);
      const token=glob[position];
      if(token==='*'){star=position++;restart=input;if(position===glob.length)return true;continue;}
      if(token==='?'||token===name[input]){input++;position++;continue;}
      if(star<0)return false;
      input=++restart;position=star+1;
    }
    while(glob[position]==='*')position++;
    return position===glob.length;
  }
  return (name,budget={remaining:FILE_PATTERN_BUDGET})=>{
    if(typeof name!=='string')throw new TypeError('Filename must be a string');
    // Charge normalization too, so a huge name cannot hide behind a cheap miss.
    budget.remaining-=name.length;
    if(budget.remaining<0)throw new VBError('File enumeration exceeds runtime work limit',7);
    name=name.toLowerCase();
    return matches(name,pattern,budget)||withoutExtension!==null&&matches(name,withoutExtension,budget);
  };
}
