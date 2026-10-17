import test from 'node:test';
import assert from 'node:assert/strict';
import {readZip} from '../src/project/zip.js';
import {compressedLinuxRuntimeArchive} from '../tools/embed-linux-aot-runtime.mjs';
import {linuxAOTExecutionVerification,linuxAOTRuntimePayloadFile} from '../tools/linux-aot-provenance.mjs';
import {linuxTarget} from '../packages/linux-native/src/target.js';
const cases=['language-O0','language-O1','language-O2','language-O3','abi-platform-O0','abi-platform-O1','abi-platform-O2','abi-platform-O3','resource-path-O2','program-roots-O2','abrupt-End-O2','form-lifetime-O2','large-O2','gtk-controls-O2','richtext-O2','compiled-printers-O3','compiled-instance-O3'];
function fixture(architecture,executionMode){
  const target=linuxTarget(architecture),manifest={architecture:target.architecture,sha256:'a'.repeat(64)};
  const proof={platform:'linux',arch:target.option,architecture:target.architecture,hostArchitecture:executionMode==='native'?target.option:'x64',executionMode,emulatorVersion:'qemu-aarch64 version 8.2',runtime:{sha256:manifest.sha256},optimizationLevelsVerified:[0,1,2,3]};
  for(const name of ['machineCodeExecutionVerified',target.option+'ExecutionVerified','gtkExecutionVerified','gtkNativeSignalsVerified','conformanceVerified','resourcesVerified','lifetimeVerified','codeMetadataGrowthVerified','richTextVerified','printerServicesVerified','previousInstanceVerified'])proof[name]=true;
  for(const name of cases)proof[name]={runtimeSha256:manifest.sha256,architecture:target.architecture,machine:target.machine,callingConvention:target.callingConvention,executableSha256:'b'.repeat(64)};
  proof.nativeFixtures=Object.fromEntries(['gtkSignals','richText','printers','previousInstance'].map(name=>[name,{passed:true,...proof['language-O0']}]));
  proof.compiledServices={passed:true};
  return {proof,manifest};
}
test('Compressed runtime archives retain the exact architecture-specific filename',async()=>{
  const bytes=Uint8Array.of(0x7f,0x45,0x4c,0x46,0,1,2);
  for(const architecture of ['x64','arm64']){
    const files=await readZip(compressedLinuxRuntimeArchive(bytes,architecture));assert.equal(files.size,1);assert.deepEqual(files.get('runtime-'+linuxTarget(architecture).architecture),bytes);
  }
  assert.equal(linuxAOTRuntimePayloadFile(),'aot-runtime-payload.js');assert.equal(linuxAOTRuntimePayloadFile('arm64'),'aot-runtime-arm64-payload.js');
});
test('Execution proof preserves native x64 versus emulated ARM64 provenance',()=>{
  for(const [architecture,mode]of [['x64','native'],['arm64','native'],['arm64','qemu-user']]){
    const {proof,manifest}=fixture(architecture,mode),verification=linuxAOTExecutionVerification(proof,manifest);
    assert.equal(verification.architecture,linuxTarget(architecture).architecture);assert.equal(verification.executionMode,mode);assert.equal(verification[architecture+'ExecutionVerified'],true);
    assert.equal(verification.emulatorVersion,mode==='qemu-user'?proof.emulatorVersion:undefined);
  }
});
test('Embedding proof rejects wrong architecture, partial execution, missing cases and inconsistent hosts',()=>{
  for(const change of [p=>p.arch='x64',p=>p.architecture='x86_64',p=>p.runtime.sha256='c'.repeat(64),p=>p.optimizationLevelsVerified.pop(),p=>p.arm64ExecutionVerified=false,p=>p.machineCodeExecutionVerified=false,p=>p.gtkNativeSignalsVerified=false,p=>p.executionMode='native',p=>p.emulatorVersion='',p=>delete p['language-O3'],p=>p['gtk-controls-O2'].machine=62,p=>p['large-O2'].runtimeSha256='c'.repeat(64),p=>p.richTextVerified=false,p=>p.printerServicesVerified=false,p=>p.previousInstanceVerified=false,p=>delete p.nativeFixtures.richText,p=>p.nativeFixtures.printers.runtimeSha256='c'.repeat(64),p=>p.nativeFixtures.previousInstance.passed=false,p=>p.compiledServices.passed=false,p=>delete p['compiled-printers-O3'],p=>p.error={message:'failed'}]){
    const {proof,manifest}=fixture('arm64','qemu-user');change(proof);assert.throws(()=>linuxAOTExecutionVerification(proof,manifest),/Embedding requires/);
  }
});
