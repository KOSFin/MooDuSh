import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = resolve(root, 'dist');
const outZip = resolve(distDir, 'moodush-extension.zip');

const include = [
  'manifest.json',
  '_locales',
  'css',
  'fonts',
  'html',
  'icons',
  'js',
  'logo_main.png',
  '74d85fb11d53487d88e3.png',
  'LICENSE',
  'README.md'
];

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

await new Promise((resolvePromise, reject) => {
  const zip = spawn('zip', ['-r', outZip, ...include], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  zip.stdout.pipe(createWriteStream(resolve(distDir, 'zip.log')));
  let stderr = '';
  zip.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  zip.on('error', reject);
  zip.on('close', (code) => {
    if (code === 0) {
      resolvePromise();
      return;
    }
    reject(new Error(stderr || `zip exited with ${code}`));
  });
});

console.log(`Built ${outZip}`);
