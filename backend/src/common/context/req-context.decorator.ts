import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { Request } from 'express';
import { buildConfig } from '../../config/configuration';
import { REQUEST_CONTEXT_KEY, RequestContext } from './request-context';

function fallbackContext(): RequestContext {
  const defaults = buildConfig().defaults;
  return {
    countryCode: defaults.countryCode,
    currencyCode: defaults.currencyCode,
    locale: defaults.locale,
    timezone: defaults.timezone,
    platform: null,
    appVersion: null,
    userId: null,
    cohort: null,
  };
}

/** `@ReqContext() ctx: RequestContext` — the resolved per-request market context. */
export const ReqContext = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestContext => {
    const request = ctx.switchToHttp().getRequest<Request & Record<string, unknown>>();
    return (request[REQUEST_CONTEXT_KEY] as RequestContext | undefined) ?? fallbackContext();
  },
);
