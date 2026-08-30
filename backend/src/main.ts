import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import 'reflect-metadata';
import { AppModule } from './app.module';
import { AppException } from './common/errors/app-exception';
import { GlobalExceptionFilter } from './common/errors/global-exception.filter';
import { AppConfigService } from './config/app-config.service';

export async function createApp() {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  // Every route lives under /api/v1 — the contract's `servers` entry.
  app.setGlobalPrefix('api/v1');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false, // additive-only evolution: ignore unknown fields.
      transformOptions: { enableImplicitConversion: false },
      // Bypass Nest's BadRequestException entirely so the envelope is always ours.
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
  app.enableShutdownHooks();
  return app;
}

async function bootstrap(): Promise<void> {
  const app = await createApp();
  const config = app.get(AppConfigService);
  await app.listen(config.all.port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`PREISORA API listening on http://0.0.0.0:${config.all.port}/api/v1`);
}

if (require.main === module) {
  void bootstrap();
}
