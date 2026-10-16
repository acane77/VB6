import {snapshotExportValue} from './serialization.js';
import {exportFailure} from './diagnostics.js';

export const DEPLOYMENT_LIMITS = Object.freeze({files: 512, bytes: 64 * 1024 * 1024, depth: 16});
export const OFFLINE_FILES = Object.freeze(['app.webmanifest', 'service-worker.js', 'offline-register.js', 'app-icon.svg', 'app-icon-192.png', 'app-icon-512.png']);
const encoder = new TextEncoder();
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** One canonical spelling across URLs, ZIP extractors and Windows filesystems. */
export function deploymentPath(path) {
  if (typeof path !== 'string' || !path || path.length > 1024 || path.split('/').length > DEPLOYMENT_LIMITS.depth || path.split('/').some(part =>
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part) || part.length > 255 || part.endsWith('.') ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    throw exportFailure('EXPORT_INVALID_PATH', 'Expected a portable relative deployment path', String(path));
  }
  return path;
}

export function validateDeploymentPaths(paths) {
  const seen = new Set();
  for (const path of paths) {
    const key = deploymentPath(path).toLowerCase();
    if (seen.has(key)) throw exportFailure('EXPORT_INVALID_PATH', 'Case-insensitive deployment path collision', path);
    seen.add(key);
  }
  for (const path of seen) {
    const parts = path.split('/');
    while (parts.length > 1) {
      parts.pop();
      if (seen.has(parts.join('/'))) throw exportFailure('EXPORT_INVALID_PATH', 'A deployment file cannot also be a directory', path);
    }
  }
}

export function deploymentBytes(value) {
  if (typeof value === 'string') return encoder.encode(value);
  if (value instanceof Uint8Array) return value;
  throw exportFailure('EXPORT_INVALID_ASSET', 'Expected UTF-8 text or bytes in a deployment', 'files');
}

export function deploymentSettings(input = {}) {
  const settings = snapshotExportValue(input, 'deployment');
  if (!object(settings)) throw exportFailure('EXPORT_INVALID_DEPLOYMENT', 'Expected deployment settings', 'deployment');
  for (const key of Object.keys(settings)) if (!['assets', 'offline', 'dependencyPolicy'].includes(key)) {
    throw exportFailure('EXPORT_INVALID_DEPLOYMENT', 'Unknown deployment setting', 'deployment.' + key);
  }
  if (settings.dependencyPolicy !== undefined && !['warn', 'error'].includes(settings.dependencyPolicy)) {
    throw exportFailure('EXPORT_INVALID_DEPLOYMENT', 'Expected dependencyPolicy warn or error', 'deployment.dependencyPolicy');
  }
  const assets = settings.assets === undefined ? {} : settings.assets;
  if (!object(assets) || Object.keys(assets).length > DEPLOYMENT_LIMITS.files) throw exportFailure('EXPORT_DATA_LIMIT', 'Too many deployment assets or invalid asset map', 'deployment.assets');
  validateDeploymentPaths(Object.keys(assets));
  const files = {};
  let total = 0;
  for (const [path, value] of Object.entries(assets)) {
    let data;
    if (typeof value === 'string') {
      if (value.length > DEPLOYMENT_LIMITS.bytes - total) throw exportFailure('EXPORT_DATA_LIMIT', 'Deployment assets exceed the byte limit', path);
      data = value;
    }
    else {
      if (!object(value) || Object.keys(value).join() !== 'base64' || typeof value.base64 !== 'string') throw exportFailure('EXPORT_INVALID_ASSET', 'Expected text or {base64: canonicalBase64}', path);
      const text = value.base64;
      if (text.length > Math.ceil(DEPLOYMENT_LIMITS.bytes / 3) * 4) throw exportFailure('EXPORT_DATA_LIMIT', 'Deployment assets exceed the byte limit', path);
      // Repeated grouped regexes overflow engine stacks on multi-MiB assets.
      // A single invalid-character scan and explicit tail/pad-bit checks are linear.
      const invalid = text.search(/[^A-Za-z0-9+/]/);
      if (text.length % 4 || invalid !== -1 && (invalid < text.length - 2 || !/^={1,2}$/.test(text.slice(invalid)))) throw exportFailure('EXPORT_INVALID_ASSET', 'Invalid base64 asset', path);
      const padding = invalid < 0 ? 0 : text.length - invalid;
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
      if (padding && (alphabet.indexOf(text[text.length - padding - 1]) & (padding === 2 ? 15 : 3))) throw exportFailure('EXPORT_INVALID_ASSET', 'Expected canonical base64 asset', path);
      if (text.length / 4 * 3 - padding > DEPLOYMENT_LIMITS.bytes - total) throw exportFailure('EXPORT_DATA_LIMIT', 'Deployment assets exceed the byte limit', path);
      const decoded = atob(text);
      data = new Uint8Array(decoded.length);
      for (let i = 0; i < decoded.length; i++) data[i] = decoded.charCodeAt(i);
    }
    total += deploymentBytes(data).byteLength;
    if (total > DEPLOYMENT_LIMITS.bytes) throw exportFailure('EXPORT_DATA_LIMIT', 'Deployment assets exceed the byte limit', path);
    files[path] = data;
  }
  let offline = settings.offline === undefined ? false : settings.offline;
  if (offline === true) offline = {};
  if (offline !== false) {
    if (!object(offline)) throw exportFailure('EXPORT_INVALID_DEPLOYMENT', 'Expected offline boolean or settings object', 'deployment.offline');
    for (const key of Object.keys(offline)) if (!['name', 'shortName', 'display', 'themeColor', 'backgroundColor', 'icons'].includes(key)) {
      throw exportFailure('EXPORT_INVALID_DEPLOYMENT', 'Unknown offline setting', 'deployment.offline.' + key);
    }
    for (const key of ['name', 'shortName']) if (offline[key] !== undefined && (typeof offline[key] !== 'string' || !offline[key].trim() || offline[key].length > 256)) {
      throw exportFailure('EXPORT_INVALID_DEPLOYMENT', 'Expected nonempty text of at most 256 characters', 'deployment.offline.' + key);
    }
    for (const key of ['themeColor', 'backgroundColor']) if (offline[key] !== undefined && !/^#[0-9a-f]{6}$/i.test(offline[key])) {
      throw exportFailure('EXPORT_INVALID_DEPLOYMENT', 'Expected a six-digit hex color', 'deployment.offline.' + key);
    }
    if (offline.display !== undefined && !['standalone', 'minimal-ui', 'fullscreen', 'browser'].includes(offline.display)) throw exportFailure('EXPORT_INVALID_DEPLOYMENT', 'Invalid web application display mode', 'deployment.offline.display');
    if (offline.icons !== undefined) {
      if (!Array.isArray(offline.icons) || !offline.icons.length || offline.icons.length > 16) throw exportFailure('EXPORT_INVALID_DEPLOYMENT', 'Expected 1–16 packaged icons', 'deployment.offline.icons');
      for (const icon of offline.icons) {
        if (!object(icon) || Object.keys(icon).some(key => !['src', 'sizes', 'type', 'purpose'].includes(key))) throw exportFailure('EXPORT_INVALID_DEPLOYMENT', 'Invalid icon descriptor', 'deployment.offline.icons');
        deploymentPath(icon.src);
        if (!Object.hasOwn(files, icon.src)) throw exportFailure('EXPORT_INVALID_ASSET', 'Icon must refer to a packaged deployment asset', icon.src);
        if (!/^(?:any|[1-9][0-9]*x[1-9][0-9]*(?: [1-9][0-9]*x[1-9][0-9]*)*)$/.test(icon.sizes || '')) throw exportFailure('EXPORT_INVALID_DEPLOYMENT', 'Invalid icon sizes', icon.src);
        if (!['image/png', 'image/svg+xml', 'image/webp'].includes(icon.type)) throw exportFailure('EXPORT_INVALID_DEPLOYMENT', 'Invalid icon MIME type', icon.src);
        if (icon.purpose !== undefined && !/^(?:any|maskable|monochrome)(?: (?:any|maskable|monochrome))*$/.test(icon.purpose)) throw exportFailure('EXPORT_INVALID_DEPLOYMENT', 'Invalid icon purpose', icon.src);
      }
    }
  }
  return {assets: files, offline, dependencyPolicy: settings.dependencyPolicy || 'warn'};
}
