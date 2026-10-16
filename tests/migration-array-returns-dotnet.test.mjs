import test from 'node:test';
import assert from 'node:assert/strict';
import {harness,skip} from './migration-dotnet-support.mjs';
import {ARRAY_RETURNS_FIXTURE,ARRAY_RETURNS_EXPECTED} from './migration-array-returns-fixtures.mjs';
for(const codeStyle of ['native','compatibility'])test('typed array result ABI and execution: '+codeStyle,{skip,timeout:150000},t=>{
  const h=harness(t,'array-returns-'+codeStyle,ARRAY_RETURNS_FIXTURE,{codeStyle});
  assert.deepEqual(h.run(),ARRAY_RETURNS_EXPECTED);
});
