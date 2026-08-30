import {
  ArgumentsHost,
  BadRequestException,
  HttpException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { AppException } from './app-exception';
import { ERROR_CATALOG, ERROR_CODES, ErrorEnvelope } from './error-codes';
import { GlobalExceptionFilter } from './global-exception.filter';

interface Captured {
  status: number;
  body: ErrorEnvelope;
}

// The filter logs unexpected failures at error level by design; keep the suite quiet.
beforeAll(() => {
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
});
afterAll(() => jest.restoreAllMocks());

function run(exception: unknown): Captured {
  const captured: Partial<Captured> = {};
  const response = {
    headersSent: false,
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(body: ErrorEnvelope) {
      captured.body = body;
      return this;
    },
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ method: 'GET', originalUrl: '/api/v1/test' }),
    }),
  } as unknown as ArgumentsHost;

  new GlobalExceptionFilter().catch(exception, host);
  return captured as Captured;
}

describe('error catalog', () => {
  it('mirrors the contract Error enum verbatim, in order', () => {
    expect([...ERROR_CODES]).toEqual([
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
    ]);
  });

  it('defines every code with a status, a messageKey and a retryable flag', () => {
    for (const code of ERROR_CODES) {
      const definition = ERROR_CATALOG[code];
      expect(definition.httpStatus).toBeGreaterThanOrEqual(400);
      expect(definition.messageKey).toMatch(/^error\.[a-z_]+$/);
      expect(typeof definition.retryable).toBe('boolean');
    }
  });

  it('marks exactly RATE_LIMITED and SERVICE_TEMPORARILY_UNAVAILABLE retryable', () => {
    const retryable = ERROR_CODES.filter((code) => ERROR_CATALOG[code].retryable);
    expect(retryable).toEqual(['RATE_LIMITED', 'SERVICE_TEMPORARILY_UNAVAILABLE']);
  });
});

describe('GlobalExceptionFilter', () => {
  it('serializes every response as the four-field envelope', () => {
    const { body } = run(new AppException('PRODUCT_NOT_FOUND', { gtin: '4012345000016' }));
    expect(Object.keys(body).sort()).toEqual(['code', 'details', 'messageKey', 'retryable']);
  });

  it('passes an AppException through with its catalog status', () => {
    const { status, body } = run(new AppException('NO_CURRENT_PRICES', { radiusMeters: 5000 }));
    expect(status).toBe(404);
    expect(body).toEqual({
      code: 'NO_CURRENT_PRICES',
      messageKey: 'error.no_current_prices',
      details: { radiusMeters: 5000 },
      retryable: false,
    });
  });

  it('keeps a per-resource messageKey override', () => {
    const { status, body } = run(AppException.resourceNotFound('store'));
    expect(status).toBe(404);
    expect(body.code).toBe('RESOURCE_NOT_FOUND');
    expect(body.messageKey).toBe('error.store_not_found');
    expect(body.details).toEqual({ resource: 'store' });
  });

  it('maps a validation failure to VALIDATION_FAILED with the offending issues', () => {
    const { status, body } = run(
      new BadRequestException({ message: ['lat must be a number'], statusCode: 400 }),
    );
    expect(status).toBe(400);
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.details).toEqual({ issues: ['lat must be a number'] });
    expect(body.retryable).toBe(false);
  });

  it('maps the throttler exception to RATE_LIMITED (retryable)', () => {
    const { status, body } = run(new ThrottlerException());
    expect(status).toBe(429);
    expect(body.code).toBe('RATE_LIMITED');
    expect(body.retryable).toBe(true);
  });

  it('maps a Nest 401 to UNAUTHORIZED', () => {
    const { status, body } = run(new UnauthorizedException());
    expect(status).toBe(401);
    expect(body.code).toBe('UNAUTHORIZED');
  });

  it('maps an unmatched route to RESOURCE_NOT_FOUND, never PRODUCT_NOT_FOUND', () => {
    const { status, body } = run(new NotFoundException());
    expect(status).toBe(404);
    expect(body.code).toBe('RESOURCE_NOT_FOUND');
    expect(body.messageKey).toBe('error.route_not_found');
  });

  it('maps an unexpected error to SERVICE_TEMPORARILY_UNAVAILABLE and leaks no stack', () => {
    const boom = new Error('connection to 10.0.0.5:5432 refused: password=hunter2');
    const { status, body } = run(boom);
    expect(status).toBe(503);
    expect(body).toEqual({
      code: 'SERVICE_TEMPORARILY_UNAVAILABLE',
      messageKey: 'error.service_temporarily_unavailable',
      details: null,
      retryable: true,
    });
    expect(JSON.stringify(body)).not.toContain('hunter2');
  });

  it('collapses an exotic HttpException rather than leaking a framework body', () => {
    const { status, body } = run(new HttpException({ secret: 'internal' }, 409));
    expect(status).toBe(503);
    expect(body.code).toBe('SERVICE_TEMPORARILY_UNAVAILABLE');
    expect(JSON.stringify(body)).not.toContain('internal');
  });

  it('answers a stubbed operation with 501 FEATURE_NOT_AVAILABLE', () => {
    const { status, body } = run(AppException.notImplemented('auth.oauth'));
    expect(status).toBe(501);
    expect(body.code).toBe('FEATURE_NOT_AVAILABLE');
    expect(body.retryable).toBe(false);
  });
});
