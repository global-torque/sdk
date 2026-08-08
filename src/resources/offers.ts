import type { SdkConvenienceRequestOptions, SdkResult, SdkServiceClient } from '../types.js';
import {
  offerDetailResponseSchema,
  offerListResponseSchema,
  type OfferDetailResponse,
  type OfferListResponse,
  type OfferListItemResponse,
  type OfferOfferData,
  type OfferOnChainAssetToken,
  type OfferOnChainCustody,
  type OfferOnChainSummary,
  type OfferOnChainVault,
} from './generated/contracts.js';
import { compileResponseValidator } from './validation.js';

/** @public */
export type OffersResourceRequestOptions = Omit<
  SdkConvenienceRequestOptions,
  'operationId' | 'query' | 'responseMode' | 'responseValidator'
>;

/** @public */
export interface ListOffersInput {
  limit?: number;
  offset?: number;
  request?: OffersResourceRequestOptions;
}

/** @public */
export interface GetOfferInput {
  slug: string | number;
  request?: OffersResourceRequestOptions;
}

/** @public */
export interface OffersResource {
  listOffers(input?: ListOffersInput): Promise<SdkResult<OfferListResponse>>;
  getOffer(input: GetOfferInput): Promise<SdkResult<OfferDetailResponse>>;
}

const boundedInteger = (value: number | undefined, name: string, maximum?: number) => {
  if (
    value !== undefined &&
    (!Number.isSafeInteger(value) || value < 0 || (maximum !== undefined && value > maximum))
  ) {
    throw new TypeError(
      maximum === undefined
        ? `${name} must be a non-negative safe integer when provided.`
        : `${name} must be a safe integer from 0 through ${String(maximum)} when provided.`,
    );
  }
  return value;
};

const offerSlugPath = (value: string | number) => {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) {
    throw new TypeError('numeric slug must be a non-negative safe integer.');
  }
  const slug = String(value).trim();
  if (!slug) throw new TypeError('slug must be a non-blank string or number.');
  return encodeURIComponent(slug);
};

/** @public */
export const validateOfferListResponse = compileResponseValidator<OfferListResponse>(
  offerListResponseSchema,
  'OfferListResponse',
  (value) => value as OfferListResponse,
);

/** @public */
export const validateOfferDetailResponse = compileResponseValidator<OfferDetailResponse>(
  offerDetailResponseSchema,
  'OfferDetailResponse',
  (value) => value as OfferDetailResponse,
);

/** Create typed public offer reads over a configured `offers` service client. @public */
export const createOffersResource = (client: SdkServiceClient): OffersResource =>
  Object.freeze({
    listOffers: (input: ListOffersInput = {}) =>
      client.get<OfferListResponse>('/public/offer', {
        ...input.request,
        operationId: 'OfferList',
        query: {
          limit: boundedInteger(input.limit, 'limit', 100),
          offset: boundedInteger(input.offset, 'offset'),
        },
        responseMode: 'json',
        responseValidator: validateOfferListResponse,
      }),
    getOffer: (input: GetOfferInput) =>
      client.get<OfferDetailResponse>(`/public/offer/${offerSlugPath(input.slug)}`, {
        ...input.request,
        operationId: 'OfferDetail',
        responseMode: 'json',
        responseValidator: validateOfferDetailResponse,
      }),
  });

export type {
  OfferDetailResponse,
  OfferListItemResponse,
  OfferListResponse,
  OfferOfferData,
  OfferOnChainAssetToken,
  OfferOnChainCustody,
  OfferOnChainSummary,
  OfferOnChainVault,
};
