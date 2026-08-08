import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const packageDirectory = path.resolve(import.meta.dirname, '..');
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'invest-sdk-package-lint-'));
const archiveIndex = process.argv.indexOf('--archive');
const archiveValue = archiveIndex >= 0 ? process.argv[archiveIndex + 1] : undefined;
if (archiveIndex >= 0 && (!archiveValue || archiveValue.startsWith('--'))) {
  throw new Error('--archive requires an npm tarball.');
}

const run = (command, arguments_) => {
  const result = spawnSync(command, arguments_, {
    cwd: packageDirectory,
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${arguments_.join(' ')} failed.`);
  }
};

try {
  let archivePath;
  if (archiveValue) {
    archivePath = path.resolve(process.cwd(), archiveValue);
    if (!fs.statSync(archivePath).isFile() || !archivePath.endsWith('.tgz')) {
      throw new Error(`Not an npm tarball: ${archivePath}`);
    }
  } else {
    run(process.execPath, ['scripts/pack-safe.mjs', '--pack-destination', temporaryDirectory]);
    const archive = fs.readdirSync(temporaryDirectory).find((entry) => entry.endsWith('.tgz'));
    if (!archive) throw new Error('Safe Invest SDK pack did not create an archive.');
    archivePath = path.join(temporaryDirectory, archive);
  }
  run('pnpm', ['exec', 'publint', archivePath]);
  run('pnpm', [
    'exec',
    'attw',
    archivePath,
    '--profile',
    'esm-only',
    '--ignore-rules',
    'internal-resolution-error',
    'no-resolution',
  ]);
} finally {
  fs.rmSync(temporaryDirectory, { force: true, recursive: true });
}
