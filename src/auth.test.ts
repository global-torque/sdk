import { describe, expect, it, vi } from 'vitest';

import { bearerAuth, cookieAuth, noUserAuth } from './auth.js';

describe('authentication strategy helpers', () => {
  it('constructs immutable cookie, bearer, and no-user-auth strategies', () => {
    const getToken = vi.fn(() => 'token');
    const cookie = cookieAuth({ credentials: 'same-origin' });
    const bearer = bearerAuth({ getToken, credentials: 'include' });
    const none = noUserAuth();

    expect(cookie).toEqual({ kind: 'cookie', credentials: 'same-origin' });
    expect(bearer).toEqual({ kind: 'bearer', getToken, credentials: 'include' });
    expect(none).toEqual({ kind: 'none' });
    expect(Object.isFrozen(cookie)).toBe(true);
    expect(Object.isFrozen(bearer)).toBe(true);
    expect(Object.isFrozen(none)).toBe(true);
  });
});
