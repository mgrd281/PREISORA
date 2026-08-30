import { ERROR_CATALOG, ErrorCode, ErrorEnvelope, buildErrorEnvelope } from './error-codes';

/**
 * The only exception services throw. `GlobalExceptionFilter` serializes it to the
 * wire envelope; the HTTP status comes from the catalog, never from the call site.
 */
export class AppException extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly envelope: ErrorEnvelope;

  constructor(
    code: ErrorCode,
    details: Record<string, unknown> | null = null,
    messageKeyOverride?: string,
  ) {
    super(`${code}: ${messageKeyOverride ?? ERROR_CATALOG[code].messageKey}`);
    this.name = 'AppException';
    this.code = code;
    this.httpStatus = ERROR_CATALOG[code].httpStatus;
    this.envelope = buildErrorEnvelope(code, details, messageKeyOverride);
  }

  /**
   * `RESOURCE_NOT_FOUND` with the precise per-resource messageKey the contract
   * documents (`error.store_not_found`, `error.alert_not_found`, ...).
   */
  static resourceNotFound(resource: string): AppException {
    return new AppException('RESOURCE_NOT_FOUND', { resource }, `error.${resource}_not_found`);
  }

  static productNotFound(details: Record<string, unknown> | null = null): AppException {
    return new AppException('PRODUCT_NOT_FOUND', details);
  }

  /** Every stubbed operation answers exactly this (ADR-0003). */
  static notImplemented(feature: string): AppException {
    return new AppException('FEATURE_NOT_AVAILABLE', { feature });
  }
}
