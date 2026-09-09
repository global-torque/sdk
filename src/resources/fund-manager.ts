import type { SdkResult, SdkServiceClient } from '../types.js';
import {
  fundManagerAdminDataSchema,
  type FundManagerAdminData,
  type OpenRecord,
} from './generated/contracts.js';
import {
  boundedInteger,
  optionalDateTime,
  optionalString,
  type ResourceRequestOptions,
} from './helpers.js';
import { compileResponseValidator } from './validation.js';

/** @public */
export interface GetFundManagerAdminDataInput {
  limit?: number;
  offset?: number;
  search?: string;
  action?: string;
  recordType?: string;
  recordId?: string;
  dateFrom?: string;
  dateTo?: string;
  request?: ResourceRequestOptions;
}
/** @public */
export interface FundManagerResource {
  getAdminData(input?: GetFundManagerAdminDataInput): Promise<SdkResult<FundManagerAdminData>>;
}

/** @public */
export const validateFundManagerAdminData = compileResponseValidator<FundManagerAdminData>(
  fundManagerAdminDataSchema,
  'FundManagerAdminData',
  (value) => value as FundManagerAdminData,
);

/** Create fund-manager reads over a configured fund-manager service client. @public */
export const createFundManagerResource = (client: SdkServiceClient): FundManagerResource =>
  Object.freeze<FundManagerResource>({
    getAdminData: (input = {}) =>
      client.get<FundManagerAdminData>('/auth/admin-data', {
        ...input.request,
        operationId: 'getFundManagerAdminData',
        query: {
          limit: boundedInteger(input.limit, 'limit', 1, 100),
          offset: boundedInteger(input.offset, 'offset', 0),
          search: optionalString(input.search, 'search'),
          action: optionalString(input.action, 'action'),
          recordType: optionalString(input.recordType, 'recordType'),
          recordId: optionalString(input.recordId, 'recordId'),
          dateFrom: optionalDateTime(input.dateFrom, 'dateFrom'),
          dateTo: optionalDateTime(input.dateTo, 'dateTo'),
        },
        responseMode: 'json',
        responseValidator: validateFundManagerAdminData,
      }),
  });

export type { FundManagerAdminData, OpenRecord };
export type { ResourceRequestOptions } from './helpers.js';
