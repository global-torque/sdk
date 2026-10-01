import { describe, expect, it, vi } from 'vitest';

import { createIdempotencyKeys } from './idempotency.js';

const echoKey = (idempotencyKey: string) => Promise.resolve(idempotencyKey);

describe('SDK idempotency keys', () => {
  it('keeps one key per scope until an action for that scope resolves', async () => {
    const keys = createIdempotencyKeys();

    const [first, overlapping, otherScope] = await Promise.all([
      keys.run('offer-a:7', echoKey),
      keys.run('offer-a:7', echoKey),
      keys.run('offer-b:7', echoKey),
    ]);
    expect(overlapping).toBe(first);
    expect(otherScope).not.toBe(first);

    const lostResponse = new Error('response lost');
    let failedKey = '';
    await expect(
      keys.run('offer-a:7', (idempotencyKey) => {
        failedKey = idempotencyKey;
        return Promise.reject(lostResponse);
      }),
    ).rejects.toBe(lostResponse);
    expect(failedKey).not.toBe(first);
    await expect(keys.run('offer-a:7', echoKey)).resolves.toBe(failedKey);
  });

  it('forgets a key without letting a stale success drop the newer key', async () => {
    const keys = createIdempotencyKeys();
    let resolveStale: (() => void) | undefined;
    const stale = keys.run(
      'offer-a:7',
      (idempotencyKey) =>
        new Promise<string>((resolve) => {
          resolveStale = () => resolve(idempotencyKey);
        }),
    );

    keys.forget('offer-a:7');
    let newerKey = '';
    await expect(
      keys.run('offer-a:7', (idempotencyKey) => {
        newerKey = idempotencyKey;
        return Promise.reject(new Error('response lost'));
      }),
    ).rejects.toThrow('response lost');
    resolveStale?.();
    const staleKey = await stale;

    expect(newerKey).not.toBe(staleKey);
    await expect(keys.run('offer-a:7', echoKey)).resolves.toBe(newerKey);
  });

  it('rejects an empty scope before running the action', async () => {
    const action = vi.fn(echoKey);

    await expect(createIdempotencyKeys().run('', action)).rejects.toMatchObject({
      code: 'SDK_IDEMPOTENCY_SCOPE_INVALID',
    });
    expect(action).not.toHaveBeenCalled();
  });
});
