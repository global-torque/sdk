import type { SdkResult, SdkServiceClient } from '../types.js';
import {
  notificationRecordSchema,
  pushSubscriptionCreateSchema,
  pushSubscriptionResponseSchema,
  type NotificationRecord,
  type PushSubscriptionCreate,
  type PushSubscriptionResponse,
} from './generated/contracts.js';
import {
  mutationRequest,
  pathSegment,
  type MutationResourceRequestOptions,
  type ResourceRequestOptions,
} from './helpers.js';
import { compileRequestValidator, compileResponseValidator } from './validation.js';

/** Configured service clients required by the two backend-owned notification contracts. @public */
export interface NotificationsResourceClients {
  notifications: SdkServiceClient;
  users: SdkServiceClient;
}

/** @public */
export interface NotificationIdInput {
  id: number;
  request?: MutationResourceRequestOptions;
}

/** @public */
export interface SubscribeNotificationDeviceInput {
  body: PushSubscriptionCreate;
  request?: MutationResourceRequestOptions;
}

/** @public */
export interface NotificationsResource {
  list(request?: ResourceRequestOptions): Promise<SdkResult<readonly NotificationRecord[]>>;
  markRead(input: NotificationIdInput): Promise<SdkResult<string>>;
  markAllRead(request?: MutationResourceRequestOptions): Promise<SdkResult<string>>;
  subscribeDevice(
    input: SubscribeNotificationDeviceInput,
  ): Promise<SdkResult<PushSubscriptionResponse>>;
}

/** @public */
export const validateNotificationListResponse = compileResponseValidator<
  readonly NotificationRecord[]
>(
  {
    type: 'array',
    items: notificationRecordSchema,
  },
  'NotificationRecord[]',
  (value) => value as readonly NotificationRecord[],
);
const subscriptionRequestValidator = compileRequestValidator<PushSubscriptionCreate>(
  pushSubscriptionCreateSchema,
  'PushSubscriptionCreate',
  (value) => value as PushSubscriptionCreate,
);
/** @public */
export const validatePushSubscriptionResponse = compileResponseValidator<PushSubscriptionResponse>(
  pushSubscriptionResponseSchema,
  'PushSubscriptionResponse',
  (value) => value as PushSubscriptionResponse,
);

/** Create notification-list and device-subscription operations over their owning service clients. @public */
export const createNotificationsResource = (
  clients: NotificationsResourceClients,
): NotificationsResource =>
  Object.freeze<NotificationsResource>({
    list: (request) =>
      clients.notifications.get<readonly NotificationRecord[]>('/notification', {
        ...request,
        responseMode: 'json',
        responseValidator: validateNotificationListResponse,
      }),
    markRead: (input) =>
      clients.notifications.put(`/notification/${pathSegment(input.id, 'id')}`, undefined, {
        ...mutationRequest(input.request),
        responseMode: 'text',
      }),
    markAllRead: (request) =>
      clients.notifications.put('/notification/all', undefined, {
        ...mutationRequest(request),
        responseMode: 'text',
      }),
    subscribeDevice: (input) =>
      clients.users.post('/auth/subscribe', subscriptionRequestValidator(input.body), {
        ...mutationRequest(input.request),
        operationId: 'PushSubscriptionCreate',
        responseMode: 'json',
        responseValidator: validatePushSubscriptionResponse,
      }),
  });

export type { NotificationRecord, PushSubscriptionCreate, PushSubscriptionResponse };
export type { MutationResourceRequestOptions, ResourceRequestOptions } from './helpers.js';
