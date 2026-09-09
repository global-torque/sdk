import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { assertSingleSelectedGeneration } from './pack-utils.mjs';
import { publishTagForVersion } from './public-package-version-policy.mjs';
import {
  assertPackedDependencyBoundary,
  assertPackedSourceBoundary,
  publicExportSpecifiers,
} from './packed-policy.mjs';

const packageDirectory = path.resolve(import.meta.dirname, '..');
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'invest-sdk-consumer-'));
const expectedLicense = fs.readFileSync(path.join(packageDirectory, 'LICENSE'), 'utf8');
const expectedManifest = JSON.parse(
  fs.readFileSync(path.join(packageDirectory, 'package.json'), 'utf8'),
);
const archiveIndex = process.argv.indexOf('--archive');
const archiveValue = archiveIndex >= 0 ? process.argv[archiveIndex + 1] : undefined;
if (archiveIndex >= 0 && (!archiveValue || archiveValue.startsWith('--'))) {
  throw new Error('--archive requires an npm tarball.');
}

const run = (command, arguments_, cwd) => {
  const result = spawnSync(command, arguments_, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${arguments_.join(' ')} failed:\n${result.stdout ?? ''}\n${result.stderr ?? ''}`,
    );
  }
  return result.stdout ?? '';
};

try {
  let archivePath;
  if (archiveValue) {
    archivePath = path.resolve(process.cwd(), archiveValue);
    if (!fs.statSync(archivePath).isFile() || !archivePath.endsWith('.tgz')) {
      throw new Error(`Not an npm tarball: ${archivePath}`);
    }
  } else {
    run(
      process.execPath,
      ['scripts/pack-safe.mjs', '--pack-destination', temporaryDirectory],
      packageDirectory,
    );
    const archive = fs.readdirSync(temporaryDirectory).find((entry) => entry.endsWith('.tgz'));
    if (!archive) throw new Error('pnpm pack did not create an archive.');
    archivePath = path.join(temporaryDirectory, archive);
  }

  const consumerDirectory = path.join(temporaryDirectory, 'consumer');
  fs.mkdirSync(consumerDirectory);
  fs.writeFileSync(
    path.join(consumerDirectory, 'package.json'),
    JSON.stringify({ private: true, type: 'module' }),
  );
  run('pnpm', ['add', '--ignore-scripts', archivePath], consumerDirectory);
  const installedPackageDirectory = path.join(consumerDirectory, 'node_modules/@global-torque/sdk');
  const installedManifest = JSON.parse(
    fs.readFileSync(path.join(installedPackageDirectory, 'package.json'), 'utf8'),
  );
  const packedGeneration = assertSingleSelectedGeneration(installedPackageDirectory);
  if (!/^[a-f0-9]{64}$/u.test(packedGeneration)) {
    throw new Error(`Packed SDK generation is not content-addressed: ${packedGeneration}`);
  }
  if (
    installedManifest.name !== expectedManifest.name ||
    installedManifest.version !== expectedManifest.version ||
    installedManifest.private !== false ||
    installedManifest.license !== 'MIT' ||
    installedManifest.repository?.url !== expectedManifest.repository.url ||
    installedManifest.publishConfig?.access !== 'public' ||
    installedManifest.publishConfig?.provenance !== true ||
    installedManifest.publishConfig?.tag !== publishTagForVersion(installedManifest.version) ||
    JSON.stringify(Object.keys(installedManifest.exports).sort()) !==
      JSON.stringify(Object.keys(expectedManifest.exports).sort())
  ) {
    throw new Error('Packed SDK identity, exports, or public release metadata changed.');
  }
  assertPackedDependencyBoundary(installedManifest);
  assertPackedSourceBoundary(installedPackageDirectory);
  const exportSpecifiers = publicExportSpecifiers(installedManifest);
  const packedLicense = fs.readFileSync(path.join(installedPackageDirectory, 'LICENSE'), 'utf8');
  if (packedLicense !== expectedLicense || !packedLicense.startsWith('MIT License')) {
    throw new Error('Packed SDK license does not match the MIT package license.');
  }
  fs.writeFileSync(
    path.join(consumerDirectory, 'verify.ts'),
    `import * as sdk from '@global-torque/sdk';
	import * as auth from '@global-torque/sdk/auth';
	import * as resourceAuth from '@global-torque/sdk/resources/auth';
	import * as analytics from '@global-torque/sdk/resources/analytics';
	import * as distributions from '@global-torque/sdk/resources/distributions';
	import * as esign from '@global-torque/sdk/resources/esign';
	import * as evm from '@global-torque/sdk/resources/evm';
	import * as filer from '@global-torque/sdk/resources/filer';
	import * as forms from '@global-torque/sdk/resources/forms';
	import * as fundManager from '@global-torque/sdk/resources/fund-manager';
	import * as invitations from '@global-torque/sdk/resources/invitations';
	import * as notifications from '@global-torque/sdk/resources/notifications';
	import * as offers from '@global-torque/sdk/resources/offers';
	import * as investments from '@global-torque/sdk/resources/investments';
	import * as profiles from '@global-torque/sdk/resources/profiles';
	import * as users from '@global-torque/sdk/resources/users';
	import * as vault from '@global-torque/sdk/resources/vault';
	import * as errors from '@global-torque/sdk/errors';
	import * as pagination from '@global-torque/sdk/pagination';
	import * as testing from '@global-torque/sdk/testing';
	import * as eip7702 from '@global-torque/sdk/wallet/eip7702';
	import * as turnkey from '@global-torque/sdk/wallet/turnkey';
	import * as sponsoredCalls from '@global-torque/sdk/wallet/sponsored-calls';
	import type * as contracts from '@global-torque/sdk/types';

const config = {
  apiKey: 'synthetic_type_key',
	services: {
	  investments: { baseUrl: 'https://api.example.test/' },
	  downloads: {
	    baseUrl: 'https://downloads.example.test/',
	    applicationAuth: 'none',
	    auth: { kind: 'none', credentials: 'omit' },
	  },
	},
	} satisfies contracts.InvestSdkTransportConfig;
	const transport: contracts.InvestSdkTransport = sdk.createInvestSdkTransport(config);
	const cookie: contracts.SdkCookieAuthStrategy = auth.cookieAuth();
	const pageOptions: pagination.SdkPaginationOptions<number> = {
	  fetchPage: async () => ({ items: [1], nextCursor: null }),
	  maxItems: 1,
	  maxPages: 1,
	};
	const pageItems: Promise<number[]> = pagination.collectSdkPages(pageOptions);
	const response: Response = testing.jsonResponse({ ok: true });
	const delegation: eip7702.Eip7702DelegationInspection =
	  eip7702.inspectEip7702Bytecode('0x');
	const turnkeyConfig: turnkey.TurnkeyBrowserConfig = {
	  apiBaseUrl: 'https://api.turnkey.test',
	  parentOrganizationId: 'parent-org',
	  appName: 'Torque',
	  walletName: 'Wallet',
	};
	const evmResource: evm.EvmResource = evm.createEvmResource(
	  transport.createServiceClient('investments'),
	);
	const offersResource: offers.OffersResource = offers.createOffersResource(
	  transport.createServiceClient('investments'),
	);
	const investmentsResource: investments.InvestmentsResource =
	  investments.createInvestmentsResource(transport.createServiceClient('investments'));
	const vaultResource: vault.VaultResource = vault.createVaultResource(
	  transport.createServiceClient('investments'),
	);
	const firstPartyResources = [
	  analytics.createAnalyticsResource(transport.createServiceClient('investments')),
	  distributions.createDistributionsResource(transport.createServiceClient('investments')),
	  esign.createEsignResource(transport.createServiceClient('investments')),
	  filer.createFilerResource(transport.createServiceClient('investments'), {
	    signedDownloadClient: transport.createKeylessServiceClient('downloads'),
	    publicDownloadClient: transport.createKeylessServiceClient('downloads'),
	  }),
	  forms.createFormsResource(transport.createServiceClient('investments')),
	  fundManager.createFundManagerResource(transport.createServiceClient('investments')),
	  invitations.createInvitationsResource(transport.createServiceClient('investments')),
	  notifications.createNotificationsResource({
	    notifications: transport.createServiceClient('investments'),
	    users: transport.createServiceClient('investments'),
	  }),
	  profiles.createProfilesResource(transport.createServiceClient('investments')),
	  users.createUsersResource(transport.createServiceClient('investments')),
	] satisfies [
	  analytics.AnalyticsResource,
	  distributions.DistributionsResource,
	  esign.EsignResource,
	  filer.FilerResource,
	  forms.FormsResource,
	  fundManager.FundManagerResource,
	  invitations.InvitationsResource,
	  notifications.NotificationsResource,
	  profiles.ProfilesResource,
	  users.UsersResource,
	];
	const error: sdk.InvestSdkError = new errors.SdkConfigurationError('TEST', 'synthetic');
const result: contracts.SdkResult<undefined> = {
  data: undefined,
  status: 204,
  headers: new Headers(),
  metadata: Object.freeze({
    requestId: 'packed-consumer-request',
    attempts: 1,
    source: 'network',
  }),
};
	void [
	  transport,
	  cookie,
	  resourceAuth.cookieAuth(),
	  evmResource,
	  offersResource,
	  investmentsResource,
	  vaultResource,
	  firstPartyResources,
	  pageItems,
	  response,
	  delegation,
	  turnkeyConfig,
	  sponsoredCalls.assertExactSponsoredCall,
	  error,
	  result,
	];
`,
  );
  fs.writeFileSync(
    path.join(consumerDirectory, 'verify-exports.ts'),
    `${exportSpecifiers
      .map((specifier, index) => `import * as publicExport${index} from '${specifier}';`)
      .join('\n')}

void [${exportSpecifiers.map((_specifier, index) => `publicExport${index}`).join(', ')}];
`,
  );
  for (const [name, compilerOptions] of [
    ['nodenext', { module: 'NodeNext', moduleResolution: 'NodeNext' }],
    ['bundler', { module: 'ESNext', moduleResolution: 'Bundler' }],
  ]) {
    const configPath = path.join(consumerDirectory, `tsconfig.${name}.json`);
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          target: 'ES2022',
          lib: ['ES2022', 'DOM', 'DOM.Iterable'],
          skipLibCheck: false,
          ...compilerOptions,
        },
        include: ['verify.ts', 'verify-exports.ts'],
      }),
    );
    run('pnpm', ['exec', 'tsc', '-p', configPath], packageDirectory);
  }
  fs.writeFileSync(
    path.join(consumerDirectory, 'verify.mjs'),
    `import * as sdk from '@global-torque/sdk';
	import * as auth from '@global-torque/sdk/auth';
	import * as resourceAuth from '@global-torque/sdk/resources/auth';
	import * as analytics from '@global-torque/sdk/resources/analytics';
	import * as distributions from '@global-torque/sdk/resources/distributions';
	import * as esign from '@global-torque/sdk/resources/esign';
	import * as evm from '@global-torque/sdk/resources/evm';
	import * as filer from '@global-torque/sdk/resources/filer';
	import * as forms from '@global-torque/sdk/resources/forms';
	import * as fundManager from '@global-torque/sdk/resources/fund-manager';
	import * as invitations from '@global-torque/sdk/resources/invitations';
	import * as notifications from '@global-torque/sdk/resources/notifications';
	import * as offers from '@global-torque/sdk/resources/offers';
	import * as investments from '@global-torque/sdk/resources/investments';
	import * as profiles from '@global-torque/sdk/resources/profiles';
	import * as users from '@global-torque/sdk/resources/users';
	import * as vault from '@global-torque/sdk/resources/vault';
	import * as errors from '@global-torque/sdk/errors';
	import * as pagination from '@global-torque/sdk/pagination';
	import * as testing from '@global-torque/sdk/testing';
	import * as eip7702 from '@global-torque/sdk/wallet/eip7702';
	import * as turnkey from '@global-torque/sdk/wallet/turnkey';
	import * as sponsoredCalls from '@global-torque/sdk/wallet/sponsored-calls';
	import * as contracts from '@global-torque/sdk/types';

const expectedErrors = [
  'InvestSdkError',
  'SdkAbortError',
  'SdkAuthenticationError',
  'SdkAuthorizationError',
  'SdkConfigurationError',
  'SdkConflictError',
  'SdkHttpError',
  'SdkNetworkError',
  'SdkOfflineError',
	  'SdkRateLimitError',
	  'SdkResponseParseError',
	  'SdkResponseValidationError',
  'SdkTimeoutError',
  'SdkValidationError',
];
for (const name of expectedErrors) {
  if (typeof sdk[name] !== 'function' || sdk[name] !== errors[name]) {
    throw new Error('Missing public error export: ' + name);
  }
	}
	if (Object.keys(contracts).length !== 0) throw new Error('Type-only subpath emitted runtime values');
	if (auth.cookieAuth().kind !== 'cookie') throw new Error('Auth subpath mismatch');
	if (resourceAuth.noUserAuth().kind !== 'none') throw new Error('Resource auth subpath mismatch');
	if (typeof pagination.collectSdkPages !== 'function') throw new Error('Pagination subpath mismatch');
	if (testing.jsonResponse({ ok: true }).status !== 200) throw new Error('Testing subpath mismatch');
	if (eip7702.inspectEip7702Bytecode('0x').status !== 'not_delegated') {
	  throw new Error('EIP-7702 wallet subpath mismatch');
	}
	if (typeof turnkey.createTurnkeyBrowserOtpClient !== 'function') {
	  throw new Error('Turnkey wallet subpath mismatch');
	}
	if (typeof investments.createInvestmentsResource !== 'function') {
	  throw new Error('Investments resource subpath mismatch');
	}
	for (const [name, factory] of [
	  ['Analytics', analytics.createAnalyticsResource],
	  ['Distributions', distributions.createDistributionsResource],
	  ['E-sign', esign.createEsignResource],
	  ['Filer', filer.createFilerResource],
	  ['Forms', forms.createFormsResource],
	  ['Fund Manager', fundManager.createFundManagerResource],
	  ['Invitations', invitations.createInvitationsResource],
	  ['Notifications', notifications.createNotificationsResource],
	  ['Profiles', profiles.createProfilesResource],
	  ['Users', users.createUsersResource],
	]) {
	  if (typeof factory !== 'function') throw new Error(name + ' resource subpath mismatch');
	}
	if (typeof sponsoredCalls.createSponsoredCallExecutor !== 'function') {
	  throw new Error('Sponsored calls wallet subpath mismatch');
	}

let captured;
const transport = sdk.createInvestSdkTransport({
  apiKey: 'synthetic_pack_key',
  createRequestId: () => 'pack-request',
  fetch: async (url, init) => {
    captured = { url: String(url), method: init.method, key: new Headers(init.headers).get('x-api-key') };
    const body = String(url).includes('/public/offer') ? { data: [], count: 0 } : { fields: [] };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  },
  services: {
    investments: { baseUrl: 'https://api.example.test/' },
    offers: { baseUrl: 'https://offers.example.test/v1.0/' },
  },
});

const result = await transport.createServiceClient('investments').options('/forms');
if (captured.url !== 'https://api.example.test/forms') throw new Error('OPTIONS URL mismatch');
if (captured.method !== 'OPTIONS') throw new Error('OPTIONS method mismatch');
if (captured.key !== 'synthetic_pack_key') throw new Error('application key mismatch');
if (result.status !== 200 || result.data.fields.length !== 0) throw new Error('result envelope mismatch');
const offerResult = await offers
  .createOffersResource(transport.createServiceClient('offers'))
  .listOffers({ limit: 1 });
if (offerResult.data.count !== 0) throw new Error('Offers resource validation mismatch');
if (captured.url !== 'https://offers.example.test/v1.0/public/offer?limit=1') {
  throw new Error('Offers resource URL mismatch');
}
if (typeof evm.createEvmResource !== 'function') throw new Error('EVM resource subpath mismatch');
if (typeof vault.createVaultResource !== 'function') throw new Error('Vault resource subpath mismatch');
transport.dispose();
`,
  );
  run('node', ['verify.mjs'], consumerDirectory);
  fs.writeFileSync(
    path.join(consumerDirectory, 'verify-exports.mjs'),
    `const specifiers = ${JSON.stringify(exportSpecifiers)};
for (const specifier of specifiers) {
  const namespace = await import(specifier);
  if (namespace === null || typeof namespace !== 'object') {
    throw new Error('Invalid public export namespace: ' + specifier);
  }
}
`,
  );
  run('node', ['verify-exports.mjs'], consumerDirectory);

  const npmConsumerDirectory = path.join(temporaryDirectory, 'npm-consumer');
  fs.mkdirSync(npmConsumerDirectory);
  for (const fileName of [
    'package.json',
    'verify.ts',
    'verify-exports.ts',
    'verify.mjs',
    'verify-exports.mjs',
    'tsconfig.nodenext.json',
    'tsconfig.bundler.json',
  ]) {
    fs.copyFileSync(
      path.join(consumerDirectory, fileName),
      path.join(npmConsumerDirectory, fileName),
    );
  }
  run(
    'npm',
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', archivePath],
    npmConsumerDirectory,
  );
  for (const name of ['nodenext', 'bundler']) {
    run(
      'pnpm',
      ['exec', 'tsc', '-p', path.join(npmConsumerDirectory, `tsconfig.${name}.json`)],
      packageDirectory,
    );
  }
  run('node', ['verify.mjs'], npmConsumerDirectory);
  run('node', ['verify-exports.mjs'], npmConsumerDirectory);
  console.log(
    `Packed invest SDK clean npm/pnpm consumers passed for ${exportSpecifiers.length} public subpaths.`,
  );
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
