import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  assertPackedDependencyBoundary,
  assertPackedSourceBoundary,
  publicExportSpecifiers,
} from './packed-policy.mjs';

test('enumerates every explicit public subpath', () => {
  assert.deepEqual(
    publicExportSpecifiers({
      name: '@global-torque/sdk',
      exports: { './wallet/turnkey': {}, '.': {}, './auth': {} },
    }),
    ['@global-torque/sdk', '@global-torque/sdk/auth', '@global-torque/sdk/wallet/turnkey'],
  );
  assert.throws(
    () =>
      publicExportSpecifiers({
        name: '@global-torque/sdk',
        exports: { './resources/*': {} },
      }),
    /explicit public subpath/u,
  );
});

test('rejects upper-layer, framework, runtime, app, and workspace dependencies', () => {
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const name of [
      '@global-torque/sdk-runtime',
      '@global-torque/sdk-integrations',
      '@global-torque/app-sdk',
      '@global-torque/tahoe',
      '@webdev' + 'elop-pro/invest-runtime',
      '@capacitor/core',
      '@vue/runtime-core',
      '@angular/core',
      '@nuxt/kit',
      '@sveltejs/kit',
      'pinia',
      'react',
      'react-dom',
      'solid-js',
      'svelte',
      'vue',
      'vue-router',
      'workbox-window',
    ]) {
      assert.throws(
        () => assertPackedDependencyBoundary({ [field]: { [name]: '1.0.0' } }),
        new RegExp(`forbidden ${field} entry`, 'u'),
      );
    }
  }
  assert.throws(
    () => assertPackedDependencyBoundary({ dependencies: { ajv: 'workspace:*' } }),
    /workspace dependency/u,
  );
  assert.doesNotThrow(() =>
    assertPackedDependencyBoundary({ dependencies: { ajv: '^8.20.0', viem: '^2.54.1' } }),
  );
});

test('rejects forbidden coupling in packed JavaScript and declarations', () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-packed-policy-'));
  const privateRuntimeSpecifier = '@webdev' + 'elop-pro/invest-runtime';
  const applicationSpecifier = 'ap' + 'ps/dashboard/runtime';
  try {
    const distDirectory = path.join(temporaryDirectory, 'dist');
    fs.mkdirSync(distDirectory);
    const filePath = path.join(distDirectory, 'index.js');
    const nestedDirectory = path.join(distDirectory, 'nested');
    fs.mkdirSync(nestedDirectory);
    const nestedDeclarationPath = path.join(nestedDirectory, 'index.d.mts');
    const packedScriptDirectory = path.join(temporaryDirectory, 'scripts');
    fs.mkdirSync(packedScriptDirectory);
    const packedScriptPath = path.join(packedScriptDirectory, 'prepack.mjs');
    fs.writeFileSync(filePath, 'export const value = 1;\n');
    fs.writeFileSync(nestedDeclarationPath, 'export declare const value: 1;\n');
    fs.writeFileSync(packedScriptPath, 'export const value = 1;\n');
    assert.doesNotThrow(() => assertPackedSourceBoundary(temporaryDirectory));

    for (const source of [
      'export const value = import.meta.' + 'env.API_URL;',
      "export const value = import.meta['env'].API_URL;",
      'export const value = process.env.API_URL;',
      "export const value = process['env'].API_URL;",
      'export const value = globalThis.process.env.API_URL;',
      "export const value = globalThis['process']['env'].API_URL;",
      'export const value = Deno.env.get("API_URL");',
      "export const value = Deno['env'].get('API_URL');",
      'export const value = Bun.env.API_URL;',
      "export const value = Bun['env'].API_URL;",
      `export { x } from '${privateRuntimeSpecifier}';`,
      "export { x } from '@global-torque/sdk-runtime';",
      "export { x } from '@global-torque/sdk-integrations/wallet/turnkey';",
      "export { x } from '@global-torque/app-sdk';",
      "export { x } from 'vue';",
      "import 'react';",
      "export const router = import('vue-router');",
      "export { x } from '@capacitor/core';",
      `export { x } from '${applicationSpecifier}';`,
    ]) {
      fs.writeFileSync(filePath, source);
      assert.throws(() => assertPackedSourceBoundary(temporaryDirectory), /Packed SDK/u);
    }

    fs.writeFileSync(filePath, 'export const value = 1;\n');
    fs.writeFileSync(nestedDeclarationPath, "export { x } from 'vue';\n");
    assert.throws(() => assertPackedSourceBoundary(temporaryDirectory), /nested/u);

    fs.writeFileSync(nestedDeclarationPath, 'export declare const value: 1;\n');
    fs.writeFileSync(packedScriptPath, 'export const value = process.env.API_URL;\n');
    assert.throws(() => assertPackedSourceBoundary(temporaryDirectory), /scripts/u);
  } finally {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true });
  }
});
