import { describe, expect, it } from 'vitest';
import { createInvestSdkTransport } from '../client.js';
import { createFetchScript, jsonResponse } from '../testing.js';
import { createEvmResource } from './evm.js';

const setup = (responses: readonly Response[]) => {
  const script = createFetchScript(responses);
  const routes: string[] = [];
  const transport = createInvestSdkTransport({
    apiKey: 'synthetic-resource-key',
    createRequestId: () => 'resource-request',
    fetch: script.fetch,
    hooks: {
      onRequest: ({ route }) => {
        routes.push(route);
      },
    },
    services: { evm: { baseUrl: 'https://evm.example.test/v1.0/' } },
  });
  return {
    resource: createEvmResource(transport.createServiceClient('evm')),
    requests: script.requests,
    routes,
    transport,
  };
};

describe('EVM resource', () => {
  it('validates wallet info and preserves the required chain query', async () => {
    const context = setup([
      jsonResponse({ profile_id: 1150, wallet_status: 'verified', balances: [] }),
    ]);
    const result = await context.resource.getWalletInfo({ profileId: 1150, chain: 'all' });

    expect(result.data.profile_id).toBe(1150);
    expect(context.requests[0]?.url).toBe(
      'https://evm.example.test/v1.0/auth/wallet/1150?chain=all',
    );
    expect(context.routes).toEqual(['getWalletInfo']);
    context.transport.dispose();
  });

  it('accepts the backend aggregate wallet shape with empty optional enum sentinels', async () => {
    const context = setup([
      jsonResponse({
        profile_id: 1292,
        wallet_id: 41,
        wallet_status: 'verified',
        provider_name: 'turnkey',
        turnkey_org_id: 'turnkey-parent-org',
        turnkey_sub_org_id: 'sub-org-1292',
        turnkey_user_id: 'user-1292',
        turnkey_wallet_id: 'wallet-1292',
        turnkey_delegated_user_id: 'delegated-user-1292',
        chain: '',
        wallet_address: '',
        chain_account_status: '',
        balances: [],
        tradable_crypto_balance: { amount_usd: '0', token_count: 0 },
        rwa_asset_balance: { amount_usd: '0', token_count: 0 },
        deposit_instructions: { chain: '', address: '' },
        chains: [
          {
            chain: 'ethereum-sepolia',
            wallet_address: '0x1111111111111111111111111111111111111111',
            chain_account_status: 'verified',
          },
        ],
        updated_at: '2026-08-07T12:00:00Z',
      }),
    ]);

    const result = await context.resource.getWalletInfo({ profileId: 1292, chain: 'all' });

    expect(result.data).toMatchObject({
      profile_id: 1292,
      chain: '',
      wallet_address: '',
      chains: [
        {
          chain: 'ethereum-sepolia',
          wallet_address: '0x1111111111111111111111111111111111111111',
          chain_account_status: 'verified',
        },
      ],
      deposit_instructions: { address: '' },
    });
    expect(result.data.chain_account_status).toBeUndefined();
    expect(result.data.deposit_instructions?.chain).toBeUndefined();
    expect(context.requests[0]?.url).toBe(
      'https://evm.example.test/v1.0/auth/wallet/1292?chain=all',
    );
    context.transport.dispose();
  });

  it.each([
    { chain_account_status: 'ready' },
    { chain_account_status: '', deposit_instructions: { chain: 'solana', address: '' } },
  ])('still rejects invalid non-empty aggregate enum values: %j', async (invalidFields) => {
    const context = setup([
      jsonResponse({
        profile_id: 1292,
        wallet_status: 'verified',
        chain: '',
        wallet_address: '',
        balances: [],
        chains: [],
        ...invalidFields,
      }),
    ]);

    const error = await context.resource
      .getWalletInfo({ profileId: 1292, chain: 'all' })
      .catch((reason: unknown) => reason);

    expect(error).toMatchObject({
      name: 'SdkResponseValidationError',
      code: 'SDK_RESPONSE_VALIDATION_FAILED',
      route: 'getWalletInfo',
    });
    context.transport.dispose();
  });

  it('does not treat empty enum values as sentinels for a single-chain response', async () => {
    const context = setup([
      jsonResponse({
        profile_id: 1292,
        wallet_status: 'verified',
        chain: 'ethereum-sepolia',
        wallet_address: '0x1111111111111111111111111111111111111111',
        chain_account_status: '',
        balances: [],
        chains: [],
        deposit_instructions: { chain: '', address: '' },
      }),
    ]);

    const error = await context.resource
      .getWalletInfo({ profileId: 1292, chain: 'ethereum-sepolia' })
      .catch((reason: unknown) => reason);

    expect(error).toMatchObject({
      name: 'SdkResponseValidationError',
      code: 'SDK_RESPONSE_VALIDATION_FAILED',
      route: 'getWalletInfo',
    });
    context.transport.dispose();
  });

  it('validates transaction history and forwards bounded pagination inputs', async () => {
    const context = setup([
      jsonResponse({
        profile_id: 1150,
        chain: 'polygon',
        status: 'confirmed',
        items: [{ operation_id: '501', operation_type: 'withdrawal' }],
        next_cursor: 'next',
      }),
    ]);
    const result = await context.resource.getWalletTransactions({
      profileId: 1150,
      chain: 'polygon',
      operationId: 42,
      status: 'confirmed',
      limit: 50,
      cursor: 'opaque',
    });

    expect(result.data.next_cursor).toBe('next');
    expect(context.requests[0]?.url).toBe(
      'https://evm.example.test/v1.0/auth/wallet/1150/transactions?chain=polygon&operation_id=42&status=confirmed&limit=50&cursor=opaque',
    );
    expect(context.routes).toEqual(['getWalletTransactions']);
    context.transport.dispose();
  });

  it('validates active authorization sessions and binds every read filter', async () => {
    const context = setup([
      jsonResponse({
        profile_id: 1150,
        status: 'active',
        chain: 'ethereum-sepolia',
        asset_address: '0x1111111111111111111111111111111111111111',
        items: [
          {
            session_id: 'session-withdrawal-1',
            authorization_option_id: 'withdrawal_transfer',
            operation_type: 'withdrawal',
            authorization_status: 'active',
            wallet_address: '0x2222222222222222222222222222222222222222',
            chain: 'ethereum-sepolia',
            asset_address: '0x1111111111111111111111111111111111111111',
            max_amount: '100000000',
            remaining_amount: '75000000',
          },
        ],
      }),
    ]);

    const result = await context.resource.getWalletAuthorizationSessions({
      profileId: 1150,
      chain: 'ethereum-sepolia',
      assetAddress: '0x1111111111111111111111111111111111111111',
      toAssetAddress: '0x3333333333333333333333333333333333333333',
      authorizationOptionId: 'withdrawal_transfer',
      operationType: 'withdrawal',
      delegationType: 'contract_functions',
    });

    expect(result.data.items?.[0]?.remaining_amount).toBe('75000000');
    expect(context.requests[0]?.url).toBe(
      'https://evm.example.test/v1.0/auth/wallet/authorize/sessions/1150?status=active&chain=ethereum-sepolia&asset_address=0x1111111111111111111111111111111111111111&to_asset_address=0x3333333333333333333333333333333333333333&authorization_option_id=withdrawal_transfer&operation_type=withdrawal&delegation_type=contract_functions',
    );
    expect(context.routes).toEqual(['getWalletAuthorizationSessions']);
    context.transport.dispose();
  });

  it('rejects malformed authorization sessions and invalid filters', async () => {
    const malformed = setup([jsonResponse({ profile_id: 1150, status: 'expired', items: [] })]);
    await expect(
      malformed.resource.getWalletAuthorizationSessions({ profileId: 1150 }),
    ).rejects.toMatchObject({
      name: 'SdkResponseValidationError',
      route: 'getWalletAuthorizationSessions',
    });
    malformed.transport.dispose();

    const invalid = setup([]);
    expect(() =>
      invalid.resource.getWalletAuthorizationSessions({
        profileId: 1,
        chain: 'all' as never,
      }),
    ).toThrow('authorization chain is not supported');
    expect(() =>
      invalid.resource.getWalletAuthorizationSessions({
        profileId: 1,
        assetAddress: ' ',
      }),
    ).toThrow('assetAddress must not be blank');
    expect(() =>
      invalid.resource.getWalletAuthorizationSessions({
        profileId: 1,
        status: 'expired' as never,
      }),
    ).toThrow('authorization status is not supported');
    expect(invalid.requests).toHaveLength(0);
    invalid.transport.dispose();
  });

  it('rejects malformed backend values with no schema detail leakage', async () => {
    const context = setup([jsonResponse({ profile_id: 'wrong', wallet_address: 'secret' })]);
    const error = await context.resource
      .getWalletInfo({ profileId: 1150, chain: 'all' })
      .catch((reason: unknown) => reason);

    expect(error).toMatchObject({
      name: 'SdkResponseValidationError',
      code: 'SDK_RESPONSE_VALIDATION_FAILED',
      route: 'getWalletInfo',
    });
    expect(JSON.stringify(error)).not.toContain('wallet_address');
    expect(JSON.stringify(error)).not.toContain('secret');
    context.transport.dispose();
  });

  it('rejects invalid identifiers and page sizes before any request', () => {
    const context = setup([]);
    expect(() => context.resource.getWalletInfo({ profileId: 0, chain: 'all' })).toThrow(
      'profileId must be a positive safe integer',
    );
    expect(() =>
      context.resource.getWalletTransactions({ profileId: 1, chain: 'all', limit: 0 }),
    ).toThrow('limit must be a positive safe integer');
    expect(() =>
      context.resource.getWalletTransactions({ profileId: 1, chain: 'all', operationId: 0 }),
    ).toThrow('operationId must be a positive safe integer');
    expect(() =>
      context.resource.getWalletInfo({ profileId: 1, chain: 'solana' as never }),
    ).toThrow('chain is not supported by the pinned contract');
    expect(context.requests).toHaveLength(0);
    context.transport.dispose();
  });
});
