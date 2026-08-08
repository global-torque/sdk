import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import {
  activateGeneration,
  publishCompiledGeneration,
  readSelectedGeneration,
} from './generation-publisher.mjs';
import { assertSingleSelectedGeneration, createSelectedGenerationSnapshot } from './pack-utils.mjs';

const waitArray = new Int32Array(new SharedArrayBuffer(4));
const wait = (milliseconds) => Atomics.wait(waitArray, 0, 0, milliseconds);

const createCompiledFixture = (directory, marker, { includeLegacy = false } = {}) => {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, 'shared.js'),
    `export const generation = ${JSON.stringify(marker)};\n`,
  );
  fs.writeFileSync(
    path.join(directory, 'index.js'),
    "export { generation as indexGeneration } from './shared.js';\n",
  );
  fs.writeFileSync(
    path.join(directory, 'auth.js'),
    "export { generation as authGeneration } from './shared.js';\n",
  );
  fs.writeFileSync(
    path.join(directory, 'shared.d.ts'),
    `export declare const generation: ${JSON.stringify(marker)};\n`,
  );
  fs.writeFileSync(
    path.join(directory, 'index.d.ts'),
    "export { generation as indexGeneration } from './shared.js';\n",
  );
  fs.writeFileSync(
    path.join(directory, 'auth.d.ts'),
    "export { generation as authGeneration } from './shared.js';\n",
  );
  if (includeLegacy) {
    fs.writeFileSync(
      path.join(directory, 'legacy.js'),
      "export { generation as legacyGeneration } from './shared.js';\n",
    );
    fs.writeFileSync(
      path.join(directory, 'legacy.d.ts'),
      "export { generation as legacyGeneration } from './shared.js';\n",
    );
  }
};

const importFixture = async (outputDirectory, pauseMilliseconds) => {
  const root = await import(pathToFileURL(path.join(outputDirectory, 'index.js')).href);
  if (pauseMilliseconds === 'signal') {
    process.stdout.write(`${JSON.stringify({ ready: root.indexGeneration })}\n`);
    await new Promise((resolve) => process.stdin.once('data', resolve));
    const legacy = await import(pathToFileURL(path.join(outputDirectory, 'legacy.js')).href);
    process.stdout.write(
      `${JSON.stringify({
        indexGeneration: root.indexGeneration,
        legacyGeneration: legacy.legacyGeneration,
      })}\n`,
    );
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, Number(pauseMilliseconds)));
  const auth = await import(pathToFileURL(path.join(outputDirectory, 'auth.js')).href);
  process.stdout.write(
    `${JSON.stringify({
      indexGeneration: root.indexGeneration,
      authGeneration: auth.authGeneration,
    })}\n`,
  );
};

const flipFixture = (outputDirectory, firstGeneration, secondGeneration, iterations) => {
  for (let index = 0; index < Number(iterations); index += 1) {
    activateGeneration(outputDirectory, index % 2 === 0 ? firstGeneration : secondGeneration);
    wait(1);
  }
};

const mode = process.argv[2];
if (mode === '--reader') {
  await importFixture(process.argv[3], process.argv[4]);
  process.exit(0);
}
if (mode === '--publisher') {
  flipFixture(process.argv[3], process.argv[4], process.argv[5], process.argv[6]);
  process.exit(0);
}

const runChild = (arguments_) =>
  spawn(process.execPath, [import.meta.filename, ...arguments_], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

const collectChild = (child) =>
  new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`Atomic publication child failed (${String(code)}):\n${stderr}`));
        return;
      }
      resolve(
        stdout
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line)),
      );
    });
  });

const waitForReady = (child) =>
  new Promise((resolve, reject) => {
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      const newline = stdout.indexOf('\n');
      if (newline < 0) return;
      resolve(JSON.parse(stdout.slice(0, newline)));
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      reject(new Error(`Spanning reader exited before its publication signal (${String(code)}).`));
    });
  });

const expectFailure = (action, messagePattern) => {
  try {
    action();
  } catch (error) {
    if (error instanceof Error && messagePattern.test(error.message)) return;
    throw error;
  }
  throw new Error(`Expected failure matching ${String(messagePattern)}.`);
};

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'invest-sdk-generations-'));
try {
  const outputDirectory = path.join(temporaryDirectory, 'dist');
  fs.writeFileSync(
    path.join(temporaryDirectory, 'package.json'),
    `${JSON.stringify({
      name: 'invest-sdk-generation-publication-fixture',
      private: true,
      version: '1.0.0',
      type: 'module',
      files: ['dist'],
    })}\n`,
  );
  const firstCompiledDirectory = path.join(temporaryDirectory, 'compiled-a');
  const secondCompiledDirectory = path.join(temporaryDirectory, 'compiled-b');
  createCompiledFixture(firstCompiledDirectory, 'generation-a', { includeLegacy: true });
  createCompiledFixture(secondCompiledDirectory, 'generation-b');
  const firstGeneration = publishCompiledGeneration(firstCompiledDirectory, outputDirectory);
  const legacyFacadePath = path.join(outputDirectory, 'legacy.js');
  const facadeShadowPath = path.join(temporaryDirectory, 'facade-shadow.js');
  fs.writeFileSync(facadeShadowPath, fs.readFileSync(legacyFacadePath));
  fs.rmSync(legacyFacadePath);
  fs.symlinkSync(path.relative(path.dirname(legacyFacadePath), facadeShadowPath), legacyFacadePath);
  const secondGeneration = publishCompiledGeneration(secondCompiledDirectory, outputDirectory);
  if (firstGeneration === secondGeneration) {
    throw new Error('Adversarial build fixtures did not produce distinct generations.');
  }
  if (
    !fs.existsSync(legacyFacadePath) ||
    !fs.lstatSync(legacyFacadePath).isFile() ||
    fs.lstatSync(legacyFacadePath).isSymbolicLink()
  ) {
    throw new Error('Publishing did not replace a facade symlink with the required regular file.');
  }
  try {
    assertSingleSelectedGeneration(temporaryDirectory);
    throw new Error('Direct pack guard accepted historical generations.');
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('Refusing to pack')) {
      throw error;
    }
  }

  // Existing content-addressed directories are never trusted by name. A
  // corrupt retained generation cannot be selected or silently reused.
  const firstSharedPath = path.join(outputDirectory, 'generations', firstGeneration, 'shared.js');
  const firstSharedSource = fs.readFileSync(firstSharedPath);
  const selectorBeforeCorruptionCheck = fs.readFileSync(
    path.join(outputDirectory, 'package.json'),
    'utf8',
  );
  fs.writeFileSync(firstSharedPath, "export const generation = 'corrupt';\n");
  expectFailure(() => activateGeneration(outputDirectory, firstGeneration), /integrity mismatch/u);
  const replayCompiledDirectory = path.join(temporaryDirectory, 'compiled-a-replay');
  createCompiledFixture(replayCompiledDirectory, 'generation-a', { includeLegacy: true });
  expectFailure(
    () => publishCompiledGeneration(replayCompiledDirectory, outputDirectory),
    /integrity mismatch/u,
  );
  if (
    fs.readFileSync(path.join(outputDirectory, 'package.json'), 'utf8') !==
    selectorBeforeCorruptionCheck
  ) {
    throw new Error('Failed corrupt-generation publication changed the active selector.');
  }
  fs.writeFileSync(firstSharedPath, firstSharedSource);
  if (publishCompiledGeneration(replayCompiledDirectory, outputDirectory) !== firstGeneration) {
    throw new Error('Verified generation reuse changed its content address.');
  }
  activateGeneration(outputDirectory, secondGeneration);

  // Generation ids are parsed and normalized before any candidate path is
  // followed. A syntactically matching traversal selector is rejected.
  fs.writeFileSync(
    path.join(outputDirectory, 'package.json'),
    `${JSON.stringify({
      private: true,
      type: 'module',
      imports: {
        '#invest-sdk-generation/*': './generations/../../src/*',
      },
      investSdkGeneration: '../../src',
    })}\n`,
  );
  expectFailure(() => readSelectedGeneration(outputDirectory), /Invalid Invest SDK generation id/u);
  activateGeneration(outputDirectory, secondGeneration);

  // Snapshot construction cleans its temporary directory on every failure.
  const fixtureManifestPath = path.join(temporaryDirectory, 'package.json');
  const fixtureManifest = fs.readFileSync(fixtureManifestPath, 'utf8');
  const temporaryPackDirectoriesBefore = new Set(
    fs.readdirSync(os.tmpdir()).filter((entry) => entry.startsWith('invest-sdk-pack-')),
  );
  const unsupportedManifest = JSON.parse(fixtureManifest);
  unsupportedManifest.scripts = { prepack: 'node unsupported-prepack.mjs' };
  fs.writeFileSync(fixtureManifestPath, `${JSON.stringify(unsupportedManifest)}\n`);
  expectFailure(
    () => createSelectedGenerationSnapshot(temporaryDirectory),
    /Unsupported Invest SDK prepack command/u,
  );
  fs.writeFileSync(fixtureManifestPath, fixtureManifest);
  const leakedPackDirectories = fs
    .readdirSync(os.tmpdir())
    .filter(
      (entry) => entry.startsWith('invest-sdk-pack-') && !temporaryPackDirectoriesBefore.has(entry),
    );
  if (leakedPackDirectories.length > 0) {
    throw new Error(`Failed pack snapshot leaked: ${leakedPackDirectories.join(', ')}`);
  }

  // A reader that starts before publication and resolves another public
  // subpath that was removed from the new build must remain pinned to its
  // cached package selector.
  activateGeneration(outputDirectory, firstGeneration);
  const spanningReader = runChild(['--reader', outputDirectory, 'signal']);
  const spanningCompletion = collectChild(spanningReader);
  const ready = await waitForReady(spanningReader);
  if (ready.ready !== 'generation-a') {
    throw new Error(`Spanning reader started on unexpected generation: ${String(ready.ready)}`);
  }
  activateGeneration(outputDirectory, secondGeneration);

  // Packaging derives output only from the verified selected generation.
  // Arbitrary live files and old-only facades cannot leak into the archive,
  // while the paused old-generation reader remains resolvable from live output.
  fs.writeFileSync(
    path.join(outputDirectory, 'stale-secret.js'),
    "export const privateBuildSecret = 'must-not-pack';\n",
  );
  const packSnapshot = createSelectedGenerationSnapshot(temporaryDirectory);
  try {
    if (
      packSnapshot.generationId !== secondGeneration ||
      assertSingleSelectedGeneration(packSnapshot.packageDirectory) !== secondGeneration
    ) {
      throw new Error('Pack snapshot did not isolate the selected generation.');
    }
    if (
      fs.existsSync(path.join(packSnapshot.packageDirectory, 'dist', 'stale-secret.js')) ||
      fs.existsSync(path.join(packSnapshot.packageDirectory, 'dist', 'legacy.js'))
    ) {
      throw new Error('Pack snapshot copied a non-selected live facade.');
    }
    const packedSharedPath = path.join(
      packSnapshot.packageDirectory,
      'dist',
      'generations',
      secondGeneration,
      'shared.js',
    );
    const packedSharedSource = fs.readFileSync(packedSharedPath);
    fs.writeFileSync(packedSharedPath, "export const generation = 'packed-corrupt';\n");
    expectFailure(
      () => assertSingleSelectedGeneration(packSnapshot.packageDirectory),
      /integrity mismatch/u,
    );
    fs.writeFileSync(packedSharedPath, packedSharedSource);
    const packDestination = path.join(packSnapshot.temporaryDirectory, 'archive');
    fs.mkdirSync(packDestination);
    const packResult = spawnSync('pnpm', ['pack', '--pack-destination', packDestination], {
      cwd: packSnapshot.packageDirectory,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (packResult.status !== 0) {
      throw new Error(
        `Concurrent selected-generation pack failed:\n${packResult.stdout ?? ''}\n${packResult.stderr ?? ''}`,
      );
    }
    const archive = fs.readdirSync(packDestination).find((entry) => entry.endsWith('.tgz'));
    if (!archive) throw new Error('Concurrent selected-generation pack produced no archive.');
    const archiveList = spawnSync('tar', ['-tzf', path.join(packDestination, archive)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (archiveList.status !== 0) {
      throw new Error(
        `Could not inspect selected-generation archive:\n${archiveList.stderr ?? ''}`,
      );
    }
    if (
      String(archiveList.stdout).includes('stale-secret') ||
      String(archiveList.stdout).includes('/legacy.')
    ) {
      throw new Error('Selected-generation archive contained unallowlisted live output.');
    }
  } finally {
    fs.rmSync(packSnapshot.temporaryDirectory, { force: true, recursive: true });
  }
  spanningReader.stdin.end('continue\n');
  const spanningOutput = await spanningCompletion;
  const spanningResult = spanningOutput.at(-1);
  if (
    spanningResult?.indexGeneration !== 'generation-a' ||
    spanningResult.legacyGeneration !== 'generation-a'
  ) {
    throw new Error(`Reader crossed generations: ${JSON.stringify(spanningResult)}`);
  }

  // New processes repeatedly import two separately exported subpaths while a
  // publisher flips the one selector file between distinguishable generations.
  const publisher = runChild([
    '--publisher',
    outputDirectory,
    firstGeneration,
    secondGeneration,
    '300',
  ]);
  const publisherCompletion = collectChild(publisher);
  const raceReaders = Array.from({ length: 24 }, (_, index) => {
    const reader = runChild(['--reader', outputDirectory, String(index % 7)]);
    return collectChild(reader);
  });
  const raceResults = await Promise.all(raceReaders);
  await publisherCompletion;
  for (const [result] of raceResults) {
    if (
      result?.indexGeneration !== result?.authGeneration ||
      !['generation-a', 'generation-b'].includes(result?.indexGeneration)
    ) {
      throw new Error(`Concurrent import observed a mixed generation: ${JSON.stringify(result)}`);
    }
  }

  // Raw readers see one complete selector and can follow it to a complete,
  // immutable generation even while the selector is being replaced.
  const rawPublisher = runChild([
    '--publisher',
    outputDirectory,
    firstGeneration,
    secondGeneration,
    '300',
  ]);
  const rawPublisherCompletion = collectChild(rawPublisher);
  const markerByGeneration = new Map([
    [firstGeneration, 'generation-a'],
    [secondGeneration, 'generation-b'],
  ]);
  for (let index = 0; index < 2_000; index += 1) {
    const selectedGeneration = readSelectedGeneration(outputDirectory);
    const expectedMarker = markerByGeneration.get(selectedGeneration);
    const generationDirectory = path.join(outputDirectory, 'generations', selectedGeneration);
    const indexSource = fs.readFileSync(path.join(generationDirectory, 'shared.js'), 'utf8');
    if (!indexSource.includes(JSON.stringify(expectedMarker))) {
      throw new Error(`Raw reader followed an incoherent selector: ${selectedGeneration}`);
    }
  }
  await rawPublisherCompletion;

  console.log(
    'Invest SDK generation publication passed: corrupt reuse and traversal failed closed; stale files were excluded; an old-only facade stayed readable; 24 concurrent imports and 2,000 selector reads were coherent.',
  );
} finally {
  fs.rmSync(temporaryDirectory, { force: true, recursive: true });
}
