# Contributing

Open an issue before proposing a substantial API change. Small fixes may be
submitted directly with tests.

Development requires Node 22 or 24 and pnpm 10.33.0:

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
credential isolation and sanitized diagnostics. Wallet changes must include
failure, retry/resume, cancellation, and post-confirmation success-gating tests.

Do not commit credentials, environment files, private service URLs, customer
data, generated build directories, or release tarballs.
