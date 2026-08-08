# Migration guide

## From an unchecked Fetch wrapper

Create one transport per application or service lifetime, configure exact
service origins, and dispose it when that lifetime ends. Do not use a generic
type argument as a response assertion: unvalidated JSON is
`SdkResult<unknown>`. Supply a synchronous `responseValidator` for
`SdkResult<T>`.

```ts
const service = transport.createServiceClient('investments');
const result = await service.get('/offers/example', {
  responseMode: 'json',
  responseValidator: validateOffer,
});
```

Choose user authentication explicitly with `cookieAuth`, `bearerAuth`, or
`noUserAuth`. Application API keys are separate and are sent only to the exact
configured service origin. A keyless service must explicitly set
`applicationAuth: 'none'`.

Supplying `idempotencyKey` only transports that value. It does not make a
backend operation idempotent and does not enable automatic mutation retries.

## Contract-backed resources

Resource factories accept a configured `SdkServiceClient`:

```ts
import { createOffersResource } from '@global-torque/sdk/resources/offers';

const offers = createOffersResource(transport.createServiceClient('offers'));
const result = await offers.listOffers({ limit: 20 });
```

The EVM, Offers, and Vault subpaths are alpha contract snapshots. Confirm the
target deployment's schema and authentication policy before migrating a
production call. Mutations additionally require a documented server
idempotency contract.

## EIP-7702

Import `@global-torque/sdk/wallet/eip7702`, resolve the exact signer and
authoritative wallet address in the host application, and pass both to the SDK.
Preserve the existing pending-call storage namespace during migration so an
in-flight provider call is resumed rather than duplicated.

Success gating must retain the SDK's independent post-confirmation delegation
inspection. Do not replace it with provider acceptance or a submitted call ID.

## Turnkey

Import `@global-torque/sdk/wallet/turnkey` and inject the existing
server-sign callback. Keep endpoint paths, request casing, user/profile
selection, registration challenges, UI state, and navigation in the host.
