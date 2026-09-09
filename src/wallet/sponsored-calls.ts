/** @alpha */
export interface SponsoredCall {
  to: `0x${string}`;
  data: `0x${string}`;
  value: bigint;
}

/** @alpha */
export interface SponsoredCallProvider {
  prepareCalls(input: {
    account: `0x${string}`;
    calls: readonly SponsoredCall[];
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
export interface PendingSponsoredCall {
  operationKey: string;
  sender: string;
  chainId: number;
  target: string;
  data: string;
  value: string;
  callId: string;
  submittedAt: string;
}

/** @alpha */
export interface SponsoredCallPendingStore {
  read(operationKey: string, sender: string, chainId: number): PendingSponsoredCall | null;
  write(pending: PendingSponsoredCall): void;
  clear(operationKey: string, sender: string, chainId: number): void;
}

/** @alpha */
export interface BrowserSponsoredCallPendingStoreOptions {
  namespace: string;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
}

/**
 * Durable proof that the provider accepted the call, reported before the
 * browser starts waiting for confirmation. @alpha
 */
export interface SponsoredCallSubmissionEvidence {
  callId: string;
}

/**
 * Durable proof of the transaction the accepted call produced, reported
 * before any pending evidence is discarded. @alpha
 */
export interface SponsoredCallReceiptEvidence {
  callId: string;
  transactionHash: `0x${string}`;
}

/** @alpha */
export type SponsoredCallEvidencePhase = 'submission' | 'receipt';

/**
 * Registering durable evidence failed. The provider call was accepted and
 * stays resumable, so the host must retry rather than submit a replacement.
 * @alpha
 */
export class SponsoredCallEvidenceError extends Error {
  readonly phase: SponsoredCallEvidencePhase;
  readonly callId: string;
  readonly retryable = true;

  constructor(phase: SponsoredCallEvidencePhase, callId: string, cause: unknown) {
    super(
      cause instanceof Error && cause.message.trim()
        ? cause.message
        : `Recording the sponsored call ${phase} evidence failed.`,
      { cause },
    );
    this.name = 'SponsoredCallEvidenceError';
    this.phase = phase;
    this.callId = callId;
  }
}

/**
 * Whether a failure came from durable evidence registration rather than the
 * provider. Such a failure is retryable and leaves the accepted call
 * resumable, so hosts must not treat it as a completed or dead operation.
 * @alpha
 */
export const isSponsoredCallEvidenceError = (error: unknown): error is SponsoredCallEvidenceError =>
  error instanceof SponsoredCallEvidenceError ||
  (error as { name?: unknown } | null)?.name === 'SponsoredCallEvidenceError';

/** @alpha */
export interface ExecuteSponsoredCallInput {
  operationKey: string;
  sender: string;
  call: SponsoredCall;
  provider: SponsoredCallProvider;
  postcondition: () => boolean | Promise<boolean>;
  beforeSubmit?: () => void | Promise<void>;
  /**
   * Records the accepted provider call ID durably. Awaited before the browser
   * waits for confirmation, and awaited again on every resume. Host-owned:
   * endpoint construction and authentication stay outside this package.
   */
  onSubmissionEvidence?: (evidence: SponsoredCallSubmissionEvidence) => void | Promise<void>;
  /**
   * Records the observed transaction hash durably. Awaited after the receipt
   * hash is validated and before the postcondition is evaluated, so pending
   * evidence is never discarded ahead of its registration.
   */
  onReceiptEvidence?: (evidence: SponsoredCallReceiptEvidence) => void | Promise<void>;
  signal?: AbortSignal;
  onProgress?: (progress: SponsoredCallProgress) => void;
}

/** @alpha */
export interface SponsoredCallProgress {
  phase: 'checking' | 'preparing' | 'submitted' | 'confirming' | 'verified';
  callId?: string;
}

/** @alpha */
export interface SponsoredCallResult {
  alreadySatisfied: boolean;
  callId: string | null;
  transactionHash: `0x${string}` | null;
}

/** @alpha */
export interface SponsoredCallExecutor {
  execute(input: ExecuteSponsoredCallInput): Promise<SponsoredCallResult>;
}

/** @alpha */
export interface CreateSponsoredCallExecutorOptions {
  chainId: number;
  pendingStore?: SponsoredCallPendingStore;
  // Legacy compatibility option only: age cannot prove a replacement safe.
  pendingTtlMs?: number;
  confirmationTimeoutMs?: number;
  now?: () => number;
  isTerminalFailure?: (error: unknown) => boolean;
}

const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/u;
const HEX_PATTERN = /^0x(?:[0-9a-f]{2})*$/u;
const TRANSACTION_HASH_PATTERN = /^0x[0-9a-f]{64}$/u;
const CALL_ID_PATTERN = /^[\x21-\x7e]{1,512}$/u;
const DEFAULT_CONFIRMATION_TIMEOUT_MS = 120_000;

const normalizeAddress = (value: unknown, label: string): `0x${string}` => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!ADDRESS_PATTERN.test(normalized)) throw new TypeError(`${label} must be an EVM address.`);
  return normalized as `0x${string}`;
};

const normalizeData = (value: unknown): `0x${string}` => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!HEX_PATTERN.test(normalized)) throw new TypeError('call.data must be even-length hex data.');
  return normalized as `0x${string}`;
};

const operationKey = (value: string) => {
  const normalized = value.trim();
  if (!/^[a-z0-9][a-z0-9._:-]{0,159}$/iu.test(normalized)) {
    throw new TypeError('operationKey must be a bounded non-secret identifier.');
  }
  return normalized;
};

const providerCallId = (value: unknown) => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!CALL_ID_PATTERN.test(normalized)) {
    throw new TypeError('provider call ID must be a bounded visible ASCII identifier.');
  }
  return normalized;
};

const chainId = (value: number) => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError('chainId must be a positive safe integer.');
  }
  return value;
};

const callValue = (value: unknown): bigint => {
  if (typeof value !== 'bigint' || value < 0n) {
    throw new TypeError('call.value must be a non-negative bigint.');
  }
  return value;
};

const throwIfAborted = (signal?: AbortSignal) => {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException('Sponsored call was cancelled.', 'AbortError');
};

const userOperationFromPrepared = (prepared: unknown): Record<string, unknown> => {
  const value = prepared as { type?: unknown; data?: unknown } | null;
  if (value?.type === 'user-operation-v060' || value?.type === 'user-operation-v070') {
    return value;
  }
  if (value?.type === 'array' && Array.isArray(value.data)) {
    const operations = value.data.filter((candidate) => {
      const type = (candidate as { type?: unknown } | null)?.type;
      return type === 'user-operation-v060' || type === 'user-operation-v070';
    });
    if (value.data.length === 1 && operations.length === 1) {
      return operations[0] as Record<string, unknown>;
    }
  }
  throw new Error('The provider returned an unexpected sponsored-call signature request.');
};

const preparedChainId = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;

const bigintFromPrepared = (value: unknown): bigint | null => {
  if (
    typeof value !== 'bigint' &&
    !(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) &&
    !(typeof value === 'string' && /^(?:0|[1-9][0-9]*|0x[0-9a-f]+)$/iu.test(value))
  ) {
    return null;
  }
  try {
    const parsed = BigInt(value);
    return parsed >= 0n ? parsed : null;
  } catch {
    return null;
  }
};

/** Reject any prepared operation that differs from the one authorized by the caller. @alpha */
export const assertExactSponsoredCall = (
  prepared: unknown,
  expected: { sender: string; chainId: number; call: SponsoredCall },
): void => {
  const envelope = prepared as {
    details?: { type?: unknown; data?: { calls?: unknown } };
  } | null;
  const operation = userOperationFromPrepared(prepared) as {
    chainId?: unknown;
    data?: { sender?: unknown };
    feePayment?: { sponsored?: unknown };
  };
  const expectedSender = normalizeAddress(expected.sender, 'sender');
  const expectedTarget = normalizeAddress(expected.call.to, 'call.to');
  const expectedData = normalizeData(expected.call.data);
  const expectedValue = callValue(expected.call.value);

  if (
    preparedChainId(operation.chainId) !== chainId(expected.chainId) ||
    normalizeAddress(operation.data?.sender, 'prepared sender') !== expectedSender ||
    operation.feePayment?.sponsored !== true
  ) {
    throw new Error(
      'The provider prepared the sponsored call for a changed sender, chain, or fee policy.',
    );
  }

  const calls = envelope?.details?.data?.calls;
  const preparedCall = Array.isArray(calls)
    ? (calls[0] as Record<string, unknown> | undefined)
    : undefined;
  if (
    envelope?.details?.type !== 'user-operation' ||
    !Array.isArray(calls) ||
    calls.length !== 1 ||
    normalizeAddress(preparedCall?.to, 'prepared target') !== expectedTarget ||
    normalizeData(preparedCall?.data) !== expectedData ||
    bigintFromPrepared(preparedCall?.value) !== expectedValue
  ) {
    throw new Error('The provider prepared a call other than the exact authorized operation.');
  }
};

const transactionHashFromStatus = (status: unknown): `0x${string}` => {
  const candidate = (status as { receipts?: readonly { transactionHash?: unknown }[] } | null)
    ?.receipts?.[0]?.transactionHash;
  const hash = typeof candidate === 'string' ? candidate.trim().toLowerCase() : '';
  if (!TRANSACTION_HASH_PATTERN.test(hash)) {
    throw new Error('The provider confirmed the sponsored call without a transaction hash.');
  }
  return hash as `0x${string}`;
};

/**
 * Await one host evidence hook. A failure keeps the persisted provider call
 * intact and is surfaced as retryable, never as a provider-terminal failure.
 */
const registerEvidence = async (
  phase: SponsoredCallEvidencePhase,
  callId: string,
  register: () => void | Promise<void>,
): Promise<void> => {
  try {
    await register();
  } catch (error) {
    throw new SponsoredCallEvidenceError(phase, callId, error);
  }
};

const samePendingCall = (pending: PendingSponsoredCall, expected: PendingSponsoredCall) =>
  pending.operationKey === expected.operationKey &&
  pending.sender === expected.sender &&
  pending.chainId === expected.chainId &&
  pending.target === expected.target &&
  pending.data === expected.data &&
  pending.value === expected.value &&
  Boolean(pending.callId.trim()) &&
  Number.isFinite(Date.parse(pending.submittedAt));

/** Create a browser-backed exact-operation pending store. @alpha */
export const createBrowserSponsoredCallPendingStore = (
  options: BrowserSponsoredCallPendingStoreOptions,
): SponsoredCallPendingStore => {
  const namespace = operationKey(options.namespace);
  const memory = new Map<string, PendingSponsoredCall>();
  const memoryOnlyKeys = new Set<string>();
  const keyFor = (key: string, sender: string, expectedChainId: number) =>
    `${namespace}:${operationKey(key)}:${String(chainId(expectedChainId))}:${normalizeAddress(sender, 'sender')}`;

  return {
    read(key, sender, expectedChainId) {
      const storageKey = keyFor(key, sender, expectedChainId);
      const cached = memory.get(storageKey);
      if (!options.storage || memoryOnlyKeys.has(storageKey)) return cached ?? null;
      try {
        const raw = options.storage.getItem(storageKey);
        if (!raw) {
          memory.delete(storageKey);
          return null;
        }
        const parsed = JSON.parse(raw) as Partial<PendingSponsoredCall>;
        const pending: PendingSponsoredCall = {
          operationKey: operationKey(parsed.operationKey ?? ''),
          sender: normalizeAddress(parsed.sender, 'pending sender'),
          chainId: chainId(Number(parsed.chainId)),
          target: normalizeAddress(parsed.target, 'pending target'),
          data: normalizeData(parsed.data),
          value: String(BigInt(parsed.value ?? '')),
          callId: providerCallId(parsed.callId),
          submittedAt: (parsed.submittedAt ?? '').trim(),
        };
        if (
          pending.operationKey !== operationKey(key) ||
          pending.sender !== normalizeAddress(sender, 'sender') ||
          pending.chainId !== chainId(expectedChainId) ||
          !Number.isFinite(Date.parse(pending.submittedAt))
        ) {
          memory.delete(storageKey);
          options.storage.removeItem(storageKey);
          return null;
        }
        memory.set(storageKey, pending);
        return pending;
      } catch {
        memory.delete(storageKey);
        memoryOnlyKeys.delete(storageKey);
        try {
          options.storage.removeItem(storageKey);
        } catch {
          // Malformed browser storage remains unusable but does not escape this boundary.
        }
        return null;
      }
    },
    write(pending) {
      const storageKey = keyFor(pending.operationKey, pending.sender, pending.chainId);
      memory.set(storageKey, pending);
      if (!options.storage) {
        memoryOnlyKeys.add(storageKey);
        return;
      }
      try {
        options.storage.setItem(storageKey, JSON.stringify(pending));
        memoryOnlyKeys.delete(storageKey);
      } catch {
        memoryOnlyKeys.add(storageKey);
        // In-memory state still prevents duplicate submission in this runtime.
      }
    },
    clear(key, sender, expectedChainId) {
      const storageKey = keyFor(key, sender, expectedChainId);
      memory.delete(storageKey);
      memoryOnlyKeys.delete(storageKey);
      try {
        options.storage?.removeItem(storageKey);
      } catch {
        // The injected postcondition remains authoritative.
      }
    },
  };
};

/** Execute, persist, resume, and independently verify one exact sponsored EVM call. @alpha */
export const createSponsoredCallExecutor = (
  options: CreateSponsoredCallExecutorOptions,
): SponsoredCallExecutor => {
  const expectedChainId = chainId(options.chainId);
  const confirmationTimeoutMs = options.confirmationTimeoutMs ?? DEFAULT_CONFIRMATION_TIMEOUT_MS;
  if (!Number.isFinite(confirmationTimeoutMs) || confirmationTimeoutMs <= 0) {
    throw new TypeError('confirmationTimeoutMs must be a positive number.');
  }
  if (
    options.pendingTtlMs !== undefined &&
    (!Number.isFinite(options.pendingTtlMs) || options.pendingTtlMs <= 0)
  ) {
    throw new TypeError('pendingTtlMs must be a positive number.');
  }
  const now = options.now ?? Date.now;
  const inFlight = new Set<string>();
  const isTerminalFailure =
    options.isTerminalFailure ??
    ((error: unknown) => (error as { name?: unknown } | null)?.name === 'BundleFailedError');

  return {
    async execute(input): Promise<SponsoredCallResult> {
      const key = operationKey(input.operationKey);
      const sender = normalizeAddress(input.sender, 'sender');
      const call: SponsoredCall = {
        to: normalizeAddress(input.call.to, 'call.to'),
        data: normalizeData(input.call.data),
        value: callValue(input.call.value),
      };
      const executionKey = `${String(expectedChainId)}:${sender}:${key}`;
      if (inFlight.has(executionKey)) {
        throw new Error('The same sponsored operation is already in progress.');
      }
      inFlight.add(executionKey);
      try {
        throwIfAborted(input.signal);
        input.onProgress?.({ phase: 'checking' });
        const expectedPending: PendingSponsoredCall = {
          operationKey: key,
          sender,
          chainId: expectedChainId,
          target: call.to,
          data: call.data,
          value: String(call.value),
          callId: '',
          submittedAt: '',
        };
        let pending = options.pendingStore?.read(key, sender, expectedChainId) ?? null;
        if (pending) pending = { ...pending, callId: providerCallId(pending.callId) };
        if (pending && !samePendingCall(pending, { ...expectedPending, callId: pending.callId })) {
          throw new Error(
            'The persisted sponsored call does not match the currently authorized operation.',
          );
        }

        // A persisted provider call always wins over an already-satisfied host
        // check. It still has evidence to register and a receipt to reconcile;
        // neither elapsed time nor backend progress proves a replacement safe.
        if (!pending && (await input.postcondition())) {
          input.onProgress?.({ phase: 'verified' });
          return { alreadySatisfied: true, callId: null, transactionHash: null };
        }
        throwIfAborted(input.signal);

        let callId = pending?.callId ?? '';
        if (!callId) {
          const observedNow = now();
          let submittedAt: string;
          try {
            submittedAt = new Date(observedNow).toISOString();
          } catch {
            throw new TypeError('now must return a valid epoch-millisecond timestamp.');
          }
          input.onProgress?.({ phase: 'preparing' });
          const prepared = await input.provider.prepareCalls({ account: sender, calls: [call] });
          throwIfAborted(input.signal);
          assertExactSponsoredCall(prepared, { sender, chainId: expectedChainId, call });
          const signed = await input.provider.signPreparedCalls(prepared);
          throwIfAborted(input.signal);
          await input.beforeSubmit?.();
          throwIfAborted(input.signal);
          const submitted = await input.provider.sendPreparedCalls(signed);
          callId = providerCallId((submitted as { id?: unknown } | null)?.id);
          options.pendingStore?.write({
            ...expectedPending,
            callId,
            submittedAt,
          });
        }

        input.onProgress?.({ phase: 'submitted', callId });
        // Registration runs on every attempt, fresh or resumed, and is awaited
        // before any confirmation wait: the owning operation must hold the
        // provider call ID before this browser can lose it.
        await registerEvidence('submission', callId, () =>
          input.onSubmissionEvidence?.({ callId }),
        );
        throwIfAborted(input.signal);
        input.onProgress?.({ phase: 'confirming', callId });
        let status: unknown;
        try {
          status = await input.provider.waitForCallsStatus({
            id: callId,
            timeout: confirmationTimeoutMs,
            throwOnFailure: true,
          });
        } catch (error) {
          if (isTerminalFailure(error)) options.pendingStore?.clear(key, sender, expectedChainId);
          throw error;
        }
        throwIfAborted(input.signal);
        const transactionHash = transactionHashFromStatus(status);
        await registerEvidence('receipt', callId, () =>
          input.onReceiptEvidence?.({ callId, transactionHash }),
        );
        if (!(await input.postcondition())) {
          throw new Error(
            'The sponsored call confirmed, but its required postcondition is not satisfied.',
          );
        }
        options.pendingStore?.clear(key, sender, expectedChainId);
        input.onProgress?.({ phase: 'verified', callId });
        return { alreadySatisfied: false, callId, transactionHash };
      } finally {
        inFlight.delete(executionKey);
      }
    },
  };
};
