import { describe, expect, it } from 'vitest';
import { createInvestSdkTransport } from '../client.js';
import { SdkResponseValidationError } from '../errors.js';
import { createFetchScript, jsonResponse } from '../testing.js';
import { createInvestmentsResource, validateInvestmentDetail } from './investments.js';

const pinnedInvestment = {
  id: 123,
  offer: {
    id: 77,
    name: 'Oncolyze Series A',
    legal_name: 'Oncolyze, Inc.',
    slug: 'oncolyze',
    title: 'Oncolyze Series A Preferred Shares',
    security_type: 'preferred-equity',
    price_per_share: '25',
    min_investment: '6.25',
    image_link_id: 501,
    total_shares: '100000',
    valuation: '25000000',
    subscribed_shares: '14000',
    confirmed_shares: '12000',
    status: 'published',
    approved_at: '2026-01-15T12:00:00Z',
    website: 'https://example.com/oncolyze',
    state: 'DE',
    city: 'Wilmington',
    reg_type: 'reg D 506(c)',
    close_at: '2026-12-31T23:59:59Z',
    seo_title: 'Invest in Oncolyze',
    seo_description: 'Preferred equity offering for accredited investors.',
    data: {
      wire_to: 'Oncolyze Escrow Account',
      swift_id: 'EXAMPLEUS33',
      custodian: 'North Capital',
      account_number: '****1234',
      routing_number: '****0210',
    },
    ticker: 'ONCL',
    tokenization_engine: 'ERC-3643',
    tokenization_model: 'issuer_sponsored_onchain_register',
    fund_structure: 'closed_ended',
    amount_raised: '350000',
    target_raise: '2500000',
  },
  profile_id: 42,
  user_id: 7,
  price_per_share: '25',
  number_of_shares: '0.25',
  amount: '6.25',
  step: 'review',
  status: 'confirmed',
  created_at: '2026-02-10T14:20:00Z',
  submited_at: '2026-02-10T14:45:00Z',
  funding_type: 'ach',
  funding_status: 'initialize',
  signature_data: {
    signature_id: 'sig_01HT9Y8N5T9A7Q6Z4K3W2V1M0N',
    provider: 'hellosign',
  },
  escrow_data: { provider: 'north_capital', escrow_id: 'esc_123' },
  payment_data: {
    created_at: '2026-02-10T14:30:00Z',
    account_type: 'checking',
    account_holder_name: 'Jane Investor',
    funding_source_id: 101,
    transaction_id: 'txn_01HT9Y8N5T9A7Q6Z4K3W2V1M0N',
  },
  payment_type: 'north_capital',
  escrow_type: 'north_capital',
  entity_id: 'entity_123',
  transaction_ref: 'wire_20260210_123',
} as const;

const pendingSharesInvestment = {
  ...pinnedInvestment,
  number_of_shares: null,
  amount: null,
} as const;

const setup = (responses: readonly Response[]) => {
  const script = createFetchScript(responses);
  const routes: string[] = [];
  const transport = createInvestSdkTransport({
    apiKey: 'synthetic-investment-key',
    createRequestId: () => 'investment-request',
    fetch: script.fetch,
    hooks: {
      onRequest: ({ route }) => {
        routes.push(route);
      },
    },
    services: { investment: { baseUrl: 'https://investment.example.test/v1.0/' } },
  });
  return {
    resource: createInvestmentsResource(transport.createServiceClient('investment')),
    requests: script.requests,
    routes,
    transport,
  };
};

const requestBody = (body: BodyInit | null | undefined) => {
  if (typeof body !== 'string') throw new TypeError('Expected a serialized JSON request body.');
  return JSON.parse(body) as Record<string, unknown>;
};

describe('investments resource', () => {
  it('validates vault quarantine snapshots and rejects malformed incidents', () => {
    const quarantine = {
      active: true,
      active_incidents: [
        {
          id: 9,
          shortfall_assets_raw: '12',
          redemption_id: null,
          controller_address: null,
          affected_effect_id: null,
          finalized_block_number: 42,
          finalized_block_hash: '0xabc',
          detected_at: '2026-09-21T10:00:00Z',
          recovery_state: 'active',
          recovery_condition: 'finalized_snapshot_and_full_coverage_required',
        },
      ],
      total_shortfall_assets_raw: '12',
      recovery_state: 'active',
      recovery_condition: 'finalized_snapshot_and_full_coverage_required',
    } as const;
    const investment = {
      ...pinnedInvestment,
      vault: {
        deployment: {
          contract_id: 1,
          status: 'active',
          chain: 'base',
          address: `0x${'1'.repeat(40)}`,
          asset: { symbol: 'USDC', address: `0x${'2'.repeat(40)}`, decimals: 6 },
          share: { symbol: 'SHARE', address: `0x${'3'.repeat(40)}`, decimals: 18 },
        },
        deposit: null,
        position: {
          share_balance_raw: '0',
          historical_claimed_shares_raw: '0',
          available_to_redeem_shares_raw: '0',
        },
        protocol: { quarantine },
        redemptions: [],
      },
    };
    expect(validateInvestmentDetail(investment).vault?.protocol?.quarantine).toEqual(quarantine);
    expect(() =>
      validateInvestmentDetail({
        ...investment,
        vault: {
          ...investment.vault,
          protocol: {
            quarantine: {
              ...quarantine,
              active_incidents: [
                { ...quarantine.active_incidents[0], recovery_condition: undefined },
              ],
            },
          },
        },
      }),
    ).toThrow(/does not satisfy its compatible contract/u);
    expect(() =>
      validateInvestmentDetail({
        ...investment,
        vault: {
          ...investment.vault,
          protocol: { quarantine: { ...quarantine, total_shortfall_assets_raw: '-1' } },
        },
      }),
    ).toThrow(/does not satisfy its compatible contract/u);
  });

  it('accepts pending shares in create, detail, and list responses', async () => {
    const context = setup([
      jsonResponse(pendingSharesInvestment),
      jsonResponse(pendingSharesInvestment),
      jsonResponse({ data: [pendingSharesInvestment], count: 1 }),
    ]);

    const created = await context.resource.createInvestment({
      offerSlug: 'oncolyze',
      profileId: 42,
    });
    const detail = await context.resource.getInvestment({ investmentId: 123 });
    const listed = await context.resource.listUnconfirmed();

    expect(created.data).toMatchObject({ number_of_shares: null, amount: null });
    expect(detail.data).toMatchObject({ number_of_shares: null, amount: null });
    expect(listed.data.data?.[0]).toMatchObject({ number_of_shares: null, amount: null });
    context.transport.dispose();
  });

  it('executes every pinned safe read with exact routes, paths, and pagination', async () => {
    const context = setup([
      jsonResponse({
        data: [pinnedInvestment],
        count: 1,
        meta: {
          total_investments: 25_000,
          total_investments_12_months: 12_000,
          total_distributions: 1_500,
          avarange_annual: 8.2,
        },
      }),
      jsonResponse({ data: [pinnedInvestment], count: 1 }),
      jsonResponse({ data: [pinnedInvestment], count: 1 }),
      jsonResponse(pinnedInvestment),
      jsonResponse({
        data: [
          {
            id: 42,
            type: 'individual',
            kyc_status: 'approved',
            accreditation_status: 'approved',
            investments: [pinnedInvestment],
          },
        ],
        count: 1,
      }),
    ]);

    const confirmed = await context.resource.listConfirmedByProfile({
      profileId: 42,
      limit: 25,
      offset: 0,
    });
    const profileUnconfirmed = await context.resource.listUnconfirmedByProfile({ profileId: 42 });
    const unconfirmed = await context.resource.listUnconfirmed({ limit: 50, offset: 5 });
    const detail = await context.resource.getInvestment({ investmentId: 123 });
    const byOffer = await context.resource.listByOffer({ offerSlug: ' oncolyze/class-a ' });

    expect(confirmed.data.meta?.total_investments).toBe(25_000);
    expect(profileUnconfirmed.data.data?.[0]?.payment_data?.funding_source_id).toBe(101);
    expect(unconfirmed.data.count).toBe(1);
    expect(detail.data.offer?.slug).toBe('oncolyze');
    expect(byOffer.data.data?.[0]?.investments?.[0]?.id).toBe(123);
    expect(context.requests.map(({ url }) => url)).toEqual([
      'https://investment.example.test/v1.0/auth/investment/42/confirmed?limit=25&offset=0',
      'https://investment.example.test/v1.0/auth/investment/42/unconfirmed',
      'https://investment.example.test/v1.0/auth/investment/unconfirmed?limit=50&offset=5',
      'https://investment.example.test/v1.0/auth/investment/123',
      'https://investment.example.test/v1.0/auth/offer/oncolyze%2Fclass-a/investments',
    ]);
    expect(context.routes).toEqual([
      'InvestmentListConfirmed',
      'InvestmentListUnconfirmedByProfile',
      'InvestmentListUnConfirmed',
      'InvestmentGet',
      'ListOfferInvestments',
    ]);
    context.transport.dispose();
  });

  it('executes every pinned mutation with contract request bodies and no idempotency header', async () => {
    const amount = {
      amount: '6.25',
      profile_id: 42,
      funding_type: 'ach',
      funding_source_id: 101,
      payment_data: { account_type: 'checking' },
    } as const;
    const signature = {
      signature_id: 'sig_01HT9Y8N5T9A7Q6Z4K3W2V1M0N',
      user_browser: 'Mozilla/5.0',
      ip_address: '203.0.113.10',
    } as const;
    const context = setup([
      jsonResponse(pinnedInvestment),
      jsonResponse(amount),
      jsonResponse(signature),
      jsonResponse({ investment: { id: 123, status: 'confirmed' } }),
      jsonResponse({}),
    ]);

    await context.resource.createInvestment({
      offerSlug: 'oncolyze',
      profileId: 42,
      request: { idempotencyKey: 'must-not-be-forwarded' } as never,
    });
    await context.resource.setAmount({
      offerSlug: 'oncolyze',
      investmentId: 123,
      profileId: 42,
      amount: '6.25',
      fundingType: 'ach',
      fundingSourceId: 101,
      paymentData: { account_type: 'checking' },
    });
    await context.resource.submitSignature({
      offerSlug: 'oncolyze',
      investmentId: 123,
      profileId: 42,
      signatureId: ' sig_01HT9Y8N5T9A7Q6Z4K3W2V1M0N ',
      userBrowser: 'Mozilla/5.0',
      ipAddress: '203.0.113.10',
    });
    await context.resource.submitReview({
      offerSlug: 'oncolyze',
      investmentId: 123,
      profileId: 42,
    });
    await context.resource.cancelInvestment({
      investmentId: 123,
      reason: ' Changed investment plan ',
    });

    expect(context.requests.map(({ method, url }) => ({ method, url }))).toEqual([
      { method: 'POST', url: 'https://investment.example.test/v1.0/auth/invest/oncolyze/42' },
      {
        method: 'PUT',
        url: 'https://investment.example.test/v1.0/auth/invest/oncolyze/amount/123/42',
      },
      {
        method: 'PUT',
        url: 'https://investment.example.test/v1.0/auth/invest/oncolyze/signature/123/42',
      },
      {
        method: 'PUT',
        url: 'https://investment.example.test/v1.0/auth/invest/oncolyze/review/123/42',
      },
      { method: 'PUT', url: 'https://investment.example.test/v1.0/auth/investment/123/cancel' },
    ]);
    expect(context.requests.map(({ body }) => requestBody(body))).toEqual([
      {},
      amount,
      signature,
      {},
      { cancelation_reason: 'Changed investment plan' },
    ]);
    for (const request of context.requests) {
      expect(request.headers.has('idempotency-key')).toBe(false);
    }
    expect(context.routes).toEqual([
      'InvestmentCreate',
      'InvestmentAmountStep',
      'InvestmentSignatureStep',
      'InvestmentReviewStep',
      'InvestmentCancel',
    ]);
    context.transport.dispose();
  });

  it('rejects invalid path, pagination, amount, funding, and mutation inputs before transport', () => {
    const context = setup([]);

    expect(() => context.resource.listConfirmedByProfile({ profileId: 0 })).toThrow(
      'profileId must be a positive safe integer',
    );
    expect(() => context.resource.listUnconfirmed({ limit: 0 })).toThrow(
      'limit must be a safe integer from 1 through 100',
    );
    expect(() => context.resource.listUnconfirmed({ limit: 101 })).toThrow(
      'limit must be a safe integer from 1 through 100',
    );
    expect(() => context.resource.listUnconfirmed({ offset: -1 })).toThrow(
      'offset must be a safe integer greater than or equal to 0',
    );
    expect(() => context.resource.listByOffer({ offerSlug: ' ' })).toThrow(
      'offerSlug must not be blank',
    );
    expect(() => context.resource.getInvestment({ investmentId: Number.NaN })).toThrow(
      'investmentId must be a positive safe integer',
    );
    expect(() =>
      context.resource.setAmount({
        offerSlug: 'oncolyze',
        investmentId: 123,
        profileId: 42,
        amount: '6.2500000',
        fundingType: 'ach',
      }),
    ).toThrow('amount must be an exact decimal string with at most 6 fractional digits');
    expect(() =>
      context.resource.setAmount({
        offerSlug: 'oncolyze',
        investmentId: 123,
        profileId: 42,
        amount: '6.25',
        fundingType: 'card' as 'ach',
      }),
    ).toThrow('fundingType is not supported');
    expect(() =>
      context.resource.setAmount({
        offerSlug: 'oncolyze',
        investmentId: 123,
        profileId: 42,
        amount: '6.25',
        fundingType: 'ach',
        fundingSourceId: 0,
      }),
    ).toThrow('fundingSourceId must be a positive safe integer');
    expect(() =>
      context.resource.setAmount({
        offerSlug: 'oncolyze',
        investmentId: 123,
        profileId: 42,
        amount: 6.25 as never,
        fundingType: 'ach',
      }),
    ).toThrow('amount must be an exact decimal string');
    expect(() =>
      context.resource.setAmount({
        offerSlug: 'oncolyze',
        investmentId: 123,
        profileId: 42,
        amount: '6.25',
        fundingType: 'ach',
        paymentData: [] as never,
      }),
    ).toThrow('paymentData must be a plain object');
    expect(() =>
      context.resource.submitSignature({
        offerSlug: 'oncolyze',
        investmentId: 123,
        profileId: 42,
        signatureId: 'x',
      }),
    ).toThrow('signatureId must contain at least 2 non-whitespace characters');
    expect(() =>
      context.resource.submitSignature({
        offerSlug: 'oncolyze',
        investmentId: 123,
        profileId: 42,
        signatureId: 'sig_123',
        userBrowser: 123 as never,
      }),
    ).toThrow('userBrowser must be a string when provided');
    expect(() => context.resource.cancelInvestment({ investmentId: 123, reason: 'no' })).toThrow(
      'reason must contain at least 4 non-whitespace characters',
    );
    expect(context.requests).toHaveLength(0);
    context.transport.dispose();
  });

  it.each([
    [
      'InvestmentListConfirmed',
      { data: [pinnedInvestment], count: '1' },
      (resource: ReturnType<typeof createInvestmentsResource>) =>
        resource.listConfirmedByProfile({ profileId: 42 }),
    ],
    [
      'InvestmentGet',
      { ...pinnedInvestment, funding_type: 'cash' },
      (resource: ReturnType<typeof createInvestmentsResource>) =>
        resource.getInvestment({ investmentId: 123 }),
    ],
    [
      'InvestmentAmountStep',
      { amount: 6.25, profile_id: 42, funding_type: 'ach' },
      (resource: ReturnType<typeof createInvestmentsResource>) =>
        resource.setAmount({
          offerSlug: 'oncolyze',
          investmentId: 123,
          profileId: 42,
          amount: '6.25',
          fundingType: 'ach',
        }),
    ],
    [
      'InvestmentSignatureStep',
      { signature_id: 123 },
      (resource: ReturnType<typeof createInvestmentsResource>) =>
        resource.submitSignature({
          offerSlug: 'oncolyze',
          investmentId: 123,
          profileId: 42,
          signatureId: 'sig_123',
        }),
    ],
    [
      'InvestmentReviewStep',
      { investment: { id: 123, status: 'pending' } },
      (resource: ReturnType<typeof createInvestmentsResource>) =>
        resource.submitReview({
          offerSlug: 'oncolyze',
          investmentId: 123,
          profileId: 42,
        }),
    ],
  ])(
    'rejects %s response drift without leaking payload values',
    async (route, response, invoke) => {
      const context = setup([jsonResponse({ ...response, private_secret: 'must-not-leak' })]);
      const result = await invoke(context.resource).catch((reason: unknown) => reason);

      if (route === 'InvestmentGet' || route === 'InvestmentReviewStep') {
        expect(result).not.toBeInstanceOf(SdkResponseValidationError);
        expect((result as { data: Record<string, unknown> }).data.private_secret).toBe(
          'must-not-leak',
        );
      } else {
        expect(result).toBeInstanceOf(SdkResponseValidationError);
        expect(result).toMatchObject({ code: 'SDK_RESPONSE_VALIDATION_FAILED', route });
        expect(JSON.stringify(result)).not.toContain('must-not-leak');
      }
      context.transport.dispose();
    },
  );
});
