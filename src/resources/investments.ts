import type { SdkConvenienceRequestOptions, SdkResult, SdkServiceClient } from '../types.js';
import {
  amountStepSchema,
  confirmedInvestmentListResponseSchema,
  emptyResponseSchema,
  investmentDetailSchema,
  investmentListResponseSchema,
  offerInvestmentProfileListResponseSchema,
  reviewStepResponseSchema,
  signatureStepSchema,
  type AmountStep,
  type ConfirmedInvestmentListResponse,
  type EmptyResponse,
  type InvestmentDetail,
  type InvestmentListResponse,
  type InvestmentPortfolioMeta,
  type Offer,
  type OfferData,
  type OfferInvestmentProfile,
  type OfferInvestmentProfileListResponse,
  type PaymentData,
  type ReviewStepResponse,
  type SignatureStep,
} from './generated/contracts.js';
import { compileResponseValidator } from './validation.js';

/** @public */
export type InvestmentFundingType = 'none' | 'wire' | 'ach' | 'wallet' | 'crypto_wallet';

/** @public */
export type InvestmentsResourceRequestOptions = Omit<
  SdkConvenienceRequestOptions,
  'idempotencyKey' | 'operationId' | 'query' | 'responseMode' | 'responseValidator'
>;

/** @public */
export interface InvestmentProfileListInput {
  profileId: number;
  limit?: number;
  offset?: number;
  request?: InvestmentsResourceRequestOptions;
}

/** @public */
export interface ListUnconfirmedInvestmentsInput {
  limit?: number;
  offset?: number;
  request?: InvestmentsResourceRequestOptions;
}

/** @public */
export interface GetInvestmentInput {
  investmentId: number;
  request?: InvestmentsResourceRequestOptions;
}

/** @public */
export interface ListInvestmentsByOfferInput {
  offerSlug: string;
  request?: InvestmentsResourceRequestOptions;
}

/** @public */
export interface CreateInvestmentInput {
  offerSlug: string;
  profileId: number;
  request?: InvestmentsResourceRequestOptions;
}

/** @public */
export interface InvestmentStepInput {
  offerSlug: string;
  investmentId: number;
  profileId: number;
  request?: InvestmentsResourceRequestOptions;
}

/** @public */
export interface SetInvestmentAmountInput extends InvestmentStepInput {
  amount: string;
  fundingType: InvestmentFundingType;
  fundingSourceId?: number;
  paymentData?: Readonly<Record<string, unknown>>;
}

/** @public */
export interface SubmitInvestmentSignatureInput extends InvestmentStepInput {
  signatureId: string;
  userBrowser?: string;
  ipAddress?: string;
}

/** @public */
export interface CancelInvestmentInput extends GetInvestmentInput {
  reason: string;
}

/** Canonical investment-service operations backed by the pinned contract. @public */
export interface InvestmentsResource {
  listConfirmedByProfile(
    input: InvestmentProfileListInput,
  ): Promise<SdkResult<ConfirmedInvestmentListResponse>>;
  listUnconfirmedByProfile(
    input: InvestmentProfileListInput,
  ): Promise<SdkResult<InvestmentListResponse>>;
  listUnconfirmed(
    input?: ListUnconfirmedInvestmentsInput,
  ): Promise<SdkResult<InvestmentListResponse>>;
  getInvestment(input: GetInvestmentInput): Promise<SdkResult<InvestmentDetail>>;
  listByOffer(
    input: ListInvestmentsByOfferInput,
  ): Promise<SdkResult<OfferInvestmentProfileListResponse>>;
  createInvestment(input: CreateInvestmentInput): Promise<SdkResult<InvestmentDetail>>;
  setAmount(input: SetInvestmentAmountInput): Promise<SdkResult<AmountStep>>;
  submitSignature(input: SubmitInvestmentSignatureInput): Promise<SdkResult<SignatureStep>>;
  submitReview(input: InvestmentStepInput): Promise<SdkResult<ReviewStepResponse>>;
  cancelInvestment(input: CancelInvestmentInput): Promise<SdkResult<EmptyResponse>>;
}

const positiveId = (value: number, name: string) => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer.`);
  }
  return String(value);
};

const boundedPageInteger = (
  value: number | undefined,
  name: string,
  minimum: number,
  maximum?: number,
) => {
  if (
    value !== undefined &&
    (!Number.isSafeInteger(value) || value < minimum || (maximum !== undefined && value > maximum))
  ) {
    throw new TypeError(
      maximum === undefined
        ? `${name} must be a safe integer greater than or equal to ${String(minimum)} when provided.`
        : `${name} must be a safe integer from ${String(minimum)} through ${String(maximum)} when provided.`,
    );
  }
  return value;
};

const slugPath = (value: string) => {
  const slug = value.trim();
  if (!slug) throw new TypeError('offerSlug must not be blank.');
  return encodeURIComponent(slug);
};

const exactAmount = (value: string) => {
  if (typeof value !== 'string' || !/^[0-9]+(?:\.[0-9]{1,6})?$/u.test(value)) {
    throw new TypeError('amount must be an exact decimal string with at most 6 fractional digits.');
  }
  return value;
};

const optionalRecord = (
  value: unknown,
  name: string,
): Readonly<Record<string, unknown>> | undefined => {
  if (
    value !== undefined &&
    (typeof value !== 'object' || value === null || Array.isArray(value))
  ) {
    throw new TypeError(`${name} must be a plain object when provided.`);
  }
  return value as Readonly<Record<string, unknown>> | undefined;
};

const mutationRequest = (
  request: InvestmentsResourceRequestOptions | undefined,
): SdkConvenienceRequestOptions => {
  const sanitized: SdkConvenienceRequestOptions = { ...request };
  delete sanitized.idempotencyKey;
  return sanitized;
};

const optionalString = (value: string | undefined, name: string) => {
  if (value !== undefined && typeof value !== 'string') {
    throw new TypeError(`${name} must be a string when provided.`);
  }
  return value;
};

const fundingType = (value: InvestmentFundingType) => {
  if (!new Set(['none', 'wire', 'ach', 'wallet', 'crypto_wallet']).has(value)) {
    throw new TypeError('fundingType is not supported by the pinned contract.');
  }
  return value;
};

const optionalPositiveId = (value: number | undefined, name: string) =>
  value === undefined ? undefined : Number(positiveId(value, name));

const nonBlank = (value: string, name: string, minimum = 1) => {
  const normalized = value.trim();
  if (normalized.length < minimum) {
    throw new TypeError(
      `${name} must contain at least ${String(minimum)} non-whitespace characters.`,
    );
  }
  return normalized;
};

const stepPath = (input: InvestmentStepInput, step: 'amount' | 'signature' | 'review') =>
  `/auth/invest/${slugPath(input.offerSlug)}/${step}/${positiveId(input.investmentId, 'investmentId')}/${positiveId(input.profileId, 'profileId')}`;

/** @public */
export const validateInvestmentDetail = compileResponseValidator<InvestmentDetail>(
  investmentDetailSchema,
  'InvestmentDetail',
  (value) => value as InvestmentDetail,
);

/** @public */
export const validateInvestmentListResponse = compileResponseValidator<InvestmentListResponse>(
  investmentListResponseSchema,
  'InvestmentListResponse',
  (value) => value as InvestmentListResponse,
);

/** @public */
export const validateConfirmedInvestmentListResponse =
  compileResponseValidator<ConfirmedInvestmentListResponse>(
    confirmedInvestmentListResponseSchema,
    'ConfirmedInvestmentListResponse',
    (value) => value as ConfirmedInvestmentListResponse,
  );

/** @public */
export const validateOfferInvestmentProfileListResponse =
  compileResponseValidator<OfferInvestmentProfileListResponse>(
    offerInvestmentProfileListResponseSchema,
    'OfferInvestmentProfileListResponse',
    (value) => value as OfferInvestmentProfileListResponse,
  );

/** @public */
export const validateAmountStep = compileResponseValidator<AmountStep>(
  amountStepSchema,
  'AmountStep',
  (value) => value as AmountStep,
);

/** @public */
export const validateSignatureStep = compileResponseValidator<SignatureStep>(
  signatureStepSchema,
  'SignatureStep',
  (value) => value as SignatureStep,
);

/** @public */
export const validateReviewStepResponse = compileResponseValidator<ReviewStepResponse>(
  reviewStepResponseSchema,
  'ReviewStepResponse',
  (value) => value as ReviewStepResponse,
);

/** @public */
export const validateEmptyInvestmentResponse = compileResponseValidator<EmptyResponse>(
  emptyResponseSchema,
  'EmptyResponse',
  (value) => value as EmptyResponse,
);

/** Create canonical investment-service operations over a configured service client. @public */
export const createInvestmentsResource = (client: SdkServiceClient): InvestmentsResource =>
  Object.freeze({
    listConfirmedByProfile: (input: InvestmentProfileListInput) =>
      client.get<ConfirmedInvestmentListResponse>(
        `/auth/investment/${positiveId(input.profileId, 'profileId')}/confirmed`,
        {
          ...input.request,
          operationId: 'InvestmentListConfirmed',
          query: {
            limit: boundedPageInteger(input.limit, 'limit', 1, 100),
            offset: boundedPageInteger(input.offset, 'offset', 0),
          },
          responseMode: 'json',
          responseValidator: validateConfirmedInvestmentListResponse,
        },
      ),
    listUnconfirmedByProfile: (input: InvestmentProfileListInput) =>
      client.get<InvestmentListResponse>(
        `/auth/investment/${positiveId(input.profileId, 'profileId')}/unconfirmed`,
        {
          ...input.request,
          operationId: 'InvestmentListUnconfirmedByProfile',
          query: {
            limit: boundedPageInteger(input.limit, 'limit', 1, 100),
            offset: boundedPageInteger(input.offset, 'offset', 0),
          },
          responseMode: 'json',
          responseValidator: validateInvestmentListResponse,
        },
      ),
    listUnconfirmed: (input: ListUnconfirmedInvestmentsInput = {}) =>
      client.get<InvestmentListResponse>('/auth/investment/unconfirmed', {
        ...input.request,
        operationId: 'InvestmentListUnConfirmed',
        query: {
          limit: boundedPageInteger(input.limit, 'limit', 1, 100),
          offset: boundedPageInteger(input.offset, 'offset', 0),
        },
        responseMode: 'json',
        responseValidator: validateInvestmentListResponse,
      }),
    getInvestment: (input: GetInvestmentInput) =>
      client.get<InvestmentDetail>(
        `/auth/investment/${positiveId(input.investmentId, 'investmentId')}`,
        {
          ...input.request,
          operationId: 'InvestmentGet',
          responseMode: 'json',
          responseValidator: validateInvestmentDetail,
        },
      ),
    listByOffer: (input: ListInvestmentsByOfferInput) =>
      client.get<OfferInvestmentProfileListResponse>(
        `/auth/offer/${slugPath(input.offerSlug)}/investments`,
        {
          ...input.request,
          operationId: 'ListOfferInvestments',
          responseMode: 'json',
          responseValidator: validateOfferInvestmentProfileListResponse,
        },
      ),
    createInvestment: (input: CreateInvestmentInput) =>
      client.post<InvestmentDetail>(
        `/auth/invest/${slugPath(input.offerSlug)}/${positiveId(input.profileId, 'profileId')}`,
        {},
        {
          ...mutationRequest(input.request),
          operationId: 'InvestmentCreate',
          responseMode: 'json',
          responseValidator: validateInvestmentDetail,
        },
      ),
    setAmount: (input: SetInvestmentAmountInput) =>
      client.put<AmountStep>(
        stepPath(input, 'amount'),
        {
          amount: exactAmount(input.amount),
          profile_id: Number(positiveId(input.profileId, 'profileId')),
          funding_type: fundingType(input.fundingType),
          funding_source_id: optionalPositiveId(input.fundingSourceId, 'fundingSourceId'),
          payment_data: optionalRecord(input.paymentData, 'paymentData'),
        },
        {
          ...mutationRequest(input.request),
          operationId: 'InvestmentAmountStep',
          responseMode: 'json',
          responseValidator: validateAmountStep,
        },
      ),
    submitSignature: (input: SubmitInvestmentSignatureInput) =>
      client.put<SignatureStep>(
        stepPath(input, 'signature'),
        {
          signature_id: nonBlank(input.signatureId, 'signatureId', 2),
          user_browser: optionalString(input.userBrowser, 'userBrowser'),
          ip_address: optionalString(input.ipAddress, 'ipAddress'),
        },
        {
          ...mutationRequest(input.request),
          operationId: 'InvestmentSignatureStep',
          responseMode: 'json',
          responseValidator: validateSignatureStep,
        },
      ),
    submitReview: (input: InvestmentStepInput) =>
      client.put<ReviewStepResponse>(
        stepPath(input, 'review'),
        {},
        {
          ...mutationRequest(input.request),
          operationId: 'InvestmentReviewStep',
          responseMode: 'json',
          responseValidator: validateReviewStepResponse,
        },
      ),
    cancelInvestment: (input: CancelInvestmentInput) =>
      client.put<EmptyResponse>(
        `/auth/investment/${positiveId(input.investmentId, 'investmentId')}/cancel`,
        { cancelation_reason: nonBlank(input.reason, 'reason', 4) },
        {
          ...mutationRequest(input.request),
          operationId: 'InvestmentCancel',
          responseMode: 'json',
          responseValidator: validateEmptyInvestmentResponse,
        },
      ),
  });

export type {
  AmountStep,
  ConfirmedInvestmentListResponse,
  EmptyResponse,
  InvestmentDetail,
  InvestmentListResponse,
  InvestmentPortfolioMeta,
  Offer,
  OfferData,
  OfferInvestmentProfile,
  OfferInvestmentProfileListResponse,
  PaymentData,
  ReviewStepResponse,
  SignatureStep,
};
