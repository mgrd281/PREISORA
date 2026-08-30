import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { AppException } from './app-exception';
import { ERROR_CATALOG, ErrorEnvelope, buildErrorEnvelope } from './error-codes';

/**
 * The only thing that ever writes an error body.
 *
 * Everything is mapped into `{code, messageKey, details, retryable}`:
 *  - `AppException`            -> its own envelope
 *  - ValidationPipe 400        -> VALIDATION_FAILED (with the offending fields)
 *  - ThrottlerException / 429  -> RATE_LIMITED
 *  - Nest 401                  -> UNAUTHORIZED
 *  - Nest 404 (no route)       -> RESOURCE_NOT_FOUND
 *  - anything else             -> SERVICE_TEMPORARILY_UNAVAILABLE (retryable)
 *
 * Stack traces are logged, never serialized.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { status, envelope } = this.toEnvelope(exception);

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.originalUrl} -> ${status} ${envelope.code}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.debug?.(
        `${request.method} ${request.originalUrl} -> ${status} ${envelope.code}`,
      );
    }

    if (response.headersSent) return;
    response.status(status).json(envelope);
  }

  private toEnvelope(exception: unknown): { status: number; envelope: ErrorEnvelope } {
    if (exception instanceof AppException) {
      return { status: exception.httpStatus, envelope: exception.envelope };
    }

    if (exception instanceof ThrottlerException) {
      return {
        status: ERROR_CATALOG.RATE_LIMITED.httpStatus,
        envelope: buildErrorEnvelope('RATE_LIMITED'),
      };
    }

    if (exception instanceof HttpException) {
      return this.fromHttpException(exception);
    }

    return {
      status: ERROR_CATALOG.SERVICE_TEMPORARILY_UNAVAILABLE.httpStatus,
      envelope: buildErrorEnvelope('SERVICE_TEMPORARILY_UNAVAILABLE'),
    };
  }

  private fromHttpException(exception: HttpException): {
    status: number;
    envelope: ErrorEnvelope;
  } {
    const status = exception.getStatus();
    const body = exception.getResponse();

    if (status === HttpStatus.BAD_REQUEST) {
      return {
        status: ERROR_CATALOG.VALIDATION_FAILED.httpStatus,
        envelope: buildErrorEnvelope('VALIDATION_FAILED', this.validationDetails(body)),
      };
    }
    if (status === HttpStatus.UNAUTHORIZED) {
      return {
        status: ERROR_CATALOG.UNAUTHORIZED.httpStatus,
        envelope: buildErrorEnvelope('UNAUTHORIZED'),
      };
    }
    if (status === HttpStatus.TOO_MANY_REQUESTS) {
      return {
        status: ERROR_CATALOG.RATE_LIMITED.httpStatus,
        envelope: buildErrorEnvelope('RATE_LIMITED'),
      };
    }
    if (status === HttpStatus.NOT_FOUND) {
      // An unmatched route is a missing resource, never a missing PRODUCT.
      return {
        status: ERROR_CATALOG.RESOURCE_NOT_FOUND.httpStatus,
        envelope: buildErrorEnvelope('RESOURCE_NOT_FOUND', { resource: 'route' }, 'error.route_not_found'),
      };
    }
    if (status === HttpStatus.NOT_IMPLEMENTED) {
      return {
        status: ERROR_CATALOG.FEATURE_NOT_AVAILABLE.httpStatus,
        envelope: buildErrorEnvelope('FEATURE_NOT_AVAILABLE'),
      };
    }
    if (status === HttpStatus.PAYLOAD_TOO_LARGE || status === HttpStatus.UNSUPPORTED_MEDIA_TYPE) {
      return {
        status: ERROR_CATALOG.VALIDATION_FAILED.httpStatus,
        envelope: buildErrorEnvelope('VALIDATION_FAILED', { httpStatus: status }),
      };
    }

    // Any other HttpException (403, 409, 5xx, ...) collapses to the retryable
    // service envelope rather than leaking a framework-shaped body.
    return {
      status: ERROR_CATALOG.SERVICE_TEMPORARILY_UNAVAILABLE.httpStatus,
      envelope: buildErrorEnvelope('SERVICE_TEMPORARILY_UNAVAILABLE'),
    };
  }

  /** Extracts ValidationPipe's `message` array into machine-readable details. */
  private validationDetails(body: unknown): Record<string, unknown> | null {
    if (typeof body !== 'object' || body === null) return null;
    const message = (body as { message?: unknown }).message;
    if (Array.isArray(message)) {
      return { issues: message.map((m) => String(m)) };
    }
    if (typeof message === 'string') {
      return { issues: [message] };
    }
    return null;
  }
}
