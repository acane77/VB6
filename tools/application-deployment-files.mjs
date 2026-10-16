/** Bounded, nonexecuting local deployment I/O shared by the export/verify CLI. */
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {readZip} from '../src/project/zip.js';
import {DEPLOYMENT_LIMITS, deploymentPath} from '../src/exporter/deployment-assets.js';

export async function readBoundedFile(file, limit = DEPLOYMENT_LIMITS.bytes) {
  const before = await fs.lstat(file);
  if (before.isSymbolicLink()) throw new Error('Symbolic links are not accepted: ' + file);
  // Opening a FIFO can block before fstat can diagnose it. Reject nonregular
  // inputs before open, then check again on the actual descriptor.
  if (!before.isFile()) throw new Error('Expected a regular file: ' + file);
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('Expected a regular file: ' + file);
    if (stat.size > limit) throw new Error('Input exceeds its byte limit: ' + file);
    const chunks = []; let length = 0;
    while (true) {
      const data = Buffer.allocUnsafe(Math.min(65536, limit - length + 1));
      const {bytesRead} = await handle.read(data);
      if (!bytesRead) break;
      length += bytesRead;
      if (length > limit) throw new Error('Input exceeds its byte limit: ' + file);
      chunks.push(data.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks, length);
  } finally {await handle.close();}
}

export async function readDeployment(input) {
  const root = path.resolve(input), stat = await fs.lstat(root);
  if (stat.isSymbolicLink()) throw new Error('Symbolic links are not accepted: ' + root);
  if (stat.isFile()) {
    const data = await readBoundedFile(root, DEPLOYMENT_LIMITS.bytes + 2 * 1024 * 1024);
    return Object.fromEntries(await readZip(data, {maxExpandedBytes: DEPLOYMENT_LIMITS.bytes, maxFiles: DEPLOYMENT_LIMITS.files, strictEntries: true}));
  }
  if (!stat.isDirectory()) throw new Error('Expected a deployment directory or ZIP');
  const files = Object.create(null); let count = 0, total = 0, nodes = 0;
  async function visit(relative = '') {
    const directory = await fs.opendir(path.join(root, relative));
    for await (const entry of directory) {
      const name = relative ? relative + '/' + entry.name : entry.name;
      deploymentPath(name);
      if (++nodes > DEPLOYMENT_LIMITS.files * DEPLOYMENT_LIMITS.depth) throw new Error('Deployment directory exceeds the entry limit');
      const file = path.join(root, name), info = await fs.lstat(file);
      if (info.isSymbolicLink()) throw new Error('Symbolic links are not accepted: ' + name);
      if (info.isDirectory()) await visit(name);
      else {
        if (!info.isFile()) throw new Error('Expected regular deployment file: ' + name);
        if (++count > DEPLOYMENT_LIMITS.files) throw new Error('Deployment exceeds the file limit');
        const bytes = await readBoundedFile(file, DEPLOYMENT_LIMITS.bytes - total);
        total += bytes.length; files[name] = bytes;
      }
    }
  }
  await visit(); return files;
}

export async function writeDeploymentDirectory(output, files) {
  // Caller has completed all validation. Claim a new root exclusively; never
  // merge with or overwrite an existing directory, file or symbolic link.
  await fs.mkdir(output, {mode: 0o755});
  for (const [name, data] of Object.entries(files)) {
    deploymentPath(name);
    const target = path.join(output, name);
    if (name.includes('/')) await fs.mkdir(path.dirname(target), {recursive: true});
    await fs.writeFile(target, data, {flag: 'wx'});
  }
}
