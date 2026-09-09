/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/unbound-method, @typescript-eslint/no-misused-promises */
import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import type { LocalAccount } from 'viem';
import {
  createTurnkeyBrowserOtpClient,
  readTurnkeyVerificationTokenProof,
  type TurnkeyBrowserConfig,
  type TurnkeyBrowserRuntime,
  type TurnkeyServerSign,
} from './turnkey.js';

const now = Date.parse('2026-08-07T12:00:00.000Z');
const walletAddress = '0x1111111111111111111111111111111111111111' as const;
const otherAddress = '0x2222222222222222222222222222222222222222' as const;

const config: TurnkeyBrowserConfig = {
  apiBaseUrl: 'https://api.turnkey.test',
  parentOrganizationId: 'parent-org',
  appName: 'Torque',
  walletName: 'Example Wallet',
  sessionExpirationSeconds: '3600',
};

function verificationToken(overrides: Record<string, unknown> = {}): string {
  const payload = Buffer.from(
    JSON.stringify({
      id: 'token-id',
      public_key: 'verification-public-key',
      exp: Math.floor(now / 1_000) + 600,
      ...overrides,
    }),
  ).toString('base64url');
  return `header.${payload}.signature`;
}

function createRuntime(
  options: {
    sessionOrganizationId?: string;
    sessionUserId?: string;
    signerAddress?: `0x${string}`;
    accounts?: { walletAccountId?: string; address?: string }[];
  } = {},
): TurnkeyBrowserRuntime {
  let generation = 0;
  let loggedIn = false;
  const signer = {
    address: options.signerAddress ?? walletAddress,
    signMessage: vi.fn(async () => '0xsigned'),
  } as unknown as LocalAccount;
  const client = {
    getWalletAccounts: vi.fn(async () => ({
      accounts: options.accounts ?? [{ walletAccountId: 'account-1', address: walletAddress }],
    })),
  };

  return {
    get generation() {
      return generation;
    },
    getClient: vi.fn(async () => client as never),
    getPublicKey: vi.fn(async () => 'browser-public-key'),
    getSession: vi.fn(async () =>
      loggedIn
        ? {
            organizationId: options.sessionOrganizationId ?? 'child-org',
            userId: options.sessionUserId ?? 'created-user',
          }
        : undefined,
    ),
    loginWithSession: vi.fn(async () => {
      loggedIn = true;
    }),
    createSigner: vi.fn(async () => signer),
    reset: vi.fn(async () => {
      generation += 1;
      loggedIn = false;
    }),
  };
}

function createServerSign(): {
  callback: TurnkeyServerSign<string>;
  mock: ReturnType<typeof vi.fn>;
} {
  const mock = vi.fn(async (methodName: string) => {
    switch (methodName) {
      case 'initOtp':
        return {
          otpId: 'otp-id',
          otpAttemptId: 'attempt_12345678901234567890',
          otpEncryptionTargetBundle: 'encryption-target',
        };
      case 'verifyOtp':
        return { verificationToken: verificationToken() };
      case 'createSubOrganization':
        return {
          subOrganizationId: 'child-org',
          wallet: { walletId: 'wallet-1', addresses: [walletAddress] },
          rootUserIds: ['created-user'],
        };
      case 'otpLogin':
        return { session: 'session-token' };
      default:
        throw new Error(`Unexpected method: ${methodName}`);
    }
  });
  return { callback: mock as unknown as TurnkeyServerSign<string>, mock };
}

function createClient(
  options: {
    runtime?: TurnkeyBrowserRuntime;
    serverSign?: ReturnType<typeof createServerSign>;
    encryptOtp?: (otpCode: string, target: string, publicKey: string) => Promise<string>;
  } = {},
) {
  const runtime = options.runtime ?? createRuntime();
  const serverSign = options.serverSign ?? createServerSign();
  const encryptOtp = options.encryptOtp ?? vi.fn(async () => 'encrypted-otp');
  const client = createTurnkeyBrowserOtpClient({
    config,
    runtime,
    serverSign: serverSign.callback,
    subOrganizationName: (attempt) => `Example wallet ${attempt.context}`,
    createId: () => 'idempotency-id',
    now: () => now,
    encryptOtp,
    createClientSignature: (_client, message, publicKey) =>
      Promise.resolve({
        message,
        publicKey,
        scheme: 'CLIENT_SIGNATURE_SCHEME_API_P256' as const,
        signature: 'signature',
      }),
  });
  return { client, runtime, serverSign, encryptOtp };
}

describe('readTurnkeyVerificationTokenProof', () => {
  it('returns exact unexpired browser-key proof', () => {
    expect(readTurnkeyVerificationTokenProof(verificationToken(), { now: () => now })).toEqual({
      tokenId: 'token-id',
      publicKey: 'verification-public-key',
    });
  });

  it.each([
    ['malformed', 'not-a-token'],
    ['expired', verificationToken({ exp: Math.floor(now / 1_000) })],
    ['missing proof', verificationToken({ id: '', public_key: '' })],
  ])('rejects %s verification data', (_label, token) => {
    expect(() => readTurnkeyVerificationTokenProof(token, { now: () => now })).toThrow();
  });
});

describe('createTurnkeyBrowserOtpClient', () => {
  it('validates configuration and OTP challenge responses', async () => {
    expect(() =>
      createTurnkeyBrowserOtpClient({
        config: { ...config, apiBaseUrl: '' },
        runtime: createRuntime(),
        serverSign: createServerSign().callback,
        subOrganizationName: () => 'wallet',
      }),
    ).toThrow('requires API URL');

    const { client } = createClient();
    await expect(client.startEmailOtp({ context: 'profile', contact: ' ' })).rejects.toThrow(
      'email contact',
    );

    for (const response of [
      { otpAttemptId: 'attempt_12345678901234567890', otpEncryptionTargetBundle: 'target' },
      { otpId: 'otp', otpAttemptId: 'attempt_12345678901234567890' },
      { otpId: 'otp', otpAttemptId: 'short', otpEncryptionTargetBundle: 'target' },
    ]) {
      const serverSign = createServerSign();
      serverSign.mock.mockResolvedValueOnce(response);
      const invalid = createClient({ serverSign });
      await expect(
        invalid.client.startEmailOtp({ context: 'profile', contact: 'user@example.com' }),
      ).rejects.toThrow('Turnkey did not return');
    }
  });

  it('uses the injected server-sign boundary and never sends the plain OTP', async () => {
    const { client, serverSign, encryptOtp } = createClient();
    const attempt = await client.startEmailOtp({
      context: 'profile-7',
      contact: 'user@example.com',
    });
    await client.verifyOtp(attempt, '123456');

    expect(encryptOtp).toHaveBeenCalledWith('123456', 'encryption-target', 'browser-public-key');
    expect(serverSign.mock).toHaveBeenNthCalledWith(
      1,
      'initOtp',
      {
        organizationId: 'parent-org',
        appName: 'Torque',
        otpType: 'OTP_TYPE_EMAIL',
        contact: 'user@example.com',
        otpLength: 6,
        alphanumeric: false,
        expirationSeconds: '600',
      },
      { context: 'profile-7' },
    );
    expect(serverSign.mock).toHaveBeenNthCalledWith(
      2,
      'verifyOtp',
      {
        organizationId: 'parent-org',
        otpId: 'otp-id',
        encryptedOtpBundle: 'encrypted-otp',
        expirationSeconds: '3600',
      },
      {
        context: 'profile-7',
        otpAttemptId: 'attempt_12345678901234567890',
        idempotencyKey: 'verify-attempt_12345678901234567890-idempotency-id',
      },
    );
    expect(JSON.stringify(serverSign.mock.mock.calls[1]?.[1])).not.toContain('123456');
  });

  it('creates and resolves the exact fresh Turnkey identity and signer', async () => {
    const { client, runtime, serverSign } = createClient();
    const attempt = await client.startEmailOtp({
      context: 'profile-7',
      contact: 'user@example.com',
    });
    await client.verifyOtp(attempt, '123456');
    const session = await client.establishSession({
      attempt,
      expectedWalletAddress: walletAddress,
    });

    expect(session).toMatchObject({
      walletAddress,
      subOrganizationId: 'child-org',
      userId: 'created-user',
      walletId: 'wallet-1',
      accountId: 'account-1',
    });
    await expect(session.createSigner()).resolves.toMatchObject({ address: walletAddress });
    await expect(session.signMessage('challenge')).resolves.toBe('0xsigned');
    expect(runtime.loginWithSession).toHaveBeenCalledWith('session-token');
    expect(serverSign.mock).toHaveBeenCalledWith(
      'createSubOrganization',
      expect.objectContaining({
        organizationId: 'parent-org',
        subOrganizationName: 'Example wallet profile-7',
        verificationToken: verificationToken(),
      }),
      {
        context: 'profile-7',
        otpAttemptId: 'attempt_12345678901234567890',
        idempotencyKey: 'create-attempt_12345678901234567890',
      },
    );
  });

  it('recovers an existing identity without creating another child organization', async () => {
    const serverSign = createServerSign();
    serverSign.mock.mockImplementation(async (methodName: string) => {
      if (methodName === 'initOtp') {
        return {
          otpId: 'otp-id',
          otpAttemptId: 'attempt_12345678901234567890',
          otpEncryptionTargetBundle: 'encryption-target',
          turnkeyRecovery: {
            childOrganizationId: 'child-org',
            ownerUserId: 'owner-user',
            walletAddress,
            walletId: 'wallet-1',
          },
        };
      }
      if (methodName === 'verifyOtp') return { verificationToken: verificationToken() };
      if (methodName === 'otpLogin') return { session: 'session-token' };
      throw new Error(`Unexpected method: ${methodName}`);
    });
    const { client } = createClient({
      serverSign,
      runtime: createRuntime({ sessionUserId: 'owner-user' }),
    });
    const attempt = await client.startEmailOtp({ context: 'fund-a', contact: 'fund@example.com' });
    await client.verifyOtp(attempt, '123456');
    await expect(client.establishSession({ attempt })).resolves.toMatchObject({
      subOrganizationId: 'child-org',
      walletAddress,
    });
    expect(serverSign.mock.mock.calls.some(([method]) => method === 'createSubOrganization')).toBe(
      false,
    );
  });

  it('ignores backend recovery when the caller forces a fresh create or adopt path', async () => {
    const serverSign = createServerSign();
    serverSign.mock.mockResolvedValueOnce({
      otpId: 'otp-id',
      otpAttemptId: 'attempt_12345678901234567890',
      otpEncryptionTargetBundle: 'encryption-target',
      turnkeyRecovery: {
        childOrganizationId: 'stale-child-org',
        ownerUserId: 'stale-owner-user',
        walletAddress: otherAddress,
        walletId: 'stale-wallet',
      },
    });
    const { client } = createClient({ serverSign });
    const attempt = await client.startEmailOtp({
      context: 'fund-a',
      contact: 'fund@example.com',
      recoveryOverride: null,
    });

    expect(attempt.recovery).toBeNull();
    await client.verifyOtp(attempt, '123456');
    await expect(client.establishSession({ attempt })).resolves.toMatchObject({
      subOrganizationId: 'child-org',
      walletAddress,
    });
    expect(serverSign.mock.mock.calls.some(([method]) => method === 'createSubOrganization')).toBe(
      true,
    );
  });

  it('rejects authoritative address, active session, and constructed signer mismatches', async () => {
    const first = createClient();
    const firstAttempt = await first.client.startEmailOtp({
      context: 'a',
      contact: 'a@example.com',
    });
    await first.client.verifyOtp(firstAttempt, '123456');
    await expect(
      first.client.establishSession({
        attempt: firstAttempt,
        expectedWalletAddress: otherAddress,
      }),
    ).rejects.toThrow('does not match the authoritative expected wallet');

    const wrongSession = createClient({
      runtime: createRuntime({ sessionOrganizationId: 'another-org' }),
    });
    const secondAttempt = await wrongSession.client.startEmailOtp({
      context: 'b',
      contact: 'b@example.com',
    });
    await wrongSession.client.verifyOtp(secondAttempt, '123456');
    await expect(wrongSession.client.establishSession({ attempt: secondAttempt })).rejects.toThrow(
      'active session organization does not match',
    );

    const wrongUser = createClient({
      runtime: createRuntime({ sessionUserId: 'another-user' }),
    });
    const wrongUserAttempt = await wrongUser.client.startEmailOtp({
      context: 'user-mismatch',
      contact: 'user-mismatch@example.com',
    });
    await wrongUser.client.verifyOtp(wrongUserAttempt, '123456');
    await expect(wrongUser.client.establishSession({ attempt: wrongUserAttempt })).rejects.toThrow(
      'active session user does not match',
    );

    const wrongSigner = createClient({
      runtime: createRuntime({ signerAddress: otherAddress }),
    });
    const thirdAttempt = await wrongSigner.client.startEmailOtp({
      context: 'c',
      contact: 'c@example.com',
    });
    await wrongSigner.client.verifyOtp(thirdAttempt, '123456');
    const session = await wrongSigner.client.establishSession({ attempt: thirdAttempt });
    await expect(session.createSigner()).rejects.toThrow('signer does not match');
  });

  it('invalidates old attempts on reset and honors cancellation', async () => {
    const { client, encryptOtp, serverSign } = createClient();
    const attempt = await client.startEmailOtp({
      context: 'profile-7',
      contact: 'user@example.com',
    });
    await client.reset();
    await expect(client.verifyOtp(attempt, '123456')).rejects.toThrow('invalidated');
    expect(encryptOtp).not.toHaveBeenCalled();

    const controller = new AbortController();
    controller.abort(new Error('profile changed'));
    await expect(
      client.startEmailOtp({
        context: 'profile-8',
        contact: 'other@example.com',
        signal: controller.signal,
      }),
    ).rejects.toThrow('profile changed');
    expect(serverSign.mock).toHaveBeenCalledTimes(1);
  });

  it('reuses the encrypted payload and idempotency key after a lost verify response', async () => {
    const serverSign = createServerSign();
    let verifyCalls = 0;
    serverSign.mock.mockImplementation(async (methodName: string) => {
      if (methodName === 'initOtp') {
        return {
          otpId: 'otp-id',
          otpAttemptId: 'attempt_12345678901234567890',
          otpEncryptionTargetBundle: 'encryption-target',
        };
      }
      if (methodName === 'verifyOtp') {
        verifyCalls += 1;
        if (verifyCalls === 1) throw new Error('lost response');
        return { verificationToken: verificationToken() };
      }
      throw new Error(`Unexpected method: ${methodName}`);
    });
    const encryptOtp = vi.fn(async () => 'encrypted-otp');
    const { client } = createClient({ serverSign, encryptOtp });
    const attempt = await client.startEmailOtp({
      context: 'profile-7',
      contact: 'user@example.com',
    });
    await expect(client.verifyOtp(attempt, '123456')).rejects.toThrow('lost response');
    await expect(client.verifyOtp(attempt, '123456')).resolves.toBeUndefined();
    expect(encryptOtp).toHaveBeenCalledTimes(1);
    const verifyRequests = serverSign.mock.mock.calls.filter(([method]) => method === 'verifyOtp');
    expect(verifyRequests[0]).toEqual(verifyRequests[1]);
  });

  it('short-circuits verified attempts and rejects missing verification/session data', async () => {
    const first = createClient();
    const attempt = await first.client.startEmailOtp({
      context: 'profile',
      contact: 'user@example.com',
    });
    attempt.verificationToken = verificationToken();
    await expect(first.client.verifyOtp(attempt, '123456')).resolves.toBeUndefined();
    expect(first.encryptOtp).not.toHaveBeenCalled();

    const unverified = { ...attempt };
    delete unverified.verificationToken;
    await expect(first.client.establishSession({ attempt: unverified })).rejects.toThrow(
      'has not been completed',
    );

    const missingTokenServer = createServerSign();
    missingTokenServer.mock
      .mockResolvedValueOnce({
        otpId: 'otp-id',
        otpAttemptId: 'attempt_12345678901234567890',
        otpEncryptionTargetBundle: 'target',
      })
      .mockResolvedValueOnce({});
    const missingToken = createClient({ serverSign: missingTokenServer });
    const missingAttempt = await missingToken.client.startEmailOtp({
      context: 'profile',
      contact: 'user@example.com',
    });
    await expect(missingToken.client.verifyOtp(missingAttempt, '123456')).rejects.toThrow(
      'verification token',
    );
  });

  it('rejects incomplete fresh metadata, missing login session, and changed retry binding', async () => {
    const incompleteServer = createServerSign();
    incompleteServer.mock.mockImplementation(async (methodName: string) => {
      if (methodName === 'initOtp') {
        return {
          otpId: 'otp-id',
          otpAttemptId: 'attempt_12345678901234567890',
          otpEncryptionTargetBundle: 'target',
        };
      }
      if (methodName === 'verifyOtp') return { verificationToken: verificationToken() };
      if (methodName === 'createSubOrganization') return {};
      throw new Error(`Unexpected method: ${methodName}`);
    });
    const incomplete = createClient({ serverSign: incompleteServer });
    const incompleteAttempt = await incomplete.client.startEmailOtp({
      context: 'profile',
      contact: 'user@example.com',
    });
    await incomplete.client.verifyOtp(incompleteAttempt, '123456');
    await expect(
      incomplete.client.establishSession({ attempt: incompleteAttempt }),
    ).rejects.toThrow('metadata is incomplete');

    const noSessionServer = createServerSign();
    noSessionServer.mock.mockImplementation(async (methodName: string) => {
      if (methodName === 'otpLogin') return {};
      return createServerSign().callback(methodName as never, {}, { context: '' }) as never;
    });
    const noSession = createClient({ serverSign: noSessionServer });
    const noSessionAttempt = await noSession.client.startEmailOtp({
      context: 'profile',
      contact: 'user@example.com',
    });
    await noSession.client.verifyOtp(noSessionAttempt, '123456');
    await expect(noSession.client.establishSession({ attempt: noSessionAttempt })).rejects.toThrow(
      'wallet session',
    );

    const changed = createClient();
    const changedAttempt = await changed.client.startEmailOtp({
      context: 'profile',
      contact: 'user@example.com',
    });
    await changed.client.verifyOtp(changedAttempt, '123456');
    changedAttempt.otpLoginParams = { organizationId: 'wrong' };
    await expect(changed.client.establishSession({ attempt: changedAttempt })).rejects.toThrow(
      'retry binding changed',
    );
  });

  it('requires exact recovery account and user metadata', async () => {
    const recoveryServer = createServerSign();
    recoveryServer.mock.mockImplementation(async (methodName: string) => {
      if (methodName === 'initOtp') {
        return {
          otpId: 'otp-id',
          otpAttemptId: 'attempt_12345678901234567890',
          otpEncryptionTargetBundle: 'target',
          turnkeyRecovery: {
            childOrganizationId: 'child-org',
            ownerUserId: 'owner-user',
            walletAddress,
            walletId: 'wallet-1',
          },
        };
      }
      if (methodName === 'verifyOtp') return { verificationToken: verificationToken() };
      if (methodName === 'otpLogin') return { session: 'session-token' };
      throw new Error(`Unexpected method: ${methodName}`);
    });
    const missingOwnerServer = createServerSign();
    missingOwnerServer.mock.mockImplementation(async (methodName: string) => {
      if (methodName === 'initOtp') {
        return {
          otpId: 'otp-id',
          otpAttemptId: 'attempt_12345678901234567890',
          otpEncryptionTargetBundle: 'target',
          turnkeyRecovery: {
            childOrganizationId: 'child-org',
            walletAddress,
            walletId: 'wallet-1',
          },
        };
      }
      throw new Error(`Unexpected method: ${methodName}`);
    });
    const missingOwner = createClient({ serverSign: missingOwnerServer });
    await expect(
      missingOwner.client.startEmailOtp({
        context: 'fund',
        contact: 'fund@example.com',
      }),
    ).rejects.toThrow('incomplete wallet recovery metadata');

    const missingAccount = createClient({
      serverSign: recoveryServer,
      runtime: createRuntime({ sessionUserId: 'owner-user', accounts: [] }),
    });
    const secondAttempt = await missingAccount.client.startEmailOtp({
      context: 'fund',
      contact: 'fund@example.com',
    });
    await missingAccount.client.verifyOtp(secondAttempt, '123456');
    await expect(
      missingAccount.client.establishSession({ attempt: secondAttempt }),
    ).rejects.toThrow('account metadata is incomplete or ambiguous');

    const wrongAccount = createClient({
      serverSign: recoveryServer,
      runtime: createRuntime({ sessionUserId: 'owner-user' }),
    });
    const wrongAccountAttempt = await wrongAccount.client.startEmailOtp({
      context: 'fund',
      contact: 'fund@example.com',
    });
    await wrongAccount.client.verifyOtp(wrongAccountAttempt, '123456');
    if (!wrongAccountAttempt.recovery) throw new Error('expected recovery');
    wrongAccountAttempt.recovery.accountId = 'wrong-account';
    await expect(
      wrongAccount.client.establishSession({ attempt: wrongAccountAttempt }),
    ).rejects.toThrow('account metadata is incomplete or ambiguous');
  });
});
