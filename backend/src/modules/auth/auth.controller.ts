import { Body, Controller, Delete, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import type { AuthTokensDto, UserIdentityDto } from '../../common/api/schemas';
import type { Page } from '../../common/pagination/page';
import { ReqContext } from '../../common/context/req-context.decorator';
import { RequestContext } from '../../common/context/request-context';
import { AppException } from '../../common/errors/app-exception';
import { AuthService } from './auth.service';
import { IdentityLinkDto, LoginDto, OAuthExchangeDto, RefreshDto, RegisterDto } from './auth.dto';
import { OptionalUserId } from './current-user.decorator';
import { JwtAuthGuard, OptionalJwtAuthGuard } from './jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('anonymous')
  @HttpCode(201)
  createAnonymousSession(@ReqContext() ctx: RequestContext): Promise<AuthTokensDto> {
    return this.auth.createAnonymousSession(ctx);
  }

  @Post('register')
  @HttpCode(201)
  @UseGuards(OptionalJwtAuthGuard)
  register(
    @Body() body: RegisterDto,
    @ReqContext() ctx: RequestContext,
    @OptionalUserId() userId: string | null,
  ): Promise<AuthTokensDto> {
    return this.auth.register(body, ctx, userId);
  }

  @Post('login')
  @HttpCode(200)
  login(@Body() body: LoginDto): Promise<AuthTokensDto> {
    return this.auth.login(body.email, body.password);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() body: RefreshDto): Promise<AuthTokensDto> {
    return this.auth.refresh(body.refreshToken);
  }

  // ---------------------------------------------------------------------------
  // STUBBED (x-preisora-status: stubbed). Shapes are final; the bodies are typed
  // against the contract so they compile the day the feature ships (ADR-0003).
  // ---------------------------------------------------------------------------

  @Post('oauth')
  exchangeOAuthToken(@Body() _body: OAuthExchangeDto): Promise<AuthTokensDto> {
    throw AppException.notImplemented('auth.oauth');
  }

  @Get('identities')
  @UseGuards(JwtAuthGuard)
  listIdentities(): Promise<Page<UserIdentityDto>> {
    throw AppException.notImplemented('auth.identities.list');
  }

  @Post('identities')
  @UseGuards(JwtAuthGuard)
  linkIdentity(@Body() _body: IdentityLinkDto): Promise<UserIdentityDto> {
    throw AppException.notImplemented('auth.identities.link');
  }

  @Delete('identities/:identityId')
  @UseGuards(JwtAuthGuard)
  unlinkIdentity(): Promise<void> {
    throw AppException.notImplemented('auth.identities.unlink');
  }
}
