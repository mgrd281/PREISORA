import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { AppException } from '../../common/errors/app-exception';
import { AuthenticatedRequest } from './jwt-auth.guard';

/** `@CurrentUserId() userId: string` — requires `JwtAuthGuard` on the handler. */
export const CurrentUserId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  if (!request.authUserId) throw new AppException('UNAUTHORIZED');
  return request.authUserId;
});

/** Same, but `null` when unauthenticated (pairs with `OptionalJwtAuthGuard`). */
export const OptionalUserId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | null => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.authUserId ?? null;
  },
);
