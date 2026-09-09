import { alchemyWalletTransport, createSmartWalletClient } from '@alchemy/wallet-apis';
import { createPublicClient, http, type Hex, type SignableMessage } from 'viem';
import { sepolia } from 'viem/chains';

/** @alpha */
export const EIP_7702_DELEGATION_PREFIX = '0xef0100';
/** @alpha */
export const ALCHEMY_MODULAR_ACCOUNT_V2_ADDRESS = '0x69007702764179f14f51cdce752f4f775d74e139';
/** @alpha */
export const ALCHEMY_MODULAR_ACCOUNT_V2_DELEGATION = `${EIP_7702_DELEGATION_PREFIX}${ALCHEMY_MODULAR_ACCOUNT_V2_ADDRESS.slice(2)}`;
/** @alpha */
export const ETHEREUM_SEPOLIA_CHAIN_ID = 11_155_111;
/** @alpha */
export const DEFAULT_EIP_7702_PENDING_TTL_MS = 24 * 60 * 60 * 1_000;
/** @alpha */
export const DEFAULT_EIP_7702_CONFIRMATION_TIMEOUT_MS = 120_000;

/** @alpha */
export interface Eip7702Signer {
  address: `0x${string}`;
  signMessage: (parameters: { message: SignableMessage }) => Promise<Hex>;
  // Method syntax, not property syntax: viem's `LocalAccount` declares
  // `signTypedData`/`signAuthorization` with specific generic parameters, which
  // `strictFunctionTypes` rejects against a contravariant `(parameters: unknown)`
  // property. Without the bivariant method form the runtime's own
  // `createSigner()` result cannot be passed to `ensureDelegation()` by a strict
  // consumer, so the SDK's two wallet halves would not compose.
  signTypedData(parameters: unknown): Promise<Hex>;
  signAuthorization?(parameters: unknown): Promise<{
    r: `0x${string}`;
    s: `0x${string}`;
    v?: number | bigint | string;
    yParity?: number | bigint | string;
  }>;
}

/** @alpha */
export interface Eip7702DelegationInspection {
  code: string;
  delegationAddress: string | null;
  expectedDelegationAddress: string;
  status: 'not_delegated' | 'ready' | 'unexpected_delegation';
}

/** @alpha */
export interface Eip7702ActivationResult extends Eip7702DelegationInspection {
  callId?: string;
  transactionHash?: string;
}

/** @alpha */
export interface Eip7702PendingOperation {
  address: string;
  callId: string;
  chainId: number;
  submittedAt: string;
}

/** @alpha */
export interface Eip7702PendingOperationStore {
  read(address: string, chainId: number): Eip7702PendingOperation | null;
  write(pending: Eip7702PendingOperation): void;
  clear(address: string, chainId: number): void;
}

/** @alpha */
export interface Eip7702PreparedCallsProvider {
  prepareCalls(input: {
    account: `0x${string}`;
    calls: [];
    capabilities: {
      eip7702Auth: {
        account: `0x${string}`;
        delegation: string;
      };
    };
  }): Promise<unknown>;
  signPreparedCalls(prepared: unknown): Promise<unknown>;
  sendPreparedCalls(signed: unknown): Promise<unknown>;
  waitForCallsStatus(input: {
    id: string;
    timeout: number;
    throwOnFailure: true;
  }): Promise<unknown>;
}

/** @alpha */
export interface Eip7702ActivationProgress {
  phase: 'inspecting' | 'preparing' | 'submitted' | 'confirming' | 'verified';
  callId?: string;
}

/** @alpha */
export interface EnsureEip7702DelegationInput {
  signer: Eip7702Signer;
  expectedWalletAddress: string;
  signal?: AbortSignal;
  onSubmitted?: (callId: string) => void;
  onProgress?: (progress: Eip7702ActivationProgress) => void;
}

/** @alpha */
export interface Eip7702Activator {
  inspect(walletAddress: string): Promise<Eip7702DelegationInspection>;
  ensureDelegation(input: EnsureEip7702DelegationInput): Promise<Eip7702ActivationResult>;
}

/** @alpha */
export interface CreateEip7702ActivatorOptions {
  chainId?: number;
  delegateAddress?: string;
  delegationName?: string;
  pendingStore?: Eip7702PendingOperationStore;
  pendingTtlMs?: number;
  confirmationTimeoutMs?: number;
  now?: () => number;
  inspectBytecode: (walletAddress: `0x${string}`) => Promise<string | undefined>;
  createProvider: (
    signer: Eip7702Signer,
    expectedWalletAddress: `0x${string}`,
  ) => Eip7702PreparedCallsProvider | Promise<Eip7702PreparedCallsProvider>;
  isTerminalFailure?: (error: unknown) => boolean;
}

/** @alpha */
export interface BrowserEip7702PendingStoreOptions {
  namespace: string;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
}

/** @alpha */
export interface CreateAlchemyEip7702ActivatorOptions {
  apiKey: string;
  policyId: string;
  rpcUrl?: string;
  pendingStore?: Eip7702PendingOperationStore;
  pendingTtlMs?: number;
  confirmationTimeoutMs?: number;
  now?: () => number;
}

function normalizeAddress(value: unknown): string {
  return (typeof value === 'string' ? value : '').trim().toLowerCase();
}

function nonEmptyString(value: string | undefined): string | undefined {
  return value && value.length > 0 ? value : undefined;
}

function requireAddress(value: unknown, label: string): `0x${string}` {
  const address = normalizeAddress(value);
  if (!/^0x[0-9a-f]{40}$/.test(address)) {
    throw new Error(`${label} is unavailable.`);
  }
  return address as `0x${string}`;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException('Wallet activation was cancelled.', 'AbortError');
  }
}

function delegationCode(delegateAddress: string): string {
  const delegate = normalizeAddress(delegateAddress);
  return `${EIP_7702_DELEGATION_PREFIX}${delegate.replace(/^0x/, '')}`;
}

/** @alpha */
export function inspectEip7702Bytecode(
  codeValue: unknown,
  expectedDelegateAddress = ALCHEMY_MODULAR_ACCOUNT_V2_ADDRESS,
): Eip7702DelegationInspection {
  const code = (typeof codeValue === 'string' ? codeValue.trim().toLowerCase() : '') || '0x';
  const expectedDelegationAddress = normalizeAddress(expectedDelegateAddress);
  const expectedCode = delegationCode(expectedDelegationAddress);
  const isDelegation = code.startsWith(EIP_7702_DELEGATION_PREFIX) && code.length === 48;

  return {
    code,
    delegationAddress: isDelegation ? `0x${code.slice(EIP_7702_DELEGATION_PREFIX.length)}` : null,
    expectedDelegationAddress,
    status:
      code === expectedCode ? 'ready' : code === '0x' ? 'not_delegated' : 'unexpected_delegation',
  };
}

/** @alpha */
export function assertSafeEip7702PreparedCalls(
  preparedCalls: unknown,
  expectedWalletAddress: string,
  options: {
    chainId?: number;
    delegateAddress?: string;
  } = {},
): void {
  const chainId = options.chainId ?? ETHEREUM_SEPOLIA_CHAIN_ID;
  const delegateAddress = normalizeAddress(
    options.delegateAddress ?? ALCHEMY_MODULAR_ACCOUNT_V2_ADDRESS,
  );
  const prepared = preparedCalls as {
    data?: unknown;
    details?: { data?: { calls?: unknown }; type?: unknown };
    type?: unknown;
  } | null;
  if (prepared?.type !== 'array' || !Array.isArray(prepared.data)) {
    throw new Error('Alchemy returned an unsupported wallet-upgrade authorization.');
  }

  const authorizations = prepared.data.filter(
    (item) => (item as { type?: unknown } | null)?.type === 'authorization',
  );
  const userOperations = prepared.data.filter((item) => {
    const type = (item as { type?: unknown } | null)?.type;
    return type === 'user-operation-v060' || type === 'user-operation-v070';
  });
  if (prepared.data.length !== 2 || authorizations.length !== 1 || userOperations.length !== 1) {
    throw new Error('Alchemy returned an unexpected set of wallet-upgrade signature requests.');
  }

  const authorization = authorizations[0] as {
    chainId?: unknown;
    data?: { address?: unknown };
    signatureRequest?: { type?: unknown };
    type?: unknown;
  };
  if (
    authorization.type !== 'authorization' ||
    authorization.chainId !== chainId ||
    normalizeAddress(authorization.data?.address) !== delegateAddress ||
    authorization.signatureRequest?.type !== 'eip7702Auth'
  ) {
    throw new Error(
      'Alchemy returned a wallet-upgrade authorization that does not match the approved delegation.',
    );
  }

  const userOperation = userOperations[0] as {
    chainId?: unknown;
    data?: { sender?: unknown };
    feePayment?: { sponsored?: unknown };
  };
  const calls = prepared.details?.data?.calls;
  if (
    userOperation.chainId !== chainId ||
    normalizeAddress(userOperation.data?.sender) !== normalizeAddress(expectedWalletAddress) ||
    userOperation.feePayment?.sponsored !== true ||
    prepared.details?.type !== 'user-operation' ||
    !Array.isArray(calls) ||
    calls.length !== 0
  ) {
    throw new Error(
      'Alchemy returned a wallet upgrade that is not the approved empty, sponsored operation.',
    );
  }
}

function transactionHashFromStatus(status: unknown): string | undefined {
  const receipts = (
    status as {
      receipts?: { transactionHash?: string }[];
    } | null
  )?.receipts;
  const transactionHash = receipts?.[0]?.transactionHash?.trim();
  return transactionHash;
}

function isFreshPendingOperation(
  pending: Eip7702PendingOperation,
  expectedAddress: string,
  chainId: number,
  now: number,
  ttlMs: number,
): boolean {
  const submittedAt = Date.parse(pending.submittedAt);
  return (
    normalizeAddress(pending.address) === normalizeAddress(expectedAddress) &&
    pending.chainId === chainId &&
    Boolean(pending.callId.trim()) &&
    Number.isFinite(submittedAt) &&
    now - submittedAt >= 0 &&
    now - submittedAt <= ttlMs
  );
}

/** @alpha */
export function createBrowserEip7702PendingStore(
  options: BrowserEip7702PendingStoreOptions,
): Eip7702PendingOperationStore {
  const namespace = options.namespace.trim();
  if (!namespace) {
    throw new Error('EIP-7702 pending-operation storage namespace is required.');
  }
  const memory = new Map<string, Eip7702PendingOperation>();
  const keyFor = (address: string, chainId: number) =>
    `${namespace}:${String(chainId)}:${normalizeAddress(address)}`;

  return {
    read(address, chainId) {
      const key = keyFor(address, chainId);
      const cached = memory.get(key);
      if (cached) {
        return cached;
      }
      try {
        const raw = options.storage?.getItem(key);
        if (!raw) {
          return null;
        }
        const parsed = JSON.parse(raw) as Partial<Eip7702PendingOperation>;
        const pending: Eip7702PendingOperation = {
          address: normalizeAddress(parsed.address),
          callId: parsed.callId?.trim() ?? '',
          chainId: Number(parsed.chainId),
          submittedAt: parsed.submittedAt?.trim() ?? '',
        };
        if (
          pending.address !== normalizeAddress(address) ||
          !pending.callId ||
          pending.chainId !== chainId
        ) {
          options.storage?.removeItem(key);
          return null;
        }
        memory.set(key, pending);
        return pending;
      } catch {
        try {
          options.storage?.removeItem(key);
        } catch {
          // Storage is unavailable; the malformed record cannot be recovered in this runtime.
        }
        return null;
      }
    },
    write(pending) {
      const key = keyFor(pending.address, pending.chainId);
      memory.set(key, pending);
      try {
        options.storage?.setItem(key, JSON.stringify(pending));
      } catch {
        // Memory still prevents duplicate submission in this runtime.
      }
    },
    clear(address, chainId) {
      const key = keyFor(address, chainId);
      memory.delete(key);
      try {
        options.storage?.removeItem(key);
      } catch {
        // Exact chain inspection remains authoritative.
      }
    },
  };
}

/** @alpha */
export function createEip7702Activator(options: CreateEip7702ActivatorOptions): Eip7702Activator {
  const chainId = options.chainId ?? ETHEREUM_SEPOLIA_CHAIN_ID;
  const delegateAddress = normalizeAddress(
    options.delegateAddress ?? ALCHEMY_MODULAR_ACCOUNT_V2_ADDRESS,
  );
  const delegationName = (options.delegationName ?? 'ModularAccountV2').trim();
  const pendingTtlMs = options.pendingTtlMs ?? DEFAULT_EIP_7702_PENDING_TTL_MS;
  const confirmationTimeoutMs =
    options.confirmationTimeoutMs ?? DEFAULT_EIP_7702_CONFIRMATION_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  const isTerminalFailure =
    options.isTerminalFailure ??
    ((error: unknown) => (error as { name?: unknown } | null)?.name === 'BundleFailedError');

  const inspect = async (walletAddress: string): Promise<Eip7702DelegationInspection> => {
    const address = requireAddress(walletAddress, 'Wallet address');
    const code = await options.inspectBytecode(address);
    return inspectEip7702Bytecode(code, delegateAddress);
  };

  return {
    inspect,
    async ensureDelegation(input): Promise<Eip7702ActivationResult> {
      throwIfAborted(input.signal);
      const expectedAddress = requireAddress(
        input.expectedWalletAddress,
        'Expected wallet address',
      );
      const signerAddress = requireAddress(input.signer.address, 'Wallet signer address');
      if (normalizeAddress(signerAddress) !== normalizeAddress(expectedAddress)) {
        throw new Error('The authenticated wallet does not match the expected wallet address.');
      }
      if (!input.signer.signAuthorization) {
        throw new Error('The wallet signer does not support EIP-7702 authorization signing.');
      }

      input.onProgress?.({ phase: 'inspecting' });
      const before = await inspect(expectedAddress);
      throwIfAborted(input.signal);
      if (before.status === 'ready') {
        options.pendingStore?.clear(expectedAddress, chainId);
        input.onProgress?.({ phase: 'verified' });
        return before;
      }
      if (before.status === 'unexpected_delegation') {
        throw new Error(
          before.delegationAddress
            ? `This wallet is delegated to an unsupported contract (${before.delegationAddress}). Contact support before continuing.`
            : 'This wallet address has unsupported on-chain code. Contact support before continuing.',
        );
      }

      const provider = await options.createProvider(input.signer, expectedAddress);
      throwIfAborted(input.signal);
      const stored = options.pendingStore?.read(expectedAddress, chainId) ?? null;
      const pending =
        stored && isFreshPendingOperation(stored, expectedAddress, chainId, now(), pendingTtlMs)
          ? stored
          : null;
      if (stored && !pending) {
        options.pendingStore?.clear(expectedAddress, chainId);
      }

      let callId = pending?.callId ?? '';
      if (!callId) {
        input.onProgress?.({ phase: 'preparing' });
        const prepared = await provider.prepareCalls({
          account: expectedAddress,
          calls: [],
          capabilities: {
            eip7702Auth: {
              account: expectedAddress,
              delegation: delegationName,
            },
          },
        });
        throwIfAborted(input.signal);
        assertSafeEip7702PreparedCalls(prepared, expectedAddress, {
          chainId,
          delegateAddress,
        });
        const signed = await provider.signPreparedCalls(prepared);
        throwIfAborted(input.signal);
        const response = await provider.sendPreparedCalls(signed);
        const responseId = (response as { id?: unknown } | null)?.id;
        callId = typeof responseId === 'string' ? responseId.trim() : '';
        if (!callId) {
          throw new Error('Alchemy accepted the wallet upgrade without returning a call ID.');
        }
        options.pendingStore?.write({
          address: normalizeAddress(expectedAddress),
          callId,
          chainId,
          submittedAt: new Date(now()).toISOString(),
        });
      }

      input.onSubmitted?.(callId);
      input.onProgress?.({ phase: 'submitted', callId });
      throwIfAborted(input.signal);
      input.onProgress?.({ phase: 'confirming', callId });
      let status: unknown;
      try {
        status = await provider.waitForCallsStatus({
          id: callId,
          timeout: confirmationTimeoutMs,
          throwOnFailure: true,
        });
      } catch (error) {
        if (isTerminalFailure(error)) {
          options.pendingStore?.clear(expectedAddress, chainId);
        }
        throw error;
      }
      throwIfAborted(input.signal);

      const after = await inspect(expectedAddress);
      throwIfAborted(input.signal);
      if (after.status !== 'ready') {
        throw new Error(
          'The wallet upgrade was submitted, but the expected Alchemy delegation was not confirmed on-chain.',
        );
      }
      options.pendingStore?.clear(expectedAddress, chainId);
      input.onProgress?.({ phase: 'verified', callId });

      const transactionHash = transactionHashFromStatus(status);
      return {
        ...after,
        callId,
        ...(transactionHash ? { transactionHash } : {}),
      };
    },
  };
}

/** @alpha */
export function createAlchemyEip7702Activator(
  options: CreateAlchemyEip7702ActivatorOptions,
): Eip7702Activator {
  const apiKey = options.apiKey.trim();
  const policyId = options.policyId.trim();
  if (!apiKey) {
    throw new Error('Alchemy Wallet API key is required.');
  }
  if (!policyId) {
    throw new Error('Alchemy Gas Manager policy ID is required.');
  }
  const rpcUrl =
    nonEmptyString(options.rpcUrl?.trim()) ?? `https://eth-sepolia.g.alchemy.com/v2/${apiKey}`;
  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(rpcUrl),
  });

  return createEip7702Activator({
    chainId: sepolia.id,
    delegateAddress: ALCHEMY_MODULAR_ACCOUNT_V2_ADDRESS,
    delegationName: 'ModularAccountV2',
    ...(options.pendingStore === undefined ? {} : { pendingStore: options.pendingStore }),
    ...(options.pendingTtlMs === undefined ? {} : { pendingTtlMs: options.pendingTtlMs }),
    ...(options.confirmationTimeoutMs === undefined
      ? {}
      : { confirmationTimeoutMs: options.confirmationTimeoutMs }),
    ...(options.now === undefined ? {} : { now: options.now }),
    inspectBytecode: async (walletAddress) => publicClient.getCode({ address: walletAddress }),
    createProvider: (signer, expectedWalletAddress) =>
      createSmartWalletClient({
        signer: signer as never,
        transport: alchemyWalletTransport({ apiKey }),
        chain: sepolia,
        account: expectedWalletAddress,
        paymaster: { policyId },
      }) as unknown as Eip7702PreparedCallsProvider,
  });
}
