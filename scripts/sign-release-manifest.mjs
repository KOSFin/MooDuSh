import { createHash, createSign } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const zipPath = resolve(root, 'dist/moodush-extension.zip');
const manifestPath = resolve(root, 'dist/release-manifest.json');
const privateKey = process.env.RELEASE_SIGNING_PRIVATE_KEY || '';

const zip = await readFile(zipPath);
const payload = {
  version: process.env.EXTENSION_VERSION || process.env.npm_package_version || '2.9.4',
  buildId: process.env.BUILD_ID || process.env.GITHUB_SHA || 'local-dev',
  channel: process.env.BUILD_CHANNEL || 'stable',
  repositoryUrl: process.env.REPOSITORY_URL || '',
  releaseUrl: process.env.RELEASE_URL || '',
  artifact: basename(zipPath),
  sha256: createHash('sha256').update(zip).digest('hex'),
  createdAt: new Date().toISOString()
};

let signature = '';
if (privateKey.trim()) {
  const signer = createSign('SHA256');
  signer.update(JSON.stringify(payload));
  signer.end();
  signature = signer.sign(privateKey, 'base64');
}

await writeFile(manifestPath, JSON.stringify({ payload, signature }, null, 2), 'utf8');
console.log(`Wrote ${manifestPath}`);
