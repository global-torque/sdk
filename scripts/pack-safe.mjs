import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createSelectedGenerationSnapshot } from './pack-utils.mjs';

const sourcePackageDirectory = path.resolve(import.meta.dirname, '..');
const destinationArgumentIndex = process.argv.indexOf('--pack-destination');
const destinationArgument =
  destinationArgumentIndex >= 0 ? process.argv[destinationArgumentIndex + 1] : undefined;
if (
  destinationArgumentIndex >= 0 &&
  (!destinationArgument || destinationArgument.startsWith('--'))
) {
  throw new Error('--pack-destination requires a directory.');
}
const destinationDirectory = path.resolve(
  process.cwd(),
  destinationArgument ?? sourcePackageDirectory,
);
fs.mkdirSync(destinationDirectory, { recursive: true });

const snapshot = createSelectedGenerationSnapshot(sourcePackageDirectory);
try {
  const result = spawnSync('pnpm', ['pack', '--pack-destination', destinationDirectory], {
    cwd: snapshot.packageDirectory,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error(`pnpm pack failed:\n${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  }
  process.stdout.write(result.stdout ?? '');
} finally {
  fs.rmSync(snapshot.temporaryDirectory, { force: true, recursive: true });
}
