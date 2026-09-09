import type { SdkResult, SdkServiceClient } from '../types.js';
import {
  incomingRequestCreateSchema,
  incomingRequestResponseSchema,
  type IncomingRequestCreate,
  type IncomingRequestResponse,
} from './generated/contracts.js';
import { mutationRequest, type MutationResourceRequestOptions } from './helpers.js';
import { compileRequestValidator, compileResponseValidator } from './validation.js';

/** @public */
export interface CreateIncomingRequestInput {
  body: IncomingRequestCreate;
  request?: MutationResourceRequestOptions;
}
/** @public */
export interface FormsResource {
  createIncomingRequest(
    input: CreateIncomingRequestInput,
  ): Promise<SdkResult<IncomingRequestResponse>>;
}

const requestValidator = compileRequestValidator<IncomingRequestCreate>(
  incomingRequestCreateSchema,
  'IncomingRequestCreate',
  (value) => value as IncomingRequestCreate,
);
/** @public */
export const validateIncomingRequestResponse = compileResponseValidator<IncomingRequestResponse>(
  incomingRequestResponseSchema,
  'IncomingRequestResponse',
  (value) => value as IncomingRequestResponse,
);

/** Create public form operations over a configured forms-service client. @public */
export const createFormsResource = (client: SdkServiceClient): FormsResource =>
  Object.freeze<FormsResource>({
    createIncomingRequest: (input) =>
      client.post('/public/incoming-requests', requestValidator(input.body), {
        ...mutationRequest(input.request),
        operationId: 'createIncomingRequest',
        responseMode: 'json',
        responseValidator: validateIncomingRequestResponse,
      }),
  });

export type { IncomingRequestCreate, IncomingRequestResponse };
export type { MutationResourceRequestOptions } from './helpers.js';
