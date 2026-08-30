import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import { AppConfigService } from '../../config/app-config.service';

export interface AccessTokenClaims {
  /** `users.id` — the ONE primary identity (constitution §11). */
  sub: string;
}

/**
 * Pure token mechanics: no database, so the RequestContext middleware and the auth
 * guard can both depend on it without pulling in the whole auth service graph.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
  ) {}

  get accessTtlSeconds(): number {
    return this.config.jwt.accessTtlSeconds;
  }

  signAccessToken(userId: string): string {
    return this.jwt.sign(
      { sub: userId },
      {
        secret: this.config.jwt.accessSecret,
        expiresIn: this.config.jwt.accessTtlSeconds,
      },
    );
  }

  /** Throws on any problem; callers that must not fail use `tryVerifyAccessToken`. */
  verifyAccessToken(token: string): AccessTokenClaims {
    return this.jwt.verify<AccessTokenClaims>(token, {
      secret: this.config.jwt.accessSecret,
    });
  }

  /** Extracts a bearer token from an Authorization header value. */
  static extractBearer(header: string | undefined): string | null {
    if (!header) return null;
    const [scheme, value] = header.split(' ');
    if (!value || scheme.toLowerCase() !== 'bearer') return null;
    return value.trim() === '' ? null : value.trim();
  }

  /** Best-effort verification — returns `null` instead of throwing. */
  tryVerifyAccessToken(authorizationHeader: string | undefined): AccessTokenClaims | null {
    const token = TokenService.extractBearer(authorizationHeader);
    if (!token) return null;
    try {
      return this.verifyAccessToken(token);
    } catch {
      return null;
    }
  }

  /**
   * Refresh tokens are opaque random strings, never JWTs: they are single-use and
   * must be revocable, which a stateless token cannot be.
   */
  generateRefreshToken(): { token: string; hash: string; expiresAt: Date } {
    const token = randomBytes(48).toString('base64url');
    return {
      token,
      hash: TokenService.hashRefreshToken(token),
      expiresAt: new Date(Date.now() + this.config.jwt.refreshTtlDays * 24 * 60 * 60 * 1000),
    };
  }

  static hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
