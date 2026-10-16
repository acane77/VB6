import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {inflateSync} from 'node:zlib';
import {newProject} from '../src/project/model.js';
import {createApplicationExporter} from '../src/exporter/application-exporter.js';
import {verifyApplicationBundle} from '../src/exporter/deployment.js';
import {deploymentSettings, validateDeploymentPaths, DEPLOYMENT_LIMITS} from '../src/exporter/deployment-assets.js';
import {applicationIconPNG} from '../src/exporter/deployment-icons.js';
import {readZip, writeZip, crc32} from '../src/project/zip.js';

const exporter = createApplicationExporter({runtimeSource: 'globalThis.VB6Runtime={mountApplication:async()=>({})};', runtimeCSS: 'body{color:black}'});
const project = newProject('Portable Δ');
const hash = data => createHash('sha256').update(data).digest('hex');
const bytes = data => typeof data === 'string' ? Buffer.from(data) : data;
const copy = bundle => Object.fromEntries(Object.entries(bundle.files).map(([path, value]) => [path, typeof value === 'string' ? value : value.slice()]));

test('verified bundle preserves legacy APIs, inputs and independently hashed inventory', async () => {
  const original = structuredClone(project), settings = {assets: {'images/raw.bin': {base64: 'AP+A'}, 'data/readme.txt': 'Δ 日本語'}};
  const before = structuredClone(settings), bundle = await exporter.bundle(project, {persist: false}, {}, settings);
  assert.equal(exporter.files(project).manifest.schema, 1);
  assert.equal(typeof exporter.html(project), 'string');
  assert.equal(bundle.manifest.schema, 2); assert.equal(bundle.manifest.offline, null);
  assert.deepEqual(project, original); assert.deepEqual(settings, before);
  assert.deepEqual(Array.from(bundle.files['images/raw.bin']), [0, 255, 128]);
  assert.deepEqual(bundle.manifest.files.map(x => x.path), Object.keys(bundle.files).filter(x => x !== 'manifest.json').sort());
  for (const entry of bundle.manifest.files) {
    assert.equal(entry.bytes, bytes(bundle.files[entry.path]).length);
    assert.equal(entry.sha256, hash(bytes(bundle.files[entry.path])));
  }
  assert.equal(bundle.manifest.buildId, hash(JSON.stringify(bundle.manifest.files)));
  assert.equal((await verifyApplicationBundle(bundle.files, {expectedBuildId: bundle.manifest.buildId})).valid, true);
});

test('archives are byte-identical, sorted, fixed-date, and round-trip binary assets', async () => {
  const settings = {assets: {'z/data.bin': {base64: 'AP+A'}, 'a/data.txt': 'text'}};
  const first = await exporter.archive(project, {}, {}, settings), second = await exporter.archive(project, {}, {}, settings);
  assert.deepEqual(first.bytes, second.bytes);
  const view = new DataView(first.bytes.buffer, first.bytes.byteOffset, first.bytes.byteLength);
  assert.equal(view.getUint16(10, true), 0); assert.equal(view.getUint16(12, true), 33);
  const entries = await readZip(first.bytes);
  assert.deepEqual([...entries.keys()], [...entries.keys()].sort());
  assert.deepEqual(Array.from(entries.get('z/data.bin')), [0,255,128]);
  assert.equal((await verifyApplicationBundle(Object.fromEntries(entries))).valid, true);
  const legacy = writeZip({'x.txt': 'x'});
  assert.equal((await readZip(legacy)).size, 1);
});

test('offline output has relative install identity, genuine PNG icons and complete pinned cache inventory', async () => {
  const result = await exporter.bundle(project, {}, {}, {offline: {shortName: 'Portable', themeColor: '#aAbB00'}, assets: {'data/x.txt': 'hello'}});
  const app = JSON.parse(result.files['app.webmanifest']);
  assert.equal(app.id, './'); assert.equal(app.scope, './'); assert.equal(app.start_url, './index.html');
  assert.equal(app.short_name, 'Portable'); assert.equal(app.theme_color, '#aAbB00');
  assert.equal(app.icons.length, 3);
  assert.match(result.files['index.html'], /rel="manifest" href="\.\/app.webmanifest"/);
  assert.ok(result.files['index.html'].indexOf('./bootstrap.js') < result.files['index.html'].indexOf('./offline-register.js'));
  assert.deepEqual(result.manifest.offline.files, Object.keys(result.files).filter(p => !['service-worker.js', 'manifest.json'].includes(p)).sort());
  assert.match(result.files['service-worker.js'], /credentials: 'omit'/);
  assert.equal((await verifyApplicationBundle(result.files)).valid, true);
  assert.ok(result.diagnostics.some(d => d.code === 'EXPORT_OFFLINE_STATIC_ONLY'));
  const changed = await exporter.bundle(project, {}, {}, {offline: true, assets: {'data/x.txt': 'different'}});
  assert.notEqual(result.manifest.offline.cacheVersion, changed.manifest.offline.cacheVersion);
});

for (const size of [192, 512]) test('independent zlib/PNG decoder validates original ' + size + ' icon', () => {
  const png = applicationIconPNG(size);
  assert.deepEqual(png, applicationIconPNG(size));
  assert.equal(Buffer.from(png.subarray(0, 8)).toString('hex'), '89504e470d0a1a0a');
  const view = new DataView(png.buffer), chunks = [];
  let offset = 8;
  while (offset < png.length) {
    const length = view.getUint32(offset), type = Buffer.from(png.subarray(offset + 4, offset + 8)).toString();
    assert.equal(crc32(png.subarray(offset + 4, offset + 8 + length)), view.getUint32(offset + 8 + length));
    chunks.push({type, data: png.subarray(offset + 8, offset + 8 + length)}); offset += length + 12;
  }
  assert.equal(offset, png.length); assert.deepEqual(chunks.map(c => c.type), ['IHDR', 'IDAT', 'IEND']);
  const ihdr = new DataView(chunks[0].data.buffer, chunks[0].data.byteOffset);
  assert.equal(ihdr.getUint32(0), size); assert.equal(ihdr.getUint32(4), size);
  assert.equal(chunks[0].data[8], 8); assert.equal(chunks[0].data[9], 6);
  const raw = inflateSync(chunks[1].data);
  assert.equal(raw.length, size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    assert.equal(raw[y * (size * 4 + 1)], 0);
    for (let x = 0; x < size; x++) assert.equal(raw[y * (size * 4 + 1) + 1 + x * 4 + 3], 255);
  }
  assert.deepEqual([...raw.subarray(1, 5)], [36,54,75,255]);
});

test('custom packaged icons replace defaults without network retrieval', async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>';
  const result = await exporter.bundle(project, {}, {}, {offline: {icons: [{src: 'icons/custom.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable'}]}, assets: {'icons/custom.svg': svg}});
  assert.equal(result.files['icons/custom.svg'], svg);
  assert.equal(result.files['app-icon-192.png'], undefined);
  assert.equal(JSON.parse(result.files['app.webmanifest']).icons[0].src, './icons/custom.svg');
});

for (const path of ['../bad', '/absolute', 'sub/../bad', 'a//b', 'a/./b', 'a\\b', 'a?query', 'a#hash', 'a%2fb', 'CON.txt', 'sub/COM1.png', 'file.', 'sub/space name', 'x:stream', 'é.txt', 'manifest.json', 'RUNTIME.js', 'service-worker.js', 'app.css/x']) {
  test('bundle refuses ambiguous or reserved asset path ' + path, async () => {
    await assert.rejects(exporter.bundle(project, {}, {}, {assets: {[path]: 'x'}}), {code: 'EXPORT_INVALID_PATH'});
  });
}
test('asset paths reject case aliases and file-directory aliases', () => {
  for (const paths of [['a.txt', 'A.txt'], ['img', 'IMG/a.png']]) assert.throws(() => validateDeploymentPaths(paths), {code: 'EXPORT_INVALID_PATH'});
});

for (const value of [null, [], 1, {unknown: true}, {assets: null}, {assets: []}, {offline: null}, {offline: 1}, {offline: {name: ''}}, {offline: {display: 'bad'}}, {offline: {themeColor: 'red'}}, {offline: {icons: []}}, {offline: {icons: [{src: 'missing.png', sizes: '192x192', type: 'image/png'}]}}, {dependencyPolicy: 'ignore'}]) {
  test('deployment settings reject ' + JSON.stringify(value), () => assert.throws(() => deploymentSettings(value)));
}
for (const value of [null, 1, {}, {base64: 'A'}, {base64: '!!!!'}, {base64: 'AP=='} /* nonzero pad bits */, {base64: 'Y Q=='}, {base64: 'YQ==', extra: true}]) {
  test('asset descriptor rejects ' + JSON.stringify(value), () => assert.throws(() => deploymentSettings({assets: {'data.bin': value}}), {code: 'EXPORT_INVALID_ASSET'}));
}
test('empty binary assets are valid and aggregate count is bounded', async () => {
  const settings = {assets: {'empty.bin': {base64: ''}}};
  assert.equal((await exporter.bundle(project, {}, {}, settings)).files['empty.bin'].length, 0);
  await assert.rejects(exporter.bundle(project, {}, {}, {assets: Object.fromEntries(Array.from({length: DEPLOYMENT_LIMITS.files}, (_, i) => ['a' + i, '']))}), {code: 'EXPORT_DATA_LIMIT'});
});
test('unknown hooks/accessors and nonportable values never execute in deployment snapshots', async () => {
  let calls = 0;
  const assets = {}; Object.defineProperty(assets, 'a.txt', {enumerable: true, get() {calls++; return 'secret';}});
  await assert.rejects(exporter.bundle(project, {}, {}, {assets}));
  assert.equal(calls, 0);
});
test('dependency rejection is opt-in and preserves the declared dependency inventory', async () => {
  const p = structuredClone(project); p.assets = {remote: 'https://example.org/a.png'};
  const result = await exporter.bundle(p);
  assert.equal(result.manifest.dependencies[0].kind, 'asset');
  await assert.rejects(exporter.bundle(p, {}, {}, {dependencyPolicy: 'error'}), {code: 'EXPORT_EXTERNAL_DEPENDENCY'});
});

test('verification rejects changed, missing, additional, aliased files and a wrong trusted build', async () => {
  const result = await exporter.bundle(project, {}, {}, {assets: {'raw.bin': {base64: 'AP+A'}}});
  const changed = copy(result); changed['raw.bin'][0] = 1;
  const missing = copy(result); delete missing['runtime.js'];
  const extra = {...result.files, 'extra.txt': 'extra'};
  const alias = {...result.files, 'RUNTIME.js': result.files['runtime.js']};
  for (const files of [changed, missing, extra, alias]) assert.equal((await verifyApplicationBundle(files)).valid, false);
  assert.equal((await verifyApplicationBundle(result.files, {expectedBuildId: '0'.repeat(64)})).valid, false);
  assert.equal((await verifyApplicationBundle(result.files, {expectedBuildId: 'invalid'})).valid, false);
});
test('verification is nonexecuting, snapshots bytes and rejects malformed manifests', async () => {
  const result = await exporter.bundle(project, {}, {}, {assets: {'raw.bin': {base64: 'AP+A'}}});
  const files = copy(result), pending = verifyApplicationBundle(files);
  files['raw.bin'][0] = 9; assert.equal((await pending).valid, true);
  let calls = 0; const evil = {};
  Object.defineProperty(evil, 'manifest.json', {enumerable: true, get() {calls++; return '{}';}});
  assert.equal((await verifyApplicationBundle(evil)).valid, false); assert.equal(calls, 0);
  for (const manifest of ['{', '{}', JSON.stringify({...result.manifest, schema: 1}), JSON.stringify({...result.manifest, files: [...result.manifest.files].reverse()}), JSON.stringify({...result.manifest, files: result.manifest.files.map(e => ({...e, bytes: -1}))})]) {
    assert.equal((await verifyApplicationBundle({...result.files, 'manifest.json': manifest})).valid, false);
  }
  assert.equal((await verifyApplicationBundle({...result.files, 'manifest.json': new Uint8Array([255])})).valid, false);
  assert.equal((await verifyApplicationBundle(null)).valid, false);
});
test('fingerprint record property order is irrelevant but content order is canonical', async () => {
  const result = await exporter.bundle(project), files = copy(result);
  const manifest = {...result.manifest, files: result.manifest.files.map(e => ({sha256: e.sha256, bytes: e.bytes, path: e.path}))};
  files['manifest.json'] = JSON.stringify(manifest);
  assert.equal((await verifyApplicationBundle(files)).valid, true);
});

test('strict deployment ZIP reads reject symlink metadata and noncanonical aliases', async () => {
  const data = writeZip({'index.html': 'target'}), view = new DataView(data.buffer);
  const end = data.length - 22, central = view.getUint32(end + 16, true);
  view.setUint16(central + 4, 0x0314, true); // Unix creator; symlink, permissions 0777.
  view.setUint32(central + 38, 0xa1ff0000, true);
  await assert.rejects(readZip(data, {strictEntries: true}), /Special files/);
  assert.equal((await readZip(data)).size, 1); // Legacy read-only import behavior remains compatible.
  await assert.rejects(readZip(writeZip({'a//b.txt': 'text'}), {strictEntries: true}), /Noncanonical/);
  await assert.rejects(readZip(writeZip({'a\\b.txt': 'text'}), {strictEntries: true}), /Noncanonical/);
});
test('deployment paths bound directory depth consistently with verification I/O', () => {
  assert.doesNotThrow(() => validateDeploymentPaths([Array(DEPLOYMENT_LIMITS.depth).fill('a').join('/')]));
  assert.throws(() => validateDeploymentPaths([Array(DEPLOYMENT_LIMITS.depth + 1).fill('a').join('/')]), {code: 'EXPORT_INVALID_PATH'});
});

test('multi-megabyte canonical base64 decodes without regex recursion or excess copies', async () => {
  const data = Buffer.alloc(4_000_000, 120), text = data.toString('base64');
  const result = await exporter.bundle(project, {}, {}, {assets: {'large.bin': {base64: text}}});
  assert.deepEqual(Buffer.from(result.files['large.bin']), data);
  assert.equal((await verifyApplicationBundle(result.files)).valid, true);
  assert.throws(() => deploymentSettings({assets: {'bad.bin': {base64: text.slice(0, -1) + '!'}}}), {code: 'EXPORT_INVALID_ASSET'});
});
test('base64 tail validation agrees with independent canonical encoding over every byte', () => {
  for (let value = 0; value < 256; value++) {
    for (const data of [Buffer.from([value]), Buffer.from([value, 255 - value])]) {
      const text = data.toString('base64'), result = deploymentSettings({assets: {'data.bin': {base64: text}}});
      assert.deepEqual(Buffer.from(result.assets['data.bin']), data);
    }
  }
  for (const text of ['=', '====', 'A===', '=AAA', 'AA=A', 'AAA=AAAA', 'AAA==', 'AAB=', 'AB==', 'AAAA!===']) {
    assert.throws(() => deploymentSettings({assets: {'data.bin': {base64: text}}}), {code: 'EXPORT_INVALID_ASSET'});
  }
});
