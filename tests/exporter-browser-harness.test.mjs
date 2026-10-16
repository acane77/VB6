import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

const root = new URL('../', import.meta.url);
test('exporter browser observation retains CSP and awaits resolved state', () => {
  const result = spawnSync(process.env.PYTHON || 'python', ['tools/test_exporter_browser_wait.py'], {cwd: root, encoding: 'utf8', timeout: 10000});
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
for (const name of ['browser-exporter-tests.py', 'browser-exporter-offline-tests.py']) {
  test(name + ' retains real CSP without in-page polling compilation', () => {
    const source = readFileSync(new URL('tools/' + name, root), 'utf8');
    assert.match(source, /from exporter_browser_wait import wait_for_export/);
    assert.doesNotMatch(source, /\.wait_for_function\(/);
    assert.match(source, /script-src 'self'/);
    assert.doesNotMatch(source, /unsafe-eval|bypass_csp\s*=\s*True|bypassCSP\s*:\s*true/);
  });
}


test('offline acceptance uses fresh clients and proves APIs remain network-only', () => {
  const source = readFileSync(new URL('tools/browser-exporter-offline-tests.py', root), 'utf8');
  assert.match(source, /def open_offline_page\(/);
  assert.doesNotMatch(source, /set_offline\(True\)[^\n]*\n[^\n]*\.reload\(/);
  assert.match(source, /caches\.match\(new URL\(\"\.\/api\/data\"/);
  assert.match(source, /state\['api_available'\] = False/);
  assert.match(source, /status == 503/);
});

test('update acceptance retains controlled clients until a waiting worker exists', () => {
  const source = readFileSync(new URL('tools/browser-exporter-offline-tests.py', root), 'utf8');
  assert.match(source, /updater = new_page\(context\)/);
  assert.match(source, /Boolean\(navigator\.serviceWorker\.controller\)/);
  assert.match(source, /waiting\?\.state === \"installed\"/);
  assert.match(source, /a\.close\(\); updater\.close\(\)/);
});
