# `@global-torque/sdk`

Framework-free TypeScript transport, contract-validated investment resources,
and injected EIP-7702 and Turnkey browser-wallet building blocks. The package
supports Node 22+, modern browsers, ES modules, and any UI framework.

> **Alpha:** transport and wallet APIs may change before `1.0`. The generated
> investment resource subpaths are experimental contract snapshots; read
> [Contract status](#contract-status) before using them.

## Install

```sh
npm install @global-torque/sdk@next
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
- exact-origin `X-API-Key` isolation and separate cookie, bearer, and anonymous
  user-auth strategies;
- typed, sanitized HTTP, validation, authentication, authorization,
  rate-limit, parse, network, abort, timeout, and configuration errors;
- safe-read retries for `GET` and `OPTIONS`, with bounded backoff, jitter, and
  `Retry-After` handling;
- explicit idempotency-key transport without automatic mutation retries;
- bounded cursor pagination and deterministic testing helpers;
- opt-in safe-read deduplication; and
- abort-on-dispose ownership and credentialed `redirect: 'error'` requests.

The package does not depend on Vue, Pinia, React, routers, application state,
environment loaders, or UI code. Configuration and secrets are passed by the
host; the SDK does not read environment variables.

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
result. Validator failures become sanitized `SdkResponseValidationError`
instances; response bodies and validator messages are not copied into errors.

`collectSdkPages` and `paginateSdk` require both `maxPages` and `maxItems` and
fail closed instead of returning an over-limit partial result.

Application credentials are validated for non-blank, bounded, header-safe
syntax. Callers cannot override `X-API-Key`, `Authorization`,
`Idempotency-Key`, or `X-Request-ID` through a generic headers bag. Supplying
`idempotencyKey` does not assert server idempotency and never enables mutation
retries.

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
- `@global-torque/sdk/resources/investments`
- `@global-torque/sdk/resources/offers`
- `@global-torque/sdk/resources/vault`

Each factory accepts an already configured service client and validates both
request parameters and successful JSON responses.

### Contract status

Resource schemas are digest-pinned snapshots used for alpha integration, not a
promise that every deployment implements the same revision. The EVM source
specification currently contains success examples with unquoted hexadecimal
YAML scalars that parse as numbers while their schemas require strings. The
SDK does not coerce those invalid examples or represent them as authoritative
fixtures. Offers and Vault selected examples validate against their schemas.

Do not enable application-key deployment or mutation retries solely because a
resource exists in this package. Confirm the target deployment's contract,
authentication scope, and idempotency behavior independently. See
[`CONTRACTS.md`](./CONTRACTS.md) for the complete status.

`resources/investments` owns contract-backed confirmed and unconfirmed lists,
detail, offer investment lists, creation, amount, signature, review, and cancel
operations. It deliberately excludes the legacy ownership, funding, notes, and
OPTIONS compatibility methods because those operations are absent from the
pinned backend contract.

The planned `./resources/profiles`, `./resources/invitations`, and
`./resources/fund-manager` subpaths are not exported yet. Their current app
models contain product policy or lack authoritative backend schemas. The full
ERC-7540 prepare/arm/claim lifecycle is likewise deferred; `resources/vault`
exposes only the operations present in the pinned contract.

## Public API

The package uses explicit exports only:

- root transport, auth, errors, pagination, and types;
- `./auth`, `./errors`, `./pagination`, `./testing`, and `./types`;
- `./resources/auth`, `./resources/evm`, `./resources/investments`,
  `./resources/offers`, and `./resources/vault`; and
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
only the manifest allowlist. `pack:smoke` installs that exact tarball into a
clean temporary consumer, typechecks every exported subpath, and runs transport
and wallet assertions.

Releases are immutable: a failed alpha receives a new version. A source tag
builds and attests one tarball, and a separate manual workflow verifies the
immutable GitHub release, attestation, checksum, per-file manifest, and clean
consumer before publishing those exact bytes.

npm requires a package to exist before its trusted publisher can be
configured. The first version therefore uses the publish workflow's explicit
bootstrap mode with a temporary granular npm token and `--provenance`. The
token is then revoked and removed, and later versions use the same workflow
through npm trusted publishing without a long-lived token.

## Support and security

Use [GitHub issues](https://github.com/global-torque/sdk/issues) for
reproducible defects and feature requests. Report vulnerabilities privately as
described in [`SECURITY.md`](./SECURITY.md).

## License

MIT. See [`LICENSE`](./LICENSE) and [`NOTICE.md`](./NOTICE.md).
