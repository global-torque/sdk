import type { SdkResult, SdkServiceClient } from '../types.js';
import {
  fundManagerProfileListResponseSchema,
  individualProfileCreateSchema,
  jsonSchemaDocumentSchema,
  objectIdResponseSchema,
  partialIndividualProfileSchema,
  profileRetrieveResponseSchema,
  type FundManagerProfile,
  type FundManagerProfileListResponse,
  type AccreditedInvestor,
  type AccreditedInvestorRequestInput,
  type EmploymentTypes,
  type EmploymentTypesRequestInput,
  type FINRAAffiliated,
  type FINRAAffiliatedRequestInput,
  type Individual,
  type IndividualProfileCreateRequest,
  type IndividualProfileUpdateRequest,
  type InvestmentObjectives,
  type InvestmentObjectivesRequestInput,
  type JsonSchemaDocument,
  type ObjectIdResponse,
  type PersonalInformation,
  type PersonalInformationRequestInput,
  type PartialIndividual,
  type ProfileRetrieveResponse,
  type RegCF,
  type RegCFRequestInput,
  type TenPercentShareholder,
  type TenPercentShareholderRequestInput,
} from './generated/contracts.js';
import {
  mutationRequest,
  pathSegment,
  positiveInteger,
  type MutationResourceRequestOptions,
  type ResourceRequestOptions,
} from './helpers.js';
import { compileRequestValidator, compileResponseValidator } from './validation.js';

/** @public */
export type ProfileType = 'individual' | 'entity' | 'trust' | 'sdira' | 'solo401k';
/** @public */
export interface ProfileTypeInput {
  type: ProfileType;
  request?: ResourceRequestOptions;
}
/** @public */
export interface ProfileIdentityInput extends ProfileTypeInput {
  id: number;
}
/** @public */
export interface CreateProfileInput {
  type: ProfileType;
  body: IndividualProfileCreateRequest;
  request?: MutationResourceRequestOptions;
}
/** @public */
export interface UpdateProfileInput {
  type: ProfileType;
  id: number;
  body: IndividualProfileUpdateRequest;
  request?: MutationResourceRequestOptions;
}
/** @public */
export interface ProfilesResource {
  listFundManagerProfiles(
    request?: ResourceRequestOptions,
  ): Promise<SdkResult<FundManagerProfileListResponse>>;
  getCreateSchema(input: ProfileTypeInput): Promise<SdkResult<JsonSchemaDocument>>;
  create(input: CreateProfileInput): Promise<SdkResult<ObjectIdResponse>>;
  get(input: ProfileIdentityInput): Promise<SdkResult<ProfileRetrieveResponse>>;
  getUpdateSchema(input: ProfileIdentityInput): Promise<SdkResult<JsonSchemaDocument>>;
  update(input: UpdateProfileInput): Promise<SdkResult<Individual>>;
}

const profileTypes: readonly ProfileType[] = Object.freeze([
  'individual',
  'entity',
  'trust',
  'sdira',
  'solo401k',
]);
const profileTypePath = (type: ProfileType) => {
  if (!profileTypes.includes(type))
    throw new TypeError('type is not supported by the pinned contract.');
  return type;
};
const profilePath = (type: ProfileType, id?: number) =>
  `/auth/profile/${profileTypePath(type)}${
    id === undefined ? '' : `/${pathSegment(positiveInteger(id, 'id'), 'id')}`
  }`;

/** @public */
export const validateProfileJsonSchemaDocument = compileResponseValidator<JsonSchemaDocument>(
  jsonSchemaDocumentSchema,
  'JsonSchemaDocument',
  (value) => value as JsonSchemaDocument,
);
const createRequestValidator = compileRequestValidator<IndividualProfileCreateRequest>(
  individualProfileCreateSchema,
  'Individual',
  (value) => value as IndividualProfileCreateRequest,
);
/** @public */
export const validateProfileCreateResponse = compileResponseValidator<ObjectIdResponse>(
  objectIdResponseSchema,
  'ObjectIdResponse',
  (value) => value as ObjectIdResponse,
);
/** @public */
export const validateProfileRetrieveResponse = compileResponseValidator<ProfileRetrieveResponse>(
  profileRetrieveResponseSchema,
  'ProfileRetrieveResponse',
  (value) => value as ProfileRetrieveResponse,
);
const updateRequestValidator = compileRequestValidator<IndividualProfileUpdateRequest>(
  partialIndividualProfileSchema,
  'PartialIndividual',
  (value) => value as IndividualProfileUpdateRequest,
);
/** @public */
export const validateIndividualProfileResponse = compileResponseValidator<Individual>(
  individualProfileCreateSchema,
  'Individual',
  (value) => value as Individual,
);
/** @public */
export const validateFundManagerProfileListResponse =
  compileResponseValidator<FundManagerProfileListResponse>(
    fundManagerProfileListResponseSchema,
    'FundManagerProfileListResponse',
    (value) => value as FundManagerProfileListResponse,
  );

/** Create investment-profile operations over a configured profiles-service client. @public */
export const createProfilesResource = (client: SdkServiceClient): ProfilesResource =>
  Object.freeze<ProfilesResource>({
    listFundManagerProfiles: (request) =>
      client.get<FundManagerProfileListResponse>('/auth/fund-manager/profiles', {
        ...request,
        operationId: 'FundManagerProfileList',
        responseMode: 'json',
        responseValidator: validateFundManagerProfileListResponse,
      }),
    getCreateSchema: (input) =>
      client.options<JsonSchemaDocument>(profilePath(input.type), {
        ...input.request,
        schema: true,
        operationId: 'ProfileCreateOptions',
        responseMode: 'json',
        responseValidator: validateProfileJsonSchemaDocument,
      }),
    create: (input) =>
      client.post(profilePath(input.type), createRequestValidator(input.body), {
        ...mutationRequest(input.request),
        operationId: 'ProfileCreate',
        responseMode: 'json',
        responseValidator: validateProfileCreateResponse,
      }),
    get: (input) =>
      client.get<ProfileRetrieveResponse>(profilePath(input.type, input.id), {
        ...input.request,
        operationId: 'RetrieveProfile',
        responseMode: 'json',
        responseValidator: validateProfileRetrieveResponse,
      }),
    getUpdateSchema: (input) =>
      client.options<JsonSchemaDocument>(profilePath(input.type, input.id), {
        ...input.request,
        schema: true,
        operationId: 'ProfileUpdateOptions',
        responseMode: 'json',
        responseValidator: validateProfileJsonSchemaDocument,
      }),
    update: (input) =>
      client.patch(profilePath(input.type, input.id), updateRequestValidator(input.body), {
        ...mutationRequest(input.request),
        operationId: 'ProfileUpdate',
        responseMode: 'json',
        responseValidator: validateIndividualProfileResponse,
      }),
  });

export type {
  AccreditedInvestor,
  AccreditedInvestorRequestInput,
  EmploymentTypes,
  EmploymentTypesRequestInput,
  FINRAAffiliated,
  FINRAAffiliatedRequestInput,
  FundManagerProfile,
  FundManagerProfileListResponse,
  Individual,
  IndividualProfileCreateRequest,
  IndividualProfileUpdateRequest,
  InvestmentObjectives,
  InvestmentObjectivesRequestInput,
  JsonSchemaDocument,
  ObjectIdResponse,
  PersonalInformation,
  PersonalInformationRequestInput,
  PartialIndividual,
  ProfileRetrieveResponse,
  RegCF,
  RegCFRequestInput,
  TenPercentShareholder,
  TenPercentShareholderRequestInput,
};
export type { MutationResourceRequestOptions, ResourceRequestOptions } from './helpers.js';
