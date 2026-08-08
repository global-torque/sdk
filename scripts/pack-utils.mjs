import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  collectGenerationFiles,
  deriveGenerationFacades,
  GENERATION_ID_PATTERN,
  GENERATION_IMPORT_PATTERN,
  readSelectedGeneration,
  verifyGenerationDirectory,
} from './generation-publisher.mjs';

const PREPACK_COMMAND = 'node scripts/assert-packable-output.mjs';
const PREPACK_SUPPORT_PATHS = [
  'scripts/assert-packable-output.mjs',
  'scripts/generation-publisher.mjs',
  'scripts/pack-utils.mjs',
];

const assertContainedRelativePath = (baseDirectory, relativePath) => {
  if (
    typeof relativePath !== 'string' ||
    relativePath.length === 0 ||
    path.isAbsolute(relativePath) ||
    relativePath.includes('\0')
  ) {
    throw new Error(`Invalid Invest SDK package allowlist path: ${String(relativePath)}`);
  }
  const absolutePath = path.resolve(baseDirectory, relativePath);
  const normalizedRelativePath = path.relative(baseDirectory, absolutePath);
  if (
    normalizedRelativePath === '' ||
    normalizedRelativePath.startsWith(`..${path.sep}`) ||
    normalizedRelativePath === '..' ||
    path.isAbsolute(normalizedRelativePath)
  ) {
    throw new Error(`Invest SDK package allowlist path escapes the package: ${relativePath}`);
  }
  return absolutePath;
};

const copyAllowlistedPath = (sourcePackageDirectory, packageDirectory, relativePath) => {
  const sourcePath = assertContainedRelativePath(sourcePackageDirectory, relativePath);
  if (!fs.existsSync(sourcePath)) return;
  const destinationPath = assertContainedRelativePath(packageDirectory, relativePath);
  const stats = fs.lstatSync(sourcePath);
  if (stats.isSymbolicLink()) {
    throw new Error(`Invest SDK package allowlist cannot contain symlinks: ${relativePath}`);
  }
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.cpSync(sourcePath, destinationPath, { recursive: true });
};

const packageAllowlist = (manifest) => {
  if (!Array.isArray(manifest.files) || manifest.files.some((entry) => typeof entry !== 'string')) {
    throw new Error('Invest SDK package manifest must declare a string files allowlist.');
  }
  const allowlist = manifest.files.filter((entry) => entry !== 'dist');
  if (manifest.scripts?.prepack !== undefined) {
    if (manifest.scripts.prepack !== PREPACK_COMMAND) {
      throw new Error(
        `Unsupported Invest SDK prepack command: ${String(manifest.scripts.prepack)}`,
      );
    }
    allowlist.push(...PREPACK_SUPPORT_PATHS);
  }
  return [...new Set(allowlist)].sort();
};

const selectedGenerationFromPackedManifest = (packageDirectory) => {
  const manifest = JSON.parse(fs.readFileSync(path.join(packageDirectory, 'package.json'), 'utf8'));
  const mappedPath = manifest.imports?.[GENERATION_IMPORT_PATTERN];
  const match =
    typeof mappedPath === 'string'
      ? /^\.\/dist\/generations\/([a-f0-9]{64})\/\*$/u.exec(mappedPath)
      : null;
  if (!match || !GENERATION_ID_PATTERN.test(match[1])) {
    throw new Error('Packed Invest SDK generation selector is malformed.');
  }
  return match[1];
};

const expectedOutputFiles = (outputDirectory, selectedGeneration, includeSelector) => {
  const verified = verifyGenerationDirectory(outputDirectory, selectedGeneration);
  const expected = new Set(
    verified.files.map((file) =>
      path.posix.join('generations', selectedGeneration, file.relativePath),
    ),
  );
  for (const relativePath of deriveGenerationFacades(verified.directory).keys()) {
    expected.add(relativePath);
  }
  if (includeSelector) expected.add('package.json');
  return expected;
};

export const assertExpectedOutputFiles = (outputDirectory, selectedGeneration, includeSelector) => {
  const expected = expectedOutputFiles(outputDirectory, selectedGeneration, includeSelector);
  const actual = new Set(collectGenerationFiles(outputDirectory).map((file) => file.relativePath));
  const unexpected = [...actual].filter((relativePath) => !expected.has(relativePath)).sort();
  const missing = [...expected].filter((relativePath) => !actual.has(relativePath)).sort();
  if (unexpected.length > 0 || missing.length > 0) {
    throw new Error(
      'Invest SDK output does not match the selected generation. ' +
        `Unexpected: ${unexpected.join(', ') || 'none'}; ` +
        `missing: ${missing.join(', ') || 'none'}.`,
    );
  }
};

export const assertSingleSelectedGeneration = (packageDirectory) => {
  const outputDirectory = path.join(packageDirectory, 'dist');
  const nestedSelectorPath = path.join(outputDirectory, 'package.json');
  const includeSelector = fs.existsSync(nestedSelectorPath);
  const selectedGeneration = includeSelector
    ? readSelectedGeneration(outputDirectory)
    : selectedGenerationFromPackedManifest(packageDirectory);
  verifyGenerationDirectory(outputDirectory, selectedGeneration);

  const generationsDirectory = path.join(outputDirectory, 'generations');
  const entries = fs.readdirSync(generationsDirectory, { withFileTypes: true });
  const invalidEntry = entries.find((entry) => !entry.isDirectory() || entry.isSymbolicLink());
  if (invalidEntry) {
    throw new Error(
      `Refusing to pack Invest SDK output with invalid generation entry ${invalidEntry.name}.`,
    );
  }
  const generations = entries.map((entry) => entry.name).sort();
  if (generations.length !== 1 || generations[0] !== selectedGeneration) {
    throw new Error(
      `Refusing to pack Invest SDK output with non-selected generations. ` +
        `Selected ${selectedGeneration}; found ${generations.join(', ') || 'none'}. ` +
        'Use pnpm run pack:safe to stage only the selected immutable generation.',
    );
  }
  assertExpectedOutputFiles(outputDirectory, selectedGeneration, includeSelector);
  return selectedGeneration;
};

export const createSelectedGenerationSnapshot = (sourcePackageDirectory) => {
  const sourceOutputDirectory = path.join(sourcePackageDirectory, 'dist');
  const selectedGeneration = readSelectedGeneration(sourceOutputDirectory);
  const verifiedGeneration = verifyGenerationDirectory(sourceOutputDirectory, selectedGeneration);
  const sourceManifest = JSON.parse(
    fs.readFileSync(path.join(sourcePackageDirectory, 'package.json'), 'utf8'),
  );
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'invest-sdk-pack-'));
  const packageDirectory = path.join(temporaryDirectory, 'package');
  try {
    fs.mkdirSync(packageDirectory);

    copyAllowlistedPath(sourcePackageDirectory, packageDirectory, 'package.json');
    for (const relativePath of packageAllowlist(sourceManifest)) {
      copyAllowlistedPath(sourcePackageDirectory, packageDirectory, relativePath);
    }

    const outputDirectory = path.join(packageDirectory, 'dist');
    fs.mkdirSync(outputDirectory);
    for (const [relativePath, contents] of deriveGenerationFacades(verifiedGeneration.directory)) {
      const facadePath = assertContainedRelativePath(outputDirectory, relativePath);
      fs.mkdirSync(path.dirname(facadePath), { recursive: true });
      fs.writeFileSync(facadePath, contents);
    }
    fs.cpSync(
      verifiedGeneration.directory,
      path.join(outputDirectory, 'generations', selectedGeneration),
      { recursive: true },
    );

    const snapshotManifestPath = path.join(packageDirectory, 'package.json');
    const snapshotManifest = JSON.parse(fs.readFileSync(snapshotManifestPath, 'utf8'));
    snapshotManifest.imports = {
      [GENERATION_IMPORT_PATTERN]: `./dist/generations/${selectedGeneration}/*`,
    };
    fs.writeFileSync(snapshotManifestPath, `${JSON.stringify(snapshotManifest, null, 2)}\n`);
    assertSingleSelectedGeneration(packageDirectory);

    return {
      generationId: selectedGeneration,
      packageDirectory,
      temporaryDirectory,
    };
  } catch (error) {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true });
    throw error;
  }
};
