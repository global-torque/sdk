import type { SdkConvenienceRequestOptions } from '../types.js';

/** Shared request controls for contract-backed resource operations. @public */
export type ResourceRequestOptions = Omit<
  SdkConvenienceRequestOptions,
  'operationId' | 'query' | 'responseMode' | 'responseValidator'
>;

/** Shared mutation controls; operation-owned idempotency cannot be overridden. @public */
export type MutationResourceRequestOptions = Omit<ResourceRequestOptions, 'idempotencyKey'>;

/** @internal */
export const mutationRequest = (
  request: MutationResourceRequestOptions | undefined,
): SdkConvenienceRequestOptions => {
  const result: SdkConvenienceRequestOptions = { ...request };
  delete result.idempotencyKey;
  return result;
};

/** @internal */
export const positiveInteger = (value: number, name: string): number => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer.`);
  }
  return value;
};

/** @internal */
export const boundedInteger = (
  value: number | undefined,
  name: string,
  minimum: number,
  maximum?: number,
): number | undefined => {
  if (
    value !== undefined &&
    (!Number.isSafeInteger(value) || value < minimum || (maximum !== undefined && value > maximum))
  ) {
    throw new TypeError(
      maximum === undefined
        ? `${name} must be a safe integer greater than or equal to ${String(minimum)} when provided.`
        : `${name} must be a safe integer from ${String(minimum)} through ${String(maximum)} when provided.`,
    );
  }
  return value;
};

/** @internal */
export const nonBlank = (value: string, name: string): string => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${name} must be a non-blank string.`);
  }
  return value.trim();
};

/** @internal */
export const optionalString = (value: string | undefined, name: string): string | undefined => {
  if (value !== undefined && typeof value !== 'string') {
    throw new TypeError(`${name} must be a string when provided.`);
  }
  return value;
};

/** @internal */
export const optionalDateTime = (value: string | undefined, name: string): string | undefined => {
  optionalString(value, name);
  if (
    value !== undefined &&
    (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/iu.test(value) ||
      !Number.isFinite(Date.parse(value)))
  ) {
    throw new TypeError(`${name} must be an ISO 8601 date-time when provided.`);
  }
  return value;
};

/** @internal */
export const pathSegment = (value: number, name: string): string => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new TypeError(`${name} must be a safe integer.`);
  }
  return encodeURIComponent(nonBlank(String(value), name));
};

/** @internal */
export const catchAllPath = (value: string, name: string): string => {
  const segments = nonBlank(value, name).split('/').filter(Boolean);
  if (segments.length === 0 || segments.some((segment) => segment === '.' || segment === '..')) {
    throw new TypeError(`${name} must contain safe path segments.`);
  }
  return segments.map(encodeURIComponent).join('/');
};
