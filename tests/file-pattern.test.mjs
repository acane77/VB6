import test from 'node:test';
import assert from 'node:assert/strict';
import {compileFilePattern,FILE_PATTERN_BUDGET} from '../src/runtime/file-pattern.js';
import {VirtualFileSystem} from '../src/runtime/filesystem.js';
import {fileLibrary} from '../src/runtime/file-library.js';
import {error} from './helpers/compiler-runtime.mjs';

for(const [pattern,name,expected] of [
 ['*.*','plain',true],['NAME.*','name',true],['NAME.*','name.txt',true],['NAME.*','name.other.txt',true],['name.*','names',false],
 ['*.txt','a.TXT',true],['a.?xt','a.txt',true],['a.?xt','a.xt',false],['a*.txt','abc.log',false],
 ['[a].txt','[a].txt',true],['[a].txt','a.txt',false],['#.txt','1.txt',false],['+.txt','+.txt',true],
 ['a(b).$','a(b).$',true],['A***B','axB',true],['*','',true],['?','',false],['','',true],
 ['*.','plain',false],['*?','\n',true],['*','a\nb',true],['?.TXT','é.txt',true],
])test('File glob '+JSON.stringify([pattern,name]),()=>assert.equal(compileFilePattern(pattern)(name),expected));

// Dynamic programming is independent of the production greedy restart logic.
function reference(name,pattern){
 name=name.toLowerCase();pattern=pattern.toLowerCase().replace(/\*+/g,'*');
 const dp=glob=>{
  let row=Array(name.length+1).fill(false);row[0]=true;
  for(const token of glob){const next=Array(name.length+1).fill(false);next[0]=token==='*'&&row[0];
   for(let n=1;n<=name.length;n++)next[n]=token==='*'?row[n]||next[n-1]:(token==='?'||token===name[n-1])&&row[n-1];
   row=next;
  }return row[name.length];
 };
 if(pattern.replace(/\*+/g,'*')==='*.*')return true;
 return dp(pattern)||pattern.endsWith('.*')&&dp(pattern.slice(0,-2));
}
test('File glob matches an independent DP oracle on 10000 deterministic patterns',()=>{
 let seed=17;const next=limit=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%limit;};
 const text='aAbB.c[]#$()+',patterns=text+'*??*';
 for(let n=0;n<10000;n++){
  const name=Array.from({length:next(15)},()=>text[next(text.length)]).join('');
  const pattern=Array.from({length:next(14)},()=>patterns[next(patterns.length)]).join('');
  assert.equal(compileFilePattern(pattern)(name),reference(name,pattern),JSON.stringify({name,pattern}));
 }
});
test('Separated-star nonmatch is bounded rather than regex backtracking', {timeout:2000},()=>{
 const matches=compileFilePattern('*a'.repeat(128)+'b');
 assert.equal(matches('a'.repeat(20000)),false);
});
test('Adversarial long literal suffix and aggregate calls share an explicit work budget',()=>{
 const matches=compileFilePattern('*'+'a'.repeat(300)+'b'),budget={remaining:10000};
 error(()=>matches('a'.repeat(2000),budget),7);assert.ok(budget.remaining<0);
 const shared={remaining:10},all=compileFilePattern('*');assert.equal(all('one',shared),true);assert.equal(all('two',shared),true);error(()=>all('three',shared),7);
 assert.equal(FILE_PATTERN_BUDGET,10000000);error(()=>compileFilePattern('x'.repeat(4097)),7);
});
test('Filename regex metacharacters are literals and Dir remains directory-scoped',()=>{
 const fs=new VirtualFileSystem(),lib=fileLibrary({fs});fs.write('/[a].txt','a');fs.write('/a.txt','b');fs.write('/nested/[a].txt','c');
 assert.equal(lib.Dir('/[a].txt'),'[a].txt');assert.equal(lib.Dir(),'');
 fs.write('/a\nb.txt','c');assert.ok(fs.find('/*.txt').includes('/a\nb.txt'));
});
test('Failed Dir compilation retains the previous enumeration and wildcard Kill is atomic',()=>{
 const fs=new VirtualFileSystem(),lib=fileLibrary({fs});fs.write('/a.txt','a');fs.write('/b.txt','b');
 assert.equal(lib.Dir('/*.txt'),'a.txt');error(()=>lib.Dir('/'+'x'.repeat(4097)),7);assert.equal(lib.Dir(),'b.txt');
 const before=fs.snapshot();error(()=>lib.Kill('/'+'*a'.repeat(2049)),7);assert.deepEqual(fs.snapshot(),before);
});
