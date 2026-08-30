/**
 * Everything market-, locale- and client-dependent a request carries, resolved once
 * per request by `RequestContextMiddleware`. Services read this instead of headers —
 * and never hardcode a market (constitution §24).
 */
export interface RequestContext {
  countryCode: string;
  currencyCode: string;
  locale: string;
  timezone: string;
  /** From `X-App-Platform`; `null` when the caller did not declare one. */
  platform: 'ios' | 'android' | null;
  /** From `X-App-Version`; `null` when the caller did not declare one. */
  appVersion: string | null;
  /** Authenticated account id, when a valid bearer token was presented. */
  userId: string | null;
  /** Feature-flag cohort of the authenticated user, when set. */
  cohort: string | null;
}

export const REQUEST_CONTEXT_KEY = 'preisoraContext';
