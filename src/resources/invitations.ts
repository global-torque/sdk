import type { SdkContractResponseValidator, SdkResult, SdkServiceClient } from '../types.js';
import {
  invitationAcceptRequestSchema,
  invitationCodeSchema,
  invitationListResponseSchema,
  invitationManagerContextSchema,
  invitationPreviewResponseSchema,
  invitationResponseSchema,
  investorInvitationAcceptResponseSchema,
  investorInvitationCreateSchema,
  teamInvitationAcceptResponseSchema,
  teamInvitationCreateSchema,
  type AcceptedInvestor,
  type InvitationAcceptRequest,
  type InvitationCode,
  type InvitationListResponse,
  type InvitationManagerCapability,
  type InvitationManagerContext,
  type InvitationPreviewResponse,
  type InvitationResponse,
  type InvestorInvitationAcceptResponse,
  type InvestorInvitationCreate,
  type TeamInvitationAcceptResponse,
  type TeamInvitationCreate,
  type TeamInvitationMember,
} from './generated/contracts.js';
import {
  boundedInteger,
  mutationRequest,
  optionalString,
  type MutationResourceRequestOptions,
  type ResourceRequestOptions,
} from './helpers.js';
import { compileRequestValidator, compileResponseValidator } from './validation.js';

/** @public */
export type InvitationStatus = 'pending' | 'accepted' | 'expired' | 'cancelled';
/** @public */
export type InvitationAcceptResponse =
  TeamInvitationAcceptResponse | InvestorInvitationAcceptResponse;
/** @public */
export interface ListInvitationsInput {
  limit?: number;
  offset?: number;
  search?: string;
  status?: InvitationStatus;
  request?: ResourceRequestOptions;
}
/** @public */
export interface CreateInvestorInvitationInput {
  body: InvestorInvitationCreate;
  request?: MutationResourceRequestOptions;
}
/** @public */
export interface CreateTeamInvitationInput {
  body: TeamInvitationCreate;
  request?: MutationResourceRequestOptions;
}
/** @public */
export interface InvitationIdentityInput {
  id: string;
  request?: MutationResourceRequestOptions;
}
/** @public */
export interface PreviewInvitationInput {
  body: InvitationCode;
  request?: MutationResourceRequestOptions;
}
/** @public */
export interface AcceptInvitationInput {
  body: InvitationAcceptRequest;
  request?: MutationResourceRequestOptions;
}
/** @public */
export interface InvitationsResource {
  listInvestors(input?: ListInvitationsInput): Promise<SdkResult<InvitationListResponse>>;
  createInvestor(input: CreateInvestorInvitationInput): Promise<SdkResult<InvitationResponse>>;
  cancelInvestor(input: InvitationIdentityInput): Promise<SdkResult<InvitationResponse>>;
  resendInvestor(input: InvitationIdentityInput): Promise<SdkResult<InvitationResponse>>;
  listTeam(input?: ListInvitationsInput): Promise<SdkResult<InvitationListResponse>>;
  createTeam(input: CreateTeamInvitationInput): Promise<SdkResult<InvitationResponse>>;
  cancelTeam(input: InvitationIdentityInput): Promise<SdkResult<InvitationResponse>>;
  resendTeam(input: InvitationIdentityInput): Promise<SdkResult<InvitationResponse>>;
  getManagerContext(request?: ResourceRequestOptions): Promise<SdkResult<InvitationManagerContext>>;
  preview(input: PreviewInvitationInput): Promise<SdkResult<InvitationPreviewResponse>>;
  accept(input: AcceptInvitationInput): Promise<SdkResult<InvitationAcceptResponse>>;
}

/** @public */
export const validateInvitationResponse = compileResponseValidator<InvitationResponse>(
  invitationResponseSchema,
  'InvitationResponse',
  (value) => value as InvitationResponse,
);
/** @public */
export const validateInvitationListResponse = compileResponseValidator<InvitationListResponse>(
  invitationListResponseSchema,
  'InvitationListResponse',
  (value) => value as InvitationListResponse,
);
/** @public */
export const validateInvitationManagerContext = compileResponseValidator<InvitationManagerContext>(
  invitationManagerContextSchema,
  'InvitationManagerContext',
  (value) => value as InvitationManagerContext,
);
/** @public */
export const validateInvitationPreviewResponse =
  compileResponseValidator<InvitationPreviewResponse>(
    invitationPreviewResponseSchema,
    'InvitationPreviewResponse',
    (value) => value as InvitationPreviewResponse,
  );
/** @public */
export const validateTeamInvitationAcceptResponse =
  compileResponseValidator<TeamInvitationAcceptResponse>(
    teamInvitationAcceptResponseSchema,
    'TeamInvitationAcceptResponse',
    (value) => value as TeamInvitationAcceptResponse,
  );
/** @public */
export const validateInvestorInvitationAcceptResponse =
  compileResponseValidator<InvestorInvitationAcceptResponse>(
    investorInvitationAcceptResponseSchema,
    'InvestorInvitationAcceptResponse',
    (value) => value as InvestorInvitationAcceptResponse,
  );
const compatibleInvitationAcceptResponse = (value: unknown) => {
  try {
    return validateTeamInvitationAcceptResponse(value);
  } catch {
    return validateInvestorInvitationAcceptResponse(value);
  }
};
const exactInvitationAcceptResponse = (value: unknown) => {
  try {
    return validateTeamInvitationAcceptResponse.exact(value);
  } catch {
    return validateInvestorInvitationAcceptResponse.exact(value);
  }
};
/** @public */
export const validateInvitationAcceptResponse = Object.defineProperty(
  compatibleInvitationAcceptResponse,
  'exact',
  {
    configurable: false,
    enumerable: false,
    value: exactInvitationAcceptResponse,
    writable: false,
  },
) as SdkContractResponseValidator<InvitationAcceptResponse>;
const investorCreateValidator = compileRequestValidator<InvestorInvitationCreate>(
  investorInvitationCreateSchema,
  'InvestorInvitationCreate',
  (value) => value as InvestorInvitationCreate,
);
const teamCreateValidator = compileRequestValidator<TeamInvitationCreate>(
  teamInvitationCreateSchema,
  'TeamInvitationCreate',
  (value) => value as TeamInvitationCreate,
);
const previewRequestValidator = compileRequestValidator<InvitationCode>(
  invitationCodeSchema,
  'InvitationCode',
  (value) => value as InvitationCode,
);
const acceptRequestValidator = compileRequestValidator<InvitationAcceptRequest>(
  invitationAcceptRequestSchema,
  'InvitationAcceptRequest',
  (value) => value as InvitationAcceptRequest,
);

const invitationIdPath = (id: string) => {
  if (typeof id !== 'string' || !/^invite-[1-9][0-9]*$/u.test(id))
    throw new TypeError('id must be an invitation identifier.');
  return encodeURIComponent(id);
};
const invitationStatuses: readonly InvitationStatus[] = Object.freeze([
  'pending',
  'accepted',
  'expired',
  'cancelled',
]);
const invitationStatus = (status: InvitationStatus | undefined) => {
  if (status !== undefined && !invitationStatuses.includes(status))
    throw new TypeError('status is not supported by the pinned contract.');
  return status;
};
const listQuery = (input: ListInvitationsInput) => ({
  limit: boundedInteger(input.limit, 'limit', Number.MIN_SAFE_INTEGER),
  offset: boundedInteger(input.offset, 'offset', Number.MIN_SAFE_INTEGER),
  search: optionalString(input.search, 'search'),
  status: invitationStatus(input.status),
});
/** Create invitation operations over a configured user-invitations service client. @public */
export const createInvitationsResource = (client: SdkServiceClient): InvitationsResource =>
  Object.freeze<InvitationsResource>({
    listInvestors: (input = {}) =>
      client.get<InvitationListResponse>('/auth/investors/invitations', {
        ...input.request,
        operationId: 'InvestorInvitationList',
        query: listQuery(input),
        responseMode: 'json',
        responseValidator: validateInvitationListResponse,
      }),
    createInvestor: (input) =>
      client.post('/auth/investors/invitations', investorCreateValidator(input.body), {
        ...mutationRequest(input.request),
        operationId: 'InvestorInvitationCreate',
        responseMode: 'json',
        responseValidator: validateInvitationResponse,
      }),
    cancelInvestor: (input) =>
      client.delete(`/auth/investors/invitations/${invitationIdPath(input.id)}`, undefined, {
        ...mutationRequest(input.request),
        operationId: 'InvestorInvitationCancel',
        responseMode: 'json',
        responseValidator: validateInvitationResponse,
      }),
    resendInvestor: (input) =>
      client.post(`/auth/investors/invitations/${invitationIdPath(input.id)}/resend`, undefined, {
        ...mutationRequest(input.request),
        operationId: 'InvestorInvitationResend',
        responseMode: 'json',
        responseValidator: validateInvitationResponse,
      }),
    listTeam: (input = {}) =>
      client.get<InvitationListResponse>('/auth/organization/invitations', {
        ...input.request,
        operationId: 'TeamInvitationList',
        query: listQuery(input),
        responseMode: 'json',
        responseValidator: validateInvitationListResponse,
      }),
    createTeam: (input) =>
      client.post('/auth/organization/invitations', teamCreateValidator(input.body), {
        ...mutationRequest(input.request),
        operationId: 'TeamInvitationCreate',
        responseMode: 'json',
        responseValidator: validateInvitationResponse,
      }),
    cancelTeam: (input) =>
      client.delete(`/auth/organization/invitations/${invitationIdPath(input.id)}`, undefined, {
        ...mutationRequest(input.request),
        operationId: 'TeamInvitationCancel',
        responseMode: 'json',
        responseValidator: validateInvitationResponse,
      }),
    resendTeam: (input) =>
      client.post(
        `/auth/organization/invitations/${invitationIdPath(input.id)}/resend`,
        undefined,
        {
          ...mutationRequest(input.request),
          operationId: 'TeamInvitationResend',
          responseMode: 'json',
          responseValidator: validateInvitationResponse,
        },
      ),
    getManagerContext: (request) =>
      client.get<InvitationManagerContext>('/auth/invitations/manager-context', {
        ...request,
        operationId: 'InvitationManagerContext',
        responseMode: 'json',
        responseValidator: validateInvitationManagerContext,
      }),
    preview: (input) =>
      client.post('/public/invitations/preview', previewRequestValidator(input.body), {
        ...mutationRequest(input.request),
        operationId: 'InvitationPreview',
        responseMode: 'json',
        responseValidator: validateInvitationPreviewResponse,
      }),
    accept: (input) =>
      client.post('/auth/invitations/accept', acceptRequestValidator(input.body), {
        ...mutationRequest(input.request),
        operationId: 'InvitationAccept',
        responseMode: 'json',
        responseValidator: validateInvitationAcceptResponse,
      }),
  });

export type {
  AcceptedInvestor,
  InvitationAcceptRequest,
  InvitationCode,
  InvitationListResponse,
  InvitationManagerCapability,
  InvitationManagerContext,
  InvitationPreviewResponse,
  InvitationResponse,
  InvestorInvitationAcceptResponse,
  InvestorInvitationCreate,
  TeamInvitationAcceptResponse,
  TeamInvitationCreate,
  TeamInvitationMember,
};
export type { MutationResourceRequestOptions, ResourceRequestOptions } from './helpers.js';
