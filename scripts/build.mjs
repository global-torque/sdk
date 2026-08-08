import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { publishCompiledGeneration } from './generation-publisher.mjs';

const packageDirectory = path.resolve(import.meta.dirname, '..');
const outputDirectory = path.join(packageDirectory, 'dist');
const temporaryOutputDirectory = path.join(packageDirectory, `.dist-build-${String(process.pid)}`);
const buildLockDirectory = path.join(packageDirectory, '.dist-build.lock');
const buildLockCandidateDirectory = `${buildLockDirectory}.candidate-${String(process.pid)}`;
const buildLockDeadline = Date.now() + 120_000;
const buildLockWaiter = new Int32Array(new SharedArrayBuffer(4));

const acquireBuildLock = () => {
  for (;;) {
    fs.rmSync(buildLockCandidateDirectory, { force: true, recursive: true });
    fs.mkdirSync(buildLockCandidateDirectory);
    fs.writeFileSync(
      path.join(buildLockCandidateDirectory, 'owner.json'),
      `${JSON.stringify({ pid: process.pid })}\n`,
    );
    try {
      fs.renameSync(buildLockCandidateDirectory, buildLockDirectory);
      return;
    } catch (error) {
      fs.rmSync(buildLockCandidateDirectory, { force: true, recursive: true });
      if (
        !error ||
        typeof error !== 'object' ||
        !('code' in error) ||
        (error.code !== 'EEXIST' && error.code !== 'ENOTEMPTY')
      ) {
        throw error;
      }
    }

    let ownerPid;
    try {
      const owner = JSON.parse(
        fs.readFileSync(path.join(buildLockDirectory, 'owner.json'), 'utf8'),
      );
      ownerPid = Number(owner.pid);
    } catch {
      throw new Error(
        'Invest SDK build lock is incomplete; remove packages/invest-sdk/.dist-build.lock if no build is running.',
      );
    }

    let ownerIsRunning = false;
    try {
      process.kill(ownerPid, 0);
      ownerIsRunning = true;
    } catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ESRCH') {
        throw error;
      }
    }
    if (ownerIsRunning) {
      if (Date.now() >= buildLockDeadline) {
        throw new Error(`Timed out waiting for Invest SDK build ${String(ownerPid)}.`);
      }
      Atomics.wait(buildLockWaiter, 0, 0, 100);
      continue;
    }

    const staleLockDirectory = `${buildLockDirectory}.stale-${String(process.pid)}`;
    try {
      fs.rmSync(staleLockDirectory, { force: true, recursive: true });
      fs.renameSync(buildLockDirectory, staleLockDirectory);
      fs.rmSync(staleLockDirectory, { force: true, recursive: true });
    } catch (error) {
      if (
        !error ||
        typeof error !== 'object' ||
        !('code' in error) ||
        (error.code !== 'ENOENT' && error.code !== 'EEXIST')
      ) {
        throw error;
      }
    }
  }
};

acquireBuildLock();
try {
  fs.rmSync(temporaryOutputDirectory, { force: true, recursive: true });
  const result = spawnSync(
    'pnpm',
    ['exec', 'tsc', '-p', 'tsconfig.build.json', '--outDir', temporaryOutputDirectory],
    {
      cwd: packageDirectory,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  if (result.status !== 0) {
    throw new Error(`TypeScript build failed:\n${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  }

  // The complete compiler output becomes an immutable content-addressed
  // generation. One atomic selector-file replacement publishes every runtime
  // and declaration subpath together while earlier generations remain readable.
  publishCompiledGeneration(temporaryOutputDirectory, outputDirectory);
} finally {
  fs.rmSync(temporaryOutputDirectory, { force: true, recursive: true });
  fs.rmSync(buildLockCandidateDirectory, { force: true, recursive: true });
  fs.rmSync(buildLockDirectory, { force: true, recursive: true });
}
