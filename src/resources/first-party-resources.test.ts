import { describe, expect, it } from 'vitest';
import { cookieAuth } from '../auth.js';
import { createInvestSdkTransport } from '../client.js';
import { SdkHttpError, SdkResponseValidationError } from '../errors.js';
import { createFetchScript, jsonResponse } from '../testing.js';
import { createDistributionsResource } from './distributions.js';
import { createFilerResource } from './filer.js';
import { createFormsResource } from './forms.js';
import { createFundManagerResource } from './fund-manager.js';
import { createInvitationsResource } from './invitations.js';
import { createProfilesResource, validateIndividualProfileResponse } from './profiles.js';
import { createUsersResource } from './users.js';

const setup = (service: string, responses: readonly Response[]) => {
  const script = createFetchScript(responses);
  const routes: string[] = [];
  const transport = createInvestSdkTransport({
    apiKey: 'synthetic-resource-key',
    createRequestId: () => 'first-party-resource-request',
    fetch: script.fetch,
    hooks: {
      onRequest: ({ route }) => {
        routes.push(route);
      },
    },
    services: {
      [service]: {
        baseUrl: `https://${service}.example.test/v1.0/`,
        ...(service === 'forms'
          ? { applicationAuth: 'none' as const, auth: { kind: 'none' as const } }
          : service === 'invitations'
            ? {
                applicationAuth: 'none' as const,
                auth: cookieAuth({ credentials: 'include' }),
                retry: { maxRetries: 2, delayMs: 0 },
              }
            : {}),
      },
      [`${service}-downloads`]: {
        baseUrl: `https://${service}.example.test/v1.0/`,
        applicationAuth: 'none',
        auth: { kind: 'none', credentials: 'omit' },
        redirectPolicy: 'follow',
      },
    },
  });
  return {
    client: transport.createServiceClient(service),
    downloadClient: transport.createKeylessServiceClient(`${service}-downloads`),
    requests: script.requests,
    routes,
    transport,
  };
};

describe('first-party contract resources', () => {
  it('executes distribution reads against the profile-scoped contract', async () => {
    const context = setup('distributions', [
      jsonResponse({ count: 0, data: [] }),
      jsonResponse({ counter: 1 }),
    ]);
    const resource = createDistributionsResource(context.client);
    const result = await resource.list({ profileId: 41 });
    expect((await resource.create({ profileId: 41 })).data.counter).toBe(1);
    expect(result.data.count).toBe(0);
    expect(context.requests[0]?.url).toBe(
      'https://distributions.example.test/v1.0/auth/41/distribution',
    );
    expect(context.routes).toEqual(['getDistributions', 'createDistribution']);
    context.transport.dispose();
  });

  it('validates flexible form submissions before sending them', async () => {
    const context = setup('forms', [jsonResponse({ id: 7 }, { status: 201 })]);
    const resource = createFormsResource(context.client);
    expect(() => resource.createIncomingRequest({ body: { email: 'x' } })).toThrow(
      'IncomingRequestCreate request',
    );
    expect(context.requests).toHaveLength(0);
    const result = await resource.createIncomingRequest({
      body: { email: 'person@example.test', campaign: 'alpha' },
    });
    expect(result.data.id).toBe(7);
    expect(context.requests[0]?.method).toBe('POST');
    context.transport.dispose();
  });

  it('validates the complete fund-manager admin projection', async () => {
    const adminData = {
      apiGaps: [],
      auditLogs: [],
      capacityRecords: [],
      currentMember: null,
      disabledCommands: [],
      formTemplates: [],
      funds: [],
      generatedAt: '2026-08-09T00:00:00Z',
      investors: [],
      notifications: [],
      onboardingSubmissions: [],
      organization: {},
      permissions: [],
      recentLedger: [],
      source: 'webdevelop-api',
      teamMembers: [],
    };
    const context = setup('fund-manager', [jsonResponse(adminData)]);
    const resource = createFundManagerResource(context.client);
    expect(() => resource.getAdminData({ dateFrom: 'not-a-date' })).toThrow(
      'dateFrom must be an ISO 8601 date-time',
    );
    const result = await resource.getAdminData({
      limit: 25,
      recordType: 'fund',
    });
    expect(result.data.source).toBe('webdevelop-api');
    expect(context.requests[0]?.url).toBe(
      'https://fund-manager.example.test/v1.0/auth/admin-data?limit=25&recordType=fund',
    );
    context.transport.dispose();
  });

  it('keeps filer uploads and catch-all object paths contract-bound', async () => {
    const context = setup('filer', [
      jsonResponse({ id: 5, type: 'folder' }, { status: 201 }),
      jsonResponse({ entities: {} }),
    ]);
    expect(() =>
      createFilerResource(context.client, {
        signedDownloadClient: context.client as never,
        publicDownloadClient: context.client as never,
      }),
    ).toThrow('transport-verified keyless clients');
    const [proofSymbol] = Object.getOwnPropertySymbols(context.downloadClient);
    const reflectedProof = proofSymbol
      ? (context.downloadClient as unknown as Record<PropertyKey, unknown>)[proofSymbol]
      : undefined;
    const forgedClient = {
      ...context.client,
      ...(proofSymbol ? { [proofSymbol]: reflectedProof } : {}),
    };
    expect(() =>
      createFilerResource(context.client, {
        signedDownloadClient: forgedClient as never,
        publicDownloadClient: forgedClient as never,
      }),
    ).toThrow('transport-verified keyless clients');
    const resource = createFilerResource(context.client, {
      signedDownloadClient: context.downloadClient,
      publicDownloadClient: context.downloadClient,
    });
    expect(() => resource.getFileLink({ id: 'not-an-id' as never })).toThrow(
      'id must be a safe integer',
    );
    expect(() =>
      resource.createUploadUrl({
        body: { filename: 'offer.pdf', mime: 'application/pdf', offer_id: 9 },
      }),
    ).toThrow('FilerUploadRequest request');
    expect(context.requests).toHaveLength(0);
    await resource.createOfferFolder({ body: { name: 'Documents', offer_id: 9 } });
    await resource.getAuthenticatedObject({ objectPath: 'offers/9' });
    expect(context.requests.map(({ url }) => url)).toEqual([
      'https://filer.example.test/v1.0/auth/folders',
      'https://filer.example.test/v1.0/auth/objects/offers/9',
    ]);
    context.transport.dispose();
  });

  it('covers every admitted filer file, link, public, upload, and workspace operation', async () => {
    const context = setup('filer', [
      new Response('deleted'),
      jsonResponse({
        id: 5,
        url: 'https://filer.example.test/v1.0/signed/private-file',
      }),
      new Response('private-bytes'),
      jsonResponse({ id: 5 }),
      jsonResponse({ entities: {} }),
      new Response('public-bytes'),
      jsonResponse({ id: 8 }),
      jsonResponse({ url: 'https://upload.example.test' }),
      new Response(null, { status: 204 }),
    ]);
    const resource = createFilerResource(context.client, {
      signedDownloadClient: context.downloadClient,
      publicDownloadClient: context.downloadClient,
    });
    expect((await resource.deleteFile({ id: 5 })).data).toBe('deleted');
    expect(
      (
        await resource.downloadFile({
          id: 5,
          size: 'medium',
          request: { headers: { 'x-caller-context': 'authenticated-only' } },
        })
      ).data,
    ).toBeInstanceOf(Blob);
    expect(context.requests[1]?.url).toBe(
      'https://filer.example.test/v1.0/auth/files/5/link?size=medium',
    );
    expect(context.requests[1]?.headers.get('x-api-key')).toBe('synthetic-resource-key');
    expect(context.requests[2]?.headers.has('x-api-key')).toBe(false);
    expect(context.requests[2]?.headers.has('authorization')).toBe(false);
    expect(context.requests[2]?.headers.has('x-caller-context')).toBe(false);
    expect((await resource.getFileLink({ id: 5 })).data.id).toBe(5);
    expect((await resource.getMyObjects()).data.entities).toEqual({});
    expect((await resource.downloadPublicFile({ id: 8 })).data).toBeInstanceOf(Blob);
    expect(context.requests[5]?.headers.has('x-api-key')).toBe(false);
    expect((await resource.getPublicObject({ objectPath: 'offers/8' })).data.id).toBe(8);
    expect(
      (await resource.createUploadUrl({ body: { filename: 'note.txt', mime: 'text/plain' } })).data
        .url,
    ).toContain('upload');
    expect(
      (await resource.provisionWorkspace({ body: { object_id: 8, object_type: 'offer' } })).status,
    ).toBe(204);
    context.transport.dispose();
  });

  it('uses explicit anonymous OPTIONS operations for user and profile schemas', async () => {
    const userContext = setup('profiles', [
      jsonResponse({ type: 'object' }),
      jsonResponse({ image_link_id: null }),
    ]);
    const users = createUsersResource(userContext.client);
    expect((await users.getUpdateSchema()).data).toEqual({ type: 'object' });
    expect((await users.get()).data.image_link_id).toBeNull();
    expect(userContext.requests.map(({ method }) => method)).toEqual(['OPTIONS', 'GET']);
    expect(userContext.requests[0]?.url).toBe(
      'https://profiles.example.test/v1.0/auth/user?schema=1',
    );
    userContext.transport.dispose();

    const profileContext = setup('profiles', [jsonResponse({ type: 'object' })]);
    const profiles = createProfilesResource(profileContext.client);
    expect((await profiles.getUpdateSchema({ type: 'individual', id: 3 })).data.type).toBe(
      'object',
    );
    expect(profileContext.requests[0]?.url).toBe(
      'https://profiles.example.test/v1.0/auth/profile/individual/3?schema=1',
    );
    profileContext.transport.dispose();
  });

  it('covers every admitted profile operation with generated request validation', async () => {
    const individual = {
      address1: '1 Main St',
      city: 'Austin',
      country: 'US' as const,
      dob: '1990-01-01',
      first_name: 'Ada',
      last_name: 'Lovelace',
      phone: '+15125550100',
      ssn: '111223333',
      state: 'TX' as const,
      zip_code: '78701',
    };
    const context = setup('profiles', [
      jsonResponse({ count: 0, data: [] }),
      jsonResponse({ type: 'object' }),
      jsonResponse({ id: 11 }, { status: 201 }),
      jsonResponse({ id: 11, type: 'individual' }),
      jsonResponse({ type: 'object' }),
      jsonResponse({ ...individual, citizenship: 'future-residency-status' }),
    ]);
    const resource = createProfilesResource(context.client);
    expect(() =>
      resource.create({
        type: 'individual',
        body: { ...individual, citizenship: 'future-residency-status' as never },
      }),
    ).toThrow('Individual request');
    expect((await resource.listFundManagerProfiles()).data.count).toBe(0);
    await resource.getCreateSchema({ type: 'individual' });
    expect((await resource.create({ type: 'individual', body: individual })).data.id).toBe(11);
    expect((await resource.get({ type: 'individual', id: 11 })).data.id).toBe(11);
    await resource.getUpdateSchema({ type: 'individual', id: 11 });
    const updated = await resource.update({
      type: 'individual',
      id: 11,
      body: { city: 'Austin' },
    });
    expect(updated.data.first_name).toBe('Ada');
    expect(updated.data.citizenship).toBe('future-residency-status');
    expect(() => validateIndividualProfileResponse.exact(updated.data)).toThrow('exact contract');
    context.transport.dispose();
  });

  it('exposes invitation manager context and rejects malformed identifiers before fetch', async () => {
    const context = setup('invitations', [
      jsonResponse({
        capabilities: {
          investors: { canRead: true, canWrite: true },
          team: { canRead: true, canWrite: false },
        },
      }),
    ]);
    const resource = createInvitationsResource(context.client);
    expect((await resource.getManagerContext()).data.capabilities.team.canWrite).toBe(false);
    expect(context.routes).toEqual(['InvitationManagerContext']);
    expect(context.requests[0]).toMatchObject({
      credentials: 'include',
      method: 'GET',
      url: 'https://invitations.example.test/v1.0/auth/invitations/manager-context',
    });
    expect(context.requests[0]?.headers.has('authorization')).toBe(false);
    expect(context.requests[0]?.headers.has('x-api-key')).toBe(false);
    expect(() => resource.cancelInvestor({ id: '7' })).toThrow(
      'id must be an invitation identifier',
    );
    expect(() => resource.listInvestors({ status: 'other' as never })).toThrow(
      'status is not supported by the pinned contract',
    );
    expect(() => resource.listInvestors({ limit: 1.5 })).toThrow('limit must be a safe integer');
    expect(() =>
      resource.createInvestor({
        body: {
          email: 'invalid-email',
          firstName: 'Ada',
          lastName: 'Lovelace',
          profileType: 'individual',
        },
      }),
    ).toThrow('InvestorInvitationCreate request');
    expect(() => resource.preview({ body: { code: '' } })).toThrow('InvitationCode request');
    expect(() =>
      resource.accept({
        body: { code: 'valid-code', selectedProfileType: 'unsupported' as never },
      }),
    ).toThrow('InvitationAcceptRequest request');
    expect(context.requests).toHaveLength(1);
    context.transport.dispose();
  });

  it('covers investor, team, preview, and acceptance invitation operations', async () => {
    const invitation = {
      acceptedProfileId: null,
      acceptedUserId: null,
      email: 'person@example.test',
      expiresAt: '2026-09-01T00:00:00Z',
      firstName: 'Ada',
      fundId: 'fund-legacy-1',
      fundName: 'Legacy Fund',
      id: 'invite-1',
      invitedBy: 'member-1',
      kind: 'investor',
      lastName: 'Lovelace',
      profileType: 'individual',
      requiresRegistration: true,
      source: 'webdevelop-api',
      status: 'pending',
    };
    const list = { count: 1, data: [invitation], source: 'webdevelop-api' };
    const context = setup('invitations', [
      jsonResponse(list),
      jsonResponse(invitation, { status: 201 }),
      jsonResponse(invitation),
      jsonResponse(invitation),
      jsonResponse(list),
      jsonResponse({ ...invitation, kind: 'team', role: 'Admin' }, { status: 201 }),
      jsonResponse({ ...invitation, kind: 'team', role: 'Admin' }),
      jsonResponse({ ...invitation, kind: 'team', role: 'Admin' }),
      jsonResponse({
        email: invitation.email,
        expiresAt: invitation.expiresAt,
        firstName: 'Ada',
        kind: 'investor',
        lastName: 'Lovelace',
        profileType: 'individual',
      }),
      jsonResponse({
        invitation: { ...invitation, status: 'accepted' },
        investor: { id: 'investor-1', profileType: 'individual' },
        selectedProfileType: 'individual',
        source: 'webdevelop-api',
      }),
      jsonResponse({
        invitation: { ...invitation, kind: 'team', role: 'Admin', status: 'accepted' },
        member: {
          email: invitation.email,
          firstName: invitation.firstName,
          id: 'user-1',
          lastName: invitation.lastName,
          permissions: ['funds:read'],
          role: 'Admin',
          status: 'active',
        },
        source: 'webdevelop-api',
      }),
    ]);
    const resource = createInvitationsResource(context.client);
    const investorList = await resource.listInvestors({
      limit: 25,
      offset: 0,
      status: 'pending',
    });
    expect(investorList.data.data[0]).toHaveProperty('fundId', 'fund-legacy-1');
    expect(investorList.data.data[0]).toHaveProperty('fundName', 'Legacy Fund');
    await resource.createInvestor({
      body: {
        email: invitation.email,
        firstName: 'Ada',
        lastName: 'Lovelace',
        profileType: 'individual',
      },
    });
    await resource.cancelInvestor({ id: 'invite-1' });
    await resource.resendInvestor({ id: 'invite-1' });
    await resource.listTeam({ search: 'Ada' });
    await resource.createTeam({ body: { email: invitation.email, role: 'Admin' } });
    await resource.cancelTeam({ id: 'invite-1' });
    await resource.resendTeam({ id: 'invite-1' });
    expect((await resource.preview({ body: { code: 'preview-code' } })).data.kind).toBe('investor');
    expect(
      (await resource.accept({ body: { code: 'accept-code', selectedProfileType: 'individual' } }))
        .data.source,
    ).toBe('webdevelop-api');
    expect((await resource.accept({ body: { code: 'team-code' } })).data).toMatchObject({
      member: { id: 'user-1', status: 'active' },
    });
    expect(context.requests.map(({ method, url }) => ({ method, url }))).toEqual([
      {
        method: 'GET',
        url: 'https://invitations.example.test/v1.0/auth/investors/invitations?limit=25&offset=0&status=pending',
      },
      { method: 'POST', url: 'https://invitations.example.test/v1.0/auth/investors/invitations' },
      {
        method: 'DELETE',
        url: 'https://invitations.example.test/v1.0/auth/investors/invitations/invite-1',
      },
      {
        method: 'POST',
        url: 'https://invitations.example.test/v1.0/auth/investors/invitations/invite-1/resend',
      },
      {
        method: 'GET',
        url: 'https://invitations.example.test/v1.0/auth/organization/invitations?search=Ada',
      },
      {
        method: 'POST',
        url: 'https://invitations.example.test/v1.0/auth/organization/invitations',
      },
      {
        method: 'DELETE',
        url: 'https://invitations.example.test/v1.0/auth/organization/invitations/invite-1',
      },
      {
        method: 'POST',
        url: 'https://invitations.example.test/v1.0/auth/organization/invitations/invite-1/resend',
      },
      { method: 'POST', url: 'https://invitations.example.test/v1.0/public/invitations/preview' },
      { method: 'POST', url: 'https://invitations.example.test/v1.0/auth/invitations/accept' },
      { method: 'POST', url: 'https://invitations.example.test/v1.0/auth/invitations/accept' },
    ]);
    expect(context.routes).toEqual([
      'InvestorInvitationList',
      'InvestorInvitationCreate',
      'InvestorInvitationCancel',
      'InvestorInvitationResend',
      'TeamInvitationList',
      'TeamInvitationCreate',
      'TeamInvitationCancel',
      'TeamInvitationResend',
      'InvitationPreview',
      'InvitationAccept',
      'InvitationAccept',
    ]);
    expect(
      context.requests
        .slice(1)
        .map(({ body }): unknown =>
          typeof body === 'string' ? (JSON.parse(body) as unknown) : body,
        ),
    ).toEqual([
      {
        email: invitation.email,
        firstName: 'Ada',
        lastName: 'Lovelace',
        profileType: 'individual',
      },
      undefined,
      undefined,
      undefined,
      { email: invitation.email, role: 'Admin' },
      undefined,
      undefined,
      { code: 'preview-code' },
      { code: 'accept-code', selectedProfileType: 'individual' },
      { code: 'team-code' },
    ]);
    for (const request of context.requests) {
      expect(request.credentials).toBe('include');
      expect(request.headers.has('authorization')).toBe(false);
      expect(request.headers.has('x-api-key')).toBe(false);
    }
    context.transport.dispose();
  });

  it('rejects malformed invitation responses before returning them', async () => {
    const context = setup('invitations', [jsonResponse({ data: [] })]);

    await expect(createInvitationsResource(context.client).listInvestors()).rejects.toBeInstanceOf(
      SdkResponseValidationError,
    );
    context.transport.dispose();
  });

  it('preserves structured invitation HTTP bodies and never retries mutations', async () => {
    const context = setup('invitations', [
      jsonResponse({ email: ['An invitation already exists.'] }, { status: 409 }),
      jsonResponse({ unreachable: true }, { status: 201 }),
    ]);
    const error = await createInvitationsResource(context.client)
      .createTeam({
        body: { email: 'person@example.test', role: 'Admin' },
        request: { retry: { maxRetries: 2 } },
      })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(SdkHttpError);
    expect(error).toMatchObject({ bodyKind: 'json', status: 409 });
    expect((error as SdkHttpError).responseBody).toEqual({
      email: ['An invitation already exists.'],
    });
    expect(context.requests).toHaveLength(1);
    context.transport.dispose();
  });

  it('never retries any invitation write when the service returns a retryable failure', async () => {
    const unavailable = () =>
      jsonResponse({ __error__: ['Invitation service unavailable.'] }, { status: 503 });
    const context = setup('invitations', Array.from({ length: 7 }, unavailable));
    const resource = createInvitationsResource(context.client);
    const mutations = [
      () =>
        resource.createInvestor({
          body: {
            email: 'investor@example.test',
            firstName: 'Invite',
            lastName: 'Recipient',
            profileType: 'entity',
          },
        }),
      () => resource.cancelInvestor({ id: 'invite-1' }),
      () => resource.resendInvestor({ id: 'invite-1' }),
      () =>
        resource.createTeam({
          body: { email: 'team@example.test', role: 'Ops' },
        }),
      () => resource.cancelTeam({ id: 'invite-2' }),
      () => resource.resendTeam({ id: 'invite-2' }),
      () => resource.accept({ body: { code: 'accept-code' } }),
    ];

    for (const mutate of mutations) {
      await expect(mutate()).rejects.toMatchObject({ status: 503 });
    }

    expect(context.requests).toHaveLength(mutations.length);
    expect(context.routes).toEqual([
      'InvestorInvitationCreate',
      'InvestorInvitationCancel',
      'InvestorInvitationResend',
      'TeamInvitationCreate',
      'TeamInvitationCancel',
      'TeamInvitationResend',
      'InvitationAccept',
    ]);
    context.transport.dispose();
  });

  it('validates user updates synchronously', async () => {
    const context = setup('profiles', [jsonResponse({ first_name: 'Ada', image_link_id: null })]);
    const result = await createUsersResource(context.client).update({
      body: { first_name: 'Ada' },
    });
    expect(result.data.first_name).toBe('Ada');
    context.transport.dispose();
  });

  it('sanitizes first-party response drift at the transport boundary', async () => {
    const context = setup('profiles', [jsonResponse({ secret: 'must-not-leak' })]);
    const error = await createUsersResource(context.client)
      .get()
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(SdkResponseValidationError);
    expect(JSON.stringify(error)).not.toContain('must-not-leak');
    context.transport.dispose();
  });
});
