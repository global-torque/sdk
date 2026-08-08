import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

export const GENERATIONS_DIRECTORY_NAME = 'generations';
export const GENERATION_IMPORT_PATTERN = '#invest-sdk-generation/*';
export const GENERATION_ID_PATTERN = /^[a-f0-9]{64}$/u;

export const collectGenerationFiles = (directory, relativeDirectory = '') => {
  const files = [];
  for (const entry of fs.readdirSync(directory).sort()) {
    const absolutePath = path.join(directory, entry);
    const relativePath = path.posix.join(relativeDirectory, entry);
    const stats = fs.lstatSync(absolutePath);
    if (stats.isDirectory() && !stats.isSymbolicLink()) {
      files.push(...collectGenerationFiles(absolutePath, relativePath));
      continue;
    }
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new Error(`Compiled SDK output must contain regular files only: ${relativePath}`);
    }
    files.push({ absolutePath, relativePath });
  }
  return files;
};

export const generationIdFor = (directory) => {
  const hash = createHash('sha256');
  for (const file of collectGenerationFiles(directory)) {
    hash.update(`path\0${file.relativePath}\0`);
    hash.update(fs.readFileSync(file.absolutePath));
    hash.update('\0');
  }
  return hash.digest('hex');
};

const assertValidGenerationId = (generationId) => {
  if (typeof generationId !== 'string' || !GENERATION_ID_PATTERN.test(generationId)) {
    throw new Error(`Invalid Invest SDK generation id: ${String(generationId)}`);
  }
};

export const resolveGenerationDirectory = (outputDirectory, generationId) => {
  assertValidGenerationId(generationId);
  const generationsDirectory = path.resolve(outputDirectory, GENERATIONS_DIRECTORY_NAME);
  const generationDirectory = path.resolve(generationsDirectory, generationId);
  if (path.dirname(generationDirectory) !== generationsDirectory) {
    throw new Error(`Invest SDK generation path escapes its output directory: ${generationId}`);
  }
  return generationDirectory;
};

export const verifyGenerationDirectory = (outputDirectory, generationId) => {
  const generationDirectory = resolveGenerationDirectory(outputDirectory, generationId);
  let stats;
  try {
    stats = fs.lstatSync(generationDirectory);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new Error(`Invest SDK generation is missing: ${generationId}`, { cause: error });
    }
    throw error;
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`Invest SDK generation must be a real directory: ${generationId}`);
  }
  const actualGenerationId = generationIdFor(generationDirectory);
  if (actualGenerationId !== generationId) {
    throw new Error(
      `Invest SDK generation integrity mismatch: expected ${generationId}, ` +
        `computed ${actualGenerationId}.`,
    );
  }
  return {
    directory: generationDirectory,
    files: collectGenerationFiles(generationDirectory),
    generationId,
  };
};

const atomicWriteFile = (filePath, contents) => {
  const temporaryPath = `${filePath}.next-${String(process.pid)}-${randomUUID()}`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  try {
    fs.writeFileSync(temporaryPath, contents, { flag: 'wx' });
    fs.renameSync(temporaryPath, filePath);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
};

const facadeTargetFor = (relativePath) => {
  if (relativePath.endsWith('.d.ts')) {
    return `${relativePath.slice(0, -'.d.ts'.length)}.js`;
  }
  return relativePath.endsWith('.js') ? relativePath : undefined;
};

export const deriveGenerationFacades = (generationDirectory) => {
  const facades = new Map();
  for (const file of collectGenerationFiles(generationDirectory)) {
    const target = facadeTargetFor(file.relativePath);
    if (target === undefined) continue;
    const facade = `export * from '${GENERATION_IMPORT_PATTERN.slice(0, -1)}${target}';\n`;
    facades.set(file.relativePath, facade);
  }
  return facades;
};

const mergeFacade = (facades, relativePath, contents, generationId) => {
  const previous = facades.get(relativePath);
  if (previous !== undefined && previous !== contents) {
    throw new Error(
      `Invest SDK generations disagree on stable facade ${relativePath}: ${generationId}.`,
    );
  }
  facades.set(relativePath, contents);
};

const removeUnexpectedFacades = (directory, outputDirectory, facadePaths) => {
  for (const entry of fs.readdirSync(directory).sort()) {
    if (
      directory === outputDirectory &&
      (entry === GENERATIONS_DIRECTORY_NAME || entry === 'package.json')
    ) {
      continue;
    }
    const entryPath = path.join(directory, entry);
    const stats = fs.lstatSync(entryPath);
    if (stats.isDirectory() && !stats.isSymbolicLink()) {
      removeUnexpectedFacades(entryPath, outputDirectory, facadePaths);
      if (fs.readdirSync(entryPath).length === 0) fs.rmdirSync(entryPath);
      continue;
    }
    if (!facadePaths.has(path.resolve(entryPath))) fs.rmSync(entryPath, { force: true });
  }
};

const writeStableFacadeUnion = (outputDirectory) => {
  const generationsDirectory = path.join(outputDirectory, GENERATIONS_DIRECTORY_NAME);
  const facades = new Map();
  for (const entry of fs.readdirSync(generationsDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw new Error(`Invest SDK generations directory contains an invalid entry: ${entry.name}`);
    }
    const verified = verifyGenerationDirectory(outputDirectory, entry.name);
    for (const [relativePath, contents] of deriveGenerationFacades(verified.directory)) {
      mergeFacade(facades, relativePath, contents, entry.name);
    }
  }

  const facadePaths = new Set();
  for (const [relativePath, contents] of facades) {
    const facadePath = path.join(outputDirectory, relativePath);
    facadePaths.add(path.resolve(facadePath));
    let isExpectedRegularFile = false;
    if (fs.existsSync(facadePath)) {
      const stats = fs.lstatSync(facadePath);
      isExpectedRegularFile =
        stats.isFile() &&
        !stats.isSymbolicLink() &&
        fs.readFileSync(facadePath, 'utf8') === contents;
    }
    if (!isExpectedRegularFile) {
      atomicWriteFile(facadePath, contents);
    }
  }
  removeUnexpectedFacades(outputDirectory, outputDirectory, facadePaths);
};

const selectorContents = (generationId) => {
  assertValidGenerationId(generationId);
  return `${JSON.stringify(
    {
      private: true,
      type: 'module',
      imports: {
        [GENERATION_IMPORT_PATTERN]: `./${GENERATIONS_DIRECTORY_NAME}/${generationId}/*`,
      },
      investSdkGeneration: generationId,
    },
    null,
    2,
  )}\n`;
};

const assertDirectoriesEqual = (firstDirectory, secondDirectory) => {
  const firstFiles = collectGenerationFiles(firstDirectory);
  const secondFiles = collectGenerationFiles(secondDirectory);
  if (
    firstFiles.length !== secondFiles.length ||
    firstFiles.some((file, index) => file.relativePath !== secondFiles[index]?.relativePath)
  ) {
    throw new Error('Existing Invest SDK generation does not match the compiled file set.');
  }
  for (let index = 0; index < firstFiles.length; index += 1) {
    if (
      !fs
        .readFileSync(firstFiles[index].absolutePath)
        .equals(fs.readFileSync(secondFiles[index].absolutePath))
    ) {
      throw new Error(
        `Existing Invest SDK generation content differs: ${firstFiles[index].relativePath}`,
      );
    }
  }
};

export const activateGeneration = (outputDirectory, generationId) => {
  verifyGenerationDirectory(outputDirectory, generationId);
  atomicWriteFile(path.join(outputDirectory, 'package.json'), selectorContents(generationId));
};

export const publishCompiledGeneration = (compiledDirectory, outputDirectory) => {
  const generationId = generationIdFor(compiledDirectory);
  const generationsDirectory = path.join(outputDirectory, GENERATIONS_DIRECTORY_NAME);
  const generationDirectory = resolveGenerationDirectory(outputDirectory, generationId);
  fs.mkdirSync(generationsDirectory, { recursive: true });

  if (fs.existsSync(generationDirectory)) {
    verifyGenerationDirectory(outputDirectory, generationId);
    assertDirectoriesEqual(compiledDirectory, generationDirectory);
    fs.rmSync(compiledDirectory, { force: true, recursive: true });
  } else {
    fs.renameSync(compiledDirectory, generationDirectory);
    verifyGenerationDirectory(outputDirectory, generationId);
  }

  // Stable facades are the union required by every retained immutable
  // generation. This keeps readers pinned to an older selector resolvable.
  writeStableFacadeUnion(outputDirectory);
  activateGeneration(outputDirectory, generationId);
  return generationId;
};

export const readSelectedGeneration = (outputDirectory) => {
  const selector = JSON.parse(fs.readFileSync(path.join(outputDirectory, 'package.json'), 'utf8'));
  const generationId = selector.investSdkGeneration;
  assertValidGenerationId(generationId);
  const mappedPath = selector.imports?.[GENERATION_IMPORT_PATTERN];
  if (mappedPath !== `./${GENERATIONS_DIRECTORY_NAME}/${generationId}/*`) {
    throw new Error('Invest SDK output selector is malformed.');
  }
  verifyGenerationDirectory(outputDirectory, generationId);
  return generationId;
};
