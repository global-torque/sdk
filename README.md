# `@global-torque/sdk`

Framework-free TypeScript transport, contract-validated investment resources,
and injected EIP-7702 and Turnkey browser-wallet building blocks. The package
supports Node 22+, modern browsers, ES modules, and any UI framework.

The package uses ordinary semantic versions. Before `1.0`, breaking API changes
require a new minor version and are documented in `CHANGELOG.md`; patch releases
preserve the supported API. Deployment-specific resource limitations still apply.

## Install

```sh
npm install @global-torque/sdk
```

## Transport

```ts
import { cookieAuth, createInvestSdkTransport } from '@global-torque/sdk';

const transport = createInvestSdkTransport({
  apiKey: process.env.INVEST_API_KEY,
  services: {
    investments: {
      baseUrl: 'https://api.example.com/',
      auth: cookieAuth(),
    },
  },
});

const investments = transport.createServiceClient('investments');
const schema = await investments.options('/profiles/personal-information', {
  responseValidator: validateFormSchema,
});

transport.dispose();
```

The transport provides:

- instance-scoped service origins, authentication, retries, hooks, and
  lifecycle;
- immutable body-free result metadata for request correlation, final attempt
  count, and typed `network`/`offline-cache`/`unknown` provenance;
- exact-origin `X-API-Key` isolation and separate cookie, bearer, typed custom
  Authorization, and anonymous user-auth strategies;
- typed, bounded HTTP, validation, authentication, authorization, rate-limit,
  parse, network, abort, timeout, and configuration errors;
- safe-read retries for `GET`, `HEAD`, and `OPTIONS`, with bounded backoff, jitter, and
  `Retry-After` handling;
- explicit Fetch cache-mode forwarding without SDK-owned persistence policy;
- explicit idempotency-key transport without automatic mutation retries;
- bounded cursor pagination and deterministic testing helpers;
- opt-in safe-read deduplication; and
- abort-on-dispose ownership and credentialed `redirect: 'error'` requests.

The package does not depend on Vue, Pinia, React, routers, application state,
environment loaders, or UI code. Configuration and secrets are passed by the
host; the SDK does not read environment variables.

Successful JSON and text bodies are bounded to 16 MiB by default; configure
`maxTextResponseBodyBytes` when a documented endpoint needs another bounded
limit, up to 512 MiB. Explicit blob and array-buffer modes retain native
behavior and are not subject to the text limit.

## Response typing

Unvalidated JSON remains `unknown`. Supply a synchronous validator to obtain a
typed result:

```ts
const raw = await investments.get('/offers'); // SdkResult<unknown>
const health = await investments.get('/health', { responseMode: 'text' });
const offer = await investments.get('/offers/example', {
  responseMode: 'json',
  responseValidator: validateOffer,
}); // SdkResult<Offer>
```

Response validators run synchronously after parsing and before hooks receive a
result. Generated resource validators accept and preserve additive object
fields, preserve unknown non-blank string enum values, and normalize equivalent
exact-decimal strings. They still reject missing required fields, wrong scalar
types, invalid financial values, and malformed relied-upon structures. Each
resource validator exposes `.exact(value)` as an opt-in strict-schema canary.
Resource validators can add an operation projection after wire validation; for
example, offer reads require the identifiers their routing and feature models
actually use without making unrelated optional fields availability gates.
Validator failures become `SdkResponseValidationError` instances with only a
bounded validation mode, schema keyword, and JSON pointer; response bodies and
validator messages are not copied into errors.

`OPTIONS` is raw by default. Pass `{ schema: true }` only for endpoints that
use the legacy `schema=1` discovery convention.

Every successful `SdkResult` exposes frozen `result.metadata` with the SDK-created
correlation ID, final attempt count, and response source. The source defaults to
`network`; a host-owned Fetch adapter may synchronously classify an already
produced response as `offline-cache` through `resolveResponseSource`. Successful
diagnostic events receive the same source. This hook does not read or write
storage and does not own cache eligibility, retention, consent, last-sync
policy, service workers, navigation, analytics taxonomy, or presentation.
Compatibility adapters that cannot observe their inner transport provenance
must report `unknown` rather than infer from application-specific headers, and
must forward measured request correlation and attempt metadata from that inner
transport rather than inventing it.

Failed HTTP responses expose their bounded application-protocol body as
`SdkHttpError.responseBody`. JSON values are parsed without filtering or
rewriting fields; non-JSON text is preserved as a string. This data is
untrusted: validate it immediately before use, and never send it directly to
logs or telemetry. The property is non-enumerable to reduce accidental
serialization, but that is not a security boundary. Malformed, truncated, and
empty bodies are identified by `bodyKind` and are not exposed as fabricated
protocol data. `SdkHttpError.headers` preserves the Fetch-visible response
headers. The SDK still bounds error bytes and keeps credentialed Fetch redirect
policy transport-owned.

`collectSdkPages` and `paginateSdk` require both `maxPages` and `maxItems` and
fail closed instead of returning an over-limit partial result.

Application credentials are validated for non-blank, bounded, header-safe
syntax. Callers cannot override `X-API-Key`, `Authorization`,
`Idempotency-Key`, or `X-Request-ID` through a generic headers bag. Supplying
`idempotencyKey` does not assert server idempotency and never enables mutation
retries.

Use `authorizationAuth({ getAuthorization })` when a service needs a typed
Authorization scheme other than Bearer. Generic request headers still cannot
set `Authorization`, so credential ownership remains explicit and origin-bound.

## Browser wallet subpaths

Wallet integrations are separate subpaths so transport-only consumers do not
load provider dependencies:

- `@global-torque/sdk/wallet/eip7702`
- `@global-torque/sdk/wallet/turnkey`
- `@global-torque/sdk/wallet/sponsored-calls`

```ts
import {
  createAlchemyEip7702Activator,
  createBrowserEip7702PendingStore,
} from '@global-torque/sdk/wallet/eip7702';

const activator = createAlchemyEip7702Activator({
  apiKey: runtimeConfig.alchemyWalletApiKey,
  policyId: runtimeConfig.alchemy7702PolicyId,
  rpcUrl: runtimeConfig.alchemyRpcUrl,
  pendingStore: createBrowserEip7702PendingStore({
    namespace: 'my-app:wallet:eip7702',
    storage: window.localStorage,
  }),
});

await activator.ensureDelegation({
  signer: exactSessionAccount,
  expectedWalletAddress: authoritativeWalletAddress,
});
```

The EIP-7702 activator validates the exact expected delegate, resumes pending
provider calls, and requires a post-confirmation bytecode read before reporting
success. Provider acceptance or a call ID alone is not success.

Turnkey helpers accept an injected `serverSign` callback. The host continues to
own authentication endpoints, user/profile selection, registration challenges,
navigation, and recovery UI.

`wallet/sponsored-calls` validates one exact provider-prepared EVM call against
the authorized sender, chain, target, calldata, value, and sponsored fee
policy. It persists and resumes the provider call ID, waits for a receipt, and
requires a host-injected postcondition before clearing pending state. Business
eligibility policy remains in the host application.

## Contract-backed resources

These explicit subpaths provide generated DTOs and synchronous validators:

- `@global-torque/sdk/resources/evm`
- `@global-torque/sdk/resources/distributions`
- `@global-torque/sdk/resources/filer`
- `@global-torque/sdk/resources/forms`
- `@global-torque/sdk/resources/fund-manager`
- `@global-torque/sdk/resources/invitations`
- `@global-torque/sdk/resources/investments`
- `@global-torque/sdk/resources/offers`
- `@global-torque/sdk/resources/profiles`
- `@global-torque/sdk/resources/users`
- `@global-torque/sdk/resources/vault`

Each factory accepts an already configured service client and validates both
request parameters and successful JSON responses.

### Resource status

Resource clients and validators are maintained as package source. Their
presence does not prove that every deployment implements the same API revision.
Confirm the target deployment's authentication, authorization,
request/response, and idempotency behavior independently before enabling a
resource in an application.

`resources/investments` owns schema-validated confirmed and unconfirmed lists,
detail, offer investment lists, creation, amount, signature, review, and cancel
operations. It deliberately excludes the legacy ownership, funding, notes, and
OPTIONS compatibility methods because those operations are not part of the
supported SDK surface.

The Users, Profiles, Invitations, Fund Manager, Filer, Distributions, and Forms
subpaths contain request construction and synchronous JSON validation, not app
state, workflows, routes, or UI policy.
Ory sessions/settings remain in the host identity integration and there is no
SDK settings resource. The full ERC-7540 prepare/arm/claim lifecycle is still
deferred; `resources/vault` exposes only the operations present in its current
package implementation.

Filer downloads require explicit credential separation. Construct the Filer
resource with its authenticated API client plus two keyless clients: an
origin-bound object-store client for signed URLs and a Filer public-download
client that may follow the service's documented redirect. `downloadFile`
obtains and validates the signed URL through the authenticated endpoint, then
fetches it through the keyless object-store client. Never log or persist the
signed URL.

```ts
const transport = createInvestSdkTransport({
  apiKey: process.env.FILER_API_KEY,
  services: {
    filer: { baseUrl: 'https://filer.example.com/v1.0/' },
    filerSignedDownloads: {
      baseUrl: 'https://objects.example.com/',
      applicationAuth: 'none',
      auth: { kind: 'none', credentials: 'omit' },
    },
    filerPublicDownloads: {
      baseUrl: 'https://filer.example.com/v1.0/',
      applicationAuth: 'none',
      auth: { kind: 'none', credentials: 'omit' },
      redirectPolicy: 'follow',
    },
  },
});

const filer = createFilerResource(transport.createServiceClient('filer'), {
  signedDownloadClient: transport.createKeylessServiceClient('filerSignedDownloads'),
  publicDownloadClient: transport.createKeylessServiceClient('filerPublicDownloads'),
});
```

## Public API

The package uses explicit exports only:

- root transport, auth, errors, pagination, and types;
- `./auth`, `./errors`, `./pagination`, `./testing`, and `./types`;
- `./resources/auth`, `./resources/distributions`, `./resources/evm`,
  `./resources/filer`, `./resources/forms`, `./resources/fund-manager`,
  `./resources/invitations`, `./resources/investments`, `./resources/offers`,
  `./resources/profiles`, `./resources/users`, and `./resources/vault`; and
- `./wallet/eip7702`, `./wallet/turnkey`, and `./wallet/sponsored-calls`.

## Development

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm run format:check
pnpm run lint
pnpm run docs:check
pnpm run typecheck
pnpm run test:coverage
pnpm run api:check
pnpm run package:lint
pnpm run pack:smoke
```

`pack:safe` snapshots one verified content-addressed build generation and packs
only the manifest allowlist. `pack:smoke` rejects upper-layer SDK-family,
application/private, framework, runtime, workspace, and ambient-environment
coupling in the packed manifest and JavaScript/declarations. It installs that
exact tarball into separate clean npm and pnpm consumers, typechecks and imports
every explicit exported subpath, and runs transport and wallet assertions.

Releases are immutable: a failed candidate receives a new version. Ordinary
versions publish to `latest` as normal GitHub releases; retained legacy alpha
versions use `next` and GitHub prereleases. A source tag
builds and attests one tarball, and a separate manual workflow verifies the
immutable GitHub release, attestation, checksum, per-file manifest, and clean
consumer before publishing those exact bytes.

npm requires a package to exist before its trusted publisher can be
configured. The first version therefore uses the publish workflow's explicit
bootstrap mode with a temporary granular npm token and `--provenance`. The
token is then revoked and removed, and later versions use the same workflow
through npm trusted publishing without a long-lived token.

The release workflow also publishes `npm-provenance.json`, a signed Sigstore
bundle whose subject is the versioned npm package URL and the exact tarball's
SHA-512 digest. It is a separate immutable GitHub release asset, outside the
three-file `release/` directory checked by `release:verify`. The original
tarball attestation is retained as well.

Use the verified publish workflow above for routine releases. npm CLI rejects
combining `--provenance=false` and `--provenance-file`, and this package's
`publishConfig.provenance` also requests CI signing. The local CLI command
previously documented here therefore does not work; see
[npm CLI issue #9879](https://github.com/npm/cli/issues/9879).

The initial `0.2.0` release used npm's `libnpmpublish` API with the independently
verified external bundle, preserving the exact release tarball and registry
provenance. Never rebuild an attested tarball, remove provenance to bypass the
CLI conflict, or use a bundle from another version or source release.

## Support and security

Use [GitHub issues](https://github.com/global-torque/sdk/issues) for
reproducible defects and feature requests. Report vulnerabilities privately as
described in [`SECURITY.md`](./SECURITY.md).

## License

MIT. See [`LICENSE`](./LICENSE) and [`NOTICE.md`](./NOTICE.md).
