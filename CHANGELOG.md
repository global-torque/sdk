# Changelog

All notable public changes are recorded here. The package follows semantic
versioning after `1.0`; alpha releases may contain breaking API changes.

## Unreleased

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
