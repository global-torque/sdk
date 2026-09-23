import type { SdkConvenienceRequestOptions, SdkResult, SdkServiceClient } from '../types.js';
import {
  positionResponseSchema,
  redemptionCommandResponseSchema,
  redemptionListResponseSchema,
  redemptionResponseSchema,
  type PositionResponse,
  type EvmAddress,
  type OperationReference,
  type RawSignedInteger,
  type RawUint256,
  type RedemptionCommandResponse,
  type RedemptionDealingCutoff,
  type RedemptionDetail,
  type RedemptionEstimate,
  type RedemptionFinalPrice,
  type RedemptionListResponse,
  type RedemptionResponse,
  type VaultControllerAggregate,
  type VaultCustody,
  type VaultDeployment,
  type VaultDeposit,
  type VaultLifecycle,
  type VaultOperations,
  type VaultPositionBalance,
  type VaultRedemptionLifecycle,
  type VaultRequestController,
  type VaultToken,
} from './generated/contracts.js';
import { compileResponseValidator } from './validation.js';

/** @public */
export type VaultResourceRequestOptions = Omit<
  SdkConvenienceRequestOptions,
  'idempotencyKey' | 'operationId' | 'query' | 'responseMode' | 'responseValidator'
>;

/** @public */
export interface GetVaultPositionInput {
  offerId: number;
  request?: VaultResourceRequestOptions;
}

/** @public */
export interface CreateVaultRedemptionInput {
  offerId: number;
  sharesRaw: string;
  idempotencyKey: string;
  request?: VaultResourceRequestOptions;
}

/** @public */
export interface ListVaultRedemptionsInput {
  profileId?: number;
  includeCompleted?: boolean;
  request?: VaultResourceRequestOptions;
}

/** @public */
export interface VaultRedemptionInput {
  redemptionId: number;
  request?: VaultResourceRequestOptions;
}

/** @public */
export interface VaultResource {
  getPosition(input: GetVaultPositionInput): Promise<SdkResult<PositionResponse>>;
  createRedemption(
    input: CreateVaultRedemptionInput,
  ): Promise<SdkResult<RedemptionCommandResponse>>;
  listRedemptions(input?: ListVaultRedemptionsInput): Promise<SdkResult<RedemptionListResponse>>;
  getRedemption(input: VaultRedemptionInput): Promise<SdkResult<RedemptionResponse>>;
  cancelRedemption(input: VaultRedemptionInput): Promise<SdkResult<RedemptionResponse>>;
}

const positiveId = (value: number, name: string) => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer.`);
  }
  return value;
};

const positiveRawInteger = (value: string) => {
  if (!/^[1-9]\d*$/u.test(value)) {
    throw new TypeError('sharesRaw must be a positive base-10 integer string.');
  }
  return value;
};

const requiredIdempotencyKey = (value: string) => {
  if (!value.trim()) throw new TypeError('idempotencyKey must not be blank.');
  return value;
};

/** @public */
export const validatePositionResponse = compileResponseValidator<PositionResponse>(
  positionResponseSchema,
  'PositionResponse',
  (value) => value as PositionResponse,
);

/** @public */
export const validateRedemptionCommandResponse =
  compileResponseValidator<RedemptionCommandResponse>(
    redemptionCommandResponseSchema,
    'RedemptionCommandResponse',
    (value) => value as RedemptionCommandResponse,
  );

/** @public */
export const validateRedemptionResponse = compileResponseValidator<RedemptionResponse>(
  redemptionResponseSchema,
  'RedemptionResponse',
  (value) => value as RedemptionResponse,
);

/** @public */
export const validateRedemptionListResponse = compileResponseValidator<RedemptionListResponse>(
  redemptionListResponseSchema,
  'RedemptionListResponse',
  (value) => value as RedemptionListResponse,
);

/** Create canonical authenticated ERC-7540 business reads and redemption commands. @public */
export const createVaultResource = (client: SdkServiceClient): VaultResource =>
  Object.freeze({
    getPosition: (input: GetVaultPositionInput) =>
      client.get<PositionResponse>('/auth/positions', {
        ...input.request,
        operationId: 'PositionGet',
        query: { offer_id: positiveId(input.offerId, 'offerId') },
        responseMode: 'json',
        responseValidator: validatePositionResponse,
      }),
    createRedemption: (input: CreateVaultRedemptionInput) =>
      client.post<RedemptionCommandResponse>(
        '/auth/redemptions',
        {
          offer_id: positiveId(input.offerId, 'offerId'),
          shares_raw: positiveRawInteger(input.sharesRaw),
        },
        {
          ...input.request,
          idempotencyKey: requiredIdempotencyKey(input.idempotencyKey),
          operationId: 'RedemptionCreate',
          responseMode: 'json',
          responseValidator: validateRedemptionCommandResponse,
        },
      ),
    listRedemptions: (input: ListVaultRedemptionsInput = {}) =>
      client.get<RedemptionListResponse>('/auth/redemptions', {
        ...input.request,
        operationId: 'RedemptionList',
        query: {
          profile_id:
            input.profileId === undefined ? undefined : positiveId(input.profileId, 'profileId'),
          include_completed: input.includeCompleted,
        },
        responseMode: 'json',
        responseValidator: validateRedemptionListResponse,
      }),
    getRedemption: (input: VaultRedemptionInput) =>
      client.get<RedemptionResponse>(
        `/auth/redemptions/${String(positiveId(input.redemptionId, 'redemptionId'))}`,
        {
          ...input.request,
          operationId: 'RedemptionGet',
          responseMode: 'json',
          responseValidator: validateRedemptionResponse,
        },
      ),
    cancelRedemption: (input: VaultRedemptionInput) =>
      client.delete<RedemptionResponse>(
        `/auth/redemptions/${String(positiveId(input.redemptionId, 'redemptionId'))}`,
        undefined,
        {
          ...input.request,
          operationId: 'RedemptionCancel',
          responseMode: 'json',
          responseValidator: validateRedemptionResponse,
        },
      ),
  });

export type {
  EvmAddress,
  OperationReference,
  PositionResponse,
  RawSignedInteger,
  RawUint256,
  RedemptionCommandResponse,
  RedemptionDealingCutoff,
  RedemptionDetail,
  RedemptionEstimate,
  RedemptionFinalPrice,
  RedemptionListResponse,
  RedemptionResponse,
  VaultControllerAggregate,
  VaultCustody,
  VaultDeployment,
  VaultDeposit,
  VaultLifecycle,
  VaultOperations,
  VaultPositionBalance,
  VaultRedemptionLifecycle,
  VaultRequestController,
  VaultToken,
};
