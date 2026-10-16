#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {readBoundedFile, readDeployment, writeDeploymentDirectory} from './application-deployment-files.mjs';
import {verifyApplicationBundle} from '../src/exporter/deployment.js';

const usage = `Usage: node tools/export-application.mjs PROJECT.vb6web --out PATH [--format html|directory|zip]
       node tools/export-application.mjs PROJECT.vb6web --check
       node tools/export-application.mjs DIRECTORY_OR_ZIP --verify [--expected-build SHA256]
Options:
  --options FILE      JSON runtime options (no credentials or callbacks)
  --document FILE     JSON title/language/direction/description and trusted scripts
  --deployment FILE   JSON assets/offline/dependencyPolicy (directory or zip only)
  --offline           Enable offline/installable packaging (directory or zip only)
  --help              Show this help without building the runtime
Build once with npm run build. Existing output is never overwritten.
ZIPs are reproducible; verification never loads or executes deployment code.
Import classic projects in the IDE, then save as .vb6web before using this CLI.`;

async function readJSON(file) {
  try { return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(await readBoundedFile(file))); }
  catch (error) { if (error instanceof SyntaxError) throw new Error('Invalid JSON in ' + file); throw error; }
}
function printReport(report) {
  console.log(JSON.stringify(report, null, 2));
  if (!report.valid) process.exitCode = 1;
}
async function main(args) {
  if (args.includes('--help')) { console.log(usage); return; }
  const settings = {format: 'html'};
  let input;
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('--')) {
      if (input) throw new Error('Only one input is allowed');
      input = arg; continue;
    }
    if (!['--out', '--format', '--options', '--document', '--deployment', '--offline', '--check', '--verify', '--expected-build'].includes(arg)) throw new Error('Unknown option: ' + arg);
    if (seen.has(arg)) throw new Error('Repeated option: ' + arg);
    seen.add(arg);
    if (['--check', '--offline', '--verify'].includes(arg)) settings[arg.slice(2)] = true;
    else {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Missing value for ' + arg);
      settings[arg.slice(2)] = args[++i];
    }
  }
  if (!input) throw new Error(usage);
  if (settings.verify) {
    if ([...seen].some(arg => !['--verify', '--expected-build'].includes(arg))) throw new Error('--verify cannot be combined with export options');
    printReport(await verifyApplicationBundle(await readDeployment(input), {expectedBuildId: settings['expected-build']}));
    return;
  }
  if (seen.has('--expected-build')) throw new Error('--expected-build requires --verify');
  if (!settings.check && !settings.out) throw new Error(usage);
  if (!['html', 'directory', 'zip'].includes(settings.format)) throw new Error('Expected format html, directory or zip');
  if (settings.format === 'html' && (settings.offline || settings.deployment)) throw new Error('Deployment assets and offline installation require --format directory or zip');
  const project = await readJSON(input);
  const options = settings.options ? await readJSON(settings.options) : {};
  const document = settings.document ? await readJSON(settings.document) : {};
  const deployment = settings.deployment ? await readJSON(settings.deployment) : {};
  if (settings.offline) {
    if (!deployment || typeof deployment !== 'object' || Array.isArray(deployment)) throw new Error('Expected deployment settings object');
    if (deployment.offline === false) throw new Error('--offline conflicts with deployment.offline=false');
    if (deployment.offline === undefined) deployment.offline = true;
  }
  let exporter;
  try { exporter = await import('../src/exporter/exporter.js'); }
  catch (error) { if (error.code === 'ERR_MODULE_NOT_FOUND') throw new Error('Run npm run build to generate the matching runtime payload first'); throw error; }
  if (settings.check) {
    let report = exporter.inspectApplicationExport(project, options, document);
    if (report.valid && settings.format !== 'html') {
      try { report = {valid: true, ...(await exporter.exportApplicationBundle(project, options, document, deployment)).manifest}; }
      catch (error) {report = {valid: false, diagnostics: error.diagnostics || [{severity: 'error', message: error.message}]};}
    }
    printReport(report); return;
  }
  // Render and validate everything before claiming an output path. Exclusive
  // creation rejects existing files, directories and symlinks; no --force.
  const output = path.resolve(settings.out);
  if (settings.format === 'html') {
    const html = exporter.exportApplication(project, options, document);
    await fs.writeFile(output, html, {flag: 'wx'});
  } else {
    const bundle = settings.format === 'zip' ? await exporter.exportApplicationArchive(project, options, document, deployment) : await exporter.exportApplicationBundle(project, options, document, deployment);
    if (settings.format === 'zip') await fs.writeFile(output, bundle.bytes, {flag: 'wx'});
    else await writeDeploymentDirectory(output, bundle.files);
    for (const diagnostic of bundle.diagnostics) console.error(diagnostic.code + ': ' + diagnostic.message);
    console.log('Build ID: ' + bundle.manifest.buildId);
  }
  console.log('Exported ' + settings.format + ': ' + output);
}

main(process.argv.slice(2)).catch(error => {
  if (error.code === 'EEXIST') console.error('Output already exists; choose a new path. Nothing was overwritten.');
  else if (error.diagnostics) console.error(JSON.stringify({valid: false, diagnostics: error.diagnostics}, null, 2));
  else console.error(error.message || String(error));
  process.exitCode = 1;
});
