/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/unbound-method */
import { describe, expect, it, vi } from 'vitest';
import {
  ALCHEMY_MODULAR_ACCOUNT_V2_ADDRESS,
  ALCHEMY_MODULAR_ACCOUNT_V2_DELEGATION,
  ALCHEMY_MODULAR_ACCOUNT_V2_LEGACY_DELEGATION,
  ETHEREUM_SEPOLIA_CHAIN_ID,
  assertSafeEip7702PreparedCalls,
  createAlchemyEip7702Activator,
  createBrowserEip7702PendingStore,
  createEip7702Activator,
  inspectEip7702Bytecode,
  type Eip7702PendingOperationStore,
  type Eip7702PendingOperation,
  type Eip7702PreparedCallsProvider,
  type Eip7702Signer,
} from './eip7702.js';

const walletAddress = '0x1111111111111111111111111111111111111111' as const;
const otherAddress = '0x2222222222222222222222222222222222222222' as const;
const now = Date.parse('2026-08-07T12:00:00.000Z');

function createSigner(address: `0x${string}` = walletAddress): Eip7702Signer {
  return {
    address,
    signMessage: vi.fn(async () => '0x01' as const),
    signTypedData: vi.fn(async () => '0x02' as const),
    signAuthorization: vi.fn(async () => ({
      r: '0x01' as const,
      s: '0x02' as const,
      yParity: 0,
    })),
  };
}

type PreparedCallsFixture = {
  type: string;
  data: unknown[];
  details: {
    type: string;
    data: { calls: unknown[] };
  };
} & Record<string, unknown>;

function safePreparedCalls(overrides: Record<string, unknown> = {}): PreparedCallsFixture {
  return {
    type: 'array',
    data: [
      {
        type: 'authorization',
        chainId: ETHEREUM_SEPOLIA_CHAIN_ID,
        data: { address: ALCHEMY_MODULAR_ACCOUNT_V2_ADDRESS },
        signatureRequest: { type: 'eip7702Auth' },
      },
      {
        type: 'user-operation-v070',
        chainId: ETHEREUM_SEPOLIA_CHAIN_ID,
        data: { sender: walletAddress },
        feePayment: { sponsored: true },
      },
    ],
    details: {
      type: 'user-operation',
      data: { calls: [] },
    },
    ...overrides,
  };
}

function createProvider(): Eip7702PreparedCallsProvider & {
  prepareCalls: ReturnType<typeof vi.fn>;
  signPreparedCalls: ReturnType<typeof vi.fn>;
  sendPreparedCalls: ReturnType<typeof vi.fn>;
  waitForCallsStatus: ReturnType<typeof vi.fn>;
} {
  return {
    prepareCalls: vi.fn(async () => safePreparedCalls()),
    signPreparedCalls: vi.fn(async () => ({ signed: true })),
    sendPreparedCalls: vi.fn(async () => ({ id: 'call-1' })),
    waitForCallsStatus: vi.fn(async () => ({
      receipts: [{ transactionHash: '0xtransaction' }],
    })),
  };
}

function createMemoryStore(initial?: {
  address: string;
  callId: string;
  chainId: number;
  submittedAt: string;
}): Eip7702PendingOperationStore & {
  write: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
} {
  let pending: Eip7702PendingOperation | null = initial ?? null;
  return {
    read: vi.fn(() => pending),
    write: vi.fn((value: Eip7702PendingOperation) => {
      pending = value;
    }),
    clear: vi.fn(() => {
      pending = null;
    }),
  };
}

describe('inspectEip7702Bytecode', () => {
  it('classifies exact, empty, different-delegate, and arbitrary bytecode', () => {
    expect(inspectEip7702Bytecode(ALCHEMY_MODULAR_ACCOUNT_V2_DELEGATION).status).toBe('ready');
    expect(inspectEip7702Bytecode('0x').status).toBe('not_delegated');
    expect(
      inspectEip7702Bytecode('0xef01002222222222222222222222222222222222222222'),
    ).toMatchObject({
      status: 'unexpected_delegation',
      delegationAddress: otherAddress,
    });
    expect(inspectEip7702Bytecode('0x6001600055')).toMatchObject({
      status: 'unexpected_delegation',
      delegationAddress: null,
    });
  });
});

describe('assertSafeEip7702PreparedCalls', () => {
  it('accepts only the exact empty sponsored operation', () => {
    expect(() => assertSafeEip7702PreparedCalls(safePreparedCalls(), walletAddress)).not.toThrow();
  });

  it.each([
    [
      'extra call',
      {
        ...safePreparedCalls(),
        details: { type: 'user-operation', data: { calls: [{ to: otherAddress, value: 1n }] } },
      },
    ],
    [
      'wrong sender',
      {
        ...safePreparedCalls(),
        data: [
          safePreparedCalls().data[0],
          {
            type: 'user-operation-v070',
            chainId: ETHEREUM_SEPOLIA_CHAIN_ID,
            data: { sender: otherAddress },
            feePayment: { sponsored: true },
          },
        ],
      },
    ],
    [
      'wrong chain',
      {
        ...safePreparedCalls(),
        data: [
          {
            type: 'authorization',
            chainId: 1,
            data: { address: ALCHEMY_MODULAR_ACCOUNT_V2_ADDRESS },
            signatureRequest: { type: 'eip7702Auth' },
          },
          safePreparedCalls().data[1],
        ],
      },
    ],
    [
      'coercive string chain',
      {
        ...safePreparedCalls(),
        data: safePreparedCalls().data.map((entry) => ({
          ...(entry as Record<string, unknown>),
          chainId: String(ETHEREUM_SEPOLIA_CHAIN_ID),
        })),
      },
    ],
    [
      'wrong delegate',
      {
        ...safePreparedCalls(),
        data: [
          {
            type: 'authorization',
            chainId: ETHEREUM_SEPOLIA_CHAIN_ID,
            data: { address: otherAddress },
            signatureRequest: { type: 'eip7702Auth' },
          },
          safePreparedCalls().data[1],
        ],
      },
    ],
    [
      'wrong authorization type',
      {
        ...safePreparedCalls(),
        data: [
          {
            type: 'authorization',
            chainId: ETHEREUM_SEPOLIA_CHAIN_ID,
            data: { address: ALCHEMY_MODULAR_ACCOUNT_V2_ADDRESS },
            signatureRequest: { type: 'personal_sign' },
          },
          safePreparedCalls().data[1],
        ],
      },
    ],
    [
      'not sponsored',
      {
        ...safePreparedCalls(),
        data: [
          safePreparedCalls().data[0],
          {
            type: 'user-operation-v070',
            chainId: ETHEREUM_SEPOLIA_CHAIN_ID,
            data: { sender: walletAddress },
            feePayment: { sponsored: false },
          },
        ],
      },
    ],
  ])('rejects %s before signing', (_label, prepared) => {
    expect(() => assertSafeEip7702PreparedCalls(prepared, walletAddress)).toThrow();
  });
});

describe('createEip7702Activator', () => {
  it('serializes the v1.1 delegation through the Alchemy wallet API request', async () => {
    const requests: { method: string; params: unknown[] }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const body = JSON.parse(await request.text()) as {
          id: number;
          method: string;
          params: unknown[];
        };
        requests.push(body);

        if (body.method === 'eth_getCode') {
          return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: '0x' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: body.id,
            error: { code: -32_600, message: 'intercepted wallet request' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }),
    );

    try {
      const activator = createAlchemyEip7702Activator({
        apiKey: 'key',
        policyId: '00000000-0000-4000-8000-000000000000',
        rpcUrl: 'https://rpc.example',
      });

      await expect(
        activator.ensureDelegation({
          signer: createSigner(),
          expectedWalletAddress: walletAddress,
        }),
      ).rejects.toThrow('intercepted wallet request');

      const prepareRequest = requests.find(({ method }) => method === 'wallet_prepareCalls');
      expect(prepareRequest).toBeDefined();
      expect(prepareRequest?.params[0]).toMatchObject({
        calls: [],
        capabilities: {
          eip7702Auth: {
            account: walletAddress,
            delegation: '0x77021100bD87b7008E5E1989d0eB38555d0d0000',
          },
          paymasterService: { policyId: '00000000-0000-4000-8000-000000000000' },
        },
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('validates explicit Alchemy configuration without reading application environment', () => {
    expect(() => createAlchemyEip7702Activator({ apiKey: '', policyId: 'policy' })).toThrow(
      'Wallet API key',
    );
    expect(() => createAlchemyEip7702Activator({ apiKey: 'key', policyId: '' })).toThrow(
      'policy ID',
    );
    expect(
      createAlchemyEip7702Activator({
        apiKey: 'key',
        policyId: 'policy',
        rpcUrl: 'https://rpc.example',
        pendingTtlMs: 1,
        confirmationTimeoutMs: 2,
        now: () => now,
      }).inspect,
    ).toBeTypeOf('function');
    expect(createAlchemyEip7702Activator({ apiKey: 'key', policyId: 'policy' }).inspect).toBeTypeOf(
      'function',
    );
  });

  it('rejects invalid addresses and signers without authorization support', async () => {
    const activator = createEip7702Activator({
      inspectBytecode: vi.fn(async () => '0x'),
      createProvider: vi.fn(),
    });
    await expect(activator.inspect('')).rejects.toThrow('Wallet address is unavailable');
    await expect(activator.inspect('0x1')).rejects.toThrow('Wallet address is unavailable');
    const signer = createSigner();
    delete signer.signAuthorization;
    await expect(
      activator.ensureDelegation({ signer, expectedWalletAddress: walletAddress }),
    ).rejects.toThrow('does not support EIP-7702');
  });

  it('returns ready without creating a provider or submitting', async () => {
    const createProvider = vi.fn();
    const store = createMemoryStore();
    const activator = createEip7702Activator({
      inspectBytecode: vi.fn(async () => ALCHEMY_MODULAR_ACCOUNT_V2_DELEGATION),
      createProvider,
      pendingStore: store,
    });

    await expect(
      activator.ensureDelegation({
        signer: createSigner(),
        expectedWalletAddress: walletAddress,
      }),
    ).resolves.toMatchObject({ status: 'ready' });
    expect(createProvider).not.toHaveBeenCalled();
    expect(store.clear).toHaveBeenCalledWith(walletAddress, ETHEREUM_SEPOLIA_CHAIN_ID);
  });

  it('rejects a mismatched signer before inspection or provider preparation', async () => {
    const inspectBytecode = vi.fn();
    const createProvider = vi.fn();
    const activator = createEip7702Activator({ inspectBytecode, createProvider });

    await expect(
      activator.ensureDelegation({
        signer: createSigner(otherAddress),
        expectedWalletAddress: walletAddress,
      }),
    ).rejects.toThrow('does not match the expected wallet address');
    expect(inspectBytecode).not.toHaveBeenCalled();
    expect(createProvider).not.toHaveBeenCalled();
  });

  it('rejects unsupported code without creating a provider', async () => {
    const createProvider = vi.fn();
    const activator = createEip7702Activator({
      inspectBytecode: vi.fn(async () => '0xef01002222222222222222222222222222222222222222'),
      createProvider,
    });

    await expect(
      activator.ensureDelegation({
        signer: createSigner(),
        expectedWalletAddress: walletAddress,
      }),
    ).rejects.toThrow('delegated to an unsupported contract');
    expect(createProvider).not.toHaveBeenCalled();
  });

  it('rejects the previous Alchemy delegation before signing', async () => {
    const createProvider = vi.fn();
    const activator = createEip7702Activator({
      inspectBytecode: vi.fn(async () => '0xef010069007702764179f14f51cdce752f4f775d74e139'),
      createProvider,
    });

    await expect(
      activator.ensureDelegation({
        signer: createSigner(),
        expectedWalletAddress: walletAddress,
      }),
    ).rejects.toThrow('delegated to an unsupported contract');
    expect(createProvider).not.toHaveBeenCalled();
  });

  it('migrates only the exact previous Alchemy delegation and verifies v1.1 on-chain', async () => {
    const provider = createProvider();
    const inspectBytecode = vi
      .fn()
      .mockResolvedValueOnce(ALCHEMY_MODULAR_ACCOUNT_V2_LEGACY_DELEGATION)
      .mockResolvedValueOnce(ALCHEMY_MODULAR_ACCOUNT_V2_DELEGATION);
    const activator = createEip7702Activator({
      inspectBytecode,
      createProvider: vi.fn(() => provider),
    });

    await expect(
      activator.migrateLegacyDelegation({
        signer: createSigner(),
        expectedWalletAddress: walletAddress,
      }),
    ).resolves.toMatchObject({
      status: 'ready',
      delegationAddress: ALCHEMY_MODULAR_ACCOUNT_V2_ADDRESS,
    });
    expect(provider.sendPreparedCalls).toHaveBeenCalledTimes(1);
  });

  it('does not migrate undelegated or unknown-code wallets', async () => {
    const createProvider = vi.fn();
    for (const code of ['0x', '0xef01002222222222222222222222222222222222222222', '0x1234']) {
      const activator = createEip7702Activator({
        inspectBytecode: vi.fn(async () => code),
        createProvider,
      });
      await expect(
        activator.migrateLegacyDelegation({
          signer: createSigner(),
          expectedWalletAddress: walletAddress,
        }),
      ).rejects.toThrow('Only the previous Alchemy v1.0');
    }
    expect(createProvider).not.toHaveBeenCalled();
  });

  it('does not report migrated until the new delegation is observed', async () => {
    const store = createMemoryStore();
    const provider = createProvider();
    const activator = createEip7702Activator({
      inspectBytecode: vi.fn(async () => ALCHEMY_MODULAR_ACCOUNT_V2_LEGACY_DELEGATION),
      createProvider: vi.fn(() => provider),
      pendingStore: store,
    });
    await expect(
      activator.migrateLegacyDelegation({
        signer: createSigner(),
        expectedWalletAddress: walletAddress,
      }),
    ).rejects.toThrow('not confirmed on-chain');
    expect(store.write).toHaveBeenCalled();
    expect(store.clear).not.toHaveBeenCalled();
    await expect(
      activator.migrateLegacyDelegation({
        signer: createSigner(),
        expectedWalletAddress: walletAddress,
      }),
    ).rejects.toThrow('not confirmed on-chain');
    expect(provider.prepareCalls).toHaveBeenCalledTimes(1);
  });

  it('submits once and succeeds only after exact post-confirmation inspection', async () => {
    const provider = createProvider();
    const store = createMemoryStore();
    const inspectBytecode = vi
      .fn()
      .mockResolvedValueOnce('0x')
      .mockResolvedValueOnce(ALCHEMY_MODULAR_ACCOUNT_V2_DELEGATION);
    const onSubmitted = vi.fn();
    const activator = createEip7702Activator({
      inspectBytecode,
      createProvider: vi.fn(() => provider),
      pendingStore: store,
      now: () => now,
    });

    await expect(
      activator.ensureDelegation({
        signer: createSigner(),
        expectedWalletAddress: walletAddress,
        onSubmitted,
      }),
    ).resolves.toEqual({
      status: 'ready',
      code: ALCHEMY_MODULAR_ACCOUNT_V2_DELEGATION,
      delegationAddress: ALCHEMY_MODULAR_ACCOUNT_V2_ADDRESS,
      expectedDelegationAddress: ALCHEMY_MODULAR_ACCOUNT_V2_ADDRESS,
      callId: 'call-1',
      transactionHash: '0xtransaction',
    });
    expect(provider.prepareCalls).toHaveBeenCalledTimes(1);
    expect(provider.prepareCalls).toHaveBeenCalledWith({
      account: walletAddress,
      calls: [],
      capabilities: {
        eip7702Auth: {
          account: walletAddress,
          delegation: '0x77021100bD87b7008E5E1989d0eB38555d0d0000',
        },
      },
    });
    expect(provider.signPreparedCalls).toHaveBeenCalledTimes(1);
    expect(provider.sendPreparedCalls).toHaveBeenCalledTimes(1);
    expect(store.write).toHaveBeenCalledWith({
      address: walletAddress,
      callId: 'call-1',
      chainId: ETHEREUM_SEPOLIA_CHAIN_ID,
      submittedAt: '2026-08-07T12:00:00.000Z',
    });
    expect(onSubmitted).toHaveBeenCalledWith('call-1');
  });

  it('preserves an explicitly configured delegation selector', async () => {
    const provider = createProvider();
    const activator = createEip7702Activator({
      delegationName: 'explicit-delegation',
      inspectBytecode: vi
        .fn()
        .mockResolvedValueOnce('0x')
        .mockResolvedValueOnce(ALCHEMY_MODULAR_ACCOUNT_V2_DELEGATION),
      createProvider: vi.fn(() => provider),
    });

    await activator.ensureDelegation({
      signer: createSigner(),
      expectedWalletAddress: walletAddress,
    });

    expect(provider.prepareCalls).toHaveBeenCalledWith(
      expect.objectContaining({
        capabilities: {
          eip7702Auth: {
            account: walletAddress,
            delegation: 'explicit-delegation',
          },
        },
      }),
    );
  });

  it('refuses unsafe preparation before sign or send', async () => {
    const provider = createProvider();
    provider.prepareCalls.mockResolvedValueOnce({
      ...safePreparedCalls(),
      details: { type: 'user-operation', data: { calls: [{ value: 1n }] } },
    });
    const activator = createEip7702Activator({
      inspectBytecode: vi.fn(async () => '0x'),
      createProvider: vi.fn(() => provider),
    });

    await expect(
      activator.ensureDelegation({
        signer: createSigner(),
        expectedWalletAddress: walletAddress,
      }),
    ).rejects.toThrow('not the approved empty, sponsored operation');
    expect(provider.signPreparedCalls).not.toHaveBeenCalled();
    expect(provider.sendPreparedCalls).not.toHaveBeenCalled();
  });

  it('resumes a fresh pending operation without preparing or sending another', async () => {
    const provider = createProvider();
    const store = createMemoryStore({
      address: walletAddress,
      callId: 'pending-call',
      chainId: ETHEREUM_SEPOLIA_CHAIN_ID,
      submittedAt: new Date(now - 1_000).toISOString(),
    });
    const activator = createEip7702Activator({
      inspectBytecode: vi
        .fn()
        .mockResolvedValueOnce('0x')
        .mockResolvedValueOnce(ALCHEMY_MODULAR_ACCOUNT_V2_DELEGATION),
      createProvider: vi.fn(() => provider),
      pendingStore: store,
      now: () => now,
    });

    await expect(
      activator.ensureDelegation({
        signer: createSigner(),
        expectedWalletAddress: walletAddress,
      }),
    ).resolves.toMatchObject({ callId: 'pending-call', status: 'ready' });
    expect(provider.prepareCalls).not.toHaveBeenCalled();
    expect(provider.sendPreparedCalls).not.toHaveBeenCalled();
    expect(provider.waitForCallsStatus).toHaveBeenCalledWith({
      id: 'pending-call',
      timeout: 120_000,
      throwOnFailure: true,
    });
  });

  it('expires a stale pending operation and submits a replacement', async () => {
    const provider = createProvider();
    const store = createMemoryStore({
      address: walletAddress,
      callId: 'stale-call',
      chainId: ETHEREUM_SEPOLIA_CHAIN_ID,
      submittedAt: new Date(now - 24 * 60 * 60 * 1_000 - 1).toISOString(),
    });
    const activator = createEip7702Activator({
      inspectBytecode: vi
        .fn()
        .mockResolvedValueOnce('0x')
        .mockResolvedValueOnce(ALCHEMY_MODULAR_ACCOUNT_V2_DELEGATION),
      createProvider: vi.fn(() => provider),
      pendingStore: store,
      now: () => now,
    });

    await activator.ensureDelegation({
      signer: createSigner(),
      expectedWalletAddress: walletAddress,
    });
    expect(provider.prepareCalls).toHaveBeenCalledTimes(1);
    expect(provider.sendPreparedCalls).toHaveBeenCalledTimes(1);
  });

  it('clears a terminal failure but retains a timeout for resumption', async () => {
    const terminalProvider = createProvider();
    terminalProvider.waitForCallsStatus.mockRejectedValueOnce(
      Object.assign(new Error('failed'), { name: 'BundleFailedError' }),
    );
    const terminalStore = createMemoryStore();
    const terminalActivator = createEip7702Activator({
      inspectBytecode: vi.fn(async () => '0x'),
      createProvider: vi.fn(() => terminalProvider),
      pendingStore: terminalStore,
      now: () => now,
    });
    await expect(
      terminalActivator.ensureDelegation({
        signer: createSigner(),
        expectedWalletAddress: walletAddress,
      }),
    ).rejects.toThrow('failed');
    expect(terminalStore.clear).toHaveBeenCalled();

    const timeoutProvider = createProvider();
    timeoutProvider.waitForCallsStatus.mockRejectedValueOnce(
      Object.assign(new Error('timeout'), { name: 'WaitForCallsStatusTimeoutError' }),
    );
    const timeoutStore = createMemoryStore();
    const timeoutActivator = createEip7702Activator({
      inspectBytecode: vi.fn(async () => '0x'),
      createProvider: vi.fn(() => timeoutProvider),
      pendingStore: timeoutStore,
      now: () => now,
    });
    await expect(
      timeoutActivator.ensureDelegation({
        signer: createSigner(),
        expectedWalletAddress: walletAddress,
      }),
    ).rejects.toThrow('timeout');
    expect(timeoutStore.write).toHaveBeenCalled();
    expect(timeoutStore.clear).not.toHaveBeenCalled();
  });

  it('fails when provider success is not followed by exact delegation', async () => {
    const provider = createProvider();
    const activator = createEip7702Activator({
      inspectBytecode: vi.fn(async () => '0x'),
      createProvider: vi.fn(() => provider),
    });

    await expect(
      activator.ensureDelegation({
        signer: createSigner(),
        expectedWalletAddress: walletAddress,
      }),
    ).rejects.toThrow('not confirmed on-chain');
  });

  it('rejects provider acceptance without a call ID and reports every progress phase', async () => {
    const provider = createProvider();
    provider.sendPreparedCalls = vi.fn(async () => ({}));
    const onProgress = vi.fn();
    const activator = createEip7702Activator({
      inspectBytecode: vi.fn(async () => '0x'),
      createProvider: vi.fn(() => provider),
    });
    await expect(
      activator.ensureDelegation({
        signer: createSigner(),
        expectedWalletAddress: walletAddress,
        onProgress,
      }),
    ).rejects.toThrow('without returning a call ID');
    expect(onProgress).toHaveBeenNthCalledWith(1, { phase: 'inspecting' });
    expect(onProgress).toHaveBeenNthCalledWith(2, { phase: 'preparing' });
  });

  it('honors cancellation before provider preparation', async () => {
    const controller = new AbortController();
    const createProvider = vi.fn();
    const activator = createEip7702Activator({
      inspectBytecode: vi.fn(async () => {
        controller.abort(new Error('fund changed'));
        return '0x';
      }),
      createProvider,
    });

    await expect(
      activator.ensureDelegation({
        signer: createSigner(),
        expectedWalletAddress: walletAddress,
        signal: controller.signal,
      }),
    ).rejects.toThrow('fund changed');
    expect(createProvider).not.toHaveBeenCalled();
  });
});

describe('createBrowserEip7702PendingStore', () => {
  it('requires a namespace and removes malformed or mismatched persisted operations', () => {
    expect(() => createBrowserEip7702PendingStore({ namespace: ' ' })).toThrow('namespace');
    const removeItem = vi.fn();
    const malformed = createBrowserEip7702PendingStore({
      namespace: 'test',
      storage: {
        getItem: () => '{',
        setItem: vi.fn(),
        removeItem,
      },
    });
    expect(malformed.read(walletAddress, ETHEREUM_SEPOLIA_CHAIN_ID)).toBeNull();
    expect(removeItem).toHaveBeenCalledTimes(1);
    removeItem.mockClear();

    const mismatched = createBrowserEip7702PendingStore({
      namespace: 'test',
      storage: {
        getItem: () =>
          JSON.stringify({
            address: otherAddress,
            callId: '',
            chainId: 1,
            submittedAt: '',
          }),
        setItem: vi.fn(),
        removeItem,
      },
    });
    expect(mismatched.read(walletAddress, ETHEREUM_SEPOLIA_CHAIN_ID)).toBeNull();
    expect(removeItem).toHaveBeenCalledTimes(1);
  });

  it('preserves the existing serialized key shape and tolerates storage failure', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        values.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        values.delete(key);
      }),
    };
    const store = createBrowserEip7702PendingStore({
      namespace: 'invest:wallet-auth:eip7702-upgrade',
      storage,
    });
    const pending = {
      address: walletAddress,
      callId: 'call-1',
      chainId: ETHEREUM_SEPOLIA_CHAIN_ID,
      submittedAt: new Date(now).toISOString(),
    };
    store.write(pending);
    expect(storage.setItem).toHaveBeenCalledWith(
      `invest:wallet-auth:eip7702-upgrade:${String(ETHEREUM_SEPOLIA_CHAIN_ID)}:${walletAddress}`,
      JSON.stringify(pending),
    );
    expect(store.read(walletAddress, ETHEREUM_SEPOLIA_CHAIN_ID)).toEqual(pending);

    const failingStore = createBrowserEip7702PendingStore({
      namespace: 'test',
      storage: {
        getItem: () => {
          throw new Error('unavailable');
        },
        setItem: () => {
          throw new Error('unavailable');
        },
        removeItem: () => {
          throw new Error('unavailable');
        },
      },
    });
    expect(() => failingStore.write(pending)).not.toThrow();
    expect(failingStore.read(walletAddress, ETHEREUM_SEPOLIA_CHAIN_ID)).toEqual(pending);
    expect(() => failingStore.clear(walletAddress, ETHEREUM_SEPOLIA_CHAIN_ID)).not.toThrow();
  });
});
