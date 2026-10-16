import test from 'node:test';
import assert from 'node:assert/strict';
import {harness,skip} from './migration-dotnet-support.mjs';
import {ARRAY_BOUNDARIES_FIXTURE,ARRAY_BOUNDARIES_EXPECTED} from './migration-array-boundaries-fixtures.mjs';
for(const codeStyle of ['native','compatibility'])test('multi-target array error boundaries and Resume execution: '+codeStyle,{skip,timeout:150000},t=>{
  const h=harness(t,'array-boundaries-'+codeStyle,ARRAY_BOUNDARIES_FIXTURE,{codeStyle});
  assert.deepEqual(h.run(),ARRAY_BOUNDARIES_EXPECTED);
});
