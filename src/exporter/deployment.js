import {sha256} from '../core/sha256.js';
import {writeZip} from '../project/zip.js';
import {exportDiagnostic, exportFailure} from './diagnostics.js';
import {snapshotExportValue} from './serialization.js';
import {DEPLOYMENT_LIMITS, OFFLINE_FILES, deploymentSettings, deploymentBytes, validateDeploymentPaths} from './deployment-assets.js';
import {applicationIconPNG} from './deployment-icons.js';
import {installOfflineWorker, OFFLINE_REGISTRATION, DEFAULT_APPLICATION_ICON} from './offline-worker.js';

const encoder = new TextEncoder();
const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
const digest = async data => hex(await sha256(deploymentBytes(data)));
const json = value => JSON.stringify(value, null, 2) + '\n';
const hashPattern = /^[0-9a-f]{64}$/;

async function inventory(files) {
  const paths = Object.keys(files).sort();
  validateDeploymentPaths(paths);
  if (paths.length > DEPLOYMENT_LIMITS.files) throw exportFailure('EXPORT_DATA_LIMIT', 'Too many deployment files', 'files');
  const entries = [];
  let total = 0;
  for (const path of paths) {
    const bytes = deploymentBytes(files[path]);
    total += bytes.byteLength;
    if (total > DEPLOYMENT_LIMITS.bytes) throw exportFailure('EXPORT_DATA_LIMIT', 'Deployment exceeds the 64 MiB byte limit', path);
    entries.push({path, bytes: bytes.byteLength, sha256: await digest(bytes)});
  }
  return entries;
}

/** Upgrade a prepared split application to a verified, optionally offline release.
 * Existing synchronous HTML/files APIs remain unchanged. No resource is fetched.
 */
export async function buildApplicationBundle(deployment, input = {}) {
  const settings = deploymentSettings(input);
  const files = {...deployment.files};
  delete files['manifest.json'];
  validateDeploymentPaths([...Object.keys(files), ...Object.keys(settings.assets), 'manifest.json', ...OFFLINE_FILES]);
  Object.assign(files, settings.assets);
  const diagnostics = deployment.diagnostics.slice();
  const dependencies = deployment.manifest.dependencies;
  if (settings.dependencyPolicy === 'error' && dependencies.length) throw exportFailure('EXPORT_EXTERNAL_DEPENDENCY', 'Deployment has external assets, services or Declare imports; review the dependency inventory', 'dependencies');
  let offline = null;
  if (settings.offline !== false) {
    const options = settings.offline;
    const icons = options.icons || [{src: 'app-icon-192.png', sizes: '192x192', type: 'image/png'}, {src: 'app-icon-512.png', sizes: '512x512', type: 'image/png'}, {src: 'app-icon.svg', sizes: 'any', type: 'image/svg+xml'}];
    const manifest = {
      id: './', name: options.name || deployment.manifest.project.name,
      short_name: options.shortName || options.name || deployment.manifest.project.name,
      start_url: './index.html', scope: './', display: options.display || 'standalone',
      theme_color: options.themeColor || '#24364b', background_color: options.backgroundColor || '#c0c0c0',
      icons: icons.map(icon => ({...icon, src: './' + icon.src}))
    };
    files['app.webmanifest'] = json(manifest);
    if (!options.icons) {
      files['app-icon.svg'] = DEFAULT_APPLICATION_ICON;
      files['app-icon-192.png'] = applicationIconPNG(192);
      files['app-icon-512.png'] = applicationIconPNG(512);
    }
    files['offline-register.js'] = OFFLINE_REGISTRATION;
    // Generated markup is controlled, while authored strings are HTML-escaped.
    files['index.html'] = files['index.html'].replace('</head>', '<link rel="manifest" href="./app.webmanifest"><meta name="theme-color" content="' + manifest.theme_color + '"></head>')
      .replace('</body>', '<script defer src="./offline-register.js"></script></body>');
    const cachedFiles = await inventory(files);
    const revision = await digest(JSON.stringify(cachedFiles) + '\n' + installOfflineWorker.toString());
    files['service-worker.js'] = '(' + installOfflineWorker.toString() + ')(' + JSON.stringify({revision, files: cachedFiles}) + ');\n';
    offline = {scope: './', entry: 'index.html', cacheVersion: revision, files: cachedFiles.map(file => file.path), policy: 'verified-static-only'};
    diagnostics.push(exportDiagnostic('EXPORT_OFFLINE_STATIC_ONLY', 'Offline mode caches packaged static files only. Remote services, dynamic requests and native adapters still need their normal host/network.', 'deployment.offline', {severity: 'warning'}));
  }
  const entries = await inventory(files);
  const manifest = {...deployment.manifest, schema: 2, buildId: await digest(JSON.stringify(entries)), files: entries, offline, diagnostics};
  files['manifest.json'] = json(manifest);
  // Include the manifest itself in the aggregate resource budget.
  if (entries.reduce((sum, entry) => sum + entry.bytes, 0) + encoder.encode(files['manifest.json']).length > DEPLOYMENT_LIMITS.bytes || entries.length + 1 > DEPLOYMENT_LIMITS.files) throw exportFailure('EXPORT_DATA_LIMIT', 'Deployment manifest exceeds the aggregate limits', 'manifest.json');
  return {entry: 'index.html', files, manifest, diagnostics};
}

export async function archiveApplicationBundle(deployment, settings = {}) {
  const bundle = await buildApplicationBundle(deployment, settings);
  const files = Object.fromEntries(Object.entries(bundle.files).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  return {...bundle, bytes: writeZip(files, {reproducible: true})};
}

/** Verify actual file bytes, exact inventory and the complete release identifier.
 * A trusted expectedBuildId pins contents; a self-consistent manifest alone is
 * corruption detection, not publisher authentication. Nothing is executed.
 */
export async function verifyApplicationBundle(input, {expectedBuildId} = {}) {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw exportFailure('EXPORT_INVALID_BUNDLE', 'Expected a deployment file map', 'files');
    const files = Object.create(null);
    const descriptors = Object.getOwnPropertyDescriptors(input);
    if (Reflect.ownKeys(descriptors).some(key => typeof key === 'symbol' && descriptors[key].enumerable)) throw exportFailure('EXPORT_INVALID_BUNDLE', 'Symbol deployment paths cannot be verified', 'files');
    const paths = Object.keys(descriptors).filter(path => descriptors[path].enumerable);
    validateDeploymentPaths(paths);
    if (paths.length > DEPLOYMENT_LIMITS.files) throw exportFailure('EXPORT_DATA_LIMIT', 'Too many deployment files', 'files');
    let total = 0;
    for (const [path, descriptor] of Object.entries(descriptors)) {
      if (!descriptor.enumerable) continue;
      if (!Object.hasOwn(descriptor, 'value')) throw exportFailure('EXPORT_INVALID_BUNDLE', 'Deployment accessors are not executed', path);
      // Take immutable copies before awaiting hashes; callers cannot alter a
      // binary input halfway through verification.
      const value = descriptor.value;
      if (typeof value === 'string' && value.length > DEPLOYMENT_LIMITS.bytes) throw exportFailure('EXPORT_DATA_LIMIT', 'Deployment exceeds its byte limit', path);
      const bytes = deploymentBytes(value);
      total += bytes.byteLength;
      if (total > DEPLOYMENT_LIMITS.bytes) throw exportFailure('EXPORT_DATA_LIMIT', 'Deployment exceeds its byte limit', path);
      files[path] = bytes.slice();
    }
    validateDeploymentPaths(Object.keys(files));
    if (Object.keys(files).length > DEPLOYMENT_LIMITS.files) throw exportFailure('EXPORT_DATA_LIMIT', 'Too many deployment files', 'files');
    const raw = files['manifest.json'];
    if (!raw || raw.length > 1024 * 1024) throw exportFailure('EXPORT_INVALID_BUNDLE', 'Missing or oversized deployment manifest', 'manifest.json');
    const manifest = snapshotExportValue(JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(raw)), 'manifest');
    if (manifest?.schema !== 2 || manifest.target !== 'browser' || manifest.entry !== 'index.html' || !hashPattern.test(manifest.buildId) || !Array.isArray(manifest.files)) throw exportFailure('EXPORT_INVALID_BUNDLE', 'Invalid verified deployment manifest', 'manifest.json');
    const expected = manifest.files;
    if (expected.some(entry => !entry || typeof entry.path !== 'string' || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || !hashPattern.test(entry.sha256) || Object.keys(entry).sort().join() !== 'bytes,path,sha256')) throw exportFailure('EXPORT_INVALID_BUNDLE', 'Invalid file fingerprint', 'manifest.files');
    delete files['manifest.json'];
    const actual = await inventory(files);
    if (!Object.hasOwn(files, 'index.html') || actual.length !== expected.length || actual.some((entry, index) => entry.path !== expected[index].path || entry.bytes !== expected[index].bytes || entry.sha256 !== expected[index].sha256)) throw exportFailure('EXPORT_INTEGRITY_MISMATCH', 'Deployment paths, sizes or SHA-256 fingerprints differ', 'manifest.files');
    const buildId = await digest(JSON.stringify(actual));
    if (buildId !== manifest.buildId || expectedBuildId !== undefined && (!hashPattern.test(expectedBuildId) || buildId !== expectedBuildId)) throw exportFailure('EXPORT_INTEGRITY_MISMATCH', 'Deployment build identifier differs', 'manifest.buildId');
    return {valid: true, buildId, manifest, diagnostics: []};
  } catch (error) {
    return {valid: false, diagnostics: error.diagnostics || [exportDiagnostic('EXPORT_INVALID_BUNDLE', error.message || 'Invalid deployment bundle')]};
  }
}
