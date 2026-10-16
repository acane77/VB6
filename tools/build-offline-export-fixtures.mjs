import fs from 'node:fs';
import path from 'node:path';
import {exportApplicationBundle} from '../src/exporter/exporter.js';
const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'reports/exporter-offline/fixtures');
fs.mkdirSync(output, {recursive: true});
const project = JSON.parse(fs.readFileSync(path.join(root, 'examples/calculator.vb6web')));
project.id = 'offline-calculator-fixture'; project.name = 'OfflineCalculator';
const metadata = {};
for (const version of ['one', 'two', 'failed']) {
  const p = structuredClone(project);
  p.modules[0].form.properties.Caption = 'Offline release ' + version;
  const adapter = version === 'failed' ? 'globalThis.vb6ConfigureApplication = async () => {throw new Error("Deliberate startup failure");};' : `globalThis.releaseMarker = ${JSON.stringify(version)};`;
  const bundle = await exportApplicationBundle(p, {persist: false, nativeWindows: false}, {scripts: {'adapter.js': adapter}}, {
    offline: {name: 'Offline calculator', shortName: 'Calculator'},
    assets: {'assets/raw.bin': {base64: 'AP+A'}, 'assets/version.txt': version}
  });
  const directory = path.join(output, version);
  for (const [name, bytes] of Object.entries(bundle.files)) {
    const file = path.join(directory, name); fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, bytes);
  }
  metadata[version] = {buildId: bundle.manifest.buildId, cacheVersion: bundle.manifest.offline.cacheVersion};
}
fs.writeFileSync(path.join(output, '..', 'fixture-builds.json'), JSON.stringify(metadata, null, 2) + '\n');
console.log('Built real full-runtime offline releases, binary assets and deliberate startup failure.');
