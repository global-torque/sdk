import type { SdkResult, SdkServiceClient } from '../types.js';
import {
  jsonSchemaDocumentSchema,
  partialUserUpdateSchema,
  userRetrieveResponseSchema,
  userUpdateResponseSchema,
  type JsonSchemaDocument,
  type PartialUserUpdate,
  type UserRetrieveResponse,
  type UserUpdate,
} from './generated/contracts.js';
import {
  mutationRequest,
  type MutationResourceRequestOptions,
  type ResourceRequestOptions,
} from './helpers.js';
import { compileRequestValidator, compileResponseValidator } from './validation.js';

/** @public */
export interface UpdateUserInput {
  body: PartialUserUpdate;
  request?: MutationResourceRequestOptions;
}
/** @public */
export interface UsersResource {
  get(request?: ResourceRequestOptions): Promise<SdkResult<UserRetrieveResponse>>;
  getUpdateSchema(request?: ResourceRequestOptions): Promise<SdkResult<JsonSchemaDocument>>;
  update(input: UpdateUserInput): Promise<SdkResult<UserUpdate>>;
}

/** @public */
export const validateUserRetrieveResponse = compileResponseValidator<UserRetrieveResponse>(
  userRetrieveResponseSchema,
  'UserRetrieveResponse',
  (value) => value as UserRetrieveResponse,
);
/** @public */
export const validateUserJsonSchemaDocument = compileResponseValidator<JsonSchemaDocument>(
  jsonSchemaDocumentSchema,
  'JsonSchemaDocument',
  (value) => value as JsonSchemaDocument,
);
const updateRequestValidator = compileRequestValidator<PartialUserUpdate>(
  partialUserUpdateSchema,
  'PartialUserUpdate',
  (value) => value as PartialUserUpdate,
);
/** @public */
export const validateUserUpdateResponse = compileResponseValidator<UserUpdate>(
  userUpdateResponseSchema,
  'UserUpdate',
  (value) => value as UserUpdate,
);

/** Create user-account operations over a configured profiles-service client. @public */
export const createUsersResource = (client: SdkServiceClient): UsersResource =>
  Object.freeze<UsersResource>({
    get: (request) =>
      client.get<UserRetrieveResponse>('/auth/user', {
        ...request,
        operationId: 'UserRetrieve',
        responseMode: 'json',
        responseValidator: validateUserRetrieveResponse,
      }),
    getUpdateSchema: (request) =>
      client.options<JsonSchemaDocument>('/auth/user', {
        ...request,
        schema: true,
        operationId: 'UserUpdateOptions',
        responseMode: 'json',
        responseValidator: validateUserJsonSchemaDocument,
      }),
    update: (input) =>
      client.patch('/auth/user', updateRequestValidator(input.body), {
        ...mutationRequest(input.request),
        operationId: 'UserUpdate',
        responseMode: 'json',
        responseValidator: validateUserUpdateResponse,
      }),
  });

export type { JsonSchemaDocument, PartialUserUpdate, UserRetrieveResponse, UserUpdate };
export type { MutationResourceRequestOptions, ResourceRequestOptions } from './helpers.js';
