#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const packageDirectory = path.resolve(import.meta.dirname, '..');
const allowDirty = process.argv.includes('--allow-dirty');
const skipBuild = process.argv.includes('--skip-build');
const outputIndex = process.argv.indexOf('--output-dir');
const outputValue = outputIndex >= 0 ? process.argv[outputIndex + 1] : 'release';
if (!outputValue || outputValue.startsWith('--')) {
  throw new Error('--output-dir requires a directory.');
}
const outputDirectory = path.resolve(packageDirectory, outputValue);

const run = (command, arguments_, options = {}) => {
  const result = spawnSync(command, arguments_, {
    cwd: options.cwd ?? packageDirectory,
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${arguments_.join(' ')} failed` +
        (options.capture ? `:\n${result.stdout ?? ''}\n${result.stderr ?? ''}` : ''),
    );
  }
  return String(result.stdout ?? '').trim();
};

const digest = (algorithm, value) => createHash(algorithm).update(value).digest('hex');

const collectFiles = (directory, relativeDirectory = '') =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Release artifact contains a symbolic link: ${relativePath}`);
    }
    if (entry.isDirectory()) return collectFiles(absolutePath, relativePath);
    const contents = fs.readFileSync(absolutePath);
    return [{ path: relativePath, size: contents.length, sha256: digest('sha256', contents) }];
  });

const manifest = JSON.parse(fs.readFileSync(path.join(packageDirectory, 'package.json'), 'utf8'));
if (manifest.private !== false || manifest.license !== 'MIT') {
  throw new Error('Release artifacts require a public, MIT-licensed package manifest.');
}
if (!/^0\.1\.0-alpha\.(?:0|[1-9]\d*)$/u.test(manifest.version)) {
  throw new Error(`Package version is not publishable semver: ${String(manifest.version)}`);
}
if (
  manifest.repository?.url !== 'git+https://github.com/global-torque/sdk.git' ||
  manifest.publishConfig?.access !== 'public' ||
  manifest.publishConfig?.provenance !== true ||
  manifest.publishConfig?.tag !== 'next'
) {
  throw new Error('Release artifacts require the reviewed public repository and publish policy.');
}

const sourceCommit = run('git', ['rev-parse', 'HEAD'], { capture: true });
const sourceStatus = run('git', ['status', '--porcelain=v1', '--', '.'], {
  capture: true,
});
if (sourceStatus && !allowDirty) {
  throw new Error(
    'Package source is dirty. Commit the reviewed source or use --allow-dirty for local evidence.',
  );
}

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'invest-sdk-release-'));
try {
  if (!skipBuild) run('pnpm', ['run', 'build']);
  run(process.execPath, ['scripts/pack-safe.mjs', '--pack-destination', temporaryDirectory]);
  const archives = fs.readdirSync(temporaryDirectory).filter((entry) => entry.endsWith('.tgz'));
  if (archives.length !== 1) {
    throw new Error(`Expected one release tarball, received ${String(archives.length)}.`);
  }

  const archiveName = archives[0];
  const archivePath = path.join(temporaryDirectory, archiveName);
  const archiveContents = fs.readFileSync(archivePath);
  const extractionDirectory = path.join(temporaryDirectory, 'extract');
  fs.mkdirSync(extractionDirectory);
  run('tar', ['-xzf', archivePath, '-C', extractionDirectory]);
  const packedPackage = path.join(extractionDirectory, 'package');
  const packedManifest = JSON.parse(
    fs.readFileSync(path.join(packedPackage, 'package.json'), 'utf8'),
  );
  if (
    packedManifest.name !== manifest.name ||
    packedManifest.version !== manifest.version ||
    packedManifest.private !== false ||
    packedManifest.license !== 'MIT'
  ) {
    throw new Error('Packed manifest differs from the reviewed public package identity.');
  }

  fs.mkdirSync(outputDirectory, { recursive: true });
  const destination = path.join(outputDirectory, archiveName);
  const sidecar = `${destination}.manifest.json`;
  const checksum = `${destination}.sha512`;
  for (const target of [destination, sidecar, checksum]) {
    if (fs.existsSync(target)) {
      throw new Error(`Refusing to replace immutable release output: ${target}`);
    }
  }

  const releaseManifest = {
    schemaVersion: 1,
    package: { name: manifest.name, version: manifest.version },
    source: {
      commit: sourceCommit,
      clean: sourceStatus.length === 0,
    },
    artifact: {
      file: archiveName,
      size: archiveContents.length,
      sha256: digest('sha256', archiveContents),
      sha512: digest('sha512', archiveContents),
    },
    files: collectFiles(packedPackage).sort((left, right) => left.path.localeCompare(right.path)),
  };

  fs.copyFileSync(archivePath, destination, fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(sidecar, `${JSON.stringify(releaseManifest, null, 2)}\n`, {
    flag: 'wx',
  });
  fs.writeFileSync(checksum, `${releaseManifest.artifact.sha512}  ${archiveName}\n`, {
    flag: 'wx',
  });
  process.stdout.write(`${JSON.stringify(releaseManifest, null, 2)}\n`);
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
