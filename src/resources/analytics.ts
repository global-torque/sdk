import type { SdkResult, SdkServiceClient } from '../types.js';
import {
  analyticsEventCreateSchema,
  analyticsEventResponseSchema,
  analyticsLogCreateSchema,
  analyticsLogResponseSchema,
  type AnalyticsEventCreate,
  type AnalyticsEventResponse,
  type AnalyticsLogCreate,
  type AnalyticsLogResponse,
  type AnalyticsServiceContext,
} from './generated/contracts.js';
import { mutationRequest, type MutationResourceRequestOptions } from './helpers.js';
import { compileRequestValidator, compileResponseValidator } from './validation.js';

/** @public */
export interface CreateAnalyticsLogInput {
  body: AnalyticsLogCreate;
  request?: MutationResourceRequestOptions;
}

/** @public */
export interface CreateAnalyticsEventInput {
  body: AnalyticsEventCreate;
  request?: MutationResourceRequestOptions;
}

/** @public */
export interface AnalyticsResource {
  createEvent(input: CreateAnalyticsEventInput): Promise<SdkResult<AnalyticsEventResponse>>;
  createLog(input: CreateAnalyticsLogInput): Promise<SdkResult<AnalyticsLogResponse>>;
}

const eventRequestValidator = compileRequestValidator<AnalyticsEventCreate>(
  analyticsEventCreateSchema,
  'AnalyticsEventCreate',
  (value) => value as AnalyticsEventCreate,
);
/** @public */
export const validateAnalyticsEventResponse = compileResponseValidator<AnalyticsEventResponse>(
  analyticsEventResponseSchema,
  'AnalyticsEventResponse',
  (value) => value as AnalyticsEventResponse,
);

const logRequestValidator = compileRequestValidator<AnalyticsLogCreate>(
  analyticsLogCreateSchema,
  'AnalyticsLogCreate',
  (value) => value as AnalyticsLogCreate,
);
/** @public */
export const validateAnalyticsLogResponse = compileResponseValidator<AnalyticsLogResponse>(
  analyticsLogResponseSchema,
  'AnalyticsLogResponse',
  (value) => value as AnalyticsLogResponse,
);

/** Create low-level Analytic API operations over a configured analytics-service client. @public */
export const createAnalyticsResource = (client: SdkServiceClient): AnalyticsResource =>
  Object.freeze<AnalyticsResource>({
    createEvent: (input) =>
      client.post('/public/event', eventRequestValidator(input.body), {
        ...mutationRequest(input.request),
        operationId: 'AnalyticCreation',
        responseMode: 'json',
        responseValidator: validateAnalyticsEventResponse,
      }),
    createLog: (input) =>
      client.post('/public/log', logRequestValidator(input.body), {
        ...mutationRequest(input.request),
        operationId: 'LogCreate',
        responseMode: 'json',
        responseValidator: validateAnalyticsLogResponse,
      }),
  });

export type {
  AnalyticsEventCreate,
  AnalyticsEventResponse,
  AnalyticsLogCreate,
  AnalyticsLogResponse,
  AnalyticsServiceContext,
};
export type { MutationResourceRequestOptions } from './helpers.js';
