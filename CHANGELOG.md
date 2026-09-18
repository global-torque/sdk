# Changelog

All notable public changes are recorded here. The package follows semantic
versioning. Before `1.0`, breaking API changes require a new minor version;
patch releases preserve the supported API.

## 0.3.0 - 2026-09-18

- **Breaking:** redemption responses now require business status `pending`,
  `approved`, `denied`, `cancelled`, or `completed`.
- Removed redemption-only `pricing_status` and `priced_request_effect_id` from
  generated contracts and validators.
- Added approval/denial audit metadata while retaining independent protocol
  state.

## 0.2.0 - 2026-09-09

- Security: refresh the standalone dependency lock to patched `fast-uri`,
  `js-yaml`, and `nanoid` releases, and update Vitest and its coverage tooling
  to `4.1.11`. Production dependency ranges and the SDK API are unchanged.

- Use ordinary semantic versions on `latest`; GitHub release creation no
  longer marks ordinary versions as prereleases. Legacy alpha artifacts retain
  their existing `next` channel and immutable verification controls.

- Added awaited host evidence hooks to the sponsored-call executor:
  `onSubmissionEvidence` runs after the accepted provider call ID is persisted
  and before any confirmation wait (including on every resume), and
  `onReceiptEvidence` runs after the receipt hash is validated and before the
  host postcondition or pending-store cleanup. A hook failure raises the new
  retryable `SponsoredCallEvidenceError` (see `isSponsoredCallEvidenceError`),
  leaves pending state intact, and is never treated as a provider-terminal
  failure. Endpoint construction and authentication stay with the host.
- Added explicit Fetch cache-mode forwarding so invitation preview and
  acceptance consumers can preserve `no-store` without adding SDK-owned cache
  persistence policy.

## 0.2.0-alpha.1 - 2026-08-14

- **Breaking:** generated resource response validators are forward-compatible
  by default and expose `.exact` for opt-in pinned-contract canaries. Additive
  fields and unknown non-blank string enum values are preserved, while relied-upon
  structure and financial values remain fail-closed.
- **Breaking:** `createFilerResource` requires keyless signed-download and
  public-download clients. Authenticated downloads now obtain a signed URL
  first and fetch it without application or user credentials.
- Added typed custom Authorization strategies, `HEAD`, raw `OPTIONS` defaults,
  `SdkConflictError` for HTTP 409, full Fetch-visible error headers, bounded
  response-validation diagnostics, cross-realm Fetch body support, and Node
  request-stream `duplex: 'half'` handling.
- Added a default 16 MiB bound, configurable up to 512 MiB, for successful
  JSON/text bodies and transport-verified keyless service clients for
  credential-separated flows. Binary response modes remain uncapped by this
  text-body limit.
- Made runtime service and authentication configuration fail closed instead of
  silently downgrading malformed strategies to anonymous requests.
- Applied exact sponsored-call intent checks to direct and zero-value legacy
  Turnkey signing paths and removed coercive EIP-7702 chain comparison.
- **Breaking:** replaced `SdkHttpError.details` with the non-enumerable
  `responseBody` property. Bounded JSON and text error bodies are now preserved
  as untrusted application-protocol data instead of being destructively
  sanitized during transport parsing.
- **Breaking:** removed `allowedRedirectOrigins` from `SdkServiceConfig` and
  removed the Ory-specific error-body sanitizer. Fetch redirect policy remains
  transport-owned; endpoint-specific navigation and telemetry redaction remain
  host responsibilities.
- Kept malformed, truncated, and empty HTTP error bodies fail-closed through
  `bodyKind` without fabricating protocol fields.

- Added synchronously validated `./resources/users`, `./resources/profiles`,
  `./resources/invitations`, `./resources/fund-manager`, `./resources/filer`,
  `./resources/distributions`, and `./resources/forms` subpaths from the
  immutable first-party contract source lock. Ory settings remain excluded.
- Added deterministic OpenAPI normalization for legacy path parameters,
  definitions/references, request/response schemas, and security declarations,
  with fail-closed semantic-preservation and provenance evidence.
- Pinned the workspace's backend-owned source as the authoritative first-party
  contract input and added exact revision/digest, operation, auth, deployment,
  live-operation reconciliation, and fail-closed resource-export admission
  evidence while retaining the four current resource paths as measured legacy
  migration exemptions.
- Extended packed-artifact verification to reject upper-layer SDK-family,
  application/private, framework, runtime, workspace, and ambient-environment
  coupling and to typecheck/import every public subpath from separate clean npm
  and pnpm consumers.
- Added immutable `SdkResult.metadata` with correlation, attempt, and typed
  response provenance plus an injected synchronous response-source classifier;
  the SDK still owns no storage, consent, service-worker, route, or UI policy.
- Renamed the public package identity from `@global-torque/invest-sdk` to
  `@global-torque/sdk` and updated workspace consumers and artifact gates.
- Added contract-validated `./resources/investments` reads and mutations while
  excluding unpinned ownership, funding, and notes compatibility operations.
- Added EVM authorization-session reads.
- Added `./wallet/sponsored-calls` for exact prepared-call validation,
  pending-call recovery, receipt confirmation, and injected postconditions.

## 0.1.0-alpha.2 - 2026-08-07

- Licensed the SDK under MIT and added public repository, support, security,
  contribution, notice, and npm publication metadata.
- Added trusted-publishing workflow definitions for provenance-backed public
  prereleases.
- Added the required one-time provenance-backed npm bootstrap path, pinned
  workflow actions, immutable-release and attestation verification, and
  exact-final-tarball package and consumer checks.
- Replaced private monorepo and development-host documentation with standalone
  public usage and migration guidance.
- Kept EVM, Offers, and Vault resource subpaths explicitly experimental while
  their backend contract acceptance remains deployment-specific.

- Accepted the EVM backend's aggregate wallet response by translating only its
  empty optional enum sentinels to omitted fields before pinned-schema
  validation; invalid non-empty chain and status values remain rejected.
- Added `./wallet/eip7702` and `./wallet/turnkey` subpaths. The former
  owns explicit-signer exact delegation inspection, fail-closed sponsored
  activation, pending-call resumption, and post-confirmation chain validation;
  the latter owns reusable injected Turnkey OTP, token proof, browser session,
  exact account resolution, signer construction, reset, and cancellation
  mechanics.
- Removed caller-selected response generics from unvalidated SDK requests.
  JSON and automatic parsing now remain `unknown`, explicit text/blob/array
  buffer modes infer their parser-owned types, and `SdkResult<T>` requires a
  synchronous response validator.

## 0.1.0-alpha.1 - 2026-07-28

- Established the instance-scoped canonical transport.
- Added exact-origin application-key isolation, explicit user-auth strategies,
  typed sanitized errors, response modes, cancellation, timeout, hooks,
  disposal, and opt-in scoped safe-read deduplication.
- Added synchronous response validators, explicit mutation idempotency-key
  transport, opt-in safe-read HTTP retries, exponential backoff, jitter,
  `Retry-After`, bounded pagination, auth constructors, and a packaged testing
  subpath.
- Added digest-pinned EVM and Offers contract generation plus typed wallet-info,
  wallet-transactions, offer-list, and offer-detail resource namespaces with
  generated DTOs and runtime validation.
- Added the digest-pinned Investment Vault position and redemption resource
  namespace, including exact-raw request validation and runtime response validation.
- Added exact packed-artifact consumer verification.
- Made package builds publish immutable content-addressed generations through
  one atomic selector, reverify generation names and bytes, preserve the facade
  union required by retained readers, and derive selected-generation archives
  without trusting live output.
- Added adversarial corruption, traversal, stale-file injection,
  removed-subpath reader, concurrent import/selector, and source
  edit-and-revert coverage.
- Added a local release-evidence command that builds from an immutable captured
  Git tree, rechecks source digests across gates, and records source, contract,
  archive, per-file, and exact-consumer evidence without binding archive bytes
  to later working-tree state.
- Added explicit package-license and clean-room release assertions.
- Made exact packed-consumer verification mandatory for retained dirty and
  clean artifacts; dirty source remains local evidence only.
- Made clean-source local verification fail closed if a gate changes captured
  source while leaving live source and dependency trees untouched.

Production keyed deployment remains gated by service-specific contract and
credential evidence.
