import { Injectable } from '@nestjs/common';
import { AppException } from '../../../common/errors/app-exception';

export interface VerifiedIdentity {
  /** Stable provider subject; becomes `user_identities.provider_subject`. */
  subject: string;
  email: string | null;
}

/**
 * The seam for Sign in with Apple / Google.
 *
 * Real implementations verify the provider ID token against the provider's JWKS.
 * v1 ships stubs only, and the operations that would use them are contract-`stubbed`
 * (they answer 501 `FEATURE_NOT_AVAILABLE`), so no unverified token can ever mint a
 * PREISORA session.
 */
export interface IdentityProviderVerifier {
  readonly provider: 'apple' | 'google';
  verify(idToken: string): Promise<VerifiedIdentity>;
}

@Injectable()
export class AppleIdentityProviderVerifier implements IdentityProviderVerifier {
  readonly provider = 'apple' as const;

  async verify(_idToken: string): Promise<VerifiedIdentity> {
    // STUB: real verification needs Apple's JWKS + audience/issuer checks.
    throw AppException.notImplemented('auth.apple');
  }
}

@Injectable()
export class GoogleIdentityProviderVerifier implements IdentityProviderVerifier {
  readonly provider = 'google' as const;

  async verify(_idToken: string): Promise<VerifiedIdentity> {
    // STUB: real verification needs Google's JWKS + audience/issuer checks.
    throw AppException.notImplemented('auth.google');
  }
}

export const IDENTITY_PROVIDER_VERIFIERS = Symbol('PREISORA_IDENTITY_PROVIDER_VERIFIERS');
