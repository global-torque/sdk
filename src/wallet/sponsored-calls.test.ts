/* eslint-disable @typescript-eslint/unbound-method */
import { describe, expect, it, vi } from 'vitest';
import {
  assertExactSponsoredCall,
  createBrowserSponsoredCallPendingStore,
  createSponsoredCallExecutor,
  SponsoredCallEvidenceError,
  type PendingSponsoredCall,
  type SponsoredCall,
  type SponsoredCallPendingStore,
  type SponsoredCallProvider,
} from './sponsored-calls.js';

const sender = '0x1111111111111111111111111111111111111111';
const target = '0x2222222222222222222222222222222222222222';
const changedTarget = '0x3333333333333333333333333333333333333333';
const chainId = 11_155_111;
const transactionHash = `0x${'ab'.repeat(32)}` as const;
const call = {
  to: target,
  data: '0x4a9f8f930000000000000000000000001111111111111111111111111111111111111111',
  value: 0n,
} as const satisfies SponsoredCall;

const preparedOperation = (overrides: Record<string, unknown> = {}) => ({
  type: 'user-operation-v070',
  chainId,
  data: { sender },
  feePayment: { sponsored: true },
  details: {
    type: 'user-operation',
    data: { calls: [{ to: target, data: call.data, value: '0' }] },
  },
  ...overrides,
});

const createProvider = (
  options: {
    prepared?: unknown;
    submitted?: unknown;
    status?: unknown;
    waitError?: Error;
  } = {},
) => {
  const provider: SponsoredCallProvider = {
    prepareCalls: vi.fn().mockResolvedValue(options.prepared ?? preparedOperation()),
    signPreparedCalls: vi.fn().mockResolvedValue({ signature: '0x1234' }),
    sendPreparedCalls: vi.fn().mockResolvedValue(options.submitted ?? { id: 'bundle_01J5' }),
    waitForCallsStatus: options.waitError
      ? vi.fn().mockRejectedValue(options.waitError)
      : vi.fn().mockResolvedValue(
          options.status ?? {
            receipts: [{ transactionHash: transactionHash.toUpperCase().replace('0X', '0x') }],
          },
        ),
  };
  return provider;
};

const createPendingStore = (initial: PendingSponsoredCall | null = null) => {
  let pending = initial;
  const store: SponsoredCallPendingStore = {
    read: vi.fn(() => pending),
    write: vi.fn((next: PendingSponsoredCall) => {
      pending = next;
    }),
    clear: vi.fn(() => {
      pending = null;
    }),
  };
  return { store, current: () => pending };
};

const persistedCall = (overrides: Partial<PendingSponsoredCall> = {}): PendingSponsoredCall => ({
  operationKey: 'erc7943.release:123',
  sender,
  chainId,
  target,
  data: call.data,
  value: '0',
  callId: 'bundle_existing',
  submittedAt: '2026-08-08T10:00:00.000Z',
  ...overrides,
});
const persistedNow = () => Date.parse('2026-08-08T10:01:00.000Z');

const executeInput = (
  provider: SponsoredCallProvider,
  postcondition: () => boolean | Promise<boolean>,
) => ({
  operationKey: 'erc7943.release:123',
  sender,
  call,
  provider,
  postcondition,
});

describe('exact sponsored-call validation', () => {
  it('accepts exact direct and single-operation array provider payloads', () => {
    const operation = preparedOperation();
    expect(() => assertExactSponsoredCall(operation, { sender, chainId, call })).not.toThrow();
    expect(() =>
      assertExactSponsoredCall(
        { type: 'array', data: [operation], details: operation.details },
        { sender, chainId, call },
      ),
    ).not.toThrow();
  });

  it.each([
    ['sender', preparedOperation({ data: { sender: changedTarget } })],
    ['chain', preparedOperation({ chainId: 1 })],
    ['sponsorship', preparedOperation({ feePayment: { sponsored: false } })],
    [
      'detail type',
      preparedOperation({ details: { type: 'transaction', data: { calls: [call] } } }),
    ],
    [
      'target',
      preparedOperation({
        details: { type: 'user-operation', data: { calls: [{ ...call, to: changedTarget }] } },
      }),
    ],
    [
      'calldata',
      preparedOperation({
        details: { type: 'user-operation', data: { calls: [{ ...call, data: '0x1234' }] } },
      }),
    ],
    [
      'value',
      preparedOperation({
        details: { type: 'user-operation', data: { calls: [{ ...call, value: '1' }] } },
      }),
    ],
    [
      'additional call',
      preparedOperation({ details: { type: 'user-operation', data: { calls: [call, call] } } }),
    ],
    ['additional operation', { type: 'array', data: [preparedOperation(), preparedOperation()] }],
    [
      'coercive zero value',
      preparedOperation({
        details: { type: 'user-operation', data: { calls: [{ ...call, value: false }] } },
      }),
    ],
  ])('rejects changed %s before signing', (_field, prepared) => {
    expect(() => assertExactSponsoredCall(prepared, { sender, chainId, call })).toThrow();
  });

  it('rejects a coercive boolean chain identifier even when it numerically matches', () => {
    expect(() =>
      assertExactSponsoredCall(preparedOperation({ chainId: true }), {
        sender,
        chainId: 1,
        call,
      }),
    ).toThrow();
  });
});

describe('sponsored-call executor', () => {
  it('submits, persists, confirms, verifies, and clears an exact operation', async () => {
    const provider = createProvider();
    const pending = createPendingStore();
    const postcondition = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const progress: unknown[] = [];
    const executor = createSponsoredCallExecutor({
      chainId,
      pendingStore: pending.store,
      now: () => Date.parse('2026-08-08T10:00:00.000Z'),
    });

    const result = await executor.execute({
      ...executeInput(provider, postcondition),
      onProgress: (event) => progress.push(event),
    });

    expect(result).toEqual({
      alreadySatisfied: false,
      callId: 'bundle_01J5',
      transactionHash,
    });
    expect(provider.prepareCalls).toHaveBeenCalledWith({ account: sender, calls: [call] });
    expect(provider.waitForCallsStatus).toHaveBeenCalledWith({
      id: 'bundle_01J5',
      timeout: 120_000,
      throwOnFailure: true,
    });
    expect(pending.store.write).toHaveBeenCalledWith(persistedCall({ callId: 'bundle_01J5' }));
    expect(pending.current()).toBeNull();
    expect(progress).toEqual([
      { phase: 'checking' },
      { phase: 'preparing' },
      { phase: 'submitted', callId: 'bundle_01J5' },
      { phase: 'confirming', callId: 'bundle_01J5' },
      { phase: 'verified', callId: 'bundle_01J5' },
    ]);
  });

  it('runs the final backend fence after signing and before provider submission', async () => {
    const provider = createProvider();
    const beforeSubmit = vi.fn().mockResolvedValue(undefined);
    const executor = createSponsoredCallExecutor({ chainId });
    const postcondition = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await executor.execute({
      ...executeInput(provider, postcondition),
      beforeSubmit,
    });

    expect(beforeSubmit).toHaveBeenCalledTimes(1);
    expect(provider.signPreparedCalls).toHaveBeenCalledBefore(beforeSubmit);
    expect(beforeSubmit).toHaveBeenCalledBefore(provider.sendPreparedCalls as never);
  });

  it('reconciles stored provider evidence even when the host postcondition is already true', async () => {
    const provider = createProvider();
    const pending = createPendingStore(persistedCall());
    const executor = createSponsoredCallExecutor({ chainId, pendingStore: pending.store });
    const onSubmissionEvidence = vi.fn();
    const onReceiptEvidence = vi.fn();

    await expect(
      executor.execute({
        ...executeInput(provider, () => true),
        onSubmissionEvidence,
        onReceiptEvidence,
      }),
    ).resolves.toEqual({
      alreadySatisfied: false,
      callId: 'bundle_existing',
      transactionHash,
    });
    expect(provider.prepareCalls).not.toHaveBeenCalled();
    expect(provider.sendPreparedCalls).not.toHaveBeenCalled();
    expect(onSubmissionEvidence).toHaveBeenCalledExactlyOnceWith({ callId: 'bundle_existing' });
    expect(provider.waitForCallsStatus).toHaveBeenCalledWith({
      id: 'bundle_existing',
      timeout: 120_000,
      throwOnFailure: true,
    });
    expect(onReceiptEvidence).toHaveBeenCalledExactlyOnceWith({
      callId: 'bundle_existing',
      transactionHash,
    });
    expect(pending.current()).toBeNull();
  });

  it('resumes an exact fresh pending operation without preparing, signing, or sending again', async () => {
    const provider = createProvider();
    const pending = createPendingStore(persistedCall());
    const postcondition = vi.fn().mockResolvedValueOnce(true);
    const executor = createSponsoredCallExecutor({
      chainId,
      pendingStore: pending.store,
      now: () => Date.parse('2026-08-08T10:30:00.000Z'),
    });

    await expect(executor.execute(executeInput(provider, postcondition))).resolves.toMatchObject({
      callId: 'bundle_existing',
      transactionHash,
    });
    expect(provider.prepareCalls).not.toHaveBeenCalled();
    expect(provider.signPreparedCalls).not.toHaveBeenCalled();
    expect(provider.sendPreparedCalls).not.toHaveBeenCalled();
    expect(provider.waitForCallsStatus).toHaveBeenCalledWith({
      id: 'bundle_existing',
      timeout: 120_000,
      throwOnFailure: true,
    });
  });

  it('resumes an exact old pending operation without submitting a replacement', async () => {
    const provider = createProvider();
    const pending = createPendingStore(persistedCall());
    const postcondition = vi.fn().mockResolvedValueOnce(true);
    const executor = createSponsoredCallExecutor({
      chainId,
      pendingStore: pending.store,
      pendingTtlMs: 1_000,
      now: () => Date.parse('2026-08-08T10:01:01.000Z'),
    });

    await executor.execute(executeInput(provider, postcondition));
    expect(pending.store.clear).toHaveBeenCalledTimes(1);
    expect(provider.prepareCalls).not.toHaveBeenCalled();
    expect(provider.signPreparedCalls).not.toHaveBeenCalled();
    expect(provider.sendPreparedCalls).not.toHaveBeenCalled();
    expect(provider.waitForCallsStatus).toHaveBeenCalledWith({
      id: 'bundle_existing',
      timeout: 120_000,
      throwOnFailure: true,
    });
  });

  it('rejects a changed persisted operation even when its timestamp is expired', async () => {
    const provider = createProvider();
    const pending = createPendingStore(persistedCall({ target: changedTarget }));
    const executor = createSponsoredCallExecutor({
      chainId,
      pendingStore: pending.store,
      pendingTtlMs: 1_000,
      now: () => Date.parse('2026-08-08T11:00:00.000Z'),
    });

    await expect(executor.execute(executeInput(provider, () => false))).rejects.toThrow(
      'persisted sponsored call does not match',
    );
    expect(pending.store.clear).not.toHaveBeenCalled();
    expect(provider.prepareCalls).not.toHaveBeenCalled();
  });

  it('rejects concurrent execution of the same operation key', async () => {
    let releaseWait!: (status: unknown) => void;
    const wait = new Promise<unknown>((resolve) => {
      releaseWait = resolve;
    });
    const provider = createProvider();
    vi.mocked(provider.waitForCallsStatus).mockReturnValue(wait);
    const postcondition = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const executor = createSponsoredCallExecutor({
      chainId,
      pendingStore: createPendingStore().store,
    });

    const first = executor.execute(executeInput(provider, postcondition));
    await vi.waitFor(() => expect(provider.waitForCallsStatus).toHaveBeenCalledTimes(1));
    await expect(executor.execute(executeInput(provider, () => false))).rejects.toThrow(
      'already in progress',
    );
    releaseWait({ receipts: [{ transactionHash }] });
    await expect(first).resolves.toMatchObject({ callId: 'bundle_01J5' });
    expect(provider.sendPreparedCalls).toHaveBeenCalledTimes(1);
  });

  it('clears terminal provider failures but retains retryable pending state', async () => {
    const terminal = new Error('bundle reverted');
    terminal.name = 'BundleFailedError';
    const retryable = new Error('status timed out');
    retryable.name = 'TimeoutError';
    const terminalPending = createPendingStore(persistedCall());
    const retryablePending = createPendingStore(persistedCall());
    const terminalExecutor = createSponsoredCallExecutor({
      chainId,
      pendingStore: terminalPending.store,
      now: persistedNow,
    });
    const retryableExecutor = createSponsoredCallExecutor({
      chainId,
      pendingStore: retryablePending.store,
      now: persistedNow,
    });

    await expect(
      terminalExecutor.execute(executeInput(createProvider({ waitError: terminal }), () => false)),
    ).rejects.toBe(terminal);
    await expect(
      retryableExecutor.execute(
        executeInput(createProvider({ waitError: retryable }), () => false),
      ),
    ).rejects.toBe(retryable);
    expect(terminalPending.current()).toBeNull();
    expect(retryablePending.current()?.callId).toBe('bundle_existing');
  });

  it('retains pending state when a receipt or the required postcondition cannot be verified', async () => {
    const missingReceiptPending = createPendingStore(persistedCall());
    const failedPostconditionPending = createPendingStore(persistedCall());
    const missingReceiptExecutor = createSponsoredCallExecutor({
      chainId,
      pendingStore: missingReceiptPending.store,
      now: persistedNow,
    });
    const failedPostconditionExecutor = createSponsoredCallExecutor({
      chainId,
      pendingStore: failedPostconditionPending.store,
      now: persistedNow,
    });

    await expect(
      missingReceiptExecutor.execute(
        executeInput(createProvider({ status: { receipts: [] } }), () => false),
      ),
    ).rejects.toThrow('without a transaction hash');
    const postcondition = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(false);
    await expect(
      failedPostconditionExecutor.execute(executeInput(createProvider(), postcondition)),
    ).rejects.toThrow('postcondition is not satisfied');
    expect(missingReceiptPending.current()?.callId).toBe('bundle_existing');
    expect(failedPostconditionPending.current()?.callId).toBe('bundle_existing');
  });

  it('rejects provider mutation before signing and does not persist it', async () => {
    const provider = createProvider({
      prepared: preparedOperation({
        details: { type: 'user-operation', data: { calls: [{ ...call, to: changedTarget }] } },
      }),
    });
    const pending = createPendingStore();
    const executor = createSponsoredCallExecutor({ chainId, pendingStore: pending.store });

    await expect(executor.execute(executeInput(provider, () => false))).rejects.toThrow(
      'exact authorized operation',
    );
    expect(provider.signPreparedCalls).not.toHaveBeenCalled();
    expect(provider.sendPreparedCalls).not.toHaveBeenCalled();
    expect(pending.store.write).not.toHaveBeenCalled();
  });

  it('rejects an unbounded provider call ID before persistence or status polling', async () => {
    const provider = createProvider({ submitted: { id: 'x'.repeat(513) } });
    const pending = createPendingStore();
    const executor = createSponsoredCallExecutor({ chainId, pendingStore: pending.store });

    await expect(executor.execute(executeInput(provider, () => false))).rejects.toThrow(
      'call ID must be a bounded',
    );
    expect(pending.store.write).not.toHaveBeenCalled();
    expect(provider.waitForCallsStatus).not.toHaveBeenCalled();
  });

  it('validates configuration and operation inputs before provider access', async () => {
    expect(() => createSponsoredCallExecutor({ chainId: 0 })).toThrow('positive safe integer');
    expect(() => createSponsoredCallExecutor({ chainId, pendingTtlMs: 0 })).toThrow(
      'pendingTtlMs must be a positive number',
    );
    expect(() =>
      createSponsoredCallExecutor({ chainId, confirmationTimeoutMs: Number.NaN }),
    ).toThrow('confirmationTimeoutMs must be a positive number');
    const invalidClockProvider = createProvider();
    const invalidClockExecutor = createSponsoredCallExecutor({ chainId, now: () => Number.NaN });
    await expect(
      invalidClockExecutor.execute(executeInput(invalidClockProvider, () => false)),
    ).rejects.toThrow('now must return a valid epoch-millisecond timestamp');
    expect(invalidClockProvider.prepareCalls).not.toHaveBeenCalled();
    const provider = createProvider();
    const executor = createSponsoredCallExecutor({ chainId });
    await expect(
      executor.execute({
        ...executeInput(provider, () => false),
        operationKey: 'contains a space',
      }),
    ).rejects.toThrow('bounded non-secret identifier');
    await expect(
      executor.execute({
        ...executeInput(provider, () => false),
        sender: '0x1234',
      }),
    ).rejects.toThrow('sender must be an EVM address');
    await expect(
      executor.execute({
        ...executeInput(provider, () => false),
        call: { ...call, data: '0x123' },
      }),
    ).rejects.toThrow('even-length hex data');
    await expect(
      executor.execute({
        ...executeInput(provider, () => false),
        call: { ...call, value: -1n },
      }),
    ).rejects.toThrow('non-negative bigint');
    expect(provider.prepareCalls).not.toHaveBeenCalled();
  });
});

describe('sponsored-call durable evidence', () => {
  it('persists the call ID before awaiting submission evidence and confirmation', async () => {
    const provider = createProvider();
    const pending = createPendingStore();
    const order: string[] = [];
    vi.mocked(pending.store.write).mockImplementation((next: PendingSponsoredCall) => {
      order.push(`write:${next.callId}`);
    });
    const executor = createSponsoredCallExecutor({
      chainId,
      pendingStore: pending.store,
      now: () => Date.parse('2026-08-08T10:00:00.000Z'),
    });
    const postcondition = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const onSubmissionEvidence = vi.fn(async ({ callId }: { callId: string }) => {
      await Promise.resolve();
      order.push(`evidence:${callId}`);
      // Confirmation only starts after the owning operation holds the call ID.
      expect(provider.waitForCallsStatus).not.toHaveBeenCalled();
    });

    await executor.execute({
      ...executeInput(provider, postcondition),
      onSubmissionEvidence,
    });

    expect(order).toEqual(['write:bundle_01J5', 'evidence:bundle_01J5']);
    expect(pending.store.write).toHaveBeenCalledBefore(onSubmissionEvidence);
    expect(onSubmissionEvidence).toHaveBeenCalledExactlyOnceWith({ callId: 'bundle_01J5' });
  });

  it('registers submission evidence with the stored ID on resume without re-sending', async () => {
    const provider = createProvider();
    const pending = createPendingStore(persistedCall());
    const onSubmissionEvidence = vi.fn().mockResolvedValue(undefined);
    const executor = createSponsoredCallExecutor({
      chainId,
      pendingStore: pending.store,
      now: persistedNow,
    });
    const postcondition = vi.fn().mockResolvedValueOnce(true);

    await executor.execute({
      ...executeInput(provider, postcondition),
      onSubmissionEvidence,
    });

    expect(onSubmissionEvidence).toHaveBeenCalledExactlyOnceWith({ callId: 'bundle_existing' });
    expect(provider.prepareCalls).not.toHaveBeenCalled();
    expect(provider.signPreparedCalls).not.toHaveBeenCalled();
    expect(provider.sendPreparedCalls).not.toHaveBeenCalled();
  });

  it('awaits receipt evidence before the postcondition and before clearing pending state', async () => {
    const provider = createProvider();
    const pending = createPendingStore();
    const order: string[] = [];
    const postcondition = vi
      .fn()
      .mockImplementationOnce(() => false)
      .mockImplementationOnce(() => {
        order.push('postcondition');
        return true;
      });
    vi.mocked(pending.store.clear).mockImplementation(() => {
      order.push('clear');
    });
    const executor = createSponsoredCallExecutor({
      chainId,
      pendingStore: pending.store,
      now: () => Date.parse('2026-08-08T10:00:00.000Z'),
    });

    const result = await executor.execute({
      ...executeInput(provider, postcondition),
      onReceiptEvidence: vi.fn(async () => {
        await Promise.resolve();
        order.push('receipt-evidence');
      }),
    });

    expect(result.transactionHash).toBe(transactionHash);
    expect(order).toEqual(['receipt-evidence', 'postcondition', 'clear']);
  });

  it('reports receipt evidence with the exact confirmed call ID and hash', async () => {
    const onReceiptEvidence = vi.fn().mockResolvedValue(undefined);
    const executor = createSponsoredCallExecutor({ chainId });
    const postcondition = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await executor.execute({
      ...executeInput(createProvider(), postcondition),
      onReceiptEvidence,
    });

    expect(onReceiptEvidence).toHaveBeenCalledExactlyOnceWith({
      callId: 'bundle_01J5',
      transactionHash,
    });
  });

  it('keeps pending evidence when submission registration fails and resumes it on retry', async () => {
    const provider = createProvider();
    const pending = createPendingStore();
    const executor = createSponsoredCallExecutor({
      chainId,
      pendingStore: pending.store,
      now: () => Date.parse('2026-08-08T10:00:00.000Z'),
    });
    const onSubmissionEvidence = vi
      .fn()
      .mockRejectedValueOnce(new Error('submission registration is unavailable'))
      .mockResolvedValue(undefined);

    await expect(
      executor.execute({
        ...executeInput(provider, () => false),
        onSubmissionEvidence,
      }),
    ).rejects.toThrow(SponsoredCallEvidenceError);
    expect(pending.current()?.callId).toBe('bundle_01J5');
    expect(pending.store.clear).not.toHaveBeenCalled();
    expect(provider.waitForCallsStatus).not.toHaveBeenCalled();

    const postcondition = vi.fn().mockResolvedValueOnce(true);
    await expect(
      executor.execute({
        ...executeInput(provider, postcondition),
        onSubmissionEvidence,
      }),
    ).resolves.toMatchObject({ callId: 'bundle_01J5', transactionHash });
    expect(provider.sendPreparedCalls).toHaveBeenCalledTimes(1);
    expect(onSubmissionEvidence).toHaveBeenNthCalledWith(2, { callId: 'bundle_01J5' });
    expect(pending.current()).toBeNull();
  });

  it('keeps pending evidence when receipt registration fails and resumes it on retry', async () => {
    const provider = createProvider();
    const pending = createPendingStore();
    const executor = createSponsoredCallExecutor({
      chainId,
      pendingStore: pending.store,
      now: () => Date.parse('2026-08-08T10:00:00.000Z'),
    });
    const onReceiptEvidence = vi
      .fn()
      .mockRejectedValueOnce(new Error('receipt registration is unavailable'))
      .mockResolvedValue(undefined);

    await expect(
      executor.execute({
        ...executeInput(provider, () => false),
        onReceiptEvidence,
      }),
    ).rejects.toThrow('receipt registration is unavailable');
    expect(pending.current()?.callId).toBe('bundle_01J5');
    expect(pending.store.clear).not.toHaveBeenCalled();

    const postcondition = vi.fn().mockResolvedValueOnce(true);
    await expect(
      executor.execute({
        ...executeInput(provider, postcondition),
        onReceiptEvidence,
      }),
    ).resolves.toMatchObject({ callId: 'bundle_01J5' });
    expect(provider.sendPreparedCalls).toHaveBeenCalledTimes(1);
    expect(pending.current()).toBeNull();
  });

  it('surfaces evidence failures as retryable rather than provider-terminal', async () => {
    const cause = new Error('registration endpoint returned 503');
    const pending = createPendingStore(persistedCall());
    const isTerminalFailure = vi.fn().mockReturnValue(true);
    const executor = createSponsoredCallExecutor({
      chainId,
      pendingStore: pending.store,
      now: persistedNow,
      isTerminalFailure,
    });

    const error = await executor
      .execute({
        ...executeInput(createProvider(), () => false),
        onSubmissionEvidence: () => {
          throw cause;
        },
      })
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(SponsoredCallEvidenceError);
    expect(error).toMatchObject({
      name: 'SponsoredCallEvidenceError',
      phase: 'submission',
      callId: 'bundle_existing',
      retryable: true,
      cause,
    });
    expect(isTerminalFailure).not.toHaveBeenCalled();
    expect(pending.current()?.callId).toBe('bundle_existing');
  });

  it('skips evidence registration entirely when the postcondition is already satisfied', async () => {
    const onSubmissionEvidence = vi.fn();
    const onReceiptEvidence = vi.fn();
    const executor = createSponsoredCallExecutor({ chainId });

    await expect(
      executor.execute({
        ...executeInput(createProvider(), () => true),
        onSubmissionEvidence,
        onReceiptEvidence,
      }),
    ).resolves.toMatchObject({ alreadySatisfied: true });
    expect(onSubmissionEvidence).not.toHaveBeenCalled();
    expect(onReceiptEvidence).not.toHaveBeenCalled();
  });
});

describe('browser sponsored-call pending store', () => {
  it('round-trips normalized pending state across store instances', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    };
    const first = createBrowserSponsoredCallPendingStore({ namespace: 'gt.sponsored', storage });
    first.write(persistedCall());
    const second = createBrowserSponsoredCallPendingStore({ namespace: 'gt.sponsored', storage });

    expect(second.read('erc7943.release:123', sender.toUpperCase(), chainId)).toEqual(
      persistedCall(),
    );
    second.clear('erc7943.release:123', sender, chainId);
    expect(first.read('erc7943.release:123', sender, chainId)).toBeNull();
    expect(values.size).toBe(0);
  });

  it('removes malformed serialized state without throwing across the storage boundary', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: vi.fn((key: string) => {
        values.delete(key);
      }),
    };
    const store = createBrowserSponsoredCallPendingStore({ namespace: 'gt.sponsored', storage });
    const key = `gt.sponsored:erc7943.release:123:${String(chainId)}:${sender}`;
    values.set(key, '{"callId":"secret-but-malformed"');

    expect(store.read('erc7943.release:123', sender, chainId)).toBeNull();
    expect(storage.removeItem).toHaveBeenCalledWith(key);
    expect(values.has(key)).toBe(false);
  });

  it('removes serialized state with an invalid provider call ID', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: vi.fn((key: string) => {
        values.delete(key);
      }),
    };
    const store = createBrowserSponsoredCallPendingStore({ namespace: 'gt.sponsored', storage });
    const key = `gt.sponsored:erc7943.release:123:${String(chainId)}:${sender}`;
    values.set(key, JSON.stringify(persistedCall({ callId: 'x'.repeat(513) })));

    expect(store.read('erc7943.release:123', sender, chainId)).toBeNull();
    expect(storage.removeItem).toHaveBeenCalledWith(key);
  });
});
