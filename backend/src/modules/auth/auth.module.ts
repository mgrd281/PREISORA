import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import {
  AppleIdentityProviderVerifier,
  GoogleIdentityProviderVerifier,
} from './identity-providers/identity-provider-verifier';
import { JwtAuthGuard, OptionalJwtAuthGuard } from './jwt-auth.guard';
import { TokenService } from './token.service';

/**
 * Global so every user-scoped module can `@UseGuards(JwtAuthGuard)` without
 * re-importing the auth graph.
 */
@Global()
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    JwtAuthGuard,
    OptionalJwtAuthGuard,
    AppleIdentityProviderVerifier,
    GoogleIdentityProviderVerifier,
  ],
  exports: [TokenService, JwtAuthGuard, OptionalJwtAuthGuard],
})
export class AuthModule {}
