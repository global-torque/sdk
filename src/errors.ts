import type { SdkErrorBodyKind, SdkHttpMethod } from './types.js';

/** @public */
export interface SdkErrorContext {
  service?: string;
  route?: string;
  method?: SdkHttpMethod;
  requestId?: string;
  status?: number;
  attempts?: number;
  details?: unknown;
  bodyKind?: SdkErrorBodyKind;
}

/** @public */
export class InvestSdkError extends Error {
  readonly code: string;
  readonly service?: string;
  readonly route?: string;
  readonly method?: SdkHttpMethod;
  readonly requestId?: string;
  readonly status?: number;
  readonly attempts?: number;
  readonly details?: unknown;
  readonly bodyKind?: SdkErrorBodyKind;

  constructor(name: string, code: string, message: string, context: SdkErrorContext = {}) {
    super(message);
    this.name = name;
    this.code = code;
    if (context.service !== undefined) this.service = context.service;
    if (context.route !== undefined) this.route = context.route;
    if (context.method !== undefined) this.method = context.method;
    if (context.requestId !== undefined) this.requestId = context.requestId;
    if (context.status !== undefined) this.status = context.status;
    if (context.attempts !== undefined) this.attempts = context.attempts;
    if (context.details !== undefined) this.details = context.details;
    if (context.bodyKind !== undefined) this.bodyKind = context.bodyKind;
  }
}

/** @public */
export class SdkConfigurationError extends InvestSdkError {
  constructor(code: string, message: string) {
    super('SdkConfigurationError', code, message);
  }
}

/** @public */
export class SdkHttpError extends InvestSdkError {
  readonly headers: Headers;

  constructor(code: string, message: string, headers: Headers, context: SdkErrorContext) {
    super('SdkHttpError', code, message, context);
    this.headers = new Headers();
    for (const name of ['content-type', 'retry-after', 'x-request-id']) {
      const value = headers.get(name);
      if (value !== null) this.headers.set(name, value);
    }
  }
}

/** @public */
export class SdkAuthenticationError extends SdkHttpError {
  constructor(headers: Headers, context: SdkErrorContext) {
    super(
      'SDK_AUTHENTICATION_FAILED',
      'Application or user authentication failed.',
      headers,
      context,
    );
    this.name = 'SdkAuthenticationError';
  }
}

/** @public */
export class SdkAuthorizationError extends SdkHttpError {
  constructor(headers: Headers, context: SdkErrorContext) {
    super(
      'SDK_AUTHORIZATION_FAILED',
      'The application or user is not authorized.',
      headers,
      context,
    );
    this.name = 'SdkAuthorizationError';
  }
}

/** @public */
export class SdkValidationError extends SdkHttpError {
  constructor(headers: Headers, context: SdkErrorContext) {
    super('SDK_VALIDATION_FAILED', 'The request was rejected by validation.', headers, context);
    this.name = 'SdkValidationError';
  }
}

/** @public */
export class SdkRateLimitError extends SdkHttpError {
  readonly retryAfterMs: number | null;

  constructor(headers: Headers, retryAfterMs: number | null, context: SdkErrorContext) {
    super('SDK_RATE_LIMITED', 'The request was rate limited.', headers, context);
    this.name = 'SdkRateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

/** @public */
export class SdkResponseParseError extends InvestSdkError {
  constructor(context: SdkErrorContext) {
    super(
      'SdkResponseParseError',
      'SDK_RESPONSE_PARSE_FAILED',
      'The response body could not be parsed.',
      context,
    );
  }
}

/** @public */
export class SdkResponseValidationError extends InvestSdkError {
  constructor(context: SdkErrorContext) {
    super(
      'SdkResponseValidationError',
      'SDK_RESPONSE_VALIDATION_FAILED',
      'The response did not match its runtime contract.',
      context,
    );
  }
}

/** @public */
export class SdkNetworkError extends InvestSdkError {
  constructor(context: SdkErrorContext) {
    super('SdkNetworkError', 'SDK_NETWORK_FAILED', 'The network request failed.', context);
  }
}

/** @public */
export class SdkOfflineError extends InvestSdkError {
  constructor(context: SdkErrorContext = {}) {
    super(
      'SdkOfflineError',
      'SDK_OFFLINE',
      'The request was blocked by the application offline policy.',
      context,
    );
  }
}

/** @public */
export class SdkAbortError extends InvestSdkError {
  constructor(context: SdkErrorContext) {
    super('SdkAbortError', 'SDK_ABORTED', 'The request was aborted.', context);
  }
}

/** @public */
export class SdkTimeoutError extends InvestSdkError {
  constructor(context: SdkErrorContext) {
    super('SdkTimeoutError', 'SDK_TIMEOUT', 'The request timed out.', context);
  }
}
