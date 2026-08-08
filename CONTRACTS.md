# Contract provenance and status

The EVM, Investments, Offers, and Vault resource modules are generated from digest-pinned
OpenAPI/Swagger snapshots. Generation is deterministic and the package build
fails when committed TypeScript DTOs or runtime schemas are stale.

The snapshots provide reproducible frontend evidence; they are not a promise
that every service deployment implements the same revision. Before using a
resource against a production deployment, confirm:

- the deployed contract revision and operation path;
- the required user and application authentication modes;
- API-key scope, rotation, and revocation behavior; and
- server-side idempotency semantics for mutations.

The public source repository contains each exported operation's path, method,
parameters, request/response schema references, declared security requirements,
and the transitive validation schemas. Backend-language vendor extensions are
omitted because they are not part of runtime validation.
`contracts/provenance.json` records the SHA-256 of each reviewed source snapshot
and public projection; contract generation rejects projection drift.

## Current alpha status

- Offers list/detail examples validate against their selected schemas.
- Investment list/detail and step operations have selected generated schemas;
  the pinned review response intentionally contains only investment ID and
  status and must not be treated as a refreshed full investment record.
- Vault position/redemption examples validate against their selected schemas.
- The EVM source snapshot contains six success examples whose unquoted
  hexadecimal YAML scalars parse as numbers even though the schemas require
  strings. This affects two exported wallet-read examples and four non-exported
  operations.
- The SDK does not coerce invalid examples into fixtures. Runtime EVM responses
  must satisfy the generated string schemas.
- The wallet transaction `operation_id` query is a documented compatibility
  extension until it appears in the upstream specification.
- Profiles, invitations, filer, fund-manager, and the remaining ERC-7540
  prepare/arm/claim lifecycle are not exported as contract-backed resources.
  They require authoritative request/response schemas, service ownership,
  deployment scope, and mutation-idempotency evidence first.

For those reasons, contract-backed resources are experimental in the alpha
line. Transport and browser-wallet code does not depend on these generated
resource modules.

## Updating a contract

A contract update must include the new immutable source reference and digest,
regenerated DTOs/schemas, runtime-validator tests, updated API report, and a
clean packed-consumer run. Never advance a backend-authority or deployment
claim based only on frontend casts or successful local generation.
