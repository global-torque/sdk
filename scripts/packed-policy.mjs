import fs from 'node:fs';
import path from 'node:path';

const FORBIDDEN_EXACT_DEPENDENCIES = new Set([
  '@global-torque/app-sdk',
  '@global-torque/sdk-integrations',
  '@global-torque/sdk-runtime',
  '@global-torque/tahoe',
  'nuxt',
  'pinia',
  'react',
  'react-dom',
  'solid-js',
  'svelte',
  'vue',
  'vue-router',
]);

const FORBIDDEN_SOURCE_PATTERNS = [
  [
    'application environment',
    /\b(?:import\.meta|process|globalThis(?:\.process|\[['"]process['"]\]))(?:\.env|\[['"]env['"]\])/u,
  ],
  ['Deno environment', /\bDeno(?:\.env|\[['"]env['"]\])/u],
  ['Bun environment', /\bBun(?:\.env|\[['"]env['"]\])/u],
  ['private first-party package', new RegExp('@webdev' + 'elop-pro/', 'u')],
  ['Global Torque upper-layer package', /@global-torque\//u],
  [
    'application source alias',
    /(?:from\s+|import\s*(?:\(\s*)?|require\s*\(\s*)['"](?:@\/|~\/|apps\/)/u,
  ],
  [
    'framework import',
    /(?:from\s+|import\s*(?:\(\s*)?|require\s*\(\s*)['"](?:vue(?:-router)?|pinia|nuxt|react(?:-dom)?|solid-js|svelte|@angular\/|@nuxt\/|@sveltejs\/|@vue\/)/u,
  ],
  [
    'runtime import',
    /(?:from\s+|import\s*(?:\(\s*)?|require\s*\(\s*)['"](?:@capacitor\/|workbox-)/u,
  ],
];

const walkPackedCode = (directory) => {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkPackedCode(absolutePath));
    else if (entry.isFile() && /(?:\.cjs|\.d\.(?:cts|mts|ts)|\.js|\.mjs)$/u.test(entry.name)) {
      files.push(absolutePath);
    }
  }
  return files;
};

export const publicExportSpecifiers = (manifest) => {
  if (
    !manifest?.exports ||
    typeof manifest.exports !== 'object' ||
    Array.isArray(manifest.exports)
  ) {
    throw new Error('Packed SDK exports must be an object.');
  }
  return Object.keys(manifest.exports)
    .sort()
    .map((subpath) => {
      if (subpath === '.') return manifest.name;
      if (!subpath.startsWith('./') || subpath.includes('*')) {
        throw new Error(`Packed SDK export is not an explicit public subpath: ${subpath}`);
      }
      return `${manifest.name}/${subpath.slice(2)}`;
    });
};

export const assertPackedDependencyBoundary = (manifest) => {
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const [name, version] of Object.entries(manifest[field] ?? {})) {
      if (String(version).startsWith('workspace:')) {
        throw new Error(`Packed SDK contains a workspace dependency: ${name}`);
      }
      if (
        FORBIDDEN_EXACT_DEPENDENCIES.has(name) ||
        name.startsWith('@global-torque/') ||
        name.startsWith('@webdev' + 'elop-pro/') ||
        name.startsWith('@capacitor/') ||
        name.startsWith('@angular/') ||
        name.startsWith('@nuxt/') ||
        name.startsWith('@sveltejs/') ||
        name.startsWith('@vue/') ||
        name.startsWith('workbox-')
      ) {
        throw new Error(`Packed SDK contains forbidden ${field} entry: ${name}`);
      }
    }
  }
};

export const assertPackedSourceBoundary = (packageDirectory) => {
  const distDirectory = path.join(packageDirectory, 'dist');
  if (!fs.statSync(distDirectory).isDirectory()) {
    throw new Error('Packed SDK dist directory is missing.');
  }
  for (const filePath of walkPackedCode(packageDirectory)) {
    const source = fs.readFileSync(filePath, 'utf8');
    for (const [label, pattern] of FORBIDDEN_SOURCE_PATTERNS) {
      if (pattern.test(source)) {
        throw new Error(
          `Packed SDK ${label} coupling found in ${path.relative(packageDirectory, filePath)}.`,
        );
      }
    }
  }
};
