import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = resolve(root, 'js/build_config.js');

function env(name, fallback = '') {
  const value = process.env[name];
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

const config = {
  openeduApiBaseUrl: env('OPENEDU_API_BASE_URL', 'https://paramext.ruka.me/api'),
  moodleApiBaseUrl: env('MOODLE_API_BASE_URL', 'https://syncshare.naloaty.me/api'),
  botLink: env('BOT_LINK', 'https://t.me/moodush_bot'),
  telegramChannelLink: env('TELEGRAM_CHANNEL_LINK', 'https://t.me/moodush_news'),
  repositoryUrl: env('REPOSITORY_URL', env('GITHUB_SERVER_URL') && env('GITHUB_REPOSITORY')
    ? `${env('GITHUB_SERVER_URL')}/${env('GITHUB_REPOSITORY')}`
    : 'https://github.com/KOSFin/MooDuSh-from-syncshare'),
  updateCheckUrl: env('UPDATE_CHECK_URL', ''),
  buildChannel: env('BUILD_CHANNEL', env('GITHUB_ACTIONS') ? (env('GITHUB_REF_TYPE') === 'tag' ? 'stable' : 'dev') : 'local'),
  buildId: env('BUILD_ID', env('GITHUB_SHA', 'local-dev')),
  parserVersion: env('OPENEDU_PARSER_VERSION', 'openedu-parser-v2.0.0'),
  releasePublicKey: env('RELEASE_PUBLIC_KEY', '')
};

const source = `(function (global) {
    global.ParamExtBuildConfig = ${JSON.stringify(config, null, 8).replace(/\n/g, '\n    ')};
})(globalThis);
`;

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, source, 'utf8');
console.log(`Generated ${outputPath}`);
