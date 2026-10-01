import { SdkConfigurationError } from './errors.js';

/**
 * In-memory idempotency keys for repeated attempts at one action, such as
 * retries and double clicks.
 *
 * A scope identifies the action and must include everything that makes two
 * attempts the same action, for example the offer slug and the profile ID.
 * Keys are kept only in memory, and the helper never retries an action.
 *
 * @public
 */
export interface SdkIdempotencyKeys {
  /**
   * Runs `action` with the scope's key, creating the key when the scope has
   * none. The scope keeps the same key until an action for it resolves:
   * overlapping runs share the key, and a rejected action keeps it for the next
   * attempt. Rejections propagate unchanged.
   */
  run<T>(scope: string, action: (idempotencyKey: string) => Promise<T>): Promise<T>;
  /**
   * Drops the scope's key when the host learns that the action completed
   * another way. The next run creates a new key.
   */
  forget(scope: string): void;
}

/**
 * Creates an independent in-memory store of idempotency keys.
 *
 * @public
 */
export const createIdempotencyKeys = (): SdkIdempotencyKeys => {
  const keys = new Map<string, string>();

  const run = async <T>(
    scope: string,
    action: (idempotencyKey: string) => Promise<T>,
  ): Promise<T> => {
    if (typeof scope !== 'string' || scope === '') {
      throw new SdkConfigurationError(
        'SDK_IDEMPOTENCY_SCOPE_INVALID',
        'Idempotency scope must be a non-empty string.',
      );
    }
    // Store the key before awaiting so overlapping runs for this scope share it.
    const key = keys.get(scope) ?? globalThis.crypto.randomUUID();
    keys.set(scope, key);
    const result = await action(key);
    // A run that resolves after forget() must not drop a newer run's key.
    if (keys.get(scope) === key) keys.delete(scope);
    return result;
  };

  const forget = (scope: string) => {
    keys.delete(scope);
  };

  return Object.freeze({ run, forget });
};
