import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ThrottlerLimitDetail } from '@nestjs/throttler/dist/throttler.guard.interface';
import { Response } from 'express';
import { AppException } from '../errors/app-exception';

/**
 * Turns the throttler's own exception into the platform's single error envelope and
 * emits the `RateLimit-*` headers the contract documents on every 429 response.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected async throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const res = context.switchToHttp().getResponse<Response>();
    const resetSeconds = detail.timeToBlockExpire > 0 ? detail.timeToBlockExpire : detail.timeToExpire;
    if (typeof res?.setHeader === 'function') {
      res.setHeader('RateLimit-Limit', detail.limit);
      res.setHeader('RateLimit-Remaining', 0);
      res.setHeader('RateLimit-Reset', resetSeconds);
      res.setHeader('Retry-After', resetSeconds);
    }
    throw new AppException('RATE_LIMITED', {
      limit: detail.limit,
      retryAfterSeconds: resetSeconds,
    });
  }
}
