import type {
  SdkConvenienceRequestOptions,
  SdkResponseValidator,
  SdkResult,
  SdkServiceClient,
} from '../types.js';
import {
  profileWalletInfoResponseSchema,
  walletAuthorizationSessionsResponseSchema,
  walletTransactionsResponseSchema,
  type ProfileWalletInfoResponse,
  type WalletBalanceResponse,
  type WalletBalanceSummaryResponse,
  type WalletChainInfoResponse,
  type WalletDepositInstructionResponse,
  type WalletTransactionHistoryItem,
  type WalletAuthorizationSessionResponse,
  type WalletAuthorizationSessionsResponse,
  type WalletTransactionsResponse,
} from './generated/contracts.js';
import { compileResponseValidator } from './validation.js';

/** @public */
export type EvmChain = 'all' | 'ethereum' | 'ethereum-sepolia' | 'polygon' | 'base';

/** @public */
export type EvmTransactionStatus = 'all' | 'pending' | 'confirmed';

/** @public */
export type EvmResourceRequestOptions = Omit<
  SdkConvenienceRequestOptions,
  'operationId' | 'query' | 'responseMode' | 'responseValidator'
>;

/** @public */
export interface GetWalletInfoInput {
  profileId: number;
  chain: EvmChain;
  request?: EvmResourceRequestOptions;
}

/** @public */
export interface GetWalletTransactionsInput {
  profileId: number;
  chain: EvmChain;
  /**
   * Temporary compatibility filter used by crypto-operation polling. The
   * backend accepts it, but the pinned Swagger must still be updated.
   */
  operationId?: number;
  status?: EvmTransactionStatus;
  limit?: number;
  cursor?: string;
  request?: EvmResourceRequestOptions;
}

/** @public */
export type EvmAuthorizationOperationType = 'withdrawal' | 'exchange' | 'delegation';

/** @public */
export type EvmAuthorizationDelegationType = 'contract_functions' | 'root';

/** @public */
export interface GetWalletAuthorizationSessionsInput {
  profileId: number;
  status?: 'active';
  chain?: Exclude<EvmChain, 'all'>;
  assetAddress?: string;
  toAssetAddress?: string;
  authorizationOptionId?: string;
  operationType?: EvmAuthorizationOperationType;
  delegationType?: EvmAuthorizationDelegationType;
  request?: EvmResourceRequestOptions;
}

/** @public */
export interface EvmResource {
  getWalletInfo(input: GetWalletInfoInput): Promise<SdkResult<ProfileWalletInfoResponse>>;
  getWalletTransactions(
    input: GetWalletTransactionsInput,
  ): Promise<SdkResult<WalletTransactionsResponse>>;
  getWalletAuthorizationSessions(
    input: GetWalletAuthorizationSessionsInput,
  ): Promise<SdkResult<WalletAuthorizationSessionsResponse>>;
}

const EVM_CHAINS: ReadonlySet<string> = new Set([
  'all',
  'ethereum',
  'ethereum-sepolia',
  'polygon',
  'base',
]);
const EVM_TRANSACTION_STATUSES: ReadonlySet<string> = new Set(['all', 'pending', 'confirmed']);
const EVM_AUTHORIZATION_OPERATION_TYPES: ReadonlySet<string> = new Set([
  'withdrawal',
  'exchange',
  'delegation',
]);
const EVM_AUTHORIZATION_DELEGATION_TYPES: ReadonlySet<string> = new Set([
  'contract_functions',
  'root',
]);

const chainQuery = (chain: EvmChain) => {
  if (!EVM_CHAINS.has(chain)) throw new TypeError('chain is not supported by the pinned contract.');
  return chain;
};

const statusQuery = (status: EvmTransactionStatus | undefined) => {
  if (status !== undefined && !EVM_TRANSACTION_STATUSES.has(status)) {
    throw new TypeError('status is not supported by the pinned contract.');
  }
  return status;
};

const profileIdPath = (profileId: number) => {
  if (!Number.isSafeInteger(profileId) || profileId <= 0) {
    throw new TypeError('profileId must be a positive safe integer.');
  }
  return String(profileId);
};

const optionalLimit = (limit: number | undefined) => {
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit <= 0)) {
    throw new TypeError('limit must be a positive safe integer when provided.');
  }
  return limit;
};

const optionalOperationId = (operationId: number | undefined) => {
  if (operationId !== undefined && (!Number.isSafeInteger(operationId) || operationId <= 0)) {
    throw new TypeError('operationId must be a positive safe integer when provided.');
  }
  return operationId;
};

const optionalNonBlank = (value: string | undefined, name: string) => {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${name} must not be blank when provided.`);
  return normalized;
};

const authorizationOperationType = (value: EvmAuthorizationOperationType | undefined) => {
  if (value !== undefined && !EVM_AUTHORIZATION_OPERATION_TYPES.has(value)) {
    throw new TypeError('operationType is not supported by the pinned contract.');
  }
  return value;
};

const authorizationStatus = (value: unknown): 'active' => {
  if (value !== undefined && value !== 'active') {
    throw new TypeError('authorization status is not supported by the pinned contract.');
  }
  return value ?? 'active';
};

const authorizationDelegationType = (value: EvmAuthorizationDelegationType | undefined) => {
  if (value !== undefined && !EVM_AUTHORIZATION_DELEGATION_TYPES.has(value)) {
    throw new TypeError('delegationType is not supported by the pinned contract.');
  }
  return value;
};

const authorizationChain = (chain: Exclude<EvmChain, 'all'> | undefined) => {
  if (chain !== undefined && ((chain as string) === 'all' || !EVM_CHAINS.has(chain))) {
    throw new TypeError('authorization chain is not supported by the pinned contract.');
  }
  return chain;
};

const validatePinnedProfileWalletInfoResponse = compileResponseValidator<ProfileWalletInfoResponse>(
  profileWalletInfoResponseSchema,
  'ProfileWalletInfoResponse',
  (value) => value as ProfileWalletInfoResponse,
);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The backend's aggregate (`chain=all`) response uses empty Go string values
 * for optional enum fields that do not describe a single chain. Treat only
 * those exact aggregate sentinels as omitted before applying the pinned schema.
 */
const normalizeAggregateWalletInfoResponse = (value: unknown): unknown => {
  if (!isRecord(value) || value.chain !== '' || !Array.isArray(value.chains)) return value;

  let normalized: Record<string, unknown> | undefined;
  if (value.chain_account_status === '') {
    normalized = { ...value };
    delete normalized.chain_account_status;
  }

  const depositInstructions = value.deposit_instructions;
  if (isRecord(depositInstructions) && depositInstructions.chain === '') {
    normalized ??= { ...value };
    const normalizedDepositInstructions = { ...depositInstructions };
    delete normalizedDepositInstructions.chain;
    normalized.deposit_instructions = normalizedDepositInstructions;
  }

  return normalized ?? value;
};

/** @public */
export const validateProfileWalletInfoResponse: SdkResponseValidator<ProfileWalletInfoResponse> = (
  value,
) => validatePinnedProfileWalletInfoResponse(normalizeAggregateWalletInfoResponse(value));

/** @public */
export const validateWalletTransactionsResponse =
  compileResponseValidator<WalletTransactionsResponse>(
    walletTransactionsResponseSchema,
    'WalletTransactionsResponse',
    (value) => value as WalletTransactionsResponse,
  );

/** @public */
export const validateWalletAuthorizationSessionsResponse =
  compileResponseValidator<WalletAuthorizationSessionsResponse>(
    walletAuthorizationSessionsResponseSchema,
    'WalletAuthorizationSessionsResponse',
    (value) => value as WalletAuthorizationSessionsResponse,
  );

/** Create typed EVM wallet reads over a configured `evm` service client. @public */
export const createEvmResource = (client: SdkServiceClient): EvmResource =>
  Object.freeze({
    getWalletInfo: (input: GetWalletInfoInput) =>
      client.get<ProfileWalletInfoResponse>(`/auth/wallet/${profileIdPath(input.profileId)}`, {
        ...input.request,
        operationId: 'getWalletInfo',
        query: { chain: chainQuery(input.chain) },
        responseMode: 'json',
        responseValidator: validateProfileWalletInfoResponse,
      }),
    getWalletTransactions: (input: GetWalletTransactionsInput) =>
      client.get<WalletTransactionsResponse>(
        `/auth/wallet/${profileIdPath(input.profileId)}/transactions`,
        {
          ...input.request,
          operationId: 'getWalletTransactions',
          query: {
            chain: chainQuery(input.chain),
            operation_id: optionalOperationId(input.operationId),
            status: statusQuery(input.status),
            limit: optionalLimit(input.limit),
            cursor: input.cursor,
          },
          responseMode: 'json',
          responseValidator: validateWalletTransactionsResponse,
        },
      ),
    getWalletAuthorizationSessions: (input: GetWalletAuthorizationSessionsInput) =>
      client.get<WalletAuthorizationSessionsResponse>(
        `/auth/wallet/authorize/sessions/${profileIdPath(input.profileId)}`,
        {
          ...input.request,
          operationId: 'getWalletAuthorizationSessions',
          query: {
            status: authorizationStatus(input.status),
            chain: authorizationChain(input.chain),
            asset_address: optionalNonBlank(input.assetAddress, 'assetAddress'),
            to_asset_address: optionalNonBlank(input.toAssetAddress, 'toAssetAddress'),
            authorization_option_id: optionalNonBlank(
              input.authorizationOptionId,
              'authorizationOptionId',
            ),
            operation_type: authorizationOperationType(input.operationType),
            delegation_type: authorizationDelegationType(input.delegationType),
          },
          responseMode: 'json',
          responseValidator: validateWalletAuthorizationSessionsResponse,
        },
      ),
  });

export type {
  ProfileWalletInfoResponse,
  WalletBalanceResponse,
  WalletBalanceSummaryResponse,
  WalletAuthorizationSessionResponse,
  WalletAuthorizationSessionsResponse,
  WalletChainInfoResponse,
  WalletDepositInstructionResponse,
  WalletTransactionHistoryItem,
  WalletTransactionsResponse,
};
