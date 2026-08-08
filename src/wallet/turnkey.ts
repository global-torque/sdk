import { encryptOtpCodeToBundle, fromDerSignature } from '@turnkey/crypto';
import {
  Turnkey,
  defaultEthereumAccountAtIndex,
  type TurnkeyIndexedDbClient as TurnkeySdkIndexedDbClient,
} from '@turnkey/sdk-browser';
import { createAccount } from '@turnkey/viem';
import type { LocalAccount } from 'viem';

/** @alpha */
export interface TurnkeyIndexedDbClient {
  init(): Promise<unknown>;
  getPublicKey(): Promise<string | null>;
  loginWithSession(session: string): Promise<unknown>;
  clear(): Promise<unknown>;
  getWalletAccounts(input: Record<string, unknown>): Promise<unknown>;
}

/** @alpha */
export type TurnkeyServerSignMethod =
  'initOtp' | 'verifyOtp' | 'createSubOrganization' | 'otpLogin';

/** @alpha */
export interface TurnkeyServerSignRequest<TContext> {
  context: TContext;
  otpAttemptId?: string;
  idempotencyKey?: string;
}

/** @alpha */
export type TurnkeyServerSign<TContext> = <TResponse>(
  methodName: TurnkeyServerSignMethod,
  input: Record<string, unknown>,
  request: TurnkeyServerSignRequest<TContext>,
) => Promise<TResponse>;

/** @alpha */
export interface TurnkeyBrowserConfig {
  apiBaseUrl: string;
  parentOrganizationId: string;
  appName: string;
  walletName: string;
  sessionExpirationSeconds?: string;
  otpExpirationSeconds?: string;
  verificationExpirationSeconds?: string;
}

/** @alpha */
export interface TurnkeyBrowserRecoveryTarget {
  childOrganizationId: string;
  ownerUserId: string;
  walletAddress: string;
  walletId: string;
  accountId?: string;
}

/** @alpha */
export interface TurnkeyBrowserOtpAttempt<TContext> {
  context: TContext;
  generation: number;
  otpAttemptId: string;
  contact: string;
  otpId: string;
  otpEncryptionTargetBundle: string;
  publicKey: string;
  recovery: TurnkeyBrowserRecoveryTarget | null;
  verificationToken?: string;
  encryptedOtpBundle?: string;
  encryptedOtpCode?: string;
  verificationIdempotencyKey?: string;
  createSubOrganizationParams?: Record<string, unknown>;
  otpLoginParams?: Record<string, unknown>;
}

/** @alpha */
export interface TurnkeyBrowserIdentity {
  walletAddress: string;
  subOrganizationId: string;
  userId: string;
  walletId: string;
  accountId: string;
}

/** @alpha */
export interface TurnkeyBrowserSessionIdentity {
  organizationId?: string;
  userId?: string;
  expiry?: number;
}

/** @alpha */
export interface TurnkeyResolvedWalletAccount {
  accountId: string;
  walletAddress: string;
}

/** @alpha */
export interface TurnkeyBrowserSession extends TurnkeyBrowserIdentity {
  createSigner(): Promise<LocalAccount>;
  signMessage(message: string): Promise<string>;
}

/** @alpha */
export interface TurnkeyBrowserRuntime {
  readonly generation: number;
  getClient(): Promise<TurnkeyIndexedDbClient>;
  getPublicKey(): Promise<string>;
  getSession(): Promise<TurnkeyBrowserSessionIdentity | undefined>;
  loginWithSession(session: string): Promise<void>;
  createSigner(
    identity: Pick<TurnkeyBrowserIdentity, 'subOrganizationId' | 'walletAddress'>,
  ): Promise<LocalAccount>;
  reset(): Promise<void>;
}

/** @alpha */
export interface CreateTurnkeyBrowserOtpClientOptions<TContext> {
  config: TurnkeyBrowserConfig;
  serverSign: TurnkeyServerSign<TContext>;
  subOrganizationName: (attempt: TurnkeyBrowserOtpAttempt<TContext>) => string;
  runtime?: TurnkeyBrowserRuntime;
  createId?: () => string;
  now?: () => number;
  encryptOtp?: (
    otpCode: string,
    otpEncryptionTargetBundle: string,
    publicKey: string,
  ) => Promise<string>;
  createClientSignature?: (
    client: TurnkeyIndexedDbClient,
    message: string,
    publicKey: string,
  ) => Promise<TurnkeyClientSignature>;
}

/** @alpha */
export interface StartTurnkeyEmailOtpInput<TContext> {
  context: TContext;
  contact: string;
  signal?: AbortSignal;
  recoveryOverride?: TurnkeyBrowserRecoveryTarget | null;
}

/** @alpha */
export interface EstablishTurnkeySessionInput<TContext> {
  attempt: TurnkeyBrowserOtpAttempt<TContext>;
  expectedWalletAddress?: string;
  signal?: AbortSignal;
}

/** @alpha */
export interface TurnkeyBrowserOtpClient<TContext> {
  readonly runtime: TurnkeyBrowserRuntime;
  startEmailOtp(
    input: StartTurnkeyEmailOtpInput<TContext>,
  ): Promise<TurnkeyBrowserOtpAttempt<TContext>>;
  verifyOtp(
    attempt: TurnkeyBrowserOtpAttempt<TContext>,
    otpCode: string,
    signal?: AbortSignal,
  ): Promise<void>;
  establishSession(input: EstablishTurnkeySessionInput<TContext>): Promise<TurnkeyBrowserSession>;
  reset(): Promise<void>;
}

/** @alpha */
export interface TurnkeyVerificationTokenProof {
  tokenId: string;
  publicKey: string;
}

/** @alpha */
export interface TurnkeyClientSignature {
  message: string;
  publicKey: string;
  scheme: 'CLIENT_SIGNATURE_SCHEME_API_P256';
  signature: string;
}

interface TurnkeyVerificationTokenClaims {
  id?: string;
  public_key?: string;
  exp?: number;
}

type TurnkeyIndexedDbClientWithSigning = TurnkeyIndexedDbClient & {
  stamper?: {
    sign?: (payload: string) => Promise<string>;
  };
};

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizedConfig(config: TurnkeyBrowserConfig): Required<TurnkeyBrowserConfig> {
  const apiBaseUrl = config.apiBaseUrl.trim();
  const parentOrganizationId = config.parentOrganizationId.trim();
  const appName = config.appName.trim();
  const walletName = config.walletName.trim();
  if (!apiBaseUrl || !parentOrganizationId || !appName || !walletName) {
    throw new Error(
      'Turnkey browser configuration requires API URL, parent organization, app name, and wallet name.',
    );
  }
  const normalizeSeconds = (value: unknown, fallback: string): string => {
    const result = textValue(value) || fallback;
    return /^\d+$/.test(result) ? result : fallback;
  };
  return {
    apiBaseUrl,
    parentOrganizationId,
    appName,
    walletName,
    sessionExpirationSeconds: normalizeSeconds(config.sessionExpirationSeconds, '3600'),
    otpExpirationSeconds: normalizeSeconds(config.otpExpirationSeconds, '600'),
    verificationExpirationSeconds: normalizeSeconds(config.verificationExpirationSeconds, '3600'),
  };
}

function normalizeAddress(value: unknown): string {
  const address = textValue(value);
  return /^0x[0-9a-fA-F]{40}$/.test(address) ? address : '';
}

/** @alpha */
export function assertTurnkeySessionIdentity(
  session: TurnkeyBrowserSessionIdentity | undefined,
  expected: {
    organizationId?: string;
    userId?: string;
    requireUnexpired?: boolean;
    now?: () => number;
  } = {},
): { organizationId: string; userId: string } {
  const organizationId = textValue(session?.organizationId);
  const userId = textValue(session?.userId);
  const expectedOrganizationId = textValue(expected.organizationId);
  if (!organizationId || (expectedOrganizationId && organizationId !== expectedOrganizationId)) {
    throw new Error(
      'Turnkey wallet login succeeded, but the active session organization does not match the wallet.',
    );
  }
  if (!userId) {
    throw new Error('Turnkey wallet login succeeded, but the active session user is missing.');
  }
  const expectedUserId = textValue(expected.userId);
  if (expectedUserId && userId !== expectedUserId) {
    throw new Error(
      'Turnkey wallet login succeeded, but the active session user does not match the wallet owner.',
    );
  }
  if (expected.requireUnexpired) {
    const expiresAt = Number(session?.expiry);
    const now = expected.now ?? Date.now;
    if (!Number.isFinite(expiresAt) || expiresAt <= Math.floor(now() / 1_000)) {
      throw new Error('Turnkey wallet session is missing or expired.');
    }
  }
  return { organizationId, userId };
}

/** @alpha */
export async function resolveTurnkeyWalletAccount(
  client: Pick<TurnkeyIndexedDbClient, 'getWalletAccounts'>,
  input: {
    organizationId: string;
    walletId: string;
    accountId?: string;
    walletAddress?: string;
  },
): Promise<TurnkeyResolvedWalletAccount> {
  const response = await client.getWalletAccounts({
    organizationId: input.organizationId,
    walletId: input.walletId,
    includeWalletDetails: true,
  });
  const accounts = ((response as { accounts?: unknown }).accounts ?? []) as {
    walletAccountId?: string;
    address?: string;
  }[];
  const expectedAccountId = textValue(input.accountId);
  const expectedAddress = normalizeAddress(input.walletAddress).toLowerCase();
  const matches = accounts.flatMap((candidate) => {
    const accountId = textValue(candidate.walletAccountId);
    const walletAddress = normalizeAddress(candidate.address);
    if (
      !accountId ||
      !walletAddress ||
      (expectedAccountId && accountId !== expectedAccountId) ||
      (expectedAddress && walletAddress.toLowerCase() !== expectedAddress)
    ) {
      return [];
    }
    return [{ accountId, walletAddress }];
  });
  if (matches.length !== 1) {
    throw new Error(
      'Turnkey wallet login succeeded, but the exact wallet account metadata is incomplete or ambiguous.',
    );
  }
  return matches[0] as TurnkeyResolvedWalletAccount;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException('Turnkey browser operation was cancelled.', 'AbortError');
  }
}

function decodeBase64UrlJson(value: string): unknown {
  if (typeof globalThis.atob !== 'function') {
    throw new Error('Turnkey verification tokens cannot be decoded in this browser.');
  }
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  try {
    const binary = globalThis.atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new Error('Turnkey returned an invalid OTP verification token.');
  }
}

/** @alpha */
export function readTurnkeyVerificationTokenProof(
  verificationToken: string,
  options: { now?: () => number } = {},
): TurnkeyVerificationTokenProof {
  const [, payload] = verificationToken.split('.');
  if (!payload) {
    throw new Error('Turnkey returned an invalid OTP verification token.');
  }
  const claims = decodeBase64UrlJson(payload) as TurnkeyVerificationTokenClaims;
  const expiresAt = Number(claims.exp);
  const now = options.now ?? Date.now;
  if (!Number.isFinite(expiresAt) || expiresAt <= Math.floor(now() / 1_000)) {
    throw new Error('Turnkey verification token expired. Please request a new verification code.');
  }
  const tokenId = claims.id?.trim() ?? '';
  const publicKey = claims.public_key?.trim() ?? '';
  if (!tokenId || !publicKey) {
    throw new Error('Turnkey verification token is missing browser-key proof details.');
  }
  return { tokenId, publicKey };
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** @alpha */
export async function createTurnkeyClientSignature(
  client: TurnkeyIndexedDbClient,
  message: string,
  publicKey: string,
): Promise<TurnkeyClientSignature> {
  const stamper = (client as TurnkeyIndexedDbClientWithSigning).stamper;
  if (!stamper?.sign) {
    throw new Error('Turnkey browser session key cannot sign OTP verification proof.');
  }
  const derSignature = await stamper.sign(message);
  return {
    message,
    publicKey,
    scheme: 'CLIENT_SIGNATURE_SCHEME_API_P256',
    signature: bytesToHex(fromDerSignature(derSignature)),
  };
}

/** @alpha */
export async function encryptTurnkeyOtpCode(
  otpCode: string,
  otpEncryptionTargetBundle: string,
  publicKey: string,
): Promise<string> {
  return encryptOtpCodeToBundle(otpCode, otpEncryptionTargetBundle, publicKey);
}

/** @alpha */
export function createTurnkeyBrowserRuntime(
  rawConfig: Pick<TurnkeyBrowserConfig, 'apiBaseUrl' | 'parentOrganizationId'>,
): TurnkeyBrowserRuntime {
  const apiBaseUrl = rawConfig.apiBaseUrl.trim();
  const parentOrganizationId = rawConfig.parentOrganizationId.trim();
  if (!apiBaseUrl || !parentOrganizationId) {
    throw new Error('Turnkey browser runtime requires API URL and parent organization ID.');
  }
  let turnkeyPromise: Promise<Turnkey> | null = null;
  let clientPromise: Promise<TurnkeyIndexedDbClient> | null = null;
  let generation = 0;

  const getTurnkey = (): Promise<Turnkey> => {
    turnkeyPromise ??= Promise.resolve(
      new Turnkey({
        apiBaseUrl,
        defaultOrganizationId: parentOrganizationId,
      }),
    );
    return turnkeyPromise.catch((error: unknown) => {
      turnkeyPromise = null;
      throw error;
    });
  };

  const getClient = (): Promise<TurnkeyIndexedDbClient> => {
    clientPromise ??= getTurnkey()
      .then((turnkey) => turnkey.indexedDbClient() as unknown as TurnkeyIndexedDbClient)
      .then(async (client) => {
        await client.init();
        return client;
      });
    return clientPromise.catch((error: unknown) => {
      clientPromise = null;
      throw error;
    });
  };

  return {
    get generation() {
      return generation;
    },
    getClient,
    async getPublicKey() {
      const publicKey = await (await getClient()).getPublicKey();
      if (!publicKey) {
        throw new Error('Turnkey could not initialize a browser session key.');
      }
      return publicKey;
    },
    async getSession() {
      return (await getTurnkey()).getSession().catch(() => undefined);
    },
    async loginWithSession(session) {
      await (await getClient()).loginWithSession(session);
    },
    async createSigner(identity) {
      return createAccount({
        client: (await getClient()) as TurnkeySdkIndexedDbClient,
        organizationId: identity.subOrganizationId,
        signWith: identity.walletAddress,
        ethereumAddress: identity.walletAddress,
      });
    },
    async reset() {
      generation += 1;
      const turnkey = await turnkeyPromise?.catch(() => null);
      const client = await clientPromise?.catch(() => null);
      try {
        if (turnkey) {
          await turnkey.logout();
        }
        if (client) {
          await client.clear();
        }
      } finally {
        turnkeyPromise = null;
        clientPromise = null;
      }
    },
  };
}

function assertCurrentGeneration(runtime: TurnkeyBrowserRuntime, generation: number): void {
  if (runtime.generation !== generation) {
    throw new Error('Turnkey browser operation was invalidated by an identity reset.');
  }
}

/** @alpha */
export function createTurnkeyBrowserOtpClient<TContext>(
  options: CreateTurnkeyBrowserOtpClientOptions<TContext>,
): TurnkeyBrowserOtpClient<TContext> {
  const config = normalizedConfig(options.config);
  const runtime = options.runtime ?? createTurnkeyBrowserRuntime(config);
  const createId = options.createId ?? (() => globalThis.crypto.randomUUID());
  const now = options.now ?? Date.now;
  const encryptOtp = options.encryptOtp ?? encryptTurnkeyOtpCode;
  const signClientProof = options.createClientSignature ?? createTurnkeyClientSignature;

  const proofMessage = async (
    client: TurnkeyIndexedDbClient,
    verificationToken: string,
    usage: Record<string, unknown>,
  ): Promise<TurnkeyClientSignature> => {
    const proof = readTurnkeyVerificationTokenProof(verificationToken, { now });
    const [usageType, usageValue] = Object.entries(usage)[0] ?? [];
    if (!usageType) {
      throw new Error('Turnkey client-signature usage is missing.');
    }
    return signClientProof(
      client,
      JSON.stringify({
        [usageType]: usageValue,
        tokenId: proof.tokenId,
        type: usage.type,
      }),
      proof.publicKey,
    );
  };

  const parseRecovery = (value: unknown): TurnkeyBrowserRecoveryTarget => {
    const recovery = value as {
      childOrganizationId?: unknown;
      ownerUserId?: unknown;
      walletAddress?: unknown;
      walletId?: unknown;
      accountId?: unknown;
    } | null;
    const childOrganizationId = textValue(recovery?.childOrganizationId);
    const ownerUserId = textValue(recovery?.ownerUserId);
    const walletAddress = normalizeAddress(recovery?.walletAddress);
    const walletId = textValue(recovery?.walletId);
    const accountId = textValue(recovery?.accountId);
    if (!childOrganizationId || !ownerUserId || !walletAddress || !walletId) {
      throw new Error('Turnkey returned incomplete wallet recovery metadata.');
    }
    return {
      childOrganizationId,
      ownerUserId,
      walletAddress,
      walletId,
      ...(accountId ? { accountId } : {}),
    };
  };

  return {
    runtime,
    async startEmailOtp(input) {
      throwIfAborted(input.signal);
      const generation = runtime.generation;
      const contact = input.contact.trim();
      if (!contact) {
        throw new Error('Turnkey email contact is required.');
      }
      const publicKey = await runtime.getPublicKey();
      throwIfAborted(input.signal);
      assertCurrentGeneration(runtime, generation);
      const response = await options.serverSign<{
        otpId?: string;
        otpAttemptId?: string;
        otpEncryptionTargetBundle?: string;
        turnkeyRecovery?: unknown;
      }>(
        'initOtp',
        {
          organizationId: config.parentOrganizationId,
          appName: config.appName,
          otpType: 'OTP_TYPE_EMAIL',
          contact,
          otpLength: 6,
          alphanumeric: false,
          expirationSeconds: config.otpExpirationSeconds,
        },
        { context: input.context },
      );
      throwIfAborted(input.signal);
      assertCurrentGeneration(runtime, generation);
      const otpId = response.otpId?.trim() ?? '';
      const otpAttemptId = response.otpAttemptId?.trim() ?? '';
      const otpEncryptionTargetBundle = response.otpEncryptionTargetBundle?.trim() ?? '';
      if (!otpId) {
        throw new Error('Turnkey did not return an OTP challenge.');
      }
      if (!otpEncryptionTargetBundle) {
        throw new Error('Turnkey did not return an OTP encryption target.');
      }
      if (!/^[A-Za-z0-9_-]{16,128}$/.test(otpAttemptId)) {
        throw new Error('Turnkey did not return a valid backend OTP attempt.');
      }
      return {
        context: input.context,
        generation,
        otpAttemptId,
        contact,
        otpId,
        otpEncryptionTargetBundle,
        publicKey,
        recovery: (() => {
          const recovery =
            input.recoveryOverride === undefined
              ? response.turnkeyRecovery
              : input.recoveryOverride;
          return recovery == null ? null : parseRecovery(recovery);
        })(),
      };
    },
    async verifyOtp(attempt, otpCode, signal) {
      throwIfAborted(signal);
      assertCurrentGeneration(runtime, attempt.generation);
      if (attempt.verificationToken) {
        return;
      }
      let encryptedOtpBundle = attempt.encryptedOtpBundle?.trim() ?? '';
      if (!encryptedOtpBundle || attempt.encryptedOtpCode !== otpCode) {
        encryptedOtpBundle = await encryptOtp(
          otpCode,
          attempt.otpEncryptionTargetBundle,
          attempt.publicKey,
        );
        throwIfAborted(signal);
        assertCurrentGeneration(runtime, attempt.generation);
        attempt.encryptedOtpBundle = encryptedOtpBundle;
        attempt.encryptedOtpCode = otpCode;
        attempt.verificationIdempotencyKey = `verify-${attempt.otpAttemptId}-${createId()}`;
      }
      const response = await options.serverSign<{ verificationToken?: string }>(
        'verifyOtp',
        {
          organizationId: config.parentOrganizationId,
          otpId: attempt.otpId,
          encryptedOtpBundle,
          expirationSeconds: config.verificationExpirationSeconds,
        },
        {
          context: attempt.context,
          otpAttemptId: attempt.otpAttemptId,
          ...(attempt.verificationIdempotencyKey
            ? { idempotencyKey: attempt.verificationIdempotencyKey }
            : {}),
        },
      );
      throwIfAborted(signal);
      assertCurrentGeneration(runtime, attempt.generation);
      const verificationToken = response.verificationToken?.trim() ?? '';
      if (!verificationToken) {
        throw new Error('Turnkey did not return an OTP verification token.');
      }
      attempt.verificationToken = verificationToken;
      delete attempt.encryptedOtpBundle;
      delete attempt.encryptedOtpCode;
      delete attempt.verificationIdempotencyKey;
    },
    async establishSession(input) {
      throwIfAborted(input.signal);
      const { attempt } = input;
      assertCurrentGeneration(runtime, attempt.generation);
      const verificationToken = attempt.verificationToken?.trim() ?? '';
      if (!verificationToken) {
        throw new Error('Turnkey OTP verification has not been completed.');
      }
      const client = await runtime.getClient();
      throwIfAborted(input.signal);
      assertCurrentGeneration(runtime, attempt.generation);

      let subOrganizationId = attempt.recovery?.childOrganizationId ?? '';
      let walletId = attempt.recovery?.walletId ?? '';
      let walletAddress = attempt.recovery?.walletAddress ?? '';
      let createdUserId = attempt.recovery?.ownerUserId ?? '';
      let accountId = attempt.recovery?.accountId ?? '';
      if (!attempt.recovery) {
        let params = attempt.createSubOrganizationParams;
        if (!params) {
          const apiKeys: Record<string, unknown>[] = [];
          const authenticators: Record<string, unknown>[] = [];
          const oauthProviders: Record<string, unknown>[] = [];
          const clientSignature = await proofMessage(client, verificationToken, {
            signupV2: {
              apiKeys,
              authenticators,
              oauthProviders,
              email: attempt.contact,
            },
            type: 'USAGE_TYPE_SIGNUP',
          });
          params = {
            organizationId: config.parentOrganizationId,
            subOrganizationName: options.subOrganizationName(attempt),
            rootUsers: [
              {
                userName: attempt.contact,
                userEmail: attempt.contact,
                apiKeys,
                authenticators,
                oauthProviders,
              },
            ],
            rootQuorumThreshold: 1,
            wallet: {
              walletName: config.walletName,
              accounts: [defaultEthereumAccountAtIndex(0)],
              mnemonicLength: 12,
            },
            disableEmailRecovery: false,
            disableEmailAuth: false,
            disableSmsAuth: true,
            disableOtpEmailAuth: false,
            verificationToken,
            clientSignature,
          };
          attempt.createSubOrganizationParams = params;
        }
        const created = await options.serverSign<{
          subOrganizationId?: string;
          wallet?: { walletId?: string; addresses?: string[] };
          rootUserIds?: string[];
        }>('createSubOrganization', params, {
          context: attempt.context,
          otpAttemptId: attempt.otpAttemptId,
          idempotencyKey: `create-${attempt.otpAttemptId}`,
        });
        throwIfAborted(input.signal);
        assertCurrentGeneration(runtime, attempt.generation);
        subOrganizationId = created.subOrganizationId?.trim() ?? '';
        walletId = created.wallet?.walletId?.trim() ?? '';
        walletAddress = normalizeAddress(created.wallet?.addresses?.[0]);
        createdUserId = created.rootUserIds?.[0]?.trim() ?? '';
        if (!subOrganizationId || !walletId || !walletAddress || !createdUserId) {
          throw new Error('Turnkey wallet creation succeeded, but wallet metadata is incomplete.');
        }
      }

      const expectedAddress = input.expectedWalletAddress?.trim() ?? '';
      if (
        expectedAddress &&
        normalizeAddress(expectedAddress).toLowerCase() !== walletAddress.toLowerCase()
      ) {
        throw new Error('Turnkey wallet address does not match the authoritative expected wallet.');
      }

      let loginParams = attempt.otpLoginParams;
      if (loginParams) {
        if (
          textValue(loginParams.organizationId) !== subOrganizationId ||
          textValue(loginParams.verificationToken) !== verificationToken ||
          textValue(loginParams.publicKey) !== attempt.publicKey ||
          textValue(loginParams.expirationSeconds) !== config.sessionExpirationSeconds
        ) {
          throw new Error('Turnkey OTP login retry binding changed after provider submission.');
        }
      } else {
        const clientSignature = await proofMessage(client, verificationToken, {
          login: { publicKey: attempt.publicKey },
          type: 'USAGE_TYPE_LOGIN',
        });
        loginParams = {
          organizationId: subOrganizationId,
          verificationToken,
          publicKey: attempt.publicKey,
          expirationSeconds: config.sessionExpirationSeconds,
          invalidateExisting: true,
          clientSignature,
        };
        attempt.otpLoginParams = loginParams;
      }
      const login = await options.serverSign<{ session?: string }>('otpLogin', loginParams, {
        context: attempt.context,
        otpAttemptId: attempt.otpAttemptId,
        idempotencyKey: `login-${attempt.otpAttemptId}`,
      });
      throwIfAborted(input.signal);
      assertCurrentGeneration(runtime, attempt.generation);
      const session = login.session?.trim() ?? '';
      if (!session) {
        throw new Error('Turnkey did not return a wallet session.');
      }
      await runtime.loginWithSession(session);
      throwIfAborted(input.signal);
      assertCurrentGeneration(runtime, attempt.generation);
      const activeSession = await runtime.getSession();
      const { userId } = assertTurnkeySessionIdentity(activeSession, {
        organizationId: subOrganizationId,
        ...(createdUserId ? { userId: createdUserId } : {}),
      });
      const resolvedAccount = await resolveTurnkeyWalletAccount(client, {
        organizationId: subOrganizationId,
        walletId,
        ...(accountId ? { accountId } : {}),
        walletAddress,
      });
      throwIfAborted(input.signal);
      assertCurrentGeneration(runtime, attempt.generation);
      accountId = resolvedAccount.accountId;
      walletAddress = resolvedAccount.walletAddress;

      const identity: TurnkeyBrowserIdentity = {
        walletAddress,
        subOrganizationId,
        userId,
        walletId,
        accountId,
      };
      const createSigner = async (): Promise<LocalAccount> => {
        assertCurrentGeneration(runtime, attempt.generation);
        const signer = await runtime.createSigner(identity);
        assertCurrentGeneration(runtime, attempt.generation);
        if (normalizeAddress(signer.address).toLowerCase() !== walletAddress.toLowerCase()) {
          throw new Error('Turnkey signer does not match the resolved wallet account.');
        }
        return signer;
      };

      return {
        ...identity,
        createSigner,
        async signMessage(message: string) {
          const signer = await createSigner();
          return signer.signMessage({ message });
        },
      };
    },
    reset() {
      return runtime.reset();
    },
  };
}
