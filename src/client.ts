import {
  InvestSdkError,
  SdkAbortError,
  SdkAuthenticationError,
  SdkAuthorizationError,
  SdkConfigurationError,
  SdkHttpError,
  SdkNetworkError,
  SdkRateLimitError,
  SdkResponseParseError,
  SdkResponseValidationError,
  SdkTimeoutError,
  SdkValidationError,
  type SdkErrorContext,
} from './errors.js';
import { sanitizeErrorDetails } from './sanitize.js';
import type {
  InvestSdkTransport,
  InvestSdkTransportConfig,
  SdkConvenienceRequestOptions,
  SdkDiagnosticEvent,
  SdkErrorBodyKind,
  SdkHttpMethod,
  SdkOptionsRequestOptions,
  SdkRequestInput,
  SdkResponseData,
  SdkResponseMode,
  SdkResponseValidator,
  SdkResult,
  SdkRetryPolicy,
  SdkSleep,
  SdkServiceClient,
  SdkServiceConfig,
  SdkUserAuthStrategy,
  SdkValidatedConvenienceRequestOptions,
  SdkValidatedOptionsRequestOptions,
  SdkValidatedRequestInput,
} from './types.js';

const APPLICATION_KEY_HEADER = 'X-API-Key';
const REQUEST_ID_HEADER = 'X-Request-ID';
const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ERROR_BODY_BYTES = 64 * 1024;
const MAX_ERROR_BODY_BYTES = 1024 * 1024;
const MAX_RETRIES = 5;
const MAX_RETRY_DELAY_MS = 30_000;
const MAX_REQUEST_ID_LENGTH = 256;
const MAX_IDEMPOTENCY_KEY_LENGTH = 256;
const DIAGNOSTIC_IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,159}$/iu;
const HTTP_METHODS: ReadonlySet<string> = new Set([
  'GET',
  'OPTIONS',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
]);
const RESPONSE_MODES: ReadonlySet<string> = new Set([
  'auto',
  'json',
  'text',
  'blob',
  'arrayBuffer',
]);

type AbortKind = 'caller' | 'disposed' | 'timeout';

interface ActiveRequest {
  controller: AbortController;
  kind?: AbortKind;
}

interface NormalizedService {
  baseUrl: URL;
  applicationAuth: 'api-key' | 'none';
  headerPolicy: 'standard' | 'minimal' | 'caller';
  redirectPolicy: 'error' | 'follow';
  allowedRedirectOrigins: ReadonlySet<string>;
  auth: SdkUserAuthStrategy;
}

interface ParsedResponse {
  value: unknown;
  parseFailed: boolean;
  bodyKind: SdkErrorBodyKind;
}

type InternalSdkRequestInput<T = unknown> = Omit<
  SdkRequestInput,
  'responseMode' | 'responseValidator'
> & {
  responseMode?: SdkResponseMode;
  responseValidator?: SdkResponseValidator<T>;
};

type InternalSdkConvenienceRequestOptions<T = unknown> = Omit<
  InternalSdkRequestInput<T>,
  'method' | 'path' | 'body'
>;

type InternalSdkOptionsRequestOptions<T = unknown> = InternalSdkConvenienceRequestOptions<T> & {
  schema?: boolean;
};

interface NormalizedRetryPolicy {
  maxRetries: number;
  delayMs: number;
  backoff: 'constant' | 'exponential';
  jitterRatio: number;
  retryableStatuses: ReadonlySet<number>;
  respectRetryAfter: boolean;
}

class TokenResolutionAbortedError extends Error {}

const isRequestAborted = (active: ActiveRequest) => active.controller.signal.aborted;

const defaultRequestId = () => globalThis.crypto.randomUUID();

const failConfiguration = (code: string, message: string): never => {
  throw new SdkConfigurationError(code, message);
};

const normalizeNonNegativeInteger = (
  value: number | undefined,
  fallback: number,
  field: string,
) => {
  const candidate = value ?? fallback;
  if (!Number.isInteger(candidate) || candidate < 0 || candidate > MAX_RETRIES) {
    failConfiguration(
      'SDK_RETRY_POLICY_INVALID',
      `${field} must be an integer from 0 through ${String(MAX_RETRIES)}.`,
    );
  }
  return candidate;
};

const normalizeDelay = (value: number | undefined, fallback: number) => {
  const candidate = value ?? fallback;
  if (!Number.isFinite(candidate) || candidate < 0 || candidate > MAX_RETRY_DELAY_MS) {
    failConfiguration(
      'SDK_RETRY_POLICY_INVALID',
      `retry.delayMs must be from 0 through ${String(MAX_RETRY_DELAY_MS)}.`,
    );
  }
  return candidate;
};

const normalizeJitterRatio = (value: number | undefined, fallback: number) => {
  const candidate = value ?? fallback;
  if (!Number.isFinite(candidate) || candidate < 0 || candidate > 1) {
    failConfiguration('SDK_RETRY_POLICY_INVALID', 'retry.jitterRatio must be from 0 through 1.');
  }
  return candidate;
};

const normalizeBackoff = (
  value: SdkRetryPolicy['backoff'],
  fallback: 'constant' | 'exponential',
) => {
  const candidate: unknown = value ?? fallback;
  if (candidate !== 'constant' && candidate !== 'exponential') {
    return failConfiguration(
      'SDK_RETRY_POLICY_INVALID',
      'retry.backoff must be constant or exponential.',
    );
  }
  return candidate;
};

const normalizeRetryableStatuses = (
  value: readonly number[] | undefined,
  fallback: ReadonlySet<number>,
) => {
  if (value === undefined) return new Set(fallback);
  const statuses = new Set<number>();
  for (const status of value) {
    if (!Number.isInteger(status) || status < 400 || status > 599) {
      failConfiguration(
        'SDK_RETRY_POLICY_INVALID',
        'retry.retryableStatuses must contain only integer HTTP statuses from 400 through 599.',
      );
    }
    statuses.add(status);
  }
  return statuses;
};

const normalizeTimeout = (
  value: number | null | undefined,
  fallback: number | null = DEFAULT_TIMEOUT_MS,
) => {
  const candidate = value === undefined ? fallback : value;
  if (candidate === null) return null;
  if (!Number.isFinite(candidate) || candidate <= 0) {
    failConfiguration('SDK_TIMEOUT_INVALID', 'timeoutMs must be a positive number or null.');
  }
  return candidate;
};

const normalizeMaxErrorBodyBytes = (value: number | undefined) => {
  const candidate = value ?? DEFAULT_MAX_ERROR_BODY_BYTES;
  if (!Number.isInteger(candidate) || candidate <= 0 || candidate > MAX_ERROR_BODY_BYTES) {
    failConfiguration(
      'SDK_ERROR_BODY_LIMIT_INVALID',
      `maxErrorBodyBytes must be an integer from 1 through ${String(MAX_ERROR_BODY_BYTES)}.`,
    );
  }
  return candidate;
};

const normalizeRetry = (
  requestPolicy: SdkRetryPolicy | undefined,
  instancePolicy: SdkRetryPolicy | NormalizedRetryPolicy | undefined,
): NormalizedRetryPolicy => {
  const instanceStatuses = instancePolicy?.retryableStatuses;
  const fallbackStatuses =
    instanceStatuses instanceof Set
      ? instanceStatuses
      : normalizeRetryableStatuses(instanceStatuses as readonly number[] | undefined, new Set());
  const instanceBackoff = normalizeBackoff(instancePolicy?.backoff, 'constant');
  const instanceJitter = normalizeJitterRatio(instancePolicy?.jitterRatio, 0);
  return {
    maxRetries: normalizeNonNegativeInteger(
      requestPolicy?.maxRetries,
      normalizeNonNegativeInteger(instancePolicy?.maxRetries, 0, 'retry.maxRetries'),
      'retry.maxRetries',
    ),
    delayMs: normalizeDelay(requestPolicy?.delayMs, normalizeDelay(instancePolicy?.delayMs, 0)),
    backoff: normalizeBackoff(requestPolicy?.backoff, instanceBackoff),
    jitterRatio: normalizeJitterRatio(requestPolicy?.jitterRatio, instanceJitter),
    retryableStatuses: normalizeRetryableStatuses(
      requestPolicy?.retryableStatuses,
      fallbackStatuses,
    ),
    respectRetryAfter:
      requestPolicy?.respectRetryAfter ?? instancePolicy?.respectRetryAfter ?? true,
  };
};

const hasInvalidHeaderCharacters = (value: string, rejectSpaces: boolean) => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < (rejectSpaces ? 33 : 32) || code === 127) return true;
  }
  return false;
};

const validateApiKey = (apiKey: string | undefined, required: boolean) => {
  if (apiKey === undefined) {
    if (required) {
      failConfiguration('SDK_API_KEY_MISSING', 'apiKey is required.');
    }
    return undefined;
  }
  if (!apiKey.trim()) {
    failConfiguration('SDK_API_KEY_MISSING', 'apiKey is required.');
  }
  if (apiKey.length > 512 || hasInvalidHeaderCharacters(apiKey, true)) {
    failConfiguration(
      'SDK_API_KEY_INVALID_FORMAT',
      'apiKey must be a header-safe value no longer than 512 characters.',
    );
  }
  return apiKey;
};

const validateIdempotencyKey = (value: string | undefined, method: SdkHttpMethod) => {
  if (value === undefined) return undefined;
  if (method === 'GET' || method === 'OPTIONS') {
    failConfiguration(
      'SDK_IDEMPOTENCY_KEY_NOT_ALLOWED',
      'idempotencyKey is available only for mutation requests.',
    );
  }
  if (
    !value ||
    value.length > MAX_IDEMPOTENCY_KEY_LENGTH ||
    hasInvalidHeaderCharacters(value, true)
  ) {
    failConfiguration(
      'SDK_IDEMPOTENCY_KEY_INVALID',
      'idempotencyKey must be a non-empty header-safe value no longer than 256 characters.',
    );
  }
  return value;
};

const validateDiagnosticIdentifier = (value: string, field: string) => {
  if (!DIAGNOSTIC_IDENTIFIER_PATTERN.test(value)) {
    failConfiguration(
      'SDK_DIAGNOSTIC_IDENTIFIER_INVALID',
      `${field} must be a bounded non-secret identifier.`,
    );
  }
  return value;
};

const normalizeAllowedInsecureOrigins = (origins: readonly string[] | undefined) => {
  const normalized = new Set<string>();
  for (const origin of origins ?? []) {
    const url = (() => {
      try {
        return new URL(origin);
      } catch {
        return failConfiguration(
          'SDK_ORIGIN_INVALID',
          `Invalid insecure development origin: ${origin}`,
        );
      }
    })();
    if (url.protocol !== 'http:' || url.origin !== origin.replace(/\/$/u, '')) {
      failConfiguration(
        'SDK_ORIGIN_INVALID',
        `Insecure development origins must be exact HTTP origins: ${origin}`,
      );
    }
    normalized.add(url.origin);
  }
  return normalized;
};

const normalizeServices = (
  services: Readonly<Record<string, SdkServiceConfig>>,
  allowedInsecureOrigins: ReadonlySet<string>,
) => {
  const normalized = new Map<string, NormalizedService>();
  for (const [name, service] of Object.entries(services)) {
    validateDiagnosticIdentifier(name, 'Service name');

    const baseUrl = (() => {
      try {
        return new URL(service.baseUrl);
      } catch {
        return failConfiguration(
          'SDK_SERVICE_URL_INVALID',
          `Service ${name} has an invalid baseUrl.`,
        );
      }
    })();
    if (baseUrl.username || baseUrl.password || baseUrl.hash || baseUrl.search) {
      failConfiguration(
        'SDK_SERVICE_URL_INVALID',
        `Service ${name} must not include userinfo or a URL fragment.`,
      );
    }
    if (
      baseUrl.protocol !== 'https:' &&
      !(baseUrl.protocol === 'http:' && allowedInsecureOrigins.has(baseUrl.origin))
    ) {
      failConfiguration(
        'SDK_SERVICE_PROTOCOL_UNSUPPORTED',
        `Service ${name} must use HTTPS or an explicitly allowed local HTTP origin.`,
      );
    }
    const applicationAuth: unknown = service.applicationAuth;
    if (
      applicationAuth !== undefined &&
      applicationAuth !== 'api-key' &&
      applicationAuth !== 'none'
    ) {
      failConfiguration(
        'SDK_APPLICATION_AUTH_INVALID',
        `Service ${name} has an invalid applicationAuth policy.`,
      );
    }
    const headerPolicy: unknown = service.headerPolicy;
    if (
      headerPolicy !== undefined &&
      headerPolicy !== 'standard' &&
      headerPolicy !== 'minimal' &&
      headerPolicy !== 'caller'
    ) {
      failConfiguration(
        'SDK_HEADER_POLICY_INVALID',
        `Service ${name} has an invalid headerPolicy.`,
      );
    }
    const redirectPolicy: unknown = service.redirectPolicy;
    if (redirectPolicy !== undefined && redirectPolicy !== 'error' && redirectPolicy !== 'follow') {
      failConfiguration(
        'SDK_REDIRECT_POLICY_INVALID',
        `Service ${name} has an invalid redirectPolicy.`,
      );
    }
    if ((applicationAuth ?? 'api-key') === 'api-key' && redirectPolicy === 'follow') {
      failConfiguration(
        'SDK_KEYED_REDIRECT_FOLLOW_REJECTED',
        `Service ${name} must reject redirects when application-key authentication is enabled.`,
      );
    }
    if (
      headerPolicy === 'minimal' &&
      (applicationAuth !== 'none' ||
        (service.auth?.kind ?? 'none') !== 'none' ||
        (service.auth?.credentials ?? 'omit') !== 'omit')
    ) {
      failConfiguration(
        'SDK_MINIMAL_HEADER_AUTH_REJECTED',
        `Service ${name} may use minimal headers only with keyless, no-user-auth requests.`,
      );
    }
    const allowedRedirectOrigins = new Set<string>();
    for (const origin of service.allowedRedirectOrigins ?? []) {
      let redirectOrigin: URL;
      try {
        redirectOrigin = new URL(origin);
      } catch {
        return failConfiguration(
          'SDK_REDIRECT_ORIGIN_INVALID',
          `Service ${name} has an invalid allowed redirect origin.`,
        );
      }
      if (
        redirectOrigin.origin !== origin.replace(/\/$/u, '') ||
        (redirectOrigin.protocol !== 'https:' && !allowedInsecureOrigins.has(redirectOrigin.origin))
      ) {
        failConfiguration(
          'SDK_REDIRECT_ORIGIN_INVALID',
          `Service ${name} redirect origins must be exact HTTPS origins or approved local HTTP origins.`,
        );
      }
      allowedRedirectOrigins.add(redirectOrigin.origin);
    }
    const auth = service.auth ?? { kind: 'none' };
    const normalizedAuth: SdkUserAuthStrategy = (() => {
      if (auth.kind === 'bearer') {
        const bearer =
          auth.credentials === undefined
            ? { kind: auth.kind, getToken: auth.getToken }
            : { kind: auth.kind, getToken: auth.getToken, credentials: auth.credentials };
        return auth.deduplicationScope === undefined
          ? bearer
          : { ...bearer, deduplicationScope: auth.deduplicationScope };
      }
      if (auth.kind === 'cookie') {
        const cookie =
          auth.credentials === undefined
            ? { kind: 'cookie' as const }
            : { kind: 'cookie' as const, credentials: auth.credentials };
        return auth.deduplicationScope === undefined
          ? cookie
          : { ...cookie, deduplicationScope: auth.deduplicationScope };
      }
      return auth.credentials === undefined
        ? { kind: 'none' }
        : { kind: 'none', credentials: auth.credentials };
    })();
    normalized.set(name, {
      baseUrl: new URL(baseUrl),
      applicationAuth: service.applicationAuth ?? 'api-key',
      headerPolicy: service.headerPolicy ?? 'standard',
      redirectPolicy: service.redirectPolicy ?? 'error',
      allowedRedirectOrigins,
      auth: normalizedAuth,
    });
  }
  if (normalized.size === 0) {
    failConfiguration('SDK_SERVICES_MISSING', 'At least one service must be configured.');
  }
  return normalized;
};

const resolveUrl = (service: string, config: NormalizedService, input: InternalSdkRequestInput) => {
  const url = (() => {
    try {
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(input.path)) {
        return new URL(input.path, config.baseUrl);
      }
      const baseUrl = new URL(config.baseUrl);
      if (!baseUrl.pathname.endsWith('/')) baseUrl.pathname = `${baseUrl.pathname}/`;
      return new URL(input.path.replace(/^\/+/, ''), baseUrl);
    } catch {
      return failConfiguration(
        'SDK_REQUEST_URL_INVALID',
        `Request path for service ${service} is invalid.`,
      );
    }
  })();
  if (url.origin !== config.baseUrl.origin || url.username || url.password) {
    failConfiguration(
      'SDK_REQUEST_ORIGIN_REJECTED',
      `Request path for service ${service} must remain on its configured exact origin.`,
    );
  }
  const basePath = config.baseUrl.pathname.endsWith('/')
    ? config.baseUrl.pathname
    : `${config.baseUrl.pathname}/`;
  const basePathWithoutSlash = basePath.slice(0, -1);
  if (url.pathname !== basePathWithoutSlash && !url.pathname.startsWith(basePath)) {
    failConfiguration(
      'SDK_REQUEST_BASE_PATH_REJECTED',
      `Request path for service ${service} must remain under its configured base path.`,
    );
  }
  const queryValue = (value: unknown): string => {
    if (value === null) return '';
    if (
      typeof value === 'string' ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))
    ) {
      return String(value);
    }
    return failConfiguration(
      'SDK_QUERY_VALUE_INVALID',
      'Query values must be strings, finite numbers, booleans, null, or undefined.',
    );
  };
  for (const [key, rawValue] of Object.entries(input.query ?? {})) {
    if (Array.isArray(rawValue)) {
      url.searchParams.delete(key);
      for (const value of rawValue) {
        if (value === undefined) continue;
        url.searchParams.append(key, queryValue(value));
      }
      continue;
    }
    if (rawValue === undefined) continue;
    url.searchParams.set(key, queryValue(rawValue));
  }
  return url;
};

const isBodyInit = (body: unknown): body is BodyInit =>
  typeof body === 'string' ||
  (typeof Blob !== 'undefined' && body instanceof Blob) ||
  (typeof FormData !== 'undefined' && body instanceof FormData) ||
  (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) ||
  (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) ||
  body instanceof ArrayBuffer ||
  ArrayBuffer.isView(body);

const prepareBody = (body: unknown, headers: Headers) => {
  if (body === undefined) return undefined;
  if (isBodyInit(body)) return body;
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  let serialized: string | undefined;
  try {
    serialized = (JSON.stringify as (value: unknown) => string | undefined)(body);
  } catch {
    return failConfiguration(
      'SDK_BODY_SERIALIZATION_FAILED',
      'The request body could not be serialized as JSON.',
    );
  }
  if (serialized === undefined) {
    return failConfiguration(
      'SDK_BODY_SERIALIZATION_FAILED',
      'The request body could not be serialized as JSON.',
    );
  }
  return serialized;
};

const prepareHeaders = async (
  apiKey: string | undefined,
  auth: SdkUserAuthStrategy,
  inputHeaders: HeadersInit | undefined,
  requestId: string,
  requestIdWasExplicit: boolean,
  signal: AbortSignal,
  headerPolicy: 'standard' | 'minimal' | 'caller',
  idempotencyKey: string | undefined,
) => {
  let headers: Headers;
  try {
    headers = new Headers(inputHeaders);
  } catch {
    return failConfiguration('SDK_HEADERS_INVALID', 'Caller headers are invalid.');
  }
  if (
    headers.has(APPLICATION_KEY_HEADER) ||
    headers.has('Authorization') ||
    headers.has(IDEMPOTENCY_KEY_HEADER)
  ) {
    failConfiguration(
      'SDK_SECURITY_HEADER_OVERRIDE_REJECTED',
      'Caller headers must not supply X-API-Key, Authorization, or Idempotency-Key.',
    );
  }
  if (headers.has(REQUEST_ID_HEADER)) {
    failConfiguration(
      'SDK_REQUEST_ID_HEADER_REJECTED',
      'Caller headers must not supply X-Request-ID; use requestId instead.',
    );
  }
  if (apiKey !== undefined) headers.set(APPLICATION_KEY_HEADER, apiKey);
  if (idempotencyKey !== undefined) headers.set(IDEMPOTENCY_KEY_HEADER, idempotencyKey);
  if (headerPolicy === 'standard' || (headerPolicy === 'caller' && requestIdWasExplicit)) {
    headers.set(REQUEST_ID_HEADER, requestId);
  }
  if (headerPolicy === 'standard') {
    headers.set('Accept', headers.get('Accept') ?? 'application/json');
  }
  if (auth.kind === 'bearer') {
    if (signal.aborted) throw new TokenResolutionAbortedError();
    let token: string | null | undefined;
    let removeAbortListener: (() => void) | undefined;
    try {
      const tokenPromise = Promise.resolve().then(auth.getToken);
      const abortPromise = new Promise<never>((_resolve, reject) => {
        const rejectOnAbort = () => reject(new TokenResolutionAbortedError());
        signal.addEventListener('abort', rejectOnAbort, { once: true });
        removeAbortListener = () => signal.removeEventListener('abort', rejectOnAbort);
      });
      token = await Promise.race([tokenPromise, abortPromise]);
    } catch (error) {
      if (error instanceof TokenResolutionAbortedError) throw error;
      return failConfiguration(
        'SDK_BEARER_TOKEN_RESOLUTION_FAILED',
        'The bearer token could not be resolved.',
      );
    } finally {
      removeAbortListener?.();
    }
    if (token) {
      if (hasInvalidHeaderCharacters(token, true)) {
        return failConfiguration(
          'SDK_BEARER_TOKEN_INVALID',
          'The bearer token is not header-safe.',
        );
      }
      headers.set('Authorization', `Bearer ${token}`);
    }
  }
  return headers;
};

const credentialsFor = (auth: SdkUserAuthStrategy): RequestCredentials => {
  if (auth.kind === 'cookie') return auth.credentials ?? 'include';
  return auth.credentials ?? 'omit';
};

const deduplicationScopeFor = (auth: SdkUserAuthStrategy) => {
  // `kind: none` means that the SDK does not add a user-auth header. It does
  // not make a request anonymous when Fetch can still attach ambient cookies.
  // Without an explicit identity scope, those reads must remain isolated.
  if (auth.kind === 'none') {
    return credentialsFor(auth) === 'omit' ? 'anonymous' : null;
  }
  if (!auth.deduplicationScope) return null;
  let scope: string | null | undefined;
  try {
    scope = auth.deduplicationScope();
  } catch {
    return failConfiguration(
      'SDK_DEDUPLICATION_SCOPE_FAILED',
      'The read-deduplication authentication scope could not be resolved.',
    );
  }
  if (scope === null || scope === undefined) return null;
  if (!scope || scope.length > 256 || hasInvalidHeaderCharacters(scope, false)) {
    return failConfiguration(
      'SDK_DEDUPLICATION_SCOPE_INVALID',
      'The read-deduplication authentication scope is invalid.',
    );
  }
  return scope;
};

const createReadDeduplicationKey = (
  serviceName: string,
  service: NormalizedService,
  input: InternalSdkRequestInput,
  url: URL,
  headers: Headers,
  timeoutMs: number | null,
  retry: NormalizedRetryPolicy,
) => {
  if (input.responseValidator !== undefined) return null;
  const authScope = deduplicationScopeFor(service.auth);
  if (authScope === null) return null;
  const canonicalUrl = new URL(url);
  canonicalUrl.searchParams.sort();
  const relevantHeaders = [...headers.entries()]
    .filter(([name]) => name !== 'authorization' && name !== 'x-api-key' && name !== 'x-request-id')
    .sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify([
    serviceName,
    input.method,
    canonicalUrl.href,
    service.applicationAuth,
    service.auth.kind,
    authScope,
    credentialsFor(service.auth),
    input.responseMode ?? 'auto',
    relevantHeaders,
    timeoutMs,
    retry.maxRetries,
    retry.delayMs,
    retry.backoff,
    retry.jitterRatio,
    [...retry.retryableStatuses].sort((left, right) => left - right),
    retry.respectRetryAfter,
  ]);
};

const parseRetryAfter = (value: string | null, now = Date.now()) => {
  if (value === null) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, timestamp - now);
};

const responseDeclaresJson = (response: Response) =>
  /(?:^|[/+])json(?:$|\s*;)/iu.test(response.headers.get('content-type') ?? '');

const readBoundedText = async (response: Response, maxBytes: number) => {
  if (!response.body) return { text: '', truncated: false };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return { text: text + decoder.decode(), truncated: false };
    const remaining = maxBytes - bytesRead;
    if (value.byteLength > remaining) {
      if (remaining > 0) text += decoder.decode(value.subarray(0, remaining), { stream: true });
      await reader.cancel();
      return { text: text + decoder.decode(), truncated: true };
    }
    bytesRead += value.byteLength;
    text += decoder.decode(value, { stream: true });
  }
};

const parseErrorResponse = async (
  response: Response,
  maxErrorBodyBytes: number,
  allowedRedirectOrigins: ReadonlySet<string>,
): Promise<ParsedResponse> => {
  if (response.status === 204 || response.status === 205) {
    return { value: undefined, parseFailed: false, bodyKind: 'empty' };
  }
  const { text, truncated } = await readBoundedText(response, maxErrorBodyBytes);
  if (!text) return { value: undefined, parseFailed: false, bodyKind: 'empty' as const };
  if (truncated) {
    return { value: { bodyTruncated: true }, parseFailed: true, bodyKind: 'truncated' as const };
  }
  const declaresJson = responseDeclaresJson(response);
  const trimmedText = text.trimStart();
  if (declaresJson || trimmedText.startsWith('{') || trimmedText.startsWith('[')) {
    try {
      return {
        value: sanitizeErrorDetails(JSON.parse(text), { allowedRedirectOrigins }),
        parseFailed: false,
        bodyKind: 'json' as const,
      };
    } catch {
      if (declaresJson) {
        return {
          value: { parseFailure: 'malformed-json' },
          parseFailed: true,
          bodyKind: 'malformed' as const,
        };
      }
    }
  }
  return {
    value: sanitizeErrorDetails({ message: text }, { allowedRedirectOrigins }),
    parseFailed: false,
    bodyKind: 'text' as const,
  };
};

const parseSuccessResponse = async (response: Response, mode: SdkResponseMode) => {
  if (response.status === 204 || response.status === 205) {
    if (mode === 'text') return '';
    if (mode === 'blob') return response.blob();
    if (mode === 'arrayBuffer') return response.arrayBuffer();
    return undefined;
  }
  const effectiveMode = mode === 'auto' ? (responseDeclaresJson(response) ? 'json' : 'text') : mode;
  if (effectiveMode === 'blob') return response.blob();
  if (effectiveMode === 'arrayBuffer') return response.arrayBuffer();
  if (effectiveMode === 'text') return response.text();
  return response.json() as Promise<unknown>;
};

const makeErrorContext = (
  service: string,
  diagnosticRoute: string,
  method: SdkHttpMethod,
  requestId: string,
  attempt: number,
  extra: Partial<SdkErrorContext> = {},
): SdkErrorContext => ({
  service,
  route: diagnosticRoute,
  method,
  requestId,
  attempts: attempt,
  ...extra,
});

const classifyHttpError = async (
  response: Response,
  context: SdkErrorContext,
  maxErrorBodyBytes: number,
  allowedRedirectOrigins: ReadonlySet<string>,
  now: () => number,
): Promise<SdkHttpError> => {
  const parsed = await parseErrorResponse(response, maxErrorBodyBytes, allowedRedirectOrigins);
  const errorContext = {
    ...context,
    status: response.status,
    details: parsed.value,
    bodyKind: parsed.bodyKind,
  };
  if (response.status === 401) {
    return new SdkAuthenticationError(response.headers, errorContext);
  }
  if (response.status === 403) {
    return new SdkAuthorizationError(response.headers, errorContext);
  }
  if (response.status === 400 || response.status === 409 || response.status === 422) {
    return new SdkValidationError(response.headers, errorContext);
  }
  if (response.status === 429) {
    return new SdkRateLimitError(
      response.headers,
      parseRetryAfter(response.headers.get('retry-after'), now()),
      errorContext,
    );
  }
  return new SdkHttpError(
    'SDK_HTTP_FAILED',
    `The request failed with HTTP ${String(response.status)}.`,
    response.headers,
    errorContext,
  );
};

const emitHook = async (
  hook: ((event: Readonly<SdkDiagnosticEvent>) => void | Promise<void>) | undefined,
  event: SdkDiagnosticEvent,
  signal: AbortSignal,
) => {
  if (!hook || signal.aborted) return;
  let removeAbortListener: (() => void) | undefined;
  try {
    const hookWork = Promise.resolve()
      .then(() => hook(Object.freeze({ ...event })))
      .catch(() => undefined);
    const abort = new Promise<void>((resolve) => {
      const resolveOnAbort = () => resolve();
      signal.addEventListener('abort', resolveOnAbort, { once: true });
      removeAbortListener = () => signal.removeEventListener('abort', resolveOnAbort);
      if (signal.aborted) resolveOnAbort();
    });
    await Promise.race([hookWork, abort]);
  } finally {
    removeAbortListener?.();
  }
};

const defaultSleep: SdkSleep = (delayMs, signal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('Retry wait aborted.'));
      return;
    }
    if (delayMs === 0) {
      resolve();
      return;
    }
    const rejectOnAbort = () => {
      clearTimeout(timer);
      reject(new Error('Retry wait aborted.'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', rejectOnAbort);
      resolve();
    }, delayMs);
    signal.addEventListener('abort', rejectOnAbort, { once: true });
  });

const calculateRetryDelay = (
  retry: NormalizedRetryPolicy,
  failedAttempt: number,
  retryAfterMs: number | null,
  random: () => number,
) => {
  const backoffMultiplier = retry.backoff === 'exponential' ? 2 ** (failedAttempt - 1) : 1;
  const baseDelay = Math.min(MAX_RETRY_DELAY_MS, retry.delayMs * backoffMultiplier);
  const retryAfterDelay = retry.respectRetryAfter ? (retryAfterMs ?? 0) : 0;
  const minimumRetryAfterDelay = Math.min(MAX_RETRY_DELAY_MS, retryAfterDelay);
  if (retry.jitterRatio === 0 || baseDelay === 0) {
    return Math.max(baseDelay, minimumRetryAfterDelay);
  }
  const randomValue = random();
  if (!Number.isFinite(randomValue) || randomValue < 0 || randomValue >= 1) {
    failConfiguration('SDK_RANDOM_INVALID', 'random must return a finite value from 0 up to 1.');
  }
  const jitterMultiplier = 1 + (randomValue * 2 - 1) * retry.jitterRatio;
  const jitteredBaseDelay = Math.min(
    MAX_RETRY_DELAY_MS,
    Math.max(0, Math.round(baseDelay * jitterMultiplier)),
  );
  return Math.max(jitteredBaseDelay, minimumRetryAfterDelay);
};

const waitForRetry = async (delayMs: number, active: ActiveRequest, sleep: SdkSleep) => {
  let removeAbortListener: (() => void) | undefined;
  try {
    const abort = new Promise<never>((_resolve, reject) => {
      const rejectOnAbort = () => reject(new Error('Retry wait aborted.'));
      active.controller.signal.addEventListener('abort', rejectOnAbort, { once: true });
      removeAbortListener = () =>
        active.controller.signal.removeEventListener('abort', rejectOnAbort);
      if (active.controller.signal.aborted) rejectOnAbort();
    });
    await Promise.race([
      Promise.resolve().then(() => sleep(delayMs, active.controller.signal)),
      abort,
    ]);
  } catch {
    if (active.controller.signal.aborted) throw new Error('Retry wait aborted.');
    throw new SdkConfigurationError('SDK_RETRY_SLEEP_FAILED', 'The injected retry sleeper failed.');
  } finally {
    removeAbortListener?.();
  }
  if (active.controller.signal.aborted) throw new Error('Retry wait aborted.');
};

/** @public */
export const createInvestSdkTransport = (config: InvestSdkTransportConfig): InvestSdkTransport => {
  const fetchImplementation = config.fetch ?? globalThis.fetch;
  if (typeof fetchImplementation !== 'function') {
    failConfiguration('SDK_FETCH_MISSING', 'A Fetch implementation is required.');
  }
  for (const [name, candidate] of [
    ['createRequestId', config.createRequestId],
    ['now', config.now],
    ['random', config.random],
    ['sleep', config.sleep],
  ] as const) {
    if (candidate !== undefined && typeof candidate !== 'function') {
      failConfiguration('SDK_CALLBACK_INVALID', `${name} must be a function.`);
    }
  }
  const insecureOrigins = normalizeAllowedInsecureOrigins(config.allowInsecureOrigins);
  const services = normalizeServices(config.services, insecureOrigins);
  const applicationKey = validateApiKey(
    config.apiKey,
    [...services.values()].some(({ applicationAuth }) => applicationAuth === 'api-key'),
  );
  const defaultTimeout = normalizeTimeout(config.timeoutMs);
  const maxErrorBodyBytes = normalizeMaxErrorBodyBytes(config.maxErrorBodyBytes);
  const defaultRetry = Object.freeze(normalizeRetry(undefined, config.retry));
  const deduplicateSafeReads = config.deduplicateSafeReads === true;
  const createRequestId = config.createRequestId ?? defaultRequestId;
  const now = config.now ?? Date.now;
  const random = config.random ?? Math.random;
  const sleep = config.sleep ?? defaultSleep;
  const currentTime = () => {
    const value = now();
    if (!Number.isFinite(value)) {
      failConfiguration('SDK_CLOCK_INVALID', 'now must return a finite timestamp.');
    }
    return value;
  };
  const hooks = Object.freeze({ ...config.hooks });
  const activeRequests = new Set<ActiveRequest>();
  const inFlightReads = new Map<string, Promise<SdkResult<unknown>>>();
  let disposed = false;

  const emitDiagnostic = (
    hook: ((event: Readonly<SdkDiagnosticEvent>) => void | Promise<void>) | undefined,
    event: SdkDiagnosticEvent,
    signal: AbortSignal,
  ) => (disposed ? Promise.resolve() : emitHook(hook, event, signal));

  const request = async <T>(
    serviceName: string,
    input: InternalSdkRequestInput<T>,
  ): Promise<SdkResult<T>> => {
    if (disposed) failConfiguration('SDK_DISPOSED', 'This SDK transport has been disposed.');
    if (!HTTP_METHODS.has(input.method)) {
      failConfiguration('SDK_METHOD_INVALID', 'The request method is not supported.');
    }
    if (input.responseMode !== undefined && !RESPONSE_MODES.has(input.responseMode)) {
      failConfiguration('SDK_RESPONSE_MODE_INVALID', 'The response mode is not supported.');
    }
    const service =
      services.get(serviceName) ??
      failConfiguration('SDK_SERVICE_UNKNOWN', `Unknown SDK service: ${serviceName}`);
    const diagnosticRoute =
      input.operationId === undefined
        ? `service:${serviceName}`
        : validateDiagnosticIdentifier(input.operationId, 'operationId');
    if ((input.method === 'GET' || input.method === 'OPTIONS') && input.body !== undefined) {
      failConfiguration(
        'SDK_READ_BODY_REJECTED',
        `${input.method} requests must not include a body.`,
      );
    }

    const url = resolveUrl(serviceName, service, input);
    if (service.headerPolicy === 'minimal' && input.requestId !== undefined) {
      failConfiguration(
        'SDK_REQUEST_ID_NOT_ALLOWED',
        'requestId is not available for minimal-header services.',
      );
    }
    const requestId = input.requestId ?? createRequestId();
    if (
      !requestId ||
      requestId.length > MAX_REQUEST_ID_LENGTH ||
      hasInvalidHeaderCharacters(requestId, false)
    ) {
      failConfiguration(
        'SDK_REQUEST_ID_INVALID',
        'requestId must be a non-empty header-safe value no longer than 256 characters.',
      );
    }
    const retry = normalizeRetry(input.retry, defaultRetry);
    const safeRead = input.method === 'GET' || input.method === 'OPTIONS';
    const idempotencyKey = validateIdempotencyKey(input.idempotencyKey, input.method);
    const requestTimeout = normalizeTimeout(input.timeoutMs, defaultTimeout);
    const active: ActiveRequest = { controller: new AbortController() };
    activeRequests.add(active);
    const callerAbort = () => {
      if (!active.kind) {
        active.kind = 'caller';
        active.controller.abort(input.signal?.reason);
      }
    };
    if (input.signal?.aborted) callerAbort();
    else input.signal?.addEventListener('abort', callerAbort, { once: true });
    const timeout =
      requestTimeout === null
        ? undefined
        : setTimeout(() => {
            if (!active.kind) {
              active.kind = 'timeout';
              active.controller.abort();
            }
          }, requestTimeout);

    let attempt = 0;
    try {
      let headers: Headers;
      try {
        headers = await prepareHeaders(
          service.applicationAuth === 'api-key' ? applicationKey : undefined,
          service.auth,
          input.headers,
          requestId,
          input.requestId !== undefined,
          active.controller.signal,
          service.headerPolicy,
          idempotencyKey,
        );
      } catch (error) {
        if (!isRequestAborted(active)) throw error;
        const context = makeErrorContext(
          serviceName,
          diagnosticRoute,
          input.method,
          requestId,
          attempt,
        );
        throw active.kind === 'timeout' ? new SdkTimeoutError(context) : new SdkAbortError(context);
      }
      const body = prepareBody(input.body, headers);
      if (active.controller.signal.aborted) {
        const context = makeErrorContext(
          serviceName,
          diagnosticRoute,
          input.method,
          requestId,
          attempt,
        );
        throw active.kind === 'timeout' ? new SdkTimeoutError(context) : new SdkAbortError(context);
      }
      const execute = async (): Promise<SdkResult<T>> => {
        for (;;) {
          attempt += 1;
          const diagnosticBase = {
            service: serviceName,
            route: diagnosticRoute,
            method: input.method,
            requestId,
            attempt,
          } as const;
          try {
            if (hooks.onRequest) {
              await emitDiagnostic(
                hooks.onRequest,
                { phase: 'request', ...diagnosticBase },
                active.controller.signal,
              );
            }
            if (isRequestAborted(active)) throw new Error('Request aborted during request hooks.');
            const requestInit: RequestInit = {
              method: input.method,
              headers,
              credentials: credentialsFor(service.auth),
              redirect: service.redirectPolicy,
              signal: active.controller.signal,
            };
            if (body !== undefined) requestInit.body = body;
            const response = await fetchImplementation(url, requestInit);
            if (isRequestAborted(active)) throw new Error('Request aborted after Fetch resolved.');
            if (!response.ok) {
              const httpError = await classifyHttpError(
                response,
                makeErrorContext(serviceName, diagnosticRoute, input.method, requestId, attempt),
                maxErrorBodyBytes,
                service.allowedRedirectOrigins,
                currentTime,
              );
              if (hooks.onError) {
                await emitDiagnostic(
                  hooks.onError,
                  {
                    phase: 'error',
                    ...diagnosticBase,
                    status: response.status,
                    errorCode: httpError.code,
                  },
                  active.controller.signal,
                );
              }
              if (isRequestAborted(active)) throw new Error('Request aborted during error hooks.');
              if (
                safeRead &&
                attempt <= retry.maxRetries &&
                retry.retryableStatuses.has(response.status)
              ) {
                const retryAfterHeader = response.headers.get('retry-after');
                const retryAfterMs =
                  retryAfterHeader === null
                    ? null
                    : parseRetryAfter(retryAfterHeader, currentTime());
                await waitForRetry(
                  calculateRetryDelay(retry, attempt, retryAfterMs, random),
                  active,
                  sleep,
                );
                continue;
              }
              throw httpError;
            }

            let parsedData: unknown;
            try {
              parsedData = await parseSuccessResponse(response, input.responseMode ?? 'auto');
            } catch {
              if (isRequestAborted(active)) {
                throw new Error('Request aborted while parsing the response.');
              }
              const parseError = new SdkResponseParseError(
                makeErrorContext(serviceName, diagnosticRoute, input.method, requestId, attempt, {
                  status: response.status,
                  details: { parseFailure: 'malformed-json' },
                }),
              );
              if (hooks.onError) {
                await emitDiagnostic(
                  hooks.onError,
                  {
                    phase: 'error',
                    ...diagnosticBase,
                    status: response.status,
                    errorCode: parseError.code,
                  },
                  active.controller.signal,
                );
              }
              if (isRequestAborted(active)) throw new Error('Request aborted during error hooks.');
              throw parseError;
            }
            if (isRequestAborted(active))
              throw new Error('Request aborted while parsing the response.');
            let data: T;
            if (input.responseValidator) {
              try {
                data = input.responseValidator(parsedData);
                if (
                  typeof data === 'object' &&
                  data !== null &&
                  'then' in data &&
                  typeof data.then === 'function'
                ) {
                  void Promise.resolve(data).catch(() => undefined);
                  throw new Error('Response validators must be synchronous.');
                }
              } catch {
                const validationError = new SdkResponseValidationError(
                  makeErrorContext(serviceName, diagnosticRoute, input.method, requestId, attempt, {
                    status: response.status,
                    details: { validationFailure: 'response-schema' },
                  }),
                );
                if (hooks.onError) {
                  await emitDiagnostic(
                    hooks.onError,
                    {
                      phase: 'error',
                      ...diagnosticBase,
                      status: response.status,
                      errorCode: validationError.code,
                    },
                    active.controller.signal,
                  );
                }
                if (isRequestAborted(active)) {
                  throw new Error('Request aborted during error hooks.');
                }
                throw validationError;
              }
            } else {
              data = parsedData as T;
            }
            const responseRequestId = response.headers.get('x-request-id') ?? requestId;
            if (hooks.onResponse) {
              await emitDiagnostic(
                hooks.onResponse,
                {
                  phase: 'response',
                  ...diagnosticBase,
                  status: response.status,
                },
                active.controller.signal,
              );
            }
            if (isRequestAborted(active)) throw new Error('Request aborted during response hooks.');
            return {
              data,
              status: response.status,
              headers: new Headers(response.headers),
              requestId: responseRequestId,
            };
          } catch (error) {
            if (error instanceof InvestSdkError) throw error;
            if (isRequestAborted(active)) {
              const context = makeErrorContext(
                serviceName,
                diagnosticRoute,
                input.method,
                requestId,
                attempt,
              );
              const abortError =
                active.kind === 'timeout'
                  ? new SdkTimeoutError(context)
                  : new SdkAbortError(context);
              if (hooks.onError) {
                await emitDiagnostic(
                  hooks.onError,
                  {
                    phase: 'error',
                    ...diagnosticBase,
                    errorCode: abortError.code,
                  },
                  active.controller.signal,
                );
              }
              throw abortError;
            }
            if (safeRead && attempt <= retry.maxRetries) {
              try {
                await waitForRetry(
                  calculateRetryDelay(retry, attempt, null, random),
                  active,
                  sleep,
                );
              } catch (retryError) {
                if (!isRequestAborted(active)) throw retryError;
                const context = makeErrorContext(
                  serviceName,
                  diagnosticRoute,
                  input.method,
                  requestId,
                  attempt,
                );
                const abortError =
                  active.kind === 'timeout'
                    ? new SdkTimeoutError(context)
                    : new SdkAbortError(context);
                if (hooks.onError) {
                  await emitDiagnostic(
                    hooks.onError,
                    {
                      phase: 'error',
                      ...diagnosticBase,
                      errorCode: abortError.code,
                    },
                    active.controller.signal,
                  );
                }
                throw abortError;
              }
              continue;
            }
            const networkError = new SdkNetworkError(
              makeErrorContext(serviceName, diagnosticRoute, input.method, requestId, attempt),
            );
            if (hooks.onError) {
              await emitDiagnostic(
                hooks.onError,
                {
                  phase: 'error',
                  ...diagnosticBase,
                  errorCode: networkError.code,
                },
                active.controller.signal,
              );
            }
            if (isRequestAborted(active)) {
              const context = makeErrorContext(
                serviceName,
                diagnosticRoute,
                input.method,
                requestId,
                attempt,
              );
              throw active.kind === 'timeout'
                ? new SdkTimeoutError(context)
                : new SdkAbortError(context);
            }
            throw networkError;
          }
        }
      };

      if (!deduplicateSafeReads || !safeRead || input.signal !== undefined) return await execute();
      const deduplicationKey = createReadDeduplicationKey(
        serviceName,
        service,
        input,
        url,
        headers,
        requestTimeout,
        retry,
      );
      if (deduplicationKey === null) return await execute();
      const existing = inFlightReads.get(deduplicationKey);
      if (existing) return (await existing) as SdkResult<T>;

      const execution = execute();
      inFlightReads.set(deduplicationKey, execution);
      try {
        return await execution;
      } finally {
        if (inFlightReads.get(deduplicationKey) === execution) {
          inFlightReads.delete(deduplicationKey);
        }
      }
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      input.signal?.removeEventListener('abort', callerAbort);
      activeRequests.delete(active);
    }
  };

  const createServiceClient = (serviceName: string): SdkServiceClient => {
    if (!services.has(serviceName)) {
      failConfiguration('SDK_SERVICE_UNKNOWN', `Unknown SDK service: ${serviceName}`);
    }

    /* eslint-disable no-redeclare -- TypeScript overloads enforce the validator/mode contract. */
    function requestForService<T>(input: SdkValidatedRequestInput<T>): Promise<SdkResult<T>>;
    function requestForService<Mode extends 'text' | 'blob' | 'arrayBuffer'>(
      input: SdkRequestInput<Mode> & { responseMode: Mode },
    ): Promise<SdkResult<SdkResponseData<Mode>>>;
    function requestForService(input: SdkRequestInput): Promise<SdkResult<unknown>>;
    function requestForService(input: InternalSdkRequestInput): Promise<SdkResult<unknown>> {
      return request(serviceName, input);
    }

    function getForService<T>(
      path: string,
      options: SdkValidatedConvenienceRequestOptions<T>,
    ): Promise<SdkResult<T>>;
    function getForService<Mode extends 'text' | 'blob' | 'arrayBuffer'>(
      path: string,
      options: SdkConvenienceRequestOptions<Mode> & { responseMode: Mode },
    ): Promise<SdkResult<SdkResponseData<Mode>>>;
    function getForService(
      path: string,
      options?: SdkConvenienceRequestOptions,
    ): Promise<SdkResult<unknown>>;
    function getForService(
      path: string,
      options: InternalSdkConvenienceRequestOptions = {},
    ): Promise<SdkResult<unknown>> {
      return request(serviceName, { ...options, method: 'GET', path });
    }

    function optionsForService<T>(
      path: string,
      options: SdkValidatedOptionsRequestOptions<T>,
    ): Promise<SdkResult<T>>;
    function optionsForService<Mode extends 'text' | 'blob' | 'arrayBuffer'>(
      path: string,
      options: SdkOptionsRequestOptions<Mode> & { responseMode: Mode },
    ): Promise<SdkResult<SdkResponseData<Mode>>>;
    function optionsForService(
      path: string,
      options?: SdkOptionsRequestOptions,
    ): Promise<SdkResult<unknown>>;
    function optionsForService(
      path: string,
      options: InternalSdkOptionsRequestOptions = {},
    ): Promise<SdkResult<unknown>> {
      const { schema = true, query, ...requestOptions } = options;
      const schemaQuery = schema ? { ...query, schema: 1 } : query;
      const input: InternalSdkRequestInput = {
        ...requestOptions,
        method: 'OPTIONS',
        path,
      };
      if (schemaQuery !== undefined) input.query = schemaQuery;
      return request(serviceName, input);
    }

    const withMethod = (
      method: SdkHttpMethod,
      path: string,
      body: unknown,
      options: InternalSdkConvenienceRequestOptions = {},
    ): Promise<SdkResult<unknown>> => request(serviceName, { ...options, method, path, body });

    function postForService<T>(
      path: string,
      body: unknown,
      options: SdkValidatedConvenienceRequestOptions<T>,
    ): Promise<SdkResult<T>>;
    function postForService<Mode extends 'text' | 'blob' | 'arrayBuffer'>(
      path: string,
      body: unknown,
      options: SdkConvenienceRequestOptions<Mode> & { responseMode: Mode },
    ): Promise<SdkResult<SdkResponseData<Mode>>>;
    function postForService(
      path: string,
      body?: unknown,
      options?: SdkConvenienceRequestOptions,
    ): Promise<SdkResult<unknown>>;
    function postForService(
      path: string,
      body?: unknown,
      options?: InternalSdkConvenienceRequestOptions,
    ): Promise<SdkResult<unknown>> {
      return withMethod('POST', path, body, options);
    }

    function putForService<T>(
      path: string,
      body: unknown,
      options: SdkValidatedConvenienceRequestOptions<T>,
    ): Promise<SdkResult<T>>;
    function putForService<Mode extends 'text' | 'blob' | 'arrayBuffer'>(
      path: string,
      body: unknown,
      options: SdkConvenienceRequestOptions<Mode> & { responseMode: Mode },
    ): Promise<SdkResult<SdkResponseData<Mode>>>;
    function putForService(
      path: string,
      body?: unknown,
      options?: SdkConvenienceRequestOptions,
    ): Promise<SdkResult<unknown>>;
    function putForService(
      path: string,
      body?: unknown,
      options?: InternalSdkConvenienceRequestOptions,
    ): Promise<SdkResult<unknown>> {
      return withMethod('PUT', path, body, options);
    }

    function patchForService<T>(
      path: string,
      body: unknown,
      options: SdkValidatedConvenienceRequestOptions<T>,
    ): Promise<SdkResult<T>>;
    function patchForService<Mode extends 'text' | 'blob' | 'arrayBuffer'>(
      path: string,
      body: unknown,
      options: SdkConvenienceRequestOptions<Mode> & { responseMode: Mode },
    ): Promise<SdkResult<SdkResponseData<Mode>>>;
    function patchForService(
      path: string,
      body?: unknown,
      options?: SdkConvenienceRequestOptions,
    ): Promise<SdkResult<unknown>>;
    function patchForService(
      path: string,
      body?: unknown,
      options?: InternalSdkConvenienceRequestOptions,
    ): Promise<SdkResult<unknown>> {
      return withMethod('PATCH', path, body, options);
    }

    function deleteForService<T>(
      path: string,
      body: unknown,
      options: SdkValidatedConvenienceRequestOptions<T>,
    ): Promise<SdkResult<T>>;
    function deleteForService<Mode extends 'text' | 'blob' | 'arrayBuffer'>(
      path: string,
      body: unknown,
      options: SdkConvenienceRequestOptions<Mode> & { responseMode: Mode },
    ): Promise<SdkResult<SdkResponseData<Mode>>>;
    function deleteForService(
      path: string,
      body?: unknown,
      options?: SdkConvenienceRequestOptions,
    ): Promise<SdkResult<unknown>>;
    function deleteForService(
      path: string,
      body?: unknown,
      options?: InternalSdkConvenienceRequestOptions,
    ): Promise<SdkResult<unknown>> {
      return withMethod('DELETE', path, body, options);
    }
    /* eslint-enable no-redeclare */

    return Object.freeze({
      request: requestForService,
      get: getForService,
      options: optionsForService,
      post: postForService,
      put: putForService,
      patch: patchForService,
      delete: deleteForService,
    });
  };

  return Object.freeze({
    createServiceClient,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const active of activeRequests) {
        if (!active.kind) {
          active.kind = 'disposed';
          active.controller.abort();
        }
      }
      activeRequests.clear();
      inFlightReads.clear();
    },
  });
};
