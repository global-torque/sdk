import { describe, expect, it } from 'vitest';
import { createInvestSdkTransport } from '../client.js';
import { SdkResponseValidationError } from '../errors.js';
import { createFetchScript, jsonResponse } from '../testing.js';
import { createAnalyticsResource } from './analytics.js';
import { createEsignResource } from './esign.js';
import { createNotificationsResource } from './notifications.js';

const setup = (responses: readonly Response[]) => {
  const script = createFetchScript(responses);
  const transport = createInvestSdkTransport({
    apiKey: 'synthetic-service-resource-key',
    createRequestId: () => 'service-resource-request',
    fetch: script.fetch,
    services: {
      analytics: { baseUrl: 'https://analytics.example.test/v1.0/' },
      esign: { baseUrl: 'https://esign.example.test/v1.0/' },
      notifications: { baseUrl: 'https://notifications.example.test/' },
      users: { baseUrl: 'https://users.example.test/v1.0/' },
    },
  });
  return { requests: script.requests, transport };
};

describe('low-level service resources', () => {
  it('validates analytics events and logs without inventing idempotency', async () => {
    const context = setup([
      jsonResponse({ id: 'event-1' }, { status: 201 }),
      jsonResponse({ id: 'log-1' }, { status: 201 }),
    ]);
    const resource = createAnalyticsResource(context.transport.createServiceClient('analytics'));
    expect(() =>
      resource.createLog({
        body: { message: 'failed', time: 'not-a-date' },
      }),
    ).toThrow('AnalyticsLogCreate request');
    expect(context.requests).toHaveLength(0);

    const event = await resource.createEvent({
      body: {
        body: { source: 'navigation' },
        event_type: 'open',
        identity_id: 'identity-1',
        method: 'GET',
        request_path: '/dashboard',
        status_code: 200,
      },
    });
    expect(event.data.id).toBe('event-1');

    const result = await resource.createLog({
      body: {
        caller: ['unified-error-handler'],
        message: 'failed',
        time: '2026-08-09T12:00:00Z',
      },
      request: { idempotencyKey: 'caller-must-not-own-this' } as never,
    });
    expect(result.data.id).toBe('log-1');
    expect(context.requests.map(({ url }) => url)).toEqual([
      'https://analytics.example.test/v1.0/public/event',
      'https://analytics.example.test/v1.0/public/log',
    ]);
    expect(context.requests[1]?.headers.get('idempotency-key')).toBeNull();
    context.transport.dispose();
  });

  it('exports only the documented e-sign document creation operation', async () => {
    const context = setup([
      jsonResponse(
        {
          created_at: '2026-08-09T12:00:00Z',
          entity_id: 'submission-1',
          id: '31',
          token: 'opaque-server-token',
          uuid: '123e4567-e89b-12d3-a456-426614174000',
        },
        { status: 201 },
      ),
    ]);
    const resource = createEsignResource(context.transport.createServiceClient('esign'));
    expect(() => resource.createDocument({ body: { investment_id: 0 } })).toThrow(
      'EsignDocumentCreate request',
    );
    expect(context.requests).toHaveLength(0);
    const result = await resource.createDocument({ body: { investment_id: 45921 } });
    expect(result.data.entity_id).toBe('submission-1');
    expect(context.requests[0]?.url).toBe('https://esign.example.test/v1.0/auth/document');
    expect(Object.keys(resource)).toEqual(['createDocument']);
    context.transport.dispose();
  });

  it('composes notification feed and user-owned device subscription clients', async () => {
    const context = setup([
      jsonResponse([
        {
          content: 'Offer updated',
          created_at: '2026-08-09T12:00:00Z',
          data: { object_id: 7 },
          id: 5,
          status: 'unread',
          type: 'investment',
          updated_at: '2026-08-09T12:00:00Z',
          user_id: 3,
        },
      ]),
      new Response('read'),
      new Response('all-read'),
      jsonResponse({ id: 7, status: 'subscribed' }),
    ]);
    const resource = createNotificationsResource({
      notifications: context.transport.createServiceClient('notifications'),
      users: context.transport.createServiceClient('users'),
    });
    expect((await resource.list()).data[0]?.status).toBe('unread');
    expect((await resource.markRead({ id: 5 })).data).toBe('read');
    expect((await resource.markAllRead()).data).toBe('all-read');
    expect(
      (
        await resource.subscribeDevice({
          body: { device_token: 'fcm-device-token', provider: 'fcm' },
        })
      ).data.status,
    ).toBe('subscribed');
    expect(context.requests.map(({ url }) => url)).toEqual([
      'https://notifications.example.test/notification',
      'https://notifications.example.test/notification/5',
      'https://notifications.example.test/notification/all',
      'https://users.example.test/v1.0/auth/subscribe',
    ]);
    context.transport.dispose();
  });

  it('rejects malformed notification and subscription responses without leaking bodies', async () => {
    const context = setup([jsonResponse('not-a-list'), jsonResponse({ secret: 'must-not-leak' })]);
    const resource = createNotificationsResource({
      notifications: context.transport.createServiceClient('notifications'),
      users: context.transport.createServiceClient('users'),
    });
    const listError = await resource.list().catch((reason: unknown) => reason);
    expect(listError).toBeInstanceOf(SdkResponseValidationError);
    const subscriptionError = await resource
      .subscribeDevice({ body: { device_token: 'fcm-device-token', provider: 'fcm' } })
      .catch((reason: unknown) => reason);
    expect(subscriptionError).toBeInstanceOf(SdkResponseValidationError);
    expect(JSON.stringify(subscriptionError)).not.toContain('must-not-leak');
    context.transport.dispose();
  });
});
