import type {
  SdkAuthorizationAuthStrategy,
  SdkBearerAuthStrategy,
  SdkCookieAuthStrategy,
  SdkNoUserAuthStrategy,
} from './types.js';

/** @public */
export const authorizationAuth = (
  options: Omit<SdkAuthorizationAuthStrategy, 'kind'>,
): Readonly<SdkAuthorizationAuthStrategy> => Object.freeze({ ...options, kind: 'authorization' });

/** @public */
export const cookieAuth = (
  options: Omit<SdkCookieAuthStrategy, 'kind'> = {},
): Readonly<SdkCookieAuthStrategy> => Object.freeze({ ...options, kind: 'cookie' });

/** @public */
export const bearerAuth = (
  options: Omit<SdkBearerAuthStrategy, 'kind'>,
): Readonly<SdkBearerAuthStrategy> => Object.freeze({ ...options, kind: 'bearer' });

/** @public */
export const noUserAuth = (
  options: Omit<SdkNoUserAuthStrategy, 'kind'> = {},
): Readonly<SdkNoUserAuthStrategy> => Object.freeze({ ...options, kind: 'none' });
