import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {spawnSync} from 'node:child_process';
import {randomLibrary} from '../src/runtime/random.js';

const sdk=spawnSync('dotnet',['--version'],{encoding:'utf8',timeout:15000});
const major=/^(\d+)\./.exec(sdk.stdout?.trim()??'')?.[1];
test('Random sequence agrees exactly with Microsoft.VisualBasic.VBMath', {skip:!major&&'A .NET SDK is required for the independent managed reference',timeout:120000},()=>{
 const dir=mkdtempSync(join(tmpdir(),'vb6-random-reference-'));
 try {
  writeFileSync(join(dir,'Reference.csproj'),`<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net${major}.0</TargetFramework></PropertyGroup></Project>`);
  writeFileSync(join(dir,'Program.cs'),`using System; using System.Collections.Generic; using System.Text.Json; using Microsoft.VisualBasic;
var values=new List<double>(); values.Add(VBMath.Rnd(0));
for(int i=0;i<256;i++) values.Add(VBMath.Rnd());
foreach(float seed in new float[]{-1,-2,-0.25f,-12345.5f,float.MinValue,-float.Epsilon}) {
 values.Add(VBMath.Rnd(seed)); values.Add(VBMath.Rnd(0)); values.Add(VBMath.Rnd());
 foreach(double seed2 in new double[]{0,1,42,-42,Math.PI,1e300}) {VBMath.Randomize(seed2);values.Add(VBMath.Rnd(0));values.Add(VBMath.Rnd());}
}
Console.WriteLine("VB6_REFERENCE:"+JsonSerializer.Serialize(values));`);
  const result=spawnSync('dotnet',['run','--project',join(dir,'Reference.csproj'),'--configuration','Release','--verbosity','quiet'],{encoding:'utf8',timeout:105000,maxBuffer:2*1024*1024,env:{...process.env,DOTNET_CLI_TELEMETRY_OPTOUT:'1',DOTNET_NOLOGO:'1'}});
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
  const line=result.stdout.split(/\r?\n/).find(line=>line.startsWith('VB6_REFERENCE:'));assert.ok(line,'Reference output marker was not produced');
  const native=JSON.parse(line.slice('VB6_REFERENCE:'.length)),r=randomLibrary(),actual=[r.Rnd(0)];
  for(let i=0;i<256;i++)actual.push(r.Rnd());
  for(const seed of [-1,-2,-.25,-12345.5,-3.4028234663852886e38,-1.401298464324817e-45]) {
   actual.push(r.Rnd(seed),r.Rnd(0),r.Rnd());
   for(const seed2 of [0,1,42,-42,Math.PI,1e300]){r.Randomize(seed2);actual.push(r.Rnd(0),r.Rnd());}
  }
  assert.deepEqual(actual,native);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
