import { describe, expect, it } from 'vitest';
import { createInvestSdkTransport } from '../client.js';
import { SdkResponseValidationError } from '../errors.js';
import { createFetchScript, jsonResponse } from '../testing.js';
import { createOffersResource, validateOfferListResponse } from './offers.js';

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
    services: { offers: { baseUrl: 'https://offers.example.test/v1.0/' } },
  });
  return {
    resource: createOffersResource(transport.createServiceClient('offers')),
    requests: script.requests,
    routes,
    transport,
  };
};

describe('offers resource', () => {
  it('validates list responses and fixes the contract operation and query', async () => {
    const context = setup([
      jsonResponse({
        data: [
          {
            id: 2,
            slug: 'nixplay',
            price_per_share: '25.5',
          },
        ],
        count: 1,
      }),
    ]);
    const result = await context.resource.listOffers({ limit: 50, offset: 3 });

    expect(result.data.count).toBe(1);
    expect(result.data.data?.[0]?.price_per_share).toBe('25.5');
    expect(context.requests[0]?.url).toBe(
      'https://offers.example.test/v1.0/public/offer?limit=50&offset=3',
    );
    expect(context.routes).toEqual(['OfferList']);
    context.transport.dispose();
  });

  it('encodes detail slugs and validates detail responses', async () => {
    const context = setup([jsonResponse({ id: 2, slug: 'series seed' })]);
    const result = await context.resource.getOffer({ slug: 'series seed' });

    expect(result.data.slug).toBe('series seed');
    expect(context.requests[0]?.url).toBe(
      'https://offers.example.test/v1.0/public/offer/series%20seed',
    );
    expect(context.routes).toEqual(['OfferDetail']);
    context.transport.dispose();
  });

  it('rejects contract drift with the sanitized transport error', async () => {
    const context = setup([jsonResponse({ data: 'not-an-array', secret: 'must-not-leak' })]);
    const error = await context.resource.listOffers().catch((reason: unknown) => reason);
    expect(error).toMatchObject({
      name: 'SdkResponseValidationError',
      code: 'SDK_RESPONSE_VALIDATION_FAILED',
      route: 'OfferList',
      details: {
        validationFailure: 'response-schema',
        contractIssue: {
          validationMode: 'compatible',
          keyword: 'type',
          instancePath: '/data',
        },
      },
    });
    expect(error).toBeInstanceOf(SdkResponseValidationError);
    expect(JSON.stringify(error)).not.toContain('must-not-leak');
    context.transport.dispose();
  });

  it('rejects missing operation-relied identifiers after compatible wire validation', async () => {
    const context = setup([jsonResponse({ data: [{ slug: 'missing-id' }], count: 1 })]);
    await expect(context.resource.listOffers()).rejects.toMatchObject({
      code: 'SDK_RESPONSE_VALIDATION_FAILED',
      details: {
        contractIssue: {
          validationMode: 'compatible',
          keyword: 'required',
          instancePath: '/data/0',
        },
      },
    });
    context.transport.dispose();
  });

  it('accepts additive wire drift, preserves unknown enum values, and normalizes decimals', async () => {
    const context = setup([
      jsonResponse({
        data: [
          {
            id: 2,
            slug: 'nixplay',
            created_at: '2026-07-01',
            price_per_share: '100.00',
            fund_structure: 'evergreen_v2',
          },
        ],
        count: 1,
        next_cursor: 'page-2',
      }),
    ]);

    const result = await context.resource.listOffers();

    expect(result.data.data?.[0]?.price_per_share).toBe('100');
    expect(result.data.data?.[0]?.fund_structure).toBe('evergreen_v2');
    expect((result.data as Record<string, unknown>).next_cursor).toBe('page-2');
    expect(result.data.data?.[0]).toHaveProperty('created_at', '2026-07-01');
    expect(() => validateOfferListResponse.exact(result.data)).toThrow(
      'does not satisfy its exact contract',
    );
    context.transport.dispose();
  });

  it('rejects invalid inputs before any request', () => {
    const context = setup([]);
    expect(() => context.resource.listOffers({ offset: -1 })).toThrow(
      'offset must be a non-negative safe integer',
    );
    expect(() => context.resource.getOffer({ slug: ' ' })).toThrow(
      'slug must be a non-blank string or number',
    );
    expect(() => context.resource.getOffer({ slug: Number.NaN })).toThrow(
      'numeric slug must be a non-negative safe integer',
    );
    expect(context.requests).toHaveLength(0);
    context.transport.dispose();
  });
});
