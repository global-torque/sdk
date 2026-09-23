import { describe, expect, it } from 'vitest';
import { createInvestSdkTransport } from '../client.js';
import { createFetchScript, jsonResponse } from '../testing.js';
import { createVaultResource, validateRedemptionResponse } from './vault.js';

const position = {
  offer_id: 77,
  profile_id: 42,
  vault: {
    deployment: {
      contract_id: 754,
      status: 'verified',
      chain: 'ethereum-sepolia',
      address: '0x0000000000000000000000000000000000000754',
      asset: { symbol: 'USDC', address: '0x0000000000000000000000000000000000000006', decimals: 6 },
      share: { symbol: 'RWA', address: '0x0000000000000000000000000000000000000754', decimals: 18 },
    },
    deposit: null,
    position: {
      share_balance_raw: '250000000000000000',
      historical_claimed_shares_raw: '250000000000000000',
      available_to_redeem_shares_raw: '250000000000000000',
    },
    redemptions: [],
  },
};

const redemption = {
  id: 9,
  offer_id: 77,
  profile_id: 42,
  vault_request_origin: 'application',
  status: 'pending',
  share_amount_raw: '250000000000000000',
  pending_shares_raw: '0',
  claimable_assets_raw: '0',
  claimable_shares_raw: '0',
  claimed_assets_raw: '0',
  claimed_shares_raw: '0',
  protocol_state: 'unconfirmed',
};

const setup = (responses: readonly Response[]) => {
  const script = createFetchScript(responses);
  const transport = createInvestSdkTransport({
    createRequestId: () => 'vault-request',
    fetch: script.fetch,
    services: {
      investment: { baseUrl: 'https://investment.example.test/v1.0/', applicationAuth: 'none' },
    },
  });
  return {
    requests: script.requests,
    resource: createVaultResource(transport.createServiceClient('investment')),
    transport,
  };
};

describe('Vault resource', () => {
  it.each(['none', 'quarantined'] as const)(
    'accepts redemption protocol state %s in the exact generated contract',
    (protocolState) => {
      const result = validateRedemptionResponse.exact({
        redemption: { ...redemption, protocol_state: protocolState },
      });
      expect(result.redemption.protocol_state).toBe(protocolState);
    },
  );

  it('reads the exact raw Vault position from the canonical endpoint', async () => {
    const context = setup([jsonResponse({ position })]);
    const result = await context.resource.getPosition({ offerId: 77 });

    expect(result.data.position.vault.position.share_balance_raw).toBe('250000000000000000');
    expect(context.requests[0]?.url).toBe(
      'https://investment.example.test/v1.0/auth/positions?offer_id=77',
    );
    context.transport.dispose();
  });

  it('reads a manager-priced redemption without an estimate or legacy NAV fields', async () => {
    const quote = {
      asset_amount_raw: '6250000',
      pricing_source: 'manager_dealing_price',
      dealing_price_usdc_raw: '25000000',
      priced_by_user_id: 1,
      delta_from_estimate_raw: null,
    };
    const context = setup([
      jsonResponse({
        position: {
          ...position,
          vault: {
            ...position.vault,
            redemptions: [
              {
                ...redemption,
                request_origin: 'application',
                estimate: null,
                final: quote,
                operations: {},
              },
            ],
          },
        },
      }),
    ]);
    const result = await context.resource.getPosition({ offerId: 77 });
    expect(result.data.position.vault.redemptions[0]?.final).toEqual(quote);
    context.transport.dispose();
  });

  it('creates a redemption with exact raw shares and an idempotency key', async () => {
    const context = setup([jsonResponse({ redemption, replayed: false }, { status: 201 })]);
    await context.resource.createRedemption({
      offerId: 77,
      sharesRaw: '250000000000000000',
      idempotencyKey: 'redemption-9',
    });

    expect(context.requests[0]?.headers.get('idempotency-key')).toBe('redemption-9');
    expect(context.requests[0]?.body).toBe(
      JSON.stringify({ offer_id: 77, shares_raw: '250000000000000000' }),
    );
    context.transport.dispose();
  });

  it('lists, reads, and cancels redemptions on the canonical routes', async () => {
    const context = setup([
      jsonResponse({ count: 1, data: [redemption] }),
      jsonResponse({ redemption }),
      jsonResponse({ redemption: { ...redemption, status: 'cancelled' } }),
    ]);

    const listed = await context.resource.listRedemptions({
      profileId: 42,
      includeCompleted: false,
    });
    const read = await context.resource.getRedemption({ redemptionId: 9 });
    const cancelled = await context.resource.cancelRedemption({ redemptionId: 9 });

    expect(listed.data).toMatchObject({ count: 1, data: [{ id: 9 }] });
    expect(read.data.redemption.id).toBe(9);
    expect(cancelled.data.redemption.status).toBe('cancelled');
    expect(context.requests.map((request) => [request.method, request.url])).toEqual([
      [
        'GET',
        'https://investment.example.test/v1.0/auth/redemptions?profile_id=42&include_completed=false',
      ],
      ['GET', 'https://investment.example.test/v1.0/auth/redemptions/9'],
      ['DELETE', 'https://investment.example.test/v1.0/auth/redemptions/9'],
    ]);
    context.transport.dispose();
  });

  it('rejects invalid IDs and non-integer share values before transport', () => {
    const context = setup([]);
    expect(() => context.resource.getPosition({ offerId: 0 })).toThrow('offerId');
    expect(() =>
      context.resource.createRedemption({
        offerId: 77,
        sharesRaw: '0.25',
        idempotencyKey: 'key',
      }),
    ).toThrow('sharesRaw');
    expect(context.requests).toHaveLength(0);
    context.transport.dispose();
  });
});
