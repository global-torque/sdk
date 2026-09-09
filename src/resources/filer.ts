import type { SdkKeylessServiceClient, SdkResult, SdkServiceClient } from '../types.js';
import { SdkResponseValidationError } from '../errors.js';
import { isSdkKeylessServiceClient } from '../client.js';
import {
  filerFileSchema,
  filerOfferFolderRequestSchema,
  filerSignedUrlResponseSchema,
  filerUploadRequestSchema,
  filerWorkspaceRequestSchema,
  type FilerFile,
  type FilerFileType,
  type FilerGenericUploadRequest,
  type FilerOfferFolderRequest,
  type FilerOfferUploadRequest,
  type FilerSignedUrlResponse,
  type FilerUploadRequest,
  type FilerUploadingSignedUrlBase,
  type FilerWorkspaceRequest,
} from './generated/contracts.js';
import {
  catchAllPath,
  mutationRequest,
  optionalString,
  pathSegment,
  type MutationResourceRequestOptions,
  type ResourceRequestOptions,
} from './helpers.js';
import { compileRequestValidator, compileResponseValidator } from './validation.js';

/** @public */
export interface FilerFileIdInput {
  id: number;
  request?: ResourceRequestOptions;
}
/** @public */
export interface DeleteFilerFileInput {
  id: number;
  request?: MutationResourceRequestOptions;
}
/** @public */
export interface FilerDownloadInput extends FilerFileIdInput {
  size?: string;
}
/** @public */
export interface FilerObjectInput {
  objectPath: string;
  request?: ResourceRequestOptions;
}
/** @public */
export interface CreateFilerUploadUrlInput {
  body: FilerUploadRequest;
  request?: MutationResourceRequestOptions;
}
/** @public */
export interface CreateFilerFolderInput {
  body: FilerOfferFolderRequest;
  request?: MutationResourceRequestOptions;
}
/** @public */
export interface ProvisionFilerWorkspaceInput {
  body: FilerWorkspaceRequest;
  request?: MutationResourceRequestOptions;
}
/** @public */
export interface FilerResource {
  deleteFile(input: DeleteFilerFileInput): Promise<SdkResult<string>>;
  downloadFile(input: FilerDownloadInput): Promise<SdkResult<Blob>>;
  getFileLink(input: FilerFileIdInput): Promise<SdkResult<FilerFile>>;
  getMyObjects(request?: ResourceRequestOptions): Promise<SdkResult<FilerFile>>;
  getAuthenticatedObject(input: FilerObjectInput): Promise<SdkResult<FilerFile>>;
  downloadPublicFile(input: FilerDownloadInput): Promise<SdkResult<Blob>>;
  getPublicObject(input: FilerObjectInput): Promise<SdkResult<FilerFile>>;
  createUploadUrl(input: CreateFilerUploadUrlInput): Promise<SdkResult<FilerSignedUrlResponse>>;
  createOfferFolder(input: CreateFilerFolderInput): Promise<SdkResult<FilerFile>>;
  provisionWorkspace(input: ProvisionFilerWorkspaceInput): Promise<SdkResult<string>>;
}

/**
 * Downloads use clients that must be configured without application or user
 * credentials. The signed client is origin-bound to the object store; the
 * public client is origin-bound to Filer and may explicitly follow redirects.
 *
 * @public
 */
export interface FilerDownloadClients {
  signedDownloadClient: SdkKeylessServiceClient;
  publicDownloadClient: SdkKeylessServiceClient;
}

const filePath = (visibility: 'auth' | 'public', id: number) =>
  `/${visibility}/files/${pathSegment(id, 'id')}`;
const objectPath = (visibility: 'auth' | 'public', value: string) =>
  `/${visibility}/objects/${catchAllPath(value, 'objectPath')}`;
/** @public */
export const validateFilerFile = compileResponseValidator<FilerFile>(
  filerFileSchema,
  'FilerFile',
  (value) => value as FilerFile,
);
/** @public */
export const validateFilerSignedUrlResponse = compileResponseValidator<FilerSignedUrlResponse>(
  filerSignedUrlResponseSchema,
  'FilerSignedUrlResponse',
  (value) => value as FilerSignedUrlResponse,
);
const uploadValidator = compileRequestValidator<FilerUploadRequest>(
  filerUploadRequestSchema,
  'FilerUploadRequest',
  (value) => value as FilerUploadRequest,
);
const folderValidator = compileRequestValidator<FilerOfferFolderRequest>(
  filerOfferFolderRequestSchema,
  'FilerOfferFolderRequest',
  (value) => value as FilerOfferFolderRequest,
);
const workspaceValidator = compileRequestValidator<FilerWorkspaceRequest>(
  filerWorkspaceRequestSchema,
  'FilerWorkspaceRequest',
  (value) => value as FilerWorkspaceRequest,
);

const signedDownloadUrl = (file: FilerFile) => {
  if (typeof file.url !== 'string' || !file.url.trim()) {
    throw new SdkResponseValidationError({
      route: 'getFilerFileLink',
      method: 'GET',
      details: {
        validationFailure: 'response-schema',
        contractIssue: { keyword: 'required', instancePath: '/url', validationMode: 'compatible' },
      },
    });
  }
  let url: URL;
  try {
    url = new URL(file.url);
  } catch {
    throw new SdkResponseValidationError({
      route: 'getFilerFileLink',
      method: 'GET',
      details: {
        validationFailure: 'response-schema',
        contractIssue: { keyword: 'format', instancePath: '/url', validationMode: 'compatible' },
      },
    });
  }
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new SdkResponseValidationError({
      route: 'getFilerFileLink',
      method: 'GET',
      details: {
        validationFailure: 'response-schema',
        contractIssue: { keyword: 'format', instancePath: '/url', validationMode: 'compatible' },
      },
    });
  }
  return url.toString();
};

const credentialSeparatedRequest = (
  request: ResourceRequestOptions | undefined,
): ResourceRequestOptions => ({
  ...(request?.signal === undefined ? {} : { signal: request.signal }),
  ...(request?.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
  ...(request?.retry === undefined ? {} : { retry: request.retry }),
});

/** Create Filer operations with credential-separated clients for redirecting downloads. @public */
export const createFilerResource = (
  client: SdkServiceClient,
  downloadClients: FilerDownloadClients,
): FilerResource => {
  if (
    !isSdkKeylessServiceClient(downloadClients.signedDownloadClient) ||
    !isSdkKeylessServiceClient(downloadClients.publicDownloadClient)
  ) {
    throw new TypeError('Filer download clients must be transport-verified keyless clients.');
  }
  return Object.freeze<FilerResource>({
    deleteFile: (input) =>
      client.delete(filePath('auth', input.id), undefined, {
        ...mutationRequest(input.request),
        operationId: 'deleteFilerFile',
        responseMode: 'text',
      }),
    downloadFile: async (input) => {
      const link = await client.get<FilerFile>(`${filePath('auth', input.id)}/link`, {
        ...input.request,
        operationId: 'getFilerFileLink',
        query: { size: optionalString(input.size, 'size') },
        responseMode: 'json',
        responseValidator: validateFilerFile,
      });
      return downloadClients.signedDownloadClient.get(signedDownloadUrl(link.data), {
        ...credentialSeparatedRequest(input.request),
        operationId: 'downloadSignedFilerFile',
        responseMode: 'blob',
      });
    },
    getFileLink: (input) =>
      client.get<FilerFile>(`${filePath('auth', input.id)}/link`, {
        ...input.request,
        responseMode: 'json',
        responseValidator: validateFilerFile,
      }),
    getMyObjects: (request) =>
      client.get<FilerFile>('/auth/objects/my', {
        ...request,
        responseMode: 'json',
        responseValidator: validateFilerFile,
      }),
    getAuthenticatedObject: (input) =>
      client.get<FilerFile>(objectPath('auth', input.objectPath), {
        ...input.request,
        operationId: 'getAuthenticatedFilerObjectTree',
        responseMode: 'json',
        responseValidator: validateFilerFile,
      }),
    downloadPublicFile: (input) =>
      downloadClients.publicDownloadClient.get(filePath('public', input.id), {
        ...credentialSeparatedRequest(input.request),
        operationId: 'downloadPublicFilerFile',
        query: { size: optionalString(input.size, 'size') },
        responseMode: 'blob',
      }),
    getPublicObject: (input) =>
      client.get<FilerFile>(objectPath('public', input.objectPath), {
        ...input.request,
        responseMode: 'json',
        responseValidator: validateFilerFile,
      }),
    createUploadUrl: (input) =>
      client.post('/auth/files/signurl', uploadValidator(input.body), {
        ...mutationRequest(input.request),
        operationId: 'createFilerUploadUrl',
        responseMode: 'json',
        responseValidator: validateFilerSignedUrlResponse,
      }),
    createOfferFolder: (input) =>
      client.post('/auth/folders', folderValidator(input.body), {
        ...mutationRequest(input.request),
        operationId: 'createFilerOfferFolder',
        responseMode: 'json',
        responseValidator: validateFilerFile,
      }),
    provisionWorkspace: (input) =>
      client.post('/auth/workspaces', workspaceValidator(input.body), {
        ...mutationRequest(input.request),
        operationId: 'provisionFilerWorkspace',
        responseMode: 'text',
      }),
  });
};

export type {
  FilerFile,
  FilerFileType,
  FilerGenericUploadRequest,
  FilerOfferFolderRequest,
  FilerOfferUploadRequest,
  FilerSignedUrlResponse,
  FilerUploadRequest,
  FilerUploadingSignedUrlBase,
  FilerWorkspaceRequest,
};
export type { MutationResourceRequestOptions, ResourceRequestOptions } from './helpers.js';
