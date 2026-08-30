/**
 * THE error catalog (constitution §32).
 *
 * This enum mirrors `api-contract/schemas/Error.yaml` VERBATIM and is mirrored in
 * turn by `docs/domain-glossary.md` and the iOS `APIErrorCode`. The catalog is
 * closed: growing it is an additive change that must update all four places in one
 * PR (CONVENTIONS.md "Errors").
 */
export const ERROR_CODES = [
  'PRODUCT_NOT_FOUND',
  'RESOURCE_NOT_FOUND',
  'NO_CURRENT_PRICES',
  'INVALID_GTIN',
  'LOCATION_REQUIRED',
  'RATE_LIMITED',
  'SERVICE_TEMPORARILY_UNAVAILABLE',
  'VALIDATION_FAILED',
  'FEATURE_NOT_AVAILABLE',
  'UNAUTHORIZED',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ErrorDefinition {
  /** HTTP status this code is always served with. */
  httpStatus: number;
  /** Default dot-namespaced localization key; per-throw overrides are allowed. */
  messageKey: string;
  /** Whether retrying the identical request may succeed. */
  retryable: boolean;
}

export const ERROR_CATALOG: Readonly<Record<ErrorCode, ErrorDefinition>> = Object.freeze({
  PRODUCT_NOT_FOUND: {
    httpStatus: 404,
    messageKey: 'error.product_not_found',
    retryable: false,
  },
  RESOURCE_NOT_FOUND: {
    httpStatus: 404,
    messageKey: 'error.resource_not_found',
    retryable: false,
  },
  NO_CURRENT_PRICES: {
    // Deliberate 404 on the offers endpoint (CONVENTIONS.md, orchestrator decision #6).
    httpStatus: 404,
    messageKey: 'error.no_current_prices',
    retryable: false,
  },
  INVALID_GTIN: {
    httpStatus: 400,
    messageKey: 'error.invalid_gtin',
    retryable: false,
  },
  LOCATION_REQUIRED: {
    httpStatus: 400,
    messageKey: 'error.location_required',
    retryable: false,
  },
  RATE_LIMITED: {
    httpStatus: 429,
    messageKey: 'error.rate_limited',
    retryable: true,
  },
  SERVICE_TEMPORARILY_UNAVAILABLE: {
    httpStatus: 503,
    messageKey: 'error.service_temporarily_unavailable',
    retryable: true,
  },
  VALIDATION_FAILED: {
    httpStatus: 400,
    messageKey: 'error.validation_failed',
    retryable: false,
  },
  FEATURE_NOT_AVAILABLE: {
    httpStatus: 501,
    messageKey: 'error.feature_not_available',
    retryable: false,
  },
  UNAUTHORIZED: {
    httpStatus: 401,
    messageKey: 'error.unauthorized',
    retryable: false,
  },
});

/** The single wire error envelope. Nothing else ever leaves the API on a 4xx/5xx. */
export interface ErrorEnvelope {
  code: ErrorCode;
  messageKey: string;
  details: Record<string, unknown> | null;
  retryable: boolean;
}

export function buildErrorEnvelope(
  code: ErrorCode,
  details: Record<string, unknown> | null = null,
  messageKeyOverride?: string,
): ErrorEnvelope {
  const definition = ERROR_CATALOG[code];
  return {
    code,
    messageKey: messageKeyOverride ?? definition.messageKey,
    details,
    retryable: definition.retryable,
  };
}
