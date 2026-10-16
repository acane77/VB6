import test from 'node:test';
import assert from 'node:assert/strict';
import {harness,skip} from './migration-dotnet-support.mjs';
import {DEFAULT_MEMBERS_FIXTURE,DEFAULT_MEMBERS_EXPECTED} from './migration-default-members-fixtures.mjs';
for(const codeStyle of ['native','compatibility'])test('default member compilation and identity: '+codeStyle,{skip,timeout:150000},t=>{
  const h=harness(t,'default-members-'+codeStyle,DEFAULT_MEMBERS_FIXTURE,{codeStyle});
  assert.deepEqual(h.run(),DEFAULT_MEMBERS_EXPECTED);
});
