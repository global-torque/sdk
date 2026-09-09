import type { SdkResult, SdkServiceClient } from '../types.js';
import {
  distributionCreateResponseSchema,
  distributionListResponseSchema,
  type Distribution,
  type DistributionT,
  type ResponseCreateDistribution,
  type ResponseGetDistributions,
} from './generated/contracts.js';
import {
  mutationRequest,
  pathSegment,
  positiveInteger,
  type MutationResourceRequestOptions,
  type ResourceRequestOptions,
} from './helpers.js';
import { compileResponseValidator } from './validation.js';

/** @public */
export interface DistributionProfileInput {
  profileId: number;
  request?: ResourceRequestOptions;
}
/** @public */
export interface CreateDistributionInput {
  profileId: number;
  request?: MutationResourceRequestOptions;
}
/** @public */
export interface DistributionsResource {
  list(input: DistributionProfileInput): Promise<SdkResult<ResponseGetDistributions>>;
  create(input: CreateDistributionInput): Promise<SdkResult<ResponseCreateDistribution>>;
}

/** @public */
export const validateDistributionListResponse = compileResponseValidator<ResponseGetDistributions>(
  distributionListResponseSchema,
  'ResponseGetDistributions',
  (value) => value as ResponseGetDistributions,
);
/** @public */
export const validateDistributionCreateResponse =
  compileResponseValidator<ResponseCreateDistribution>(
    distributionCreateResponseSchema,
    'ResponseCreateDistribution',
    (value) => value as ResponseCreateDistribution,
  );
const profilePath = (profileId: number) =>
  `/auth/${pathSegment(positiveInteger(profileId, 'profileId'), 'profileId')}/distribution`;

/** Create distribution operations over a configured distribution-service client. @public */
export const createDistributionsResource = (client: SdkServiceClient): DistributionsResource =>
  Object.freeze<DistributionsResource>({
    list: (input) =>
      client.get<ResponseGetDistributions>(profilePath(input.profileId), {
        ...input.request,
        operationId: 'getDistributions',
        responseMode: 'json',
        responseValidator: validateDistributionListResponse,
      }),
    create: (input) =>
      client.post(profilePath(input.profileId), undefined, {
        ...mutationRequest(input.request),
        operationId: 'createDistribution',
        responseMode: 'json',
        responseValidator: validateDistributionCreateResponse,
      }),
  });

export type { Distribution, DistributionT, ResponseCreateDistribution, ResponseGetDistributions };
export type { MutationResourceRequestOptions, ResourceRequestOptions } from './helpers.js';
