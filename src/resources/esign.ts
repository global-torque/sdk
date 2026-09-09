import type { SdkResult, SdkServiceClient } from '../types.js';
import {
  esignDocumentCreateSchema,
  esignDocumentResponseSchema,
  type EsignDocumentCreate,
  type EsignDocumentResponse,
} from './generated/contracts.js';
import { mutationRequest, type MutationResourceRequestOptions } from './helpers.js';
import { compileRequestValidator, compileResponseValidator } from './validation.js';

/** @public */
export interface CreateEsignDocumentInput {
  body: EsignDocumentCreate;
  request?: MutationResourceRequestOptions;
}

/** @public */
export interface EsignResource {
  createDocument(input: CreateEsignDocumentInput): Promise<SdkResult<EsignDocumentResponse>>;
}

const createRequestValidator = compileRequestValidator<EsignDocumentCreate>(
  esignDocumentCreateSchema,
  'EsignDocumentCreate',
  (value) => value as EsignDocumentCreate,
);
/** @public */
export const validateEsignDocumentResponse = compileResponseValidator<EsignDocumentResponse>(
  esignDocumentResponseSchema,
  'EsignDocumentResponse',
  (value) => value as EsignDocumentResponse,
);

/** Create the documented e-sign operation over a configured e-sign-service client. @public */
export const createEsignResource = (client: SdkServiceClient): EsignResource =>
  Object.freeze<EsignResource>({
    createDocument: (input) =>
      client.post('/auth/document', createRequestValidator(input.body), {
        ...mutationRequest(input.request),
        operationId: 'documentCreate',
        responseMode: 'json',
        responseValidator: validateEsignDocumentResponse,
      }),
  });

export type { EsignDocumentCreate, EsignDocumentResponse };
export type { MutationResourceRequestOptions } from './helpers.js';
