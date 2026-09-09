# Migration guide

## From `0.1.0-alpha` response and transport behavior

Generated resource response validators are forward-compatible by default.
They preserve additive fields and unknown non-blank string enum values and
normalize documented equivalent decimal strings. Missing required fields,
wrong scalar types, invalid financial values, and malformed relied-upon
structures still fail. Use a generated validator's `.exact(value)` method only
for strict-schema canaries.

Compatible wire validation runs before any operation projection. Projections
enforce only the fields that operation relies on; the offer list/detail
projections, for example, require stable identifiers while unrelated optional
fields remain optional.

`HEAD` is now a supported safe read, raw `OPTIONS` no longer injects `schema=1`
unless `{ schema: true }` is supplied, and HTTP 409 responses now produce
`SdkConflictError` rather than `SdkValidationError`. Failed HTTP responses
preserve all Fetch-visible headers. Cross-realm Fetch bodies and Node streams
are passed through without JSON serialization; Node stream requests set
`duplex: 'half'`.

Successful JSON and text bodies now default to a 16 MiB bound. Set
`maxTextResponseBodyBytes` to another explicit bounded value, up to 512 MiB,
when needed. Binary response modes are not subject to this text limit.

Unknown authentication kinds, malformed strategy fields, bearer strategies
without `getToken`, authorization strategies without `getAuthorization`, and
missing service configuration now fail synchronously with
`SdkConfigurationError`. Use `authorizationAuth` for a complete typed
Authorization value instead of reinserting a generic header.

`createFilerResource` now requires credential-separated download clients. The
authenticated client obtains a signed URL, while a keyless origin-bound client
fetches that URL. Public downloads likewise use a separate keyless Filer
client created by `transport.createKeylessServiceClient`. Do not enable redirect
following on an application-key service.

## From `0.1.0-alpha` HTTP errors

`0.2.0` replaces `SdkHttpError.details` with `responseBody`. The new
property contains the bounded application-protocol response without field
allowlisting, redirect rewriting, or telemetry redaction. Treat it as untrusted
input: narrow and validate the expected endpoint-specific shape immediately
before use. Do not log or report it directly.

```ts
try {
  await service.post('/operation', input);
} catch (error) {
  if (error instanceof SdkHttpError) {
    const body: unknown = error.responseBody;
    // Validate the endpoint-specific protocol shape before acting on it.
  }
  throw error;
}
```

`bodyKind` distinguishes `json`, `text`, `empty`, `malformed`, and `truncated`
responses. Malformed and truncated bytes are not exposed as a partial response
object. `allowedRedirectOrigins` was removed from `SdkServiceConfig`; it never
controlled URLs embedded in JSON. Actual HTTP redirect behavior remains under
the service's `redirectPolicy`, while application navigation policy belongs in
the host runtime.

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

Use `result.metadata` for the SDK correlation ID, final attempt count, and
typed response provenance. Hosts that already wrap Fetch for offline fallback
may inject `resolveResponseSource` to classify the returned `Response` as
`network` or `offline-cache`; keep storage lookup/persistence, retention,
consent, last-sync policy, service-worker behavior, and UI outside the SDK.
Compatibility adapters that cannot prove either source should use `unknown`;
they must forward measured inner-transport request correlation and attempt
metadata rather than inventing it.

## Contract-backed resources

Resource factories accept a configured `SdkServiceClient`:

```ts
import { createOffersResource } from '@global-torque/sdk/resources/offers';

const offers = createOffersResource(transport.createServiceClient('offers'));
const result = await offers.listOffers({ limit: 20 });
```

Resource availability remains deployment-specific. Confirm the target deployment's schema and
authentication policy before migrating a production call. Mutations
additionally require a documented server
idempotency contract; SDK resource factories do not enable mutation retries.

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
