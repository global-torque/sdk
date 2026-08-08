import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import { createInvestSdkTransport } from './client.js';
import {
  SdkAbortError,
  SdkAuthenticationError,
  SdkAuthorizationError,
  SdkConfigurationError,
  SdkHttpError,
  SdkNetworkError,
  SdkOfflineError,
  SdkRateLimitError,
  SdkResponseParseError,
  SdkResponseValidationError,
  SdkTimeoutError,
  SdkValidationError,
} from './errors.js';
import { sanitizeErrorDetails } from './sanitize.js';
import { assertSanitizedValue, createFetchScript, jsonResponse, requestUrl } from './testing.js';
import type {
  InvestSdkTransportConfig,
  SdkRequestInput,
  SdkResult,
  SdkServiceClient,
} from './types.js';

const createConfig = (
  fetchImplementation: typeof fetch,
  overrides: Partial<InvestSdkTransportConfig> = {},
): InvestSdkTransportConfig => ({
  apiKey: 'public_test_key',
  createRequestId: () => 'request-1',
  fetch: fetchImplementation,
  services: {
    torque: {
      baseUrl: 'https://api.example.test/v1/',
      auth: { kind: 'cookie' },
    },
  },
  ...overrides,
});

describe('createInvestSdkTransport', () => {
  it('exports an offline-policy error for instance runtime adapters', () => {
    expect(new SdkOfflineError({ service: 'torque', method: 'POST' })).toMatchObject({
      code: 'SDK_OFFLINE',
      service: 'torque',
      method: 'POST',
    });
  });

  it('provides deterministic request capture for transport contract tests', async () => {
    const script = createFetchScript([new TypeError('offline'), jsonResponse({ ok: true })]);
    const client = createInvestSdkTransport(
      createConfig(script.fetch, { retry: { maxRetries: 1 } }),
    ).createServiceClient('torque');

    await expect(client.get('/captured')).resolves.toMatchObject({ data: { ok: true } });
    expect(script.requests).toHaveLength(2);
    expect(script.requests[0]).toMatchObject({
      url: 'https://api.example.test/v1/captured',
      method: 'GET',
      credentials: 'include',
    });
    expect(script.requests[0]?.headers.get('x-api-key')).toBe('public_test_key');
  });

  it('[contract:application-key] fails closed on missing keys and unsafe origins before making requests', () => {
    const fetchImplementation = vi.fn<typeof fetch>();

    expect(() =>
      createInvestSdkTransport(createConfig(fetchImplementation, { apiKey: ' ' })),
    ).toThrow(SdkConfigurationError);
    expect(() =>
      createInvestSdkTransport({
        services: { torque: { baseUrl: 'https://api.example.test/' } },
        fetch: fetchImplementation,
      }),
    ).toThrow(SdkConfigurationError);
    expect(() =>
      createInvestSdkTransport(
        createConfig(fetchImplementation, {
          apiKey: 'key\r\ninjected',
        }),
      ),
    ).toThrow('apiKey must be a header-safe value');
    expect(() =>
      createInvestSdkTransport(
        createConfig(fetchImplementation, {
          services: { torque: { baseUrl: 'http://api.example.test/' } },
        }),
      ),
    ).toThrow('must use HTTPS');
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('validates service, retry, timeout, and request-ID configuration', async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const invalidConfigurations: Partial<InvestSdkTransportConfig>[] = [
      { services: {} },
      { services: { torque: { baseUrl: 'not a URL' } } },
      { services: { torque: { baseUrl: 'https://user@example.test/' } } },
      { allowInsecureOrigins: ['https://api.example.test'] },
      {
        services: {
          torque: { baseUrl: 'https://api.example.test/', applicationAuth: 'invalid' as 'api-key' },
        },
      },
      {
        services: {
          torque: {
            baseUrl: 'https://api.example.test/',
            applicationAuth: 'api-key',
            headerPolicy: 'minimal',
          },
        },
      },
      {
        services: {
          torque: {
            baseUrl: 'https://api.example.test/',
            applicationAuth: 'none',
            headerPolicy: 'minimal',
            auth: { kind: 'none', credentials: 'include' },
          },
        },
      },
      {
        services: {
          torque: {
            baseUrl: 'https://api.example.test/',
            allowedRedirectOrigins: ['http://identity.example.test'],
          },
        },
      },
      {
        services: {
          torque: {
            baseUrl: 'https://api.example.test/',
            applicationAuth: 'api-key',
            redirectPolicy: 'follow',
          },
        },
      },
      { retry: { maxRetries: 6 } },
      { timeoutMs: 0 },
      { maxErrorBodyBytes: 0 },
    ];

    for (const overrides of invalidConfigurations) {
      expect(() => createInvestSdkTransport(createConfig(fetchImplementation, overrides))).toThrow(
        SdkConfigurationError,
      );
    }

    const invalidRequestId = createInvestSdkTransport(
      createConfig(fetchImplementation, { createRequestId: () => 'bad\nrequest' }),
    ).createServiceClient('torque');
    await expect(invalidRequestId.get('/test')).rejects.toMatchObject({
      code: 'SDK_REQUEST_ID_INVALID',
    });

    const transport = createInvestSdkTransport(createConfig(fetchImplementation));
    expect(() => transport.createServiceClient('missing')).toThrow('Unknown SDK service');
    await expect(
      transport.createServiceClient('torque').request({ method: 'GET', path: '/test', body: {} }),
    ).rejects.toMatchObject({ code: 'SDK_READ_BODY_REJECTED' });

    const client = transport.createServiceClient('torque');
    await expect(
      client.request({
        method: 'TRACE' as SdkRequestInput['method'],
        path: '/test',
      }),
    ).rejects.toMatchObject({ code: 'SDK_METHOD_INVALID' });
    await expect(
      client.get('/test', {
        responseMode: 'yaml' as NonNullable<SdkRequestInput['responseMode']>,
      }),
    ).rejects.toMatchObject({ code: 'SDK_RESPONSE_MODE_INVALID' });
    await expect(
      client.get('/test', {
        query: { filter: {} as never },
      }),
    ).rejects.toMatchObject({ code: 'SDK_QUERY_VALUE_INVALID' });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('projects non-serializable JSON bodies to a typed configuration error', async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const client = createInvestSdkTransport(createConfig(fetchImplementation)).createServiceClient(
      'torque',
    );
    const circular: { self?: unknown } = {};
    circular.self = circular;

    await expect(client.post('/circular', circular)).rejects.toMatchObject({
      name: 'SdkConfigurationError',
      code: 'SDK_BODY_SERIALIZATION_FAILED',
    });
    await expect(client.post('/bigint', 1n)).rejects.toMatchObject({
      name: 'SdkConfigurationError',
      code: 'SDK_BODY_SERIALIZATION_FAILED',
    });
    await expect(client.post('/function', () => undefined)).rejects.toMatchObject({
      name: 'SdkConfigurationError',
      code: 'SDK_BODY_SERIALIZATION_FAILED',
    });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('allows only exact configured local HTTP origins', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(jsonResponse({ ok: true })));
    const transport = createInvestSdkTransport(
      createConfig(fetchImplementation, {
        services: { local: { baseUrl: 'http://sdk.local.test:8081/api/' } },
        allowInsecureOrigins: ['http://sdk.local.test:8081'],
      }),
    );

    await transport.createServiceClient('local').get('/health');
    expect(requestUrl(fetchImplementation.mock.calls[0]?.[0])).toBe(
      'http://sdk.local.test:8081/api/health',
    );
  });

  it('isolates service origins and application keys between instances', async () => {
    const firstFetch = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ client: 1 }));
    const secondFetch = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ client: 2 }));
    const first = createInvestSdkTransport(createConfig(firstFetch, { apiKey: 'first-key' }));
    const second = createInvestSdkTransport(
      createConfig(secondFetch, {
        apiKey: 'second-key',
        services: { torque: { baseUrl: 'https://other.example.test/' } },
      }),
    );

    await Promise.all([
      first.createServiceClient('torque').get('/offers'),
      second.createServiceClient('torque').get('/offers'),
    ]);

    const firstHeaders = new Headers(firstFetch.mock.calls[0]?.[1]?.headers);
    const secondHeaders = new Headers(secondFetch.mock.calls[0]?.[1]?.headers);
    expect(requestUrl(firstFetch.mock.calls[0]?.[0])).toBe('https://api.example.test/v1/offers');
    expect(requestUrl(secondFetch.mock.calls[0]?.[0])).toBe('https://other.example.test/offers');
    expect(firstHeaders.get('x-api-key')).toBe('first-key');
    expect(secondHeaders.get('x-api-key')).toBe('second-key');
  });

  it('isolates concurrent hooks and retry policies between transport instances', async () => {
    const firstScript = createFetchScript([
      new TypeError('first-attempt-offline'),
      jsonResponse({ client: 1 }),
    ]);
    const secondScript = createFetchScript([new TypeError('second-client-offline')]);
    const firstRequestHook = vi.fn();
    const firstResponseHook = vi.fn();
    const secondRequestHook = vi.fn();
    const secondErrorHook = vi.fn();
    const first = createInvestSdkTransport(
      createConfig(firstScript.fetch, {
        retry: { maxRetries: 1 },
        hooks: { onRequest: firstRequestHook, onResponse: firstResponseHook },
      }),
    ).createServiceClient('torque');
    const second = createInvestSdkTransport(
      createConfig(secondScript.fetch, {
        retry: { maxRetries: 0 },
        hooks: { onRequest: secondRequestHook, onError: secondErrorHook },
      }),
    ).createServiceClient('torque');

    const [firstResult, secondResult] = await Promise.allSettled([
      first.get('/isolated'),
      second.get('/isolated'),
    ]);

    expect(firstResult).toMatchObject({ status: 'fulfilled', value: { data: { client: 1 } } });
    expect(secondResult.status).toBe('rejected');
    if (secondResult.status === 'rejected') {
      expect(secondResult.reason as unknown).toMatchObject({
        code: 'SDK_NETWORK_FAILED',
        attempts: 1,
      });
    }
    expect(firstScript.requests).toHaveLength(2);
    expect(secondScript.requests).toHaveLength(1);
    expect(firstRequestHook).toHaveBeenCalledTimes(2);
    expect(firstResponseHook).toHaveBeenCalledOnce();
    expect(secondRequestHook).toHaveBeenCalledOnce();
    expect(secondErrorHook).toHaveBeenCalledOnce();
  });

  it('snapshots mutable configuration when the transport is constructed', async () => {
    const firstHook = vi.fn();
    const replacementHook = vi.fn();
    const getToken = vi.fn(() => 'first-token');
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ ok: true }));
    const mutableServices: Record<string, InvestSdkTransportConfig['services'][string]> = {
      torque: {
        baseUrl: 'https://api.example.test/v1/',
        auth: { kind: 'bearer', getToken },
      },
    };
    const config = createConfig(fetchImplementation, {
      apiKey: 'first-key',
      retry: { maxRetries: 0 },
      hooks: { onRequest: firstHook },
      services: mutableServices,
    });
    const transport = createInvestSdkTransport(config);

    config.apiKey = 'replacement-key';
    config.retry = { maxRetries: 5 };
    config.hooks = { onRequest: replacementHook };
    mutableServices.torque = {
      baseUrl: 'https://evil.example.test/',
      auth: { kind: 'none' },
    };

    await transport.createServiceClient('torque').get('/me');

    const headers = new Headers(fetchImplementation.mock.calls[0]?.[1]?.headers);
    expect(requestUrl(fetchImplementation.mock.calls[0]?.[0])).toBe(
      'https://api.example.test/v1/me',
    );
    expect(headers.get('x-api-key')).toBe('first-key');
    expect(headers.get('authorization')).toBe('Bearer first-token');
    expect(firstHook).toHaveBeenCalledOnce();
    expect(replacementHook).not.toHaveBeenCalled();
  });

  it('rejects cross-origin paths and security-header overrides', async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const client = createInvestSdkTransport(createConfig(fetchImplementation)).createServiceClient(
      'torque',
    );

    await expect(client.get('https://evil.example.test/data')).rejects.toMatchObject({
      code: 'SDK_REQUEST_ORIGIN_REJECTED',
    });
    await expect(client.get('../other-service/data')).rejects.toMatchObject({
      code: 'SDK_REQUEST_BASE_PATH_REJECTED',
    });
    await expect(client.get('https://api.example.test/other-service/data')).rejects.toMatchObject({
      code: 'SDK_REQUEST_BASE_PATH_REJECTED',
    });
    await expect(
      client.get('/data', { headers: { Authorization: 'Bearer stolen' } }),
    ).rejects.toMatchObject({
      code: 'SDK_SECURITY_HEADER_OVERRIDE_REJECTED',
    });
    await expect(
      client.get('/data', { headers: { 'X-API-Key': 'replacement' } }),
    ).rejects.toMatchObject({
      code: 'SDK_SECURITY_HEADER_OVERRIDE_REJECTED',
    });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('applies separate cookie, bearer, and no-user-auth strategies', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(jsonResponse({ ok: true })));
    const transport = createInvestSdkTransport(
      createConfig(fetchImplementation, {
        services: {
          cookie: { baseUrl: 'https://cookie.example.test/', auth: { kind: 'cookie' } },
          bearer: {
            baseUrl: 'https://bearer.example.test/',
            auth: { kind: 'bearer', getToken: () => 'user-token' },
          },
          anonymous: { baseUrl: 'https://anonymous.example.test/', auth: { kind: 'none' } },
        },
      }),
    );

    await transport.createServiceClient('cookie').get('/me');
    await transport.createServiceClient('bearer').get('/me');
    await transport.createServiceClient('anonymous').get('/public');

    expect(fetchImplementation.mock.calls[0]?.[1]?.credentials).toBe('include');
    expect(new Headers(fetchImplementation.mock.calls[0]?.[1]?.headers).has('authorization')).toBe(
      false,
    );
    expect(fetchImplementation.mock.calls[1]?.[1]?.credentials).toBe('omit');
    expect(new Headers(fetchImplementation.mock.calls[1]?.[1]?.headers).get('authorization')).toBe(
      'Bearer user-token',
    );
    expect(fetchImplementation.mock.calls[2]?.[1]?.credentials).toBe('omit');
    expect(new Headers(fetchImplementation.mock.calls[2]?.[1]?.headers).has('authorization')).toBe(
      false,
    );
  });

  it('[transport:headers] omits the application key only for an explicitly keyless service', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(jsonResponse({ ok: true })));
    const transport = createInvestSdkTransport(
      createConfig(fetchImplementation, {
        services: {
          torque: { baseUrl: 'https://api.example.test/v1/', auth: { kind: 'cookie' } },
          external: {
            baseUrl: 'https://public.example.test/',
            applicationAuth: 'none',
            headerPolicy: 'minimal',
            auth: { kind: 'none' },
          },
        },
      }),
    );

    await transport.createServiceClient('torque').get('/profile');
    await transport.createServiceClient('external').get('/market');

    const torqueHeaders = new Headers(fetchImplementation.mock.calls[0]?.[1]?.headers);
    const externalHeaders = new Headers(fetchImplementation.mock.calls[1]?.[1]?.headers);
    expect(torqueHeaders.get('x-api-key')).toBe('public_test_key');
    expect(fetchImplementation.mock.calls[0]?.[1]?.credentials).toBe('include');
    expect(externalHeaders.has('x-api-key')).toBe(false);
    expect(externalHeaders.has('authorization')).toBe(false);
    expect(externalHeaders.has('x-request-id')).toBe(false);
    expect(externalHeaders.has('accept')).toBe(false);
    expect(fetchImplementation.mock.calls[1]?.[1]?.credentials).toBe('omit');
  });

  it('allows an entirely keyless compatibility transport without a placeholder key', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ ok: true }));
    const client = createInvestSdkTransport({
      createRequestId: () => 'compatibility-request',
      fetch: fetchImplementation,
      services: {
        compatibility: {
          baseUrl: 'https://api.example.test/',
          applicationAuth: 'none',
          auth: { kind: 'cookie', credentials: 'include' },
          redirectPolicy: 'follow',
        },
      },
    }).createServiceClient('compatibility');

    await expect(client.get('/profile')).resolves.toMatchObject({ data: { ok: true } });
    const init = fetchImplementation.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).has('x-api-key')).toBe(false);
    expect(init?.credentials).toBe('include');
    expect(init?.redirect).toBe('follow');
  });

  it('[transport:request-id] preserves an explicit request ID across safe-read retries', async () => {
    const createRequestId = vi.fn(() => 'generated-id');
    const requestIds: string[] = [];
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('temporary network failure'))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const client = createInvestSdkTransport(
      createConfig(fetchImplementation, {
        createRequestId,
        retry: { maxRetries: 1, delayMs: 0 },
        hooks: {
          onRequest: (event) => {
            requestIds.push(event.requestId);
          },
        },
      }),
    ).createServiceClient('torque');

    const result = await client.get('/profile', { requestId: 'business-operation-id' });

    expect(result.requestId).toBe('business-operation-id');
    expect(createRequestId).not.toHaveBeenCalled();
    expect(requestIds).toEqual(['business-operation-id', 'business-operation-id']);
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchImplementation.mock.calls) {
      expect(new Headers(init?.headers).get('x-request-id')).toBe('business-operation-id');
    }
  });

  it('rejects ambiguous, invalid, and minimal-service custom request IDs before Fetch', async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const transport = createInvestSdkTransport(
      createConfig(fetchImplementation, {
        services: {
          torque: { baseUrl: 'https://api.example.test/v1/', auth: { kind: 'cookie' } },
          minimal: {
            baseUrl: 'https://public.example.test/',
            applicationAuth: 'none',
            headerPolicy: 'minimal',
            auth: { kind: 'none' },
          },
        },
      }),
    );
    const client = transport.createServiceClient('torque');

    await expect(
      client.get('/profile', {
        headers: { 'X-Request-ID': 'ambiguous-id' },
      }),
    ).rejects.toMatchObject({ code: 'SDK_REQUEST_ID_HEADER_REJECTED' });
    for (const requestId of ['', 'line\nbreak', 'x'.repeat(257)]) {
      await expect(client.get('/profile', { requestId })).rejects.toMatchObject({
        code: 'SDK_REQUEST_ID_INVALID',
      });
    }
    await expect(
      transport.createServiceClient('minimal').get('/market', { requestId: 'not-sent' }),
    ).rejects.toMatchObject({ code: 'SDK_REQUEST_ID_NOT_ALLOWED' });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('rejects unsafe bearer tokens and token-provider failures before Fetch', async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const unsafe = createInvestSdkTransport(
      createConfig(fetchImplementation, {
        services: {
          torque: {
            baseUrl: 'https://api.example.test/v1/',
            auth: { kind: 'bearer', getToken: () => 'token with spaces' },
          },
        },
      }),
    ).createServiceClient('torque');
    await expect(unsafe.get('/me')).rejects.toMatchObject({ code: 'SDK_BEARER_TOKEN_INVALID' });

    const failed = createInvestSdkTransport(
      createConfig(fetchImplementation, {
        services: {
          torque: {
            baseUrl: 'https://api.example.test/v1/',
            auth: {
              kind: 'bearer',
              getToken: () => {
                throw new Error('provider unavailable');
              },
            },
          },
        },
      }),
    ).createServiceClient('torque');
    await expect(failed.get('/me')).rejects.toMatchObject({
      code: 'SDK_BEARER_TOKEN_RESOLUTION_FAILED',
    });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('does not resolve bearer tokens after pre-abort and times out a pending provider', async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const preAbortedToken = vi.fn(() => 'must-not-be-read');
    const controller = new AbortController();
    controller.abort();
    const preAbortedClient = createInvestSdkTransport(
      createConfig(fetchImplementation, {
        services: {
          torque: {
            baseUrl: 'https://api.example.test/v1/',
            auth: { kind: 'bearer', getToken: preAbortedToken },
          },
        },
      }),
    ).createServiceClient('torque');

    await expect(preAbortedClient.get('/me', { signal: controller.signal })).rejects.toBeInstanceOf(
      SdkAbortError,
    );
    expect(preAbortedToken).not.toHaveBeenCalled();

    const pendingToken = vi.fn(() => new Promise<string>(() => undefined));
    const timeoutClient = createInvestSdkTransport(
      createConfig(fetchImplementation, {
        timeoutMs: 5,
        services: {
          torque: {
            baseUrl: 'https://api.example.test/v1/',
            auth: { kind: 'bearer', getToken: pendingToken },
          },
        },
      }),
    ).createServiceClient('torque');
    await expect(timeoutClient.get('/me')).rejects.toBeInstanceOf(SdkTimeoutError);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('makes OPTIONS schema discovery first-class and preserves existing query values', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ fields: [] }));
    const client = createInvestSdkTransport(createConfig(fetchImplementation)).createServiceClient(
      'torque',
    );

    const result = await client.options('/offers?locale=en', {
      query: { section: ['identity', 'bank'], empty: null, skip: undefined },
    });

    const url = new URL(requestUrl(fetchImplementation.mock.calls[0]?.[0]) ?? '');
    expect(fetchImplementation.mock.calls[0]?.[1]?.method).toBe('OPTIONS');
    expect(url.searchParams.get('schema')).toBe('1');
    expect(url.searchParams.get('locale')).toBe('en');
    expect(url.searchParams.getAll('section')).toEqual(['identity', 'bank']);
    expect(url.searchParams.get('empty')).toBe('');
    expect(url.searchParams.has('skip')).toBe(false);
    expect(result.data).toEqual({ fields: [] });
  });

  it('can explicitly omit schema discovery and use the direct request surface', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(new Response('schema disabled')));
    const client = createInvestSdkTransport(createConfig(fetchImplementation)).createServiceClient(
      'torque',
    );

    const result = await client.options('/forms', { schema: false, responseMode: 'text' });

    expect(requestUrl(fetchImplementation.mock.calls[0]?.[0])).toBe(
      'https://api.example.test/v1/forms',
    );
    expect(result.data).toBe('schema disabled');
  });

  it('[transport:response-envelope] returns a stable result envelope and void for empty responses', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(
          { id: 7 },
          {
            status: 201,
            headers: { 'content-type': 'application/json', 'x-request-id': 'server-id' },
          },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 205 }));
    const client = createInvestSdkTransport(createConfig(fetchImplementation)).createServiceClient(
      'torque',
    );

    const created = await client.post('/offers', { name: 'Offer' });
    const removed = await client.delete('/offers/7');
    const reset = await client.post('/offers/reset');

    expect(created).toMatchObject({ data: { id: 7 }, status: 201, requestId: 'server-id' });
    expect(created.headers).toBeInstanceOf(Headers);
    expect(removed).toMatchObject({ data: undefined, status: 204, requestId: 'request-1' });
    expect(reset).toMatchObject({ data: undefined, status: 205, requestId: 'request-1' });
    expect(fetchImplementation.mock.calls[0]?.[1]?.redirect).toBe('error');
    expect(fetchImplementation.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ name: 'Offer' }));
  });

  it.each([204, 205])(
    'returns mode-specific empty values for explicit %i response modes',
    async (status) => {
      const fetchImplementation = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status }));
      const client = createInvestSdkTransport(
        createConfig(fetchImplementation),
      ).createServiceClient('torque');

      const text = await client.get('/empty-text', { responseMode: 'text' });
      const blob = await client.get('/empty-blob', { responseMode: 'blob' });
      const bytes = await client.get('/empty-bytes', { responseMode: 'arrayBuffer' });

      expect(text.data).toBe('');
      expect(blob.data).toBeInstanceOf(Blob);
      expect(blob.data.size).toBe(0);
      expect(bytes.data).toBeInstanceOf(ArrayBuffer);
      expect(bytes.data.byteLength).toBe(0);
    },
  );

  it('preserves the direct-request BodyInit matrix without forcing JSON content type', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    const client = createInvestSdkTransport(createConfig(fetchImplementation)).createServiceClient(
      'torque',
    );
    const bodies: (BodyInit | undefined)[] = [
      new FormData(),
      new URLSearchParams({ page: '1' }),
      new Blob(['blob']),
      new Uint8Array([1, 2]).buffer,
      'plain text',
      undefined,
    ];

    for (const body of bodies) {
      await client.request({ method: 'POST', path: '/body', body });
    }

    expect(fetchImplementation).toHaveBeenCalledTimes(bodies.length);
    for (const [index, body] of bodies.entries()) {
      const init = fetchImplementation.mock.calls[index]?.[1];
      expect(init?.body).toBe(body);
      expect(new Headers(init?.headers).has('content-type')).toBe(false);
    }
  });

  it('[transport:methods] [transport:response-modes] supports text, blob, array-buffer, PUT, and PATCH transport shapes', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockImplementation((_url, init) => {
      const method = init?.method;
      if (method === 'PUT') return Promise.resolve(new Response('updated'));
      if (method === 'PATCH') return Promise.resolve(new Response(new Uint8Array([1, 2, 3])));
      return Promise.resolve(new Response('blob-data'));
    });
    const client = createInvestSdkTransport(createConfig(fetchImplementation)).createServiceClient(
      'torque',
    );

    const text = await client.put('/record', 'plain-body', { responseMode: 'text' });
    const bytes = await client.patch('/record', new Uint8Array([9]), {
      responseMode: 'arrayBuffer',
    });
    const blob = await client.get('/download', { responseMode: 'blob' });

    expect(text.data).toBe('updated');
    if (!(bytes.data instanceof ArrayBuffer)) throw new TypeError('Expected ArrayBuffer data.');
    expect([...new Uint8Array(bytes.data)]).toEqual([1, 2, 3]);
    if (!(blob.data instanceof Blob)) throw new TypeError('Expected Blob data.');
    expect(await blob.data.text()).toBe('blob-data');
    expect(fetchImplementation.mock.calls[0]?.[1]?.body).toBe('plain-body');
    expect(fetchImplementation.mock.calls[1]?.[1]?.body).toBeInstanceOf(Uint8Array);
  });

  it.each([
    [400, SdkValidationError, 'SDK_VALIDATION_FAILED'],
    [401, SdkAuthenticationError, 'SDK_AUTHENTICATION_FAILED'],
    [403, SdkAuthorizationError, 'SDK_AUTHORIZATION_FAILED'],
    [404, SdkHttpError, 'SDK_HTTP_FAILED'],
    [409, SdkValidationError, 'SDK_VALIDATION_FAILED'],
    [422, SdkValidationError, 'SDK_VALIDATION_FAILED'],
    [500, SdkHttpError, 'SDK_HTTP_FAILED'],
  ])('maps HTTP %i to a stable typed error', async (status, ErrorType, code) => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          __error__: 'Rejected',
          email: ['Invalid'],
          password: 'must-not-leak',
          nested: { csrf_token: 'must-not-leak', message: '<script>alert(1)</script>Bad' },
        },
        { status, headers: { 'content-type': 'application/json', 'x-private-token': 'hidden' } },
      ),
    );
    const client = createInvestSdkTransport(createConfig(fetchImplementation)).createServiceClient(
      'torque',
    );

    const error = await client
      .post('/submit', { password: 'request-secret' }, { operationId: 'forms.submit' })
      .catch((value: unknown) => value);

    expect(error).toBeInstanceOf(ErrorType);
    expect(error).toMatchObject({ code, status, route: 'forms.submit', attempts: 1 });
    assertSanitizedValue(error, ['must-not-leak', '<script>', 'request-secret']);
    expect((error as SdkHttpError).details).toMatchObject({
      __error__: 'Rejected',
      email: ['Invalid'],
    });
    expect((error as SdkHttpError).headers.has('x-private-token')).toBe(false);
  });

  it('parses Retry-After seconds, HTTP dates, and malformed values', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-18T12:00:00.000Z'));
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '2' } }))
      .mockResolvedValueOnce(
        new Response('', {
          status: 429,
          headers: { 'retry-after': 'Sat, 18 Jul 2026 12:00:03 GMT' },
        }),
      )
      .mockResolvedValueOnce(
        new Response('', { status: 429, headers: { 'retry-after': 'later' } }),
      );
    const client = createInvestSdkTransport(createConfig(fetchImplementation)).createServiceClient(
      'torque',
    );

    const errors = await Promise.all([
      client.get('/one').catch((error: unknown) => error),
      client.get('/two').catch((error: unknown) => error),
      client.get('/three').catch((error: unknown) => error),
    ]);

    expect(errors[0]).toMatchObject({ retryAfterMs: 2_000 });
    expect(errors[1]).toMatchObject({ retryAfterMs: 3_000 });
    expect(errors[2]).toMatchObject({ retryAfterMs: null });
    expect(errors.every((error) => error instanceof SdkRateLimitError)).toBe(true);
    vi.useRealTimers();
  });

  it('keeps malformed success JSON distinct from malformed HTTP error JSON', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response('{bad', { status: 200, headers: { 'content-type': 'application/json' } }),
      )
      .mockResolvedValueOnce(
        new Response('{bad', { status: 500, headers: { 'content-type': 'application/json' } }),
      );
    const client = createInvestSdkTransport(createConfig(fetchImplementation)).createServiceClient(
      'torque',
    );

    await expect(client.get('/success')).rejects.toBeInstanceOf(SdkResponseParseError);
    await expect(client.get('/failure')).rejects.toMatchObject({
      code: 'SDK_HTTP_FAILED',
      status: 500,
      details: { parseFailure: 'malformed-json' },
    });
  });

  it('bounds non-JSON and empty HTTP error details without losing status', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response('<h1>Failure</h1><script>steal()</script>', {
          status: 502,
          headers: { 'content-type': 'text/html' },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    const client = createInvestSdkTransport(createConfig(fetchImplementation)).createServiceClient(
      'torque',
    );

    const htmlError = await client.get('/html').catch((error: unknown) => error);
    const emptyError = await client.get('/empty').catch((error: unknown) => error);

    expect(htmlError).toMatchObject({ status: 502 });
    expect(JSON.stringify(htmlError)).not.toContain('<script>');
    expect(emptyError).toMatchObject({ status: 404, details: undefined });
  });

  it('parses bounded JSON-shaped HTTP errors when the backend mislabels the media type', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: 401, message: 'Access credentials are invalid', status: 'Unauthorized' },
        }),
        { status: 401, headers: { 'content-type': 'application/octet-stream' } },
      ),
    );
    const client = createInvestSdkTransport(createConfig(fetchImplementation)).createServiceClient(
      'torque',
    );

    await expect(client.post('/auth/comment', {})).rejects.toMatchObject({
      code: 'SDK_AUTHENTICATION_FAILED',
      status: 401,
      details: {
        error: {
          code: 401,
          message: 'Access credentials are invalid',
          status: 'Unauthorized',
        },
      },
    });
  });

  it('bounds error response bytes before parsing or exposing application details', async () => {
    const secret = 'must-not-survive';
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ message: 'x'.repeat(100), token: secret }, { status: 400 }),
      );
    const client = createInvestSdkTransport(
      createConfig(fetchImplementation, { maxErrorBodyBytes: 16 }),
    ).createServiceClient('torque');

    const error = await client.get('/bounded').catch((value: unknown) => value);

    expect(error).toMatchObject({
      code: 'SDK_VALIDATION_FAILED',
      status: 400,
      details: { bodyTruncated: true },
    });
    expect(JSON.stringify(error)).not.toContain(secret);
  });

  it('retries network failures only for safe reads and keeps one request ID', async () => {
    const requestIds: string[] = [];
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const transport = createInvestSdkTransport(
      createConfig(fetchImplementation, {
        retry: { maxRetries: 1 },
        hooks: {
          onRequest: (event) => {
            requestIds.push(event.requestId);
          },
        },
      }),
    );

    await expect(transport.createServiceClient('torque').get('/safe')).resolves.toMatchObject({
      data: { ok: true },
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    expect(requestIds).toEqual(['request-1', 'request-1']);

    fetchImplementation.mockReset().mockRejectedValue(new TypeError('offline'));
    await expect(
      transport.createServiceClient('torque').post('/unsafe', {}),
    ).rejects.toBeInstanceOf(SdkNetworkError);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it('deduplicates identical safe reads only when explicitly enabled and correctly scoped', async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetchImplementation = vi.fn<typeof fetch>(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const transport = createInvestSdkTransport(
      createConfig(fetchImplementation, {
        deduplicateSafeReads: true,
        services: {
          torque: {
            baseUrl: 'https://api.example.test/v1/',
            auth: { kind: 'cookie', deduplicationScope: () => 'profile-7' },
          },
        },
      }),
    );
    const client = transport.createServiceClient('torque');

    const first = client.get('/offers', {
      query: { page: 1, filter: 'open' },
      headers: { 'X-View': 'summary' },
    });
    const second = client.get('/offers?filter=open&page=1', {
      headers: { 'X-View': 'summary' },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchImplementation).toHaveBeenCalledOnce();
    resolveFetch?.(jsonResponse({ ok: true }));
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ data: { ok: true } }),
      expect.objectContaining({ data: { ok: true } }),
    ]);
  });

  it('does not deduplicate across headers, signals, missing auth scopes, or opt-out', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(new Response('ok')));
    let scope = 'profile-1';
    const scoped = createInvestSdkTransport(
      createConfig(fetchImplementation, {
        deduplicateSafeReads: true,
        services: {
          torque: {
            baseUrl: 'https://api.example.test/v1/',
            auth: { kind: 'cookie', deduplicationScope: () => scope },
          },
        },
      }),
    ).createServiceClient('torque');

    const first = scoped.get('/same', { headers: { 'X-View': 'one' }, responseMode: 'text' });
    const second = scoped.get('/same', { headers: { 'X-View': 'two' }, responseMode: 'text' });
    scope = 'profile-2';
    const third = scoped.get('/same', { headers: { 'X-View': 'one' }, responseMode: 'text' });
    const controller = new AbortController();
    const fourth = scoped.get('/same', {
      headers: { 'X-View': 'one' },
      responseMode: 'text',
      signal: controller.signal,
    });
    await Promise.all([first, second, third, fourth]);

    const unscopedFetch = vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(new Response('ok')));
    const unscoped = createInvestSdkTransport(
      createConfig(unscopedFetch, {
        deduplicateSafeReads: true,
        services: {
          torque: { baseUrl: 'https://api.example.test/v1/', auth: { kind: 'cookie' } },
        },
      }),
    ).createServiceClient('torque');
    await Promise.all([
      unscoped.get('/same', { responseMode: 'text' }),
      unscoped.get('/same', { responseMode: 'text' }),
    ]);

    expect(fetchImplementation).toHaveBeenCalledTimes(3);
    expect(unscopedFetch).toHaveBeenCalledTimes(2);
  });

  it('does not deduplicate no-user-auth reads that can carry ambient credentials', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(new Response('ok')));
    const client = createInvestSdkTransport(
      createConfig(fetchImplementation, {
        deduplicateSafeReads: true,
        services: {
          torque: {
            baseUrl: 'https://api.example.test/v1/',
            auth: { kind: 'none', credentials: 'include' },
          },
        },
      }),
    ).createServiceClient('torque');

    await Promise.all([
      client.get('/same', { responseMode: 'text' }),
      client.get('/same', { responseMode: 'text' }),
    ]);

    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it('keeps concurrent reads from different authentication scopes isolated', async () => {
    const resolvers: ((response: Response) => void)[] = [];
    const fetchImplementation = vi.fn<typeof fetch>(
      () =>
        new Promise<Response>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    let scope = 'profile-1';
    const client = createInvestSdkTransport(
      createConfig(fetchImplementation, {
        deduplicateSafeReads: true,
        services: {
          torque: {
            baseUrl: 'https://api.example.test/v1/',
            auth: { kind: 'cookie', deduplicationScope: () => scope },
          },
        },
      }),
    ).createServiceClient('torque');

    const first = client.get('/same');
    await new Promise((resolve) => setTimeout(resolve, 0));
    scope = 'profile-2';
    const second = client.get('/same');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    resolvers[0]?.(jsonResponse({ profile: 1 }));
    resolvers[1]?.(jsonResponse({ profile: 2 }));
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ data: { profile: 1 } }),
      expect.objectContaining({ data: { profile: 2 } }),
    ]);
  });

  it('shares disposal cancellation across a deduplicated read without emitting post-dispose hooks', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    const onError = vi.fn();
    const transport = createInvestSdkTransport(
      createConfig(fetchImplementation, {
        deduplicateSafeReads: true,
        hooks: { onError },
        services: { torque: { baseUrl: 'https://api.example.test/v1/', auth: { kind: 'none' } } },
      }),
    );
    const client = transport.createServiceClient('torque');
    const first = client.get('/same');
    const second = client.get('/same');
    await new Promise((resolve) => setTimeout(resolve, 0));

    transport.dispose();

    await expect(first).rejects.toBeInstanceOf(SdkAbortError);
    await expect(second).rejects.toBeInstanceOf(SdkAbortError);
    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  });

  it('turns cancellation during a retry delay into a typed abort', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'));
    const controller = new AbortController();
    const client = createInvestSdkTransport(
      createConfig(fetchImplementation, { retry: { maxRetries: 1, delayMs: 1_000 } }),
    ).createServiceClient('torque');

    const result = client.get('/retrying', { signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();

    await expect(result).rejects.toBeInstanceOf(SdkAbortError);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it('[transport:timeout] distinguishes timeout, caller cancellation, and disposal', async () => {
    const pendingFetch = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );

    const timeoutClient = createInvestSdkTransport(
      createConfig(pendingFetch, { timeoutMs: 5 }),
    ).createServiceClient('torque');
    await expect(timeoutClient.get('/slow')).rejects.toBeInstanceOf(SdkTimeoutError);

    const controller = new AbortController();
    const abortTransport = createInvestSdkTransport(createConfig(pendingFetch));
    const aborted = abortTransport
      .createServiceClient('torque')
      .get('/cancel', { signal: controller.signal });
    controller.abort();
    await expect(aborted).rejects.toBeInstanceOf(SdkAbortError);

    const disposedTransport = createInvestSdkTransport(createConfig(pendingFetch));
    const disposed = disposedTransport.createServiceClient('torque').get('/dispose');
    disposedTransport.dispose();
    await expect(disposed).rejects.toBeInstanceOf(SdkAbortError);
    expect(() => disposedTransport.createServiceClient('torque')).not.toThrow();
    await expect(
      disposedTransport.createServiceClient('torque').get('/after'),
    ).rejects.toMatchObject({
      code: 'SDK_DISPOSED',
    });
  });

  it('does not return success when an injected Fetch ignores disposal', async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetchImplementation = vi.fn<typeof fetch>(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const onResponse = vi.fn();
    const onError = vi.fn();
    const transport = createInvestSdkTransport(
      createConfig(fetchImplementation, { hooks: { onResponse, onError } }),
    );
    const result = transport.createServiceClient('torque').get('/slow');
    await new Promise((resolve) => setTimeout(resolve, 0));

    transport.dispose();
    resolveFetch?.(jsonResponse({ stale: true }));

    await expect(result).rejects.toBeInstanceOf(SdkAbortError);
    expect(onResponse).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('gives abort and timeout precedence over response parse failures', async () => {
    let releaseBody: (() => void) | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        releaseBody = () => controller.error(new DOMException('Aborted', 'AbortError'));
      },
    });
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }),
      );
    const controller = new AbortController();
    const client = createInvestSdkTransport(createConfig(fetchImplementation)).createServiceClient(
      'torque',
    );

    const result = client.get('/stream', { signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    releaseBody?.();

    await expect(result).rejects.toBeInstanceOf(SdkAbortError);
  });

  it('emits immutable sanitized diagnostics and ignores hook failures', async () => {
    const events: unknown[] = [];
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ ok: true }));
    const transport = createInvestSdkTransport(
      createConfig(fetchImplementation, {
        apiKey: 'secret-key',
        hooks: {
          onRequest: (event) => {
            events.push(event);
            expect(Object.isFrozen(event)).toBe(true);
            throw new Error('telemetry unavailable');
          },
          onResponse: (event) => {
            events.push(event);
          },
        },
      }),
    );

    await expect(
      transport
        .createServiceClient('torque')
        .post(
          '/submit?token=query-secret',
          { password: 'body-secret' },
          { operationId: 'forms.submit' },
        ),
    ).resolves.toMatchObject({ data: { ok: true } });

    assertSanitizedValue(events, ['secret-key', 'query-secret', 'body-secret']);
    expect(events).toEqual([
      expect.objectContaining({ phase: 'request', route: 'forms.submit' }),
      expect.objectContaining({ phase: 'response', route: 'forms.submit', status: 200 }),
    ]);
  });

  it('never serializes request paths or query values into diagnostics and errors', async () => {
    const events: unknown[] = [];
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ message: 'Rejected' }, { status: 400 }));
    const client = createInvestSdkTransport(
      createConfig(fetchImplementation, {
        hooks: {
          onRequest: (event) => {
            events.push(event);
          },
          onError: (event) => {
            events.push(event);
          },
        },
      }),
    ).createServiceClient('torque');

    const error = await client
      .get('/profiles/private-profile-id/wallet?token=private-query-token', {
        operationId: 'wallet.get',
      })
      .catch((value: unknown) => value);

    expect(error).toMatchObject({ route: 'wallet.get' });
    expect(events).toEqual([
      expect.objectContaining({ phase: 'request', route: 'wallet.get' }),
      expect.objectContaining({ phase: 'error', route: 'wallet.get' }),
    ]);
    assertSanitizedValue([error, events], ['private-profile-id', 'private-query-token']);

    await expect(
      client.get('/safe', { operationId: 'invalid operation id' }),
    ).rejects.toMatchObject({ code: 'SDK_DIAGNOSTIC_IDENTIFIER_INVALID' });
  });

  it('does not let asynchronous diagnostic hooks defeat timeout or disposal', async () => {
    const pendingHook = () => new Promise<void>(() => undefined);
    const fetchImplementation = vi.fn<typeof fetch>();
    const timeoutClient = createInvestSdkTransport(
      createConfig(fetchImplementation, {
        timeoutMs: 5,
        hooks: { onRequest: pendingHook },
      }),
    ).createServiceClient('torque');

    await expect(timeoutClient.get('/hook-timeout')).rejects.toBeInstanceOf(SdkTimeoutError);

    const transport = createInvestSdkTransport(
      createConfig(fetchImplementation, { hooks: { onRequest: pendingHook } }),
    );
    const disposed = transport.createServiceClient('torque').get('/hook-dispose');
    await new Promise((resolve) => setTimeout(resolve, 0));
    transport.dispose();

    await expect(disposed).rejects.toBeInstanceOf(SdkAbortError);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('validates successful responses at the transport boundary without exposing validator failures', async () => {
    const onError = vi.fn();
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockImplementation(() =>
        Promise.resolve(jsonResponse({ identifier: 42, secret: 'backend-secret' })),
      );
    const client = createInvestSdkTransport(
      createConfig(fetchImplementation, { hooks: { onError }, deduplicateSafeReads: true }),
    ).createServiceClient('torque');

    const valid = await client.get<{ identifier: number }>('/validated', {
      responseValidator: (value) => {
        if (
          typeof value !== 'object' ||
          value === null ||
          !('identifier' in value) ||
          typeof value.identifier !== 'number'
        ) {
          throw new Error('invalid');
        }
        return { identifier: value.identifier };
      },
    });
    expect(valid.data).toEqual({ identifier: 42 });

    await expect(
      client.get('/invalid', {
        responseValidator: () => {
          throw new Error('validator leaked backend-secret');
        },
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: 'SDK_RESPONSE_VALIDATION_FAILED',
        details: { validationFailure: 'response-schema' },
      }),
    );
    const validationError = await client
      .get('/invalid-again', {
        responseValidator: () => {
          throw new Error('another backend-secret');
        },
      })
      .catch((error: unknown) => error);
    expect(validationError).toBeInstanceOf(SdkResponseValidationError);
    expect(JSON.stringify(validationError)).not.toContain('backend-secret');
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'SDK_RESPONSE_VALIDATION_FAILED' }),
    );
  });

  it('fails safely when declaration bypasses supply a rejecting asynchronous validator', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ identifier: 42 }));
    const client = createInvestSdkTransport(createConfig(fetchImplementation)).createServiceClient(
      'torque',
    );
    const unsafeClient = client as unknown as {
      get(
        path: string,
        options: { responseValidator: (value: unknown) => Promise<unknown> },
      ): Promise<SdkResult<unknown>>;
    };
    const unhandledRejection = vi.fn();
    process.on('unhandledRejection', unhandledRejection);

    try {
      const validationError = await unsafeClient
        .get('/unsafe-async-validator', {
          responseValidator: async () => {
            await Promise.resolve();
            throw new Error('validator leaked backend-secret');
          },
        })
        .catch((error: unknown) => error);

      expect(validationError).toBeInstanceOf(SdkResponseValidationError);
      expect(validationError).toMatchObject({
        code: 'SDK_RESPONSE_VALIDATION_FAILED',
        details: { validationFailure: 'response-schema' },
      });
      expect(JSON.stringify(validationError)).not.toContain('backend-secret');
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(unhandledRejection).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandledRejection);
    }
  });

  it('adds explicit mutation idempotency keys without enabling mutation retries', async () => {
    const script = createFetchScript([new TypeError('mutation failed')]);
    const client = createInvestSdkTransport(
      createConfig(script.fetch, { retry: { maxRetries: 3 } }),
    ).createServiceClient('torque');

    await expect(
      client.post('/orders', { amount: 1 }, { idempotencyKey: 'workflow-123' }),
    ).rejects.toBeInstanceOf(SdkNetworkError);
    expect(script.requests).toHaveLength(1);
    expect(script.requests[0]?.headers.get('idempotency-key')).toBe('workflow-123');

    await expect(
      client.get('/orders', { idempotencyKey: 'invalid-on-read' }),
    ).rejects.toMatchObject({ code: 'SDK_IDEMPOTENCY_KEY_NOT_ALLOWED' });
    await expect(
      client.post('/orders', {}, { headers: { 'Idempotency-Key': 'caller-value' } }),
    ).rejects.toMatchObject({ code: 'SDK_SECURITY_HEADER_OVERRIDE_REJECTED' });
    await expect(
      client.post('/orders', {}, { idempotencyKey: 'bad\nvalue' }),
    ).rejects.toMatchObject({ code: 'SDK_IDEMPOTENCY_KEY_INVALID' });
  });

  it('supports deterministic exponential retry, jitter, and Retry-After for safe reads only', async () => {
    const networkSleeps: number[] = [];
    const networkScript = createFetchScript([
      new TypeError('offline-1'),
      new TypeError('offline-2'),
      jsonResponse({ ok: true }),
    ]);
    const networkClient = createInvestSdkTransport(
      createConfig(networkScript.fetch, {
        random: () => 0.75,
        sleep: (delay) => {
          networkSleeps.push(delay);
          return Promise.resolve();
        },
        retry: {
          maxRetries: 2,
          delayMs: 100,
          backoff: 'exponential',
          jitterRatio: 0.5,
        },
      }),
    ).createServiceClient('torque');

    await expect(networkClient.get('/network')).resolves.toMatchObject({ data: { ok: true } });
    expect(networkSleeps).toEqual([125, 250]);

    const httpSleeps: number[] = [];
    const httpScript = createFetchScript([
      jsonResponse({ error: 'busy' }, { status: 429, headers: { 'retry-after': '2' } }),
      jsonResponse({ ok: true }),
    ]);
    const httpClient = createInvestSdkTransport(
      createConfig(httpScript.fetch, {
        now: () => Date.UTC(2026, 0, 1),
        random: () => 0,
        sleep: (delay) => {
          httpSleeps.push(delay);
          return Promise.resolve();
        },
        retry: {
          maxRetries: 1,
          delayMs: 100,
          jitterRatio: 0.5,
          retryableStatuses: [429],
        },
      }),
    ).createServiceClient('torque');

    await expect(httpClient.get('/limited')).resolves.toMatchObject({ data: { ok: true } });
    expect(httpSleeps).toEqual([2_000]);
  });

  it('does not misclassify retry policy callback failures as request aborts', async () => {
    const failedSleep = createInvestSdkTransport(
      createConfig(createFetchScript([new TypeError('offline')]).fetch, {
        retry: { maxRetries: 1, delayMs: 1 },
        sleep: () => Promise.reject(new Error('sleeper failed')),
      }),
    ).createServiceClient('torque');
    await expect(failedSleep.get('/sleep-failure')).rejects.toMatchObject({
      name: 'SdkConfigurationError',
      code: 'SDK_RETRY_SLEEP_FAILED',
    });

    const invalidRandom = createInvestSdkTransport(
      createConfig(createFetchScript([new TypeError('offline')]).fetch, {
        random: () => 1,
        retry: { maxRetries: 1, delayMs: 1, jitterRatio: 0.5 },
      }),
    ).createServiceClient('torque');
    await expect(invalidRandom.get('/random-failure')).rejects.toMatchObject({
      name: 'SdkConfigurationError',
      code: 'SDK_RANDOM_INVALID',
    });
  });

  it.each([
    ['response', { onResponse: () => new Promise<void>(() => undefined) }, 200],
    ['error', { onError: () => new Promise<void>(() => undefined) }, 500],
  ] as const)('gives timeout precedence over a pending %s hook', async (_phase, hooks, status) => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        status === 200
          ? jsonResponse({ ok: true })
          : jsonResponse({ message: 'failed' }, { status }),
      );
    const client = createInvestSdkTransport(
      createConfig(fetchImplementation, { timeoutMs: 5, hooks }),
    ).createServiceClient('torque');

    await expect(client.get('/pending-hook')).rejects.toBeInstanceOf(SdkTimeoutError);
  });
});

describe('canonical request type contract', () => {
  it('[contract:response-types] requires validation for caller-selected DTOs', () => {
    const assertResponseTypes = (client: SdkServiceClient) => {
      const automatic = client.get('/automatic');
      const json = client.get('/json', { responseMode: 'json' });
      const text = client.get('/text', { responseMode: 'text' });
      const blob = client.get('/blob', { responseMode: 'blob' });
      const bytes = client.get('/bytes', { responseMode: 'arrayBuffer' });
      const directText = client.request({
        method: 'GET',
        path: '/direct-text',
        responseMode: 'text',
      });
      const validated = client.get('/validated', {
        responseValidator: (value) => {
          if (
            typeof value !== 'object' ||
            value === null ||
            !('id' in value) ||
            typeof value.id !== 'number'
          ) {
            throw new TypeError('Invalid response.');
          }
          return { id: value.id };
        },
      });

      expectTypeOf(automatic).toEqualTypeOf<Promise<SdkResult<unknown>>>();
      expectTypeOf(json).toEqualTypeOf<Promise<SdkResult<unknown>>>();
      expectTypeOf(text).toEqualTypeOf<Promise<SdkResult<string>>>();
      expectTypeOf(blob).toEqualTypeOf<Promise<SdkResult<Blob>>>();
      expectTypeOf(bytes).toEqualTypeOf<Promise<SdkResult<ArrayBuffer>>>();
      expectTypeOf(directText).toEqualTypeOf<Promise<SdkResult<string>>>();
      expectTypeOf(validated).toEqualTypeOf<Promise<SdkResult<{ id: number }>>>();

      // @ts-expect-error Raw JSON cannot become a caller-selected DTO without a validator.
      void client.request<{ id: number }>({ method: 'GET', path: '/unsafe' });
      // @ts-expect-error GET cannot become a caller-selected DTO without a validator.
      void client.get<{ id: number }>('/unsafe');
      // @ts-expect-error OPTIONS cannot become a caller-selected DTO without a validator.
      void client.options<{ id: number }>('/unsafe');
      // @ts-expect-error POST cannot become a caller-selected DTO without a validator.
      void client.post<{ id: number }>('/unsafe', {});
      // @ts-expect-error PUT cannot become a caller-selected DTO without a validator.
      void client.put<{ id: number }>('/unsafe', {});
      // @ts-expect-error PATCH cannot become a caller-selected DTO without a validator.
      void client.patch<{ id: number }>('/unsafe', {});
      // @ts-expect-error DELETE cannot become a caller-selected DTO without a validator.
      void client.delete<{ id: number }>('/unsafe');
      // @ts-expect-error Response-mode inference must not be overridden with a generic.
      void client.get<string>('/unsafe-text', { responseMode: 'text' });
      // @ts-expect-error A parser-mode generic requires the matching runtime response mode.
      void client.get<'text'>('/unsafe-mode');
      // @ts-expect-error Direct parser-mode generics require the matching runtime response mode.
      void client.request<'arrayBuffer'>({ method: 'GET', path: '/unsafe-mode' });
      void client.get('/unsafe-validator', {
        // @ts-expect-error Runtime validators must return synchronously.
        responseValidator: async () => {
          await Promise.resolve();
          return { id: 1 };
        },
      });
      void client.get<object>('/unsafe-object-validator', {
        // @ts-expect-error Broad object typing must not hide an asynchronous validator.
        responseValidator: async () => {
          await Promise.resolve();
          return { id: 1 };
        },
      });
    };

    expect(assertResponseTypes).toBeTypeOf('function');
  });

  it('[contract:ignored-request-init] excludes inherited RequestInit policy fields', () => {
    const request: SdkRequestInput = { method: 'GET', path: '/typed' };
    const forbiddenFields: (keyof RequestInit)[] = [
      'cache',
      'integrity',
      'keepalive',
      'mode',
      'priority',
      'redirect',
      'referrer',
      'referrerPolicy',
      'window',
    ];

    // @ts-expect-error redirect policy is transport-owned and not caller-configurable.
    const invalidRequest: SdkRequestInput = { method: 'GET', path: '/typed', redirect: 'follow' };

    expect(forbiddenFields.every((field) => !(field in request))).toBe(true);
    expect((invalidRequest as unknown as { redirect: string }).redirect).toBe('follow');
  });
});

describe('sanitizeErrorDetails', () => {
  it('recursively removes secret fields, executable markup, and oversized material', () => {
    const sanitized = sanitizeErrorDetails({
      token: 'secret',
      safe: 'value',
      password: ['Password must contain a number.'],
      attributes: { name: 'totp_code', value: '<script>secret()</script>' },
      long: 'a'.repeat(600),
    });

    expect(sanitized).toMatchObject({
      safe: ['value'],
      password: ['Password must contain a number.'],
      attributes: { name: 'totp_code' },
    });
    expect(JSON.stringify(sanitized)).not.toContain('secret()');
    expect(JSON.stringify(sanitized)).not.toContain('csrf_token');
    expect(JSON.stringify(sanitized)).not.toContain('"token"');
    expect((sanitized as { long: string }).long.length).toBeLessThan(600);
  });

  it('preserves bounded scalar messages for the two reviewed password-validation fields', () => {
    expect(
      sanitizeErrorDetails({
        create_password: 'Password is too weak',
        repeat_password: 'Passwords do not match',
        password: 'actual-submitted-secret',
      }),
    ).toEqual({
      create_password: 'Password is too weak',
      repeat_password: 'Passwords do not match',
    });
  });

  it('handles primitives, unsupported values, unknown objects, and unsafe attributes', () => {
    expect(sanitizeErrorDetails(null)).toBeNull();
    expect(sanitizeErrorDetails(true)).toBe(true);
    expect(sanitizeErrorDetails(() => undefined)).toBeUndefined();
    expect(sanitizeErrorDetails({ attributes: { value: 'secret' } })).toEqual({ attributes: {} });

    expect(sanitizeErrorDetails({ nested: { arbitrary: 'value' } })).toEqual({});
  });

  it('redacts embedded credentials and strips query secrets from redirect values', () => {
    const sanitized = sanitizeErrorDetails(
      {
        message:
          'Authorization: Bearer auth-secret; X-API-Key=app-secret, Cookie: sid=cookie-secret',
        redirect_to: 'https://identity.example.test/login?token=query-secret#fragment',
        return_url: '/continue?csrf_token=csrf-secret',
      },
      { allowedRedirectOrigins: new Set(['https://identity.example.test']) },
    );
    const serialized = JSON.stringify(sanitized);

    expect(serialized).not.toContain('auth-secret');
    expect(serialized).not.toContain('app-secret');
    expect(serialized).not.toContain('cookie-secret');
    expect(serialized).not.toContain('query-secret');
    expect(serialized).not.toContain('csrf-secret');
    expect(sanitized).toMatchObject({
      redirect_to: 'https://identity.example.test/login',
      return_url: '/continue',
    });
  });

  it('retains only reviewed Ory navigation query fields on approved redirects', () => {
    const sanitized = sanitizeErrorDetails(
      {
        redirect_browser_to:
          'https://identity.example.test/settings?aal=aal2&flow=123e4567-e89b-42d3-a456-426614174000&refresh=true&token=secret#fragment',
      },
      { allowedRedirectOrigins: new Set(['https://identity.example.test']) },
    );

    expect(sanitized).toEqual({
      redirect_browser_to:
        'https://identity.example.test/settings?aal=aal2&flow=123e4567-e89b-42d3-a456-426614174000&refresh=true',
    });
  });

  it('rejects unapproved absolute redirects and redacts unlabeled JWT-like tokens', () => {
    const sanitized = sanitizeErrorDetails(
      {
        message: 'opaque eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signaturevalue leaked',
        redirect_browser_to: 'https://evil.example/phish?token=secret',
      },
      { allowedRedirectOrigins: new Set(['https://identity.example.test']) },
    );
    const serialized = JSON.stringify(sanitized);

    expect(serialized).not.toContain('eyJhbGci');
    expect(serialized).not.toContain('evil.example');
    expect(sanitized).toEqual({ message: 'opaque [redacted token] leaked' });
  });

  it('preserves URL-named fields as validation messages rather than redirects', () => {
    expect(
      sanitizeErrorDetails({
        website_url: 'Enter a valid URL.',
        incorporation_location: ['Select a jurisdiction.'],
      }),
    ).toEqual({
      website_url: ['Enter a valid URL.'],
      incorporation_location: ['Select a jurisdiction.'],
    });
  });

  it('allowlists Ory error identities, messages, and safe node discriminators', () => {
    const sanitized = sanitizeErrorDetails({
      error: {
        id: 'session_aal2_required',
        code: 401,
        status: 'Unauthorized',
        message: 'Session needs AAL2',
        debug: 'must-not-survive',
      },
      ui: {
        messages: [{ id: 4000006, type: 'error', text: 'Invalid credentials', context: 'private' }],
        nodes: [
          {
            attributes: { name: 'totp_code', value: '123456', type: 'text' },
            messages: [{ id: 1, type: 'error', text: 'Invalid code' }],
            meta: 'private',
          },
        ],
        action: 'https://identity.example.test/submit?csrf_token=secret',
      },
      unexpected: { nested: 'private' },
    });

    expect(sanitized).toEqual({
      error: {
        id: 'session_aal2_required',
        code: 401,
        status: 'Unauthorized',
        message: 'Session needs AAL2',
      },
      ui: {
        messages: [{ id: 4000006, type: 'error', text: 'Invalid credentials' }],
        nodes: [
          {
            attributes: { name: 'totp_code' },
            messages: [{ id: 1, type: 'error', text: 'Invalid code' }],
          },
        ],
      },
    });
    expect(JSON.stringify(sanitized)).not.toContain('123456');
    expect(JSON.stringify(sanitized)).not.toContain('csrf_token');
  });
});
