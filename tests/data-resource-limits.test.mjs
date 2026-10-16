import test from 'node:test';
import assert from 'node:assert/strict';
import {sqlTokens} from '../src/data/sql-parameters.js';
import {parseCSV,writeCSV} from '../src/data/files.js';
import {DATA_LIMITS} from '../src/data/common.js';
const limited=error=>error.number===7;

for(const token of ['name','1',"'x'",'[x]','+'])test('SQL token cap applies to '+token,()=>{
  const input=(token+' ').repeat(100000);assert.equal(sqlTokens(input+' -- trailing comment').length,100000);
  assert.throws(()=>sqlTokens(input+token),limited);
});
test('CSV limits the header and each data row before allocating an oversized row',()=>{
  assert.throws(()=>parseCSV(Array.from({length:1025},(_,i)=>'h'+i).join(',')),limited);
  assert.throws(()=>parseCSV('a\n'+Array(1025).fill('x').join(',')),limited);
});
test('CSV enforces its final unterminated row and total cell budgets',()=>{
  const good='a\n'+('x\n'.repeat(DATA_LIMITS.rows-1))+'x';assert.equal(parseCSV(good).length,DATA_LIMITS.rows);
  assert.throws(()=>parseCSV(good+'\nx'),limited);
  const header=Array.from({length:1024},(_,i)=>'h'+i).join(','),row=Array(1024).fill('x').join(',');
  assert.throws(()=>parseCSV(header+'\n'+(row+'\n').repeat(977)),limited);
});
test('CSV read and write bound UTF-8 bytes, not just JavaScript code units',()=>{
  const text='🦊'.repeat(Math.floor(DATA_LIMITS.bytes/4)+1);
  assert.throws(()=>parseCSV('a\n'+text),limited);assert.throws(()=>writeCSV([{a:text}]),limited);
  assert.throws(()=>writeCSV([{a:'"'.repeat(Math.floor(DATA_LIMITS.bytes/2))}]),limited);
});
test('CSV writer validates width, row shape, headers and count before serialization',()=>{
  assert.throws(()=>writeCSV({}));assert.throws(()=>writeCSV([null],['a']));assert.throws(()=>writeCSV([[]],['a']));
  assert.throws(()=>writeCSV([],['A','a']));assert.throws(()=>writeCSV([],['']));
  assert.throws(()=>writeCSV(Array(DATA_LIMITS.rows+1).fill({a:1})),limited);
  assert.equal(writeCSV([]),'');assert.deepEqual(parseCSV(writeCSV([])),[]);
});
test('CSV roundtrips BOM, multiline quoted Unicode, empty values and literal formula text',()=>{
  const rows=[{id:'1',name:'Zoë 🦊, "line"\r\nnext',value:''},{id:'2',name:'=1+2',value:'"'}];
  assert.deepEqual(parseCSV('\uFEFF'+writeCSV(rows)),rows);
});
