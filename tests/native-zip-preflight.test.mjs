import test from 'node:test';
import assert from 'node:assert/strict';
import {readZip, writeZip} from '../src/project/zip.js';


test('ZIP hierarchy validation accepts explicit directories and lexical file prefixes', async () => {
  const archive = writeZip({'dir/': '', 'dir/file': 'data', 'dir.other': 'sibling'});
  assert.deepEqual([...await readZip(archive)], [['dir/file', new TextEncoder().encode('data')], ['dir.other', new TextEncoder().encode('sibling')]]);
});
test('ZIP writer detects implicit hierarchy conflicts before reading payload getters', () => {
  const files = {a: ''};
  Object.defineProperty(files, 'a/b', {enumerable: true, get() { assert.fail('payload read before path preflight'); }});
  assert.throws(() => writeZip(files), /File\/directory/);
});
test('zero ZIP budgets accept an empty archive and reject nonempty archives', async () => {
  assert.equal((await readZip(writeZip({}), {maxFiles: 0, maxExpandedBytes: 0})).size, 0);
  await assert.rejects(() => readZip(writeZip({a: ''}), {maxFiles: 0}), /too many files/);
  await assert.rejects(() => readZip(writeZip({a: 'x'}), {maxExpandedBytes: 0}), /expansion limit/);
});
