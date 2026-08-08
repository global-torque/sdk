#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const packageDirectory = path.resolve(import.meta.dirname, '..');
const directoryIndex = process.argv.indexOf('--directory');
const directoryValue = directoryIndex >= 0 ? process.argv[directoryIndex + 1] : undefined;
const tagIndex = process.argv.indexOf('--tag');
const tagValue = tagIndex >= 0 ? process.argv[tagIndex + 1] : undefined;
if (!directoryValue || directoryValue.startsWith('--')) {
  throw new Error('--directory requires a release directory.');
}
if (!tagValue || tagValue.startsWith('--')) throw new Error('--tag requires a release tag.');

const releaseDirectory = path.resolve(process.cwd(), directoryValue);
const digest = (algorithm, value) => createHash(algorithm).update(value).digest('hex');
const run = (command, arguments_, options = {}) => {
  const result = spawnSync(command, arguments_, {
    cwd: options.cwd ?? packageDirectory,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${arguments_.join(' ')} failed:\n${result.stdout ?? ''}\n${result.stderr ?? ''}`,
    );
  }
  return String(result.stdout ?? '').trim();
};

const collectFiles = (directory, relativeDirectory = '') =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Release archive contains a symbolic link: ${relativePath}`);
    }
    if (entry.isDirectory()) return collectFiles(absolutePath, relativePath);
    const contents = fs.readFileSync(absolutePath);
    return [{ path: relativePath, size: contents.length, sha256: digest('sha256', contents) }];
  });

const entries = fs.readdirSync(releaseDirectory).sort();
const archives = entries.filter((entry) => entry.endsWith('.tgz'));
if (archives.length !== 1) {
  throw new Error(`Expected one release tarball, received ${String(archives.length)}.`);
}
const archiveName = archives[0];
const archivePath = path.join(releaseDirectory, archiveName);
const sidecarPath = `${archivePath}.manifest.json`;
const checksumPath = `${archivePath}.sha512`;
const expectedEntries = [
  archiveName,
  path.basename(sidecarPath),
  path.basename(checksumPath),
].sort();
if (JSON.stringify(entries) !== JSON.stringify(expectedEntries)) {
  throw new Error(`Unexpected release files: ${entries.join(', ') || 'none'}.`);
}

const archiveContents = fs.readFileSync(archivePath);
const sha256 = digest('sha256', archiveContents);
const sha512 = digest('sha512', archiveContents);
const expectedChecksum = `${sha512}  ${archiveName}\n`;
if (fs.readFileSync(checksumPath, 'utf8') !== expectedChecksum) {
  throw new Error('Release SHA-512 sidecar does not match the tarball.');
}

const releaseManifest = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
const sourceCommit = run('git', ['rev-parse', 'HEAD']);
if (
  releaseManifest.schemaVersion !== 1 ||
  releaseManifest.package?.name !== '@global-torque/sdk' ||
  `v${String(releaseManifest.package?.version)}` !== tagValue ||
  releaseManifest.source?.commit !== sourceCommit ||
  releaseManifest.source?.clean !== true ||
  releaseManifest.artifact?.file !== archiveName ||
  releaseManifest.artifact?.size !== archiveContents.length ||
  releaseManifest.artifact?.sha256 !== sha256 ||
  releaseManifest.artifact?.sha512 !== sha512
) {
  throw new Error('Release manifest does not match the tag, source commit, or tarball.');
}

const archiveEntries = run('tar', ['-tzf', archivePath]).split('\n').filter(Boolean);
if (
  archiveEntries.some(
    (entry) =>
      !entry.startsWith('package/') ||
      entry.includes('/../') ||
      entry.endsWith('/..') ||
      path.posix.isAbsolute(entry),
  )
) {
  throw new Error('Release archive contains a path outside package/.');
}

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'invest-sdk-release-verify-'));
try {
  run('tar', ['-xzf', archivePath, '-C', temporaryDirectory]);
  const packedPackage = path.join(temporaryDirectory, 'package');
  const packedManifest = JSON.parse(
    fs.readFileSync(path.join(packedPackage, 'package.json'), 'utf8'),
  );
  if (
    packedManifest.name !== releaseManifest.package.name ||
    packedManifest.version !== releaseManifest.package.version ||
    packedManifest.private !== false ||
    packedManifest.license !== 'MIT'
  ) {
    throw new Error('Packed manifest does not match the reviewed release identity.');
  }
  const actualFiles = collectFiles(packedPackage).sort((left, right) =>
    left.path.localeCompare(right.path),
  );
  if (JSON.stringify(actualFiles) !== JSON.stringify(releaseManifest.files)) {
    throw new Error('Release per-file manifest does not match the tarball contents.');
  }
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}

console.info(`Verified exact release bundle for ${tagValue} at ${sourceCommit}.`);
