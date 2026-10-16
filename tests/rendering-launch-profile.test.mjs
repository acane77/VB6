import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const root=new URL('../',import.meta.url);
test('all required-GPU runners share the audited launch profile',()=>{
 const result=spawnSync(process.env.PYTHON||'python',['tools/test_rendering_launch.py'],{cwd:root,encoding:'utf8',timeout:10000});
 assert.equal(result.error,undefined);assert.equal(result.status,0,result.stdout+result.stderr);
 for(const name of ['browser-rendering-tests.py','browser-rendering-recovery.py','browser-rendering-agent-thread.py','browser-rendering-diagnostics.py','browser-graphics-tests.py']){
  const source=readFileSync(new URL('tools/'+name,root),'utf8');assert.match(source,/rendering_launch_flags/);assert.doesNotMatch(source,/GRAPHICS_GPU_FLAGS/);
 }
});
test('FRX browser acceptance awaits retained-canvas readiness',()=>{
 const source=readFileSync(new URL('tools/browser-parity-tests.py',root),'utf8');
 assert.match(source,/await surface\.pictureReady/);assert.match(source,/surface\.picture\?\.width/);assert.doesNotMatch(source,/surface\?\.picture\?\.naturalWidth/);
});
