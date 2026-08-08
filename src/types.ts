/** @public */
export type SdkHttpMethod = 'GET' | 'OPTIONS' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** @public */
export type SdkResponseMode = 'auto' | 'json' | 'text' | 'blob' | 'arrayBuffer';

/**
 * Data produced by an unvalidated response mode. Explicit text and binary
 * modes return their corresponding empty value for 204/205 responses. JSON
 * and automatic parsing remain `unknown` until a runtime validator proves a
 * narrower type.
 *
 * @public
 */
export type SdkResponseData<Mode extends SdkResponseMode> = Mode extends 'text'
  ? string
  : Mode extends 'blob'
    ? Blob
    : Mode extends 'arrayBuffer'
      ? ArrayBuffer
      : unknown;

/** @public */
export type SdkErrorBodyKind = 'json' | 'text' | 'empty' | 'malformed' | 'truncated';

/** @public */
export type SdkQueryValue = string | number | boolean | null | undefined;

/** @public */
export interface SdkResult<T> {
  data: T;
  status: number;
  headers: Headers;
  requestId?: string;
}

/** @public */
export interface SdkRetryPolicy {
  maxRetries?: number;
  delayMs?: number;
  backoff?: 'constant' | 'exponential';
  /** Fraction from 0 through 1 applied symmetrically to the calculated delay. */
  jitterRatio?: number;
  /** HTTP statuses eligible for opt-in safe-read retries. Network failures remain eligible. */
  retryableStatuses?: readonly number[];
  respectRetryAfter?: boolean;
}

/**
 * Synchronous response validator. Promise-like results are rejected because
 * validation completes inside the response boundary before the SDK returns.
 *
 * @public
 */
export type SdkResponseValidator<T> = (
  value: unknown,
) => T extends object ? T & { readonly then?: never } : T;

/** @public */
export type SdkSleep = (delayMs: number, signal: AbortSignal) => Promise<void>;

/** @public */
export interface SdkServiceConfig {
  baseUrl: string;
  applicationAuth?: 'api-key' | 'none';
  headerPolicy?: 'standard' | 'minimal' | 'caller';
  redirectPolicy?: 'error' | 'follow';
  allowedRedirectOrigins?: readonly string[];
  auth?: SdkUserAuthStrategy;
}

/** @public */
export interface SdkCookieAuthStrategy {
  kind: 'cookie';
  credentials?: 'include' | 'same-origin';
  deduplicationScope?: () => string | null | undefined;
}

/** @public */
export interface SdkBearerAuthStrategy {
  kind: 'bearer';
  getToken: () => string | null | undefined | Promise<string | null | undefined>;
  credentials?: 'omit' | 'same-origin' | 'include';
  deduplicationScope?: () => string | null | undefined;
}

/** @public */
export interface SdkNoUserAuthStrategy {
  kind: 'none';
  credentials?: 'omit' | 'same-origin' | 'include';
}

/** @public */
export type SdkUserAuthStrategy =
  SdkCookieAuthStrategy | SdkBearerAuthStrategy | SdkNoUserAuthStrategy;

/**
 * An unvalidated request. The response type is derived only from
 * `responseMode`; JSON and automatic parsing produce `unknown`.
 *
 * @public
 */
export interface SdkRequestInput<Mode extends SdkResponseMode = SdkResponseMode> {
  method: SdkHttpMethod;
  path: string;
  operationId?: string;
  requestId?: string;
  query?: Record<string, SdkQueryValue | readonly SdkQueryValue[]>;
  headers?: HeadersInit;
  body?: unknown;
  responseMode?: Mode;
  signal?: AbortSignal;
  /** `null` disables the transport timeout for temporary legacy compatibility facades. */
  timeoutMs?: number | null;
  retry?: SdkRetryPolicy;
  /** Explicit transport-only idempotency key. It never enables mutation retries by itself. */
  idempotencyKey?: string;
  /** Validators belong to `SdkValidatedRequestInput`; this keeps unvalidated calls unknown. */
  responseValidator?: never;
}

/**
 * A request whose parsed response is synchronously proven by a runtime
 * validator.
 *
 * @public
 */
export type SdkValidatedRequestInput<T> = ([T] extends [never]
  ? unknown
  : [T] extends [PromiseLike<unknown>]
    ? never
    : unknown) &
  Omit<SdkRequestInput, 'responseMode' | 'responseValidator'> & {
    responseMode?: SdkResponseMode;
    /** Runtime boundary validator. Its exception is replaced by a sanitized SDK error. */
    responseValidator: SdkResponseValidator<T>;
  };

/** @public */
export type SdkConvenienceRequestOptions<Mode extends SdkResponseMode = SdkResponseMode> = Omit<
  SdkRequestInput<Mode>,
  'method' | 'path' | 'body'
>;

/** @public */
export type SdkValidatedConvenienceRequestOptions<T> = Omit<
  SdkValidatedRequestInput<T>,
  'method' | 'path' | 'body'
>;

/** @public */
export type SdkOptionsRequestOptions<Mode extends SdkResponseMode = SdkResponseMode> =
  SdkConvenienceRequestOptions<Mode> & {
    schema?: boolean;
  };

/** @public */
export type SdkValidatedOptionsRequestOptions<T> = SdkValidatedConvenienceRequestOptions<T> & {
  schema?: boolean;
};

/** @public */
export interface SdkDiagnosticEvent {
  phase: 'request' | 'response' | 'error';
  service: string;
  route: string;
  method: SdkHttpMethod;
  requestId: string;
  attempt: number;
  status?: number;
  errorCode?: string;
}

/** @public */
export interface SdkHooks {
  onRequest?: (event: Readonly<SdkDiagnosticEvent>) => void | Promise<void>;
  onResponse?: (event: Readonly<SdkDiagnosticEvent>) => void | Promise<void>;
  onError?: (event: Readonly<SdkDiagnosticEvent>) => void | Promise<void>;
}

/** @public */
export interface InvestSdkTransportConfig {
  apiKey?: string;
  services: Readonly<Record<string, SdkServiceConfig>>;
  fetch?: typeof fetch;
  createRequestId?: () => string;
  timeoutMs?: number | null;
  maxErrorBodyBytes?: number;
  retry?: SdkRetryPolicy;
  deduplicateSafeReads?: boolean;
  hooks?: SdkHooks;
  allowInsecureOrigins?: readonly string[];
  /** Injectable deterministic clock used only for Retry-After HTTP-date calculations. */
  now?: () => number;
  /** Injectable deterministic random source used only when retry jitter is enabled. */
  random?: () => number;
  /** Injectable abort-aware sleeper used between retries. */
  sleep?: SdkSleep;
}

/** @public */
export interface SdkServiceClient {
  request<T>(input: SdkValidatedRequestInput<T>): Promise<SdkResult<T>>;
  request<Mode extends 'text' | 'blob' | 'arrayBuffer'>(
    input: SdkRequestInput<Mode> & { responseMode: Mode },
  ): Promise<SdkResult<SdkResponseData<Mode>>>;
  request(input: SdkRequestInput): Promise<SdkResult<unknown>>;
  get<T>(path: string, options: SdkValidatedConvenienceRequestOptions<T>): Promise<SdkResult<T>>;
  get<Mode extends 'text' | 'blob' | 'arrayBuffer'>(
    path: string,
    options: SdkConvenienceRequestOptions<Mode> & { responseMode: Mode },
  ): Promise<SdkResult<SdkResponseData<Mode>>>;
  get(path: string, options?: SdkConvenienceRequestOptions): Promise<SdkResult<unknown>>;
  options<T>(path: string, options: SdkValidatedOptionsRequestOptions<T>): Promise<SdkResult<T>>;
  options<Mode extends 'text' | 'blob' | 'arrayBuffer'>(
    path: string,
    options: SdkOptionsRequestOptions<Mode> & { responseMode: Mode },
  ): Promise<SdkResult<SdkResponseData<Mode>>>;
  options(path: string, options?: SdkOptionsRequestOptions): Promise<SdkResult<unknown>>;
  post<T>(
    path: string,
    body: unknown,
    options: SdkValidatedConvenienceRequestOptions<T>,
  ): Promise<SdkResult<T>>;
  post<Mode extends 'text' | 'blob' | 'arrayBuffer'>(
    path: string,
    body: unknown,
    options: SdkConvenienceRequestOptions<Mode> & { responseMode: Mode },
  ): Promise<SdkResult<SdkResponseData<Mode>>>;
  post(
    path: string,
    body?: unknown,
    options?: SdkConvenienceRequestOptions,
  ): Promise<SdkResult<unknown>>;
  put<T>(
    path: string,
    body: unknown,
    options: SdkValidatedConvenienceRequestOptions<T>,
  ): Promise<SdkResult<T>>;
  put<Mode extends 'text' | 'blob' | 'arrayBuffer'>(
    path: string,
    body: unknown,
    options: SdkConvenienceRequestOptions<Mode> & { responseMode: Mode },
  ): Promise<SdkResult<SdkResponseData<Mode>>>;
  put(
    path: string,
    body?: unknown,
    options?: SdkConvenienceRequestOptions,
  ): Promise<SdkResult<unknown>>;
  patch<T>(
    path: string,
    body: unknown,
    options: SdkValidatedConvenienceRequestOptions<T>,
  ): Promise<SdkResult<T>>;
  patch<Mode extends 'text' | 'blob' | 'arrayBuffer'>(
    path: string,
    body: unknown,
    options: SdkConvenienceRequestOptions<Mode> & { responseMode: Mode },
  ): Promise<SdkResult<SdkResponseData<Mode>>>;
  patch(
    path: string,
    body?: unknown,
    options?: SdkConvenienceRequestOptions,
  ): Promise<SdkResult<unknown>>;
  delete<T>(
    path: string,
    body: unknown,
    options: SdkValidatedConvenienceRequestOptions<T>,
  ): Promise<SdkResult<T>>;
  delete<Mode extends 'text' | 'blob' | 'arrayBuffer'>(
    path: string,
    body: unknown,
    options: SdkConvenienceRequestOptions<Mode> & { responseMode: Mode },
  ): Promise<SdkResult<SdkResponseData<Mode>>>;
  delete(
    path: string,
    body?: unknown,
    options?: SdkConvenienceRequestOptions,
  ): Promise<SdkResult<unknown>>;
}

/** @public */
export interface InvestSdkTransport {
  createServiceClient(service: string): SdkServiceClient;
  dispose(): void;
}
