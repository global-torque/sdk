import Ajv, { type AnySchema, type ValidateFunction } from 'ajv';
import type { SdkContractResponseValidator } from '../types.js';

const ajv = new Ajv({
  allErrors: true,
  strict: false,
});
const CANONICAL_DECIMAL_DESCRIPTION = 'Canonical exact decimal string';
const POSITIVE_CANONICAL_DECIMAL_DESCRIPTION = 'Positive canonical exact decimal string';
const COMPATIBLE_DECIMAL_PATTERN = '^(?:0|[1-9][0-9]{0,19})(?:\\.[0-9]{1,18})?$';
const COMPATIBLE_POSITIVE_DECIMAL_PATTERN =
  '^(?=.*[1-9])(?:0|[1-9][0-9]{0,19})(?:\\.[0-9]{1,18})?$';

class ContractResponseValidationFailure extends Error {
  readonly issue: Readonly<{
    validationMode: 'compatible' | 'exact';
    keyword: string;
    instancePath: string;
  }>;

  constructor(
    contractName: string,
    validationMode: 'compatible' | 'exact',
    error: { keyword?: string; instancePath?: string } | null | undefined,
  ) {
    super(`${contractName} response does not satisfy its ${validationMode} contract.`);
    this.name = 'ContractResponseValidationFailure';
    this.issue = Object.freeze({
      validationMode,
      keyword: (error?.keyword ?? 'unknown').slice(0, 64),
      instancePath: (error?.instancePath ?? '').slice(0, 256),
    });
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const compatibleSchema = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(compatibleSchema);
  if (!isRecord(value)) return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === 'additionalProperties' && child === false) {
      result[key] = true;
      continue;
    }
    if (
      key === 'enum' &&
      Array.isArray(child) &&
      child.some((member) => typeof member === 'string') &&
      child.every((member) => member === null || typeof member === 'string')
    ) {
      if (!child.includes('') && result.minLength === undefined && value.minLength === undefined) {
        result.minLength = 1;
      }
      continue;
    }
    if (key === 'pattern' && typeof value.description === 'string') {
      if (value.description.startsWith(POSITIVE_CANONICAL_DECIMAL_DESCRIPTION)) {
        result[key] = COMPATIBLE_POSITIVE_DECIMAL_PATTERN;
        continue;
      }
      if (value.description.startsWith(CANONICAL_DECIMAL_DESCRIPTION)) {
        result[key] = COMPATIBLE_DECIMAL_PATTERN;
        continue;
      }
    }
    result[key] = compatibleSchema(child);
  }
  return result;
};

const canonicalDecimal = (value: string) => {
  if (!value.includes('.')) return value;
  const normalized = value.replace(/0+$/u, '').replace(/\.$/u, '');
  return normalized || '0';
};

const normalizeCompatibleResponse = (
  value: unknown,
  schema: unknown,
  rootSchema: Record<string, unknown>,
): unknown => {
  if (!isRecord(schema)) return value;
  if (typeof schema.$ref === 'string' && schema.$ref.startsWith('#/$defs/')) {
    const definition = (rootSchema.$defs as Record<string, unknown> | undefined)?.[
      schema.$ref.slice('#/$defs/'.length)
    ];
    return normalizeCompatibleResponse(value, definition, rootSchema);
  }
  let normalized = value;
  for (const branchKey of ['allOf', 'anyOf', 'oneOf'] as const) {
    const branches = schema[branchKey];
    if (Array.isArray(branches)) {
      for (const branch of branches) {
        normalized = normalizeCompatibleResponse(normalized, branch, rootSchema);
      }
    }
  }
  if (
    typeof normalized === 'string' &&
    typeof schema.description === 'string' &&
    (schema.description.startsWith(CANONICAL_DECIMAL_DESCRIPTION) ||
      schema.description.startsWith(POSITIVE_CANONICAL_DECIMAL_DESCRIPTION))
  ) {
    return canonicalDecimal(normalized);
  }
  if (Array.isArray(normalized) && isRecord(schema.items)) {
    return normalized.map((item) => normalizeCompatibleResponse(item, schema.items, rootSchema));
  }
  if (isRecord(normalized) && isRecord(schema.properties)) {
    let result: Record<string, unknown> | undefined;
    for (const [key, propertySchema] of Object.entries(schema.properties)) {
      if (!(key in normalized)) continue;
      const propertyValue = normalizeCompatibleResponse(
        normalized[key],
        propertySchema,
        rootSchema,
      );
      if (propertyValue !== normalized[key]) {
        result ??= { ...normalized };
        result[key] = propertyValue;
      }
    }
    return result ?? normalized;
  }
  return normalized;
};
const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/u;
const dateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/iu;
ajv.addFormat('date', {
  type: 'string',
  validate: (value: string) => {
    const match = datePattern.exec(value);
    if (!match) return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  },
});
ajv.addFormat('date-time', {
  type: 'string',
  validate: (value: string) => dateTimePattern.test(value) && Number.isFinite(Date.parse(value)),
});
ajv.addFormat('email', {
  type: 'string',
  validate: (value: string) =>
    value.length <= 254 &&
    /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/iu.test(
      value,
    ),
});
ajv.addFormat('url', {
  type: 'string',
  validate: (value: string) => {
    try {
      const url = new URL(value);
      return url.protocol.length > 1;
    } catch {
      return false;
    }
  },
});
ajv.addFormat('int32', {
  type: 'number',
  validate: (value: number) =>
    Number.isInteger(value) && value >= -2_147_483_648 && value <= 2_147_483_647,
});
ajv.addFormat('int64', {
  type: 'number',
  validate: (value: number) => Number.isSafeInteger(value),
});
ajv.addFormat('double', {
  type: 'number',
  validate: (value: number) => Number.isFinite(value),
});

/** @internal */
export const compileResponseValidator = <T>(
  schema: object,
  contractName: string,
  narrow: (value: unknown) => T,
  projectionSchema?: object,
): SdkContractResponseValidator<T> => {
  const rootSchema = schema as Record<string, unknown>;
  const validateCompatible: ValidateFunction = ajv.compile(compatibleSchema(schema) as AnySchema);
  const validateProjection: ValidateFunction | undefined = projectionSchema
    ? ajv.compile(projectionSchema as AnySchema)
    : undefined;
  const validateExact: ValidateFunction = ajv.compile(schema as AnySchema);
  const run = (mode: 'compatible' | 'exact', value: unknown): T => {
    const validate = mode === 'compatible' ? validateCompatible : validateExact;
    if (!validate(value)) {
      throw new ContractResponseValidationFailure(contractName, mode, validate.errors?.[0]);
    }
    const normalized =
      mode === 'compatible' ? normalizeCompatibleResponse(value, rootSchema, rootSchema) : value;
    if (mode === 'compatible' && validateProjection && !validateProjection(normalized)) {
      throw new ContractResponseValidationFailure(
        contractName,
        mode,
        validateProjection.errors?.[0],
      );
    }
    return narrow(normalized);
  };
  const validator = ((value: unknown) =>
    run('compatible', value)) as SdkContractResponseValidator<T>;
  Object.defineProperty(validator, 'exact', {
    configurable: false,
    enumerable: false,
    value: (value: unknown) => run('exact', value),
    writable: false,
  });
  // The compiler only builds synchronous validators; the casts bridge the
  // generic conditional return while the public type excludes thenables.
  return validator;
};

/** @internal */
export const compileRequestValidator = <T>(
  schema: object,
  contractName: string,
  narrow: (value: unknown) => T,
): ((value: unknown) => T) => {
  const validate: ValidateFunction = ajv.compile(schema as AnySchema);
  return (value: unknown): T => {
    if (!validate(value)) {
      throw new TypeError(`${contractName} request does not satisfy its pinned contract.`);
    }
    return narrow(value);
  };
};
