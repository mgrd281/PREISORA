import { INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AppException } from '../src/common/errors/app-exception';
import { GlobalExceptionFilter } from '../src/common/errors/global-exception.filter';
import { ValidationPipe } from '@nestjs/common';

export const API = '/api/v1';

/** Berlin Mitte — the coordinate the seeded stores are laid out around. */
export const BERLIN = { lat: 52.52, lng: 13.405 };
/** Munich — deliberately outside every seeded store's radius. */
export const MUNICH = { lat: 48.1372, lng: 11.5755 };

export const SEEDED_GTIN_MILK = '4012345000016';
export const SEEDED_GTIN_BUTTER = '4012345000023';
export const SEEDED_GTIN_COFFEE = '4012345000085';

/**
 * Boots the real application graph with the SAME global prefix, pipe and filter
 * `src/main.ts` installs — an e2e run that diverged from production wiring would
 * prove nothing.
 */
export async function createTestApp(): Promise<INestApplication> {
  Logger.overrideLogger(['error']);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
      transformOptions: { enableImplicitConversion: false },
      exceptionFactory: (errors) =>
        new AppException('VALIDATION_FAILED', {
          issues: errors.flatMap((error) =>
            Object.values(error.constraints ?? { invalid: `${error.property} is invalid` }),
          ),
          fields: errors.map((error) => error.property),
        }),
    }),
  );
  app.useGlobalFilters(new GlobalExceptionFilter());
  await app.init();
  return app;
}

export function http(app: INestApplication) {
  return request(app.getHttpServer());
}

/**
 * Asserts a body is EXACTLY the platform error envelope with the expected code:
 * four fields, no more, `details` present (possibly null), and no leaked internals.
 */
export function expectErrorEnvelope(body: unknown, code: string): void {
  expect(Object.keys(body as object).sort()).toEqual([
    'code',
    'details',
    'messageKey',
    'retryable',
  ]);
  const envelope = body as {
    code: string;
    messageKey: string;
    details: unknown;
    retryable: unknown;
  };
  expect(envelope.code).toBe(code);
  expect(envelope.messageKey).toMatch(/^error\.[a-z_]+$/);
  expect(typeof envelope.retryable).toBe('boolean');
  expect(envelope.details === null || typeof envelope.details === 'object').toBe(true);
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  auth: string;
}

/** A fresh anonymous account — the scan-before-signup funnel entry. */
export async function anonymousSession(app: INestApplication): Promise<AuthSession> {
  const response = await http(app).post(`${API}/auth/anonymous`).expect(201);
  return {
    accessToken: response.body.accessToken,
    refreshToken: response.body.refreshToken,
    auth: `Bearer ${response.body.accessToken}`,
  };
}

export async function productIdByGtin(app: INestApplication, gtin: string): Promise<string> {
  const response = await http(app).get(`${API}/products/by-gtin/${gtin}`).expect(200);
  return response.body.id as string;
}
