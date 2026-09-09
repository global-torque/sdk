import fs from 'node:fs';
import path from 'node:path';
import { publishTagForVersion } from './public-package-version-policy.mjs';

const packageDirectory = path.resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(
  fs.readFileSync(path.join(packageDirectory, 'package.json'), 'utf8'),
);
const failures = [];

const requiredDocuments = [
  'README.md',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'MIGRATION.md',
  'NOTICE.md',
  'SECURITY.md',
  'SUPPORT.md',
  'etc/invest-sdk.api.md',
];

for (const document of requiredDocuments) {
  const documentPath = path.join(packageDirectory, document);
  if (!fs.existsSync(documentPath) || fs.statSync(documentPath).size === 0) {
    failures.push(`missing or empty required document: ${document}`);
  }
  if (!packageJson.files.includes(document)) {
    failures.push(`package files allowlist omits required document: ${document}`);
  }
}

const requiredExports = [
  '.',
  './auth',
  './errors',
  './pagination',
  './resources/auth',
  './resources/evm',
  './resources/analytics',
  './resources/distributions',
  './resources/esign',
  './resources/filer',
  './resources/forms',
  './resources/fund-manager',
  './resources/invitations',
  './resources/notifications',
  './resources/offers',
  './resources/investments',
  './resources/profiles',
  './resources/users',
  './resources/vault',
  './testing',
  './types',
  './wallet/eip7702',
  './wallet/turnkey',
  './wallet/sponsored-calls',
];
for (const subpath of requiredExports) {
  if (!packageJson.exports[subpath]) failures.push(`missing explicit package export: ${subpath}`);
}

if (packageJson.private !== false) failures.push('public package must declare private: false');
if (packageJson.license !== 'MIT') failures.push('public package license must be MIT');
if (packageJson.publishConfig?.access !== 'public') {
  failures.push('public package must declare publishConfig.access: public');
}
if (
  packageJson.publishConfig?.provenance !== true ||
  packageJson.publishConfig?.tag !== publishTagForVersion(packageJson.version)
) {
  failures.push(
    'public package must preserve provenance and the version-appropriate publication tag',
  );
}
if (!packageJson.repository?.url?.includes('global-torque/sdk')) {
  failures.push('repository metadata must point to global-torque/sdk');
}

const readme = fs.readFileSync(path.join(packageDirectory, 'README.md'), 'utf8');
for (const requiredStatement of [
  'does not assert server idempotency',
  'Response validators run synchronously',
  '`result.metadata`',
  '`resolveResponseSource`',
  '`maxPages` and `maxItems`',
  '`@global-torque/sdk/resources/evm`',
  '`@global-torque/sdk/resources/investments`',
  '`@global-torque/sdk/wallet/sponsored-calls`',
  '`@global-torque/sdk/wallet/eip7702`',
  '`@global-torque/sdk/wallet/turnkey`',
  'MIT',
]) {
  if (!readme.includes(requiredStatement)) {
    failures.push(`README is missing contract statement: ${requiredStatement}`);
  }
}

const apiReport = fs.readFileSync(path.join(packageDirectory, 'etc/invest-sdk.api.md'), 'utf8');
if (!apiReport.startsWith('## API Report File for "@global-torque/sdk"')) {
  failures.push('API report does not contain the generated package header');
}

if (failures.length > 0) {
  throw new Error(`Invest SDK documentation gate failed:\n- ${failures.join('\n- ')}`);
}

console.info(`Invest SDK documentation gate passed for ${requiredDocuments.length} documents.`);
