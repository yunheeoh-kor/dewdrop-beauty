// Verify the checked-in offline assets, or restore them from pinned upstream bytes.
// Usage: node scripts/setup-vision.mjs [--check | --download]
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(new URL('../web/vendor/mediapipe/manifest.json', import.meta.url), 'utf8'));
const args = process.argv.slice(2);
if (args.length > 1 || args.some(arg => !['--check', '--download'].includes(arg))) {
  throw new Error('Usage: node scripts/setup-vision.mjs [--check | --download]');
}
const download = args.includes('--download');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function targetPath(asset) {
  if (!(asset.path.startsWith('web/vendor/mediapipe/') || asset.path === 'web/models/face_landmarker.task')) {
    throw new Error(`Unexpected asset destination: ${asset.path}`);
  }
  const path = resolve(root, asset.path);
  const rel = relative(root, path);
  if (rel.startsWith(`..${sep}`) || rel === '..') throw new Error('Asset destination escapes the workspace');
  return path;
}

function checkBytes(asset, bytes) {
  return bytes.length === asset.bytes && sha256(bytes) === asset.sha256;
}

async function fetchBytes(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

// Extract only explicitly named regular files; archive paths never control writes.
function packageFiles(archive) {
  const integrity = `sha512-${createHash('sha512').update(archive).digest('base64')}`;
  if (integrity !== manifest.package.integrity) throw new Error('MediaPipe package integrity mismatch');
  const selected = new Set(manifest.files.map(asset => asset.packageEntry).filter(Boolean));
  const files = new Map();
  const tar = gunzipSync(archive);
  for (let offset = 0; offset + 512 <= tar.length;) {
    const name = tar.subarray(offset, offset + 100).toString('utf8').replace(/\0.*$/s, '');
    if (!name) break;
    const length = Number.parseInt(tar.subarray(offset + 124, offset + 136).toString('ascii'), 8);
    if (!Number.isSafeInteger(length) || length < 0 || offset + 512 + length > tar.length) {
      throw new Error('Malformed MediaPipe archive');
    }
    if (selected.has(name)) {
      const type = tar[offset + 156];
      if (type !== 0 && type !== 48) throw new Error(`Expected a regular archive file: ${name}`);
      files.set(name, tar.subarray(offset + 512, offset + 512 + length));
    }
    offset += 512 + Math.ceil(length / 512) * 512;
  }
  return files;
}

const missing = [];
for (const asset of manifest.files) {
  const path = targetPath(asset);
  try {
    if (!checkBytes(asset, await readFile(path))) missing.push(asset);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    missing.push(asset);
  }
}

if (missing.length && !download) {
  throw new Error(`Missing or modified vision assets:\n${missing.map(asset => asset.path).join('\n')}\nRun node scripts/setup-vision.mjs --download to restore pinned assets.`);
}
if (missing.length) {
  const archiveFiles = missing.some(asset => asset.packageEntry)
    ? packageFiles(await fetchBytes(manifest.package.source)) : new Map();
  for (const asset of missing) {
    const bytes = asset.packageEntry ? archiveFiles.get(asset.packageEntry) : await fetchBytes(asset.source);
    if (!bytes || !checkBytes(asset, bytes)) throw new Error(`Asset integrity mismatch: ${asset.path}`);
    const path = targetPath(asset);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
    console.log(`Restored ${asset.path}`);
  }
}
const bytes = manifest.files.reduce((sum, asset) => sum + asset.bytes, 0);
console.log(`Verified ${manifest.files.length} offline vision assets (${bytes.toLocaleString('en-US')} bytes), MediaPipe ${manifest.package.version}, face model ${manifest.model.version}.`);
