import Ajv, { type AnySchema, type ValidateFunction } from 'ajv';
import type { SdkResponseValidator } from '../types.js';

const ajv = new Ajv({
  allErrors: true,
  strict: false,
  validateFormats: false,
});

/** @internal */
export const compileResponseValidator = <T>(
  schema: object,
  contractName: string,
  narrow: (value: unknown) => T,
): SdkResponseValidator<T> => {
  const validate: ValidateFunction = ajv.compile(schema as AnySchema);
  const validator = (value: unknown): T => {
    if (!validate(value)) {
      throw new Error(`${contractName} response does not satisfy its pinned contract.`);
    }
    return narrow(value);
  };
  // The compiler only builds synchronous validators; the cast bridges the
  // generic conditional return while the public type excludes thenables.
  return validator as SdkResponseValidator<T>;
};
