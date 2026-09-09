# Contributing

Open an issue before proposing a substantial API change. Small fixes may be
submitted directly with tests.

Development requires Node 22 or 24 and pnpm 10.34.5:

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

Keep framework, router, environment loading, user/profile selection, and UI
policy outside the SDK. New transport behavior must preserve exact-origin
credential isolation and untrusted protocol-data isolation. Wallet changes must include
failure, retry/resume, cancellation, and post-confirmation success-gating tests.
The packed-policy tests and clean npm/pnpm consumers must cover every explicit
public subpath; do not weaken their fail-closed dependency or ambient-environment
checks to admit an application-layer import.

Resource clients and validators are maintained in `src/resources`. Update their
focused tests alongside behavior changes and confirm the target deployment's
request, response, authentication, and authorization behavior independently.

Do not commit credentials, environment files, private service URLs, customer
data, generated build directories, or release tarballs.
