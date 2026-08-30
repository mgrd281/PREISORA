import { Inject, Injectable } from '@nestjs/common';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { AuthTokensDto } from '../../common/api/schemas';
import { RequestContext } from '../../common/context/request-context';
import { AppException } from '../../common/errors/app-exception';
import { DATABASE, Database } from '../../database/database.module';
import { refreshTokens, userIdentities, users } from '../../database/schema';
import { TokenService } from './token.service';

@Injectable()
export class AuthService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly tokens: TokenService,
  ) {}

  /**
   * The scan-before-signup funnel entry (orchestrator decision #3): a real account
   * with an `anonymous` identity row, and the same AuthTokens email login issues.
   */
  async createAnonymousSession(ctx: RequestContext): Promise<AuthTokensDto> {
    const userId = await this.db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({ countryCode: ctx.countryCode, locale: ctx.locale })
        .returning({ id: users.id });
      await tx.insert(userIdentities).values({
        userId: user.id,
        provider: 'anonymous',
        providerSubject: null,
      });
      return user.id;
    });
    return this.issueTokens(userId);
  }

  /**
   * With a valid bearer token the email identity is LINKED to the existing account,
   * so scans and favorites collected anonymously survive the upgrade.
   */
  async register(
    input: { email: string; password: string; displayName?: string },
    ctx: RequestContext,
    existingUserId: string | null,
  ): Promise<AuthTokensDto> {
    const email = input.email.trim().toLowerCase();

    const [taken] = await this.db
      .select({ id: userIdentities.id })
      .from(userIdentities)
      .where(and(eq(userIdentities.provider, 'email'), eq(userIdentities.providerSubject, email)))
      .limit(1);
    if (taken) {
      // No 409s on this platform (CONVENTIONS.md) — a duplicate email is a validation
      // failure with a specific messageKey.
      throw new AppException('VALIDATION_FAILED', { field: 'email' }, 'error.email_already_registered');
    }

    const passwordHash = await argonHash(input.password);

    const userId = await this.db.transaction(async (tx) => {
      let targetUserId = existingUserId;

      if (targetUserId) {
        const [existing] = await tx
          .select({ id: users.id, email: users.email })
          .from(users)
          .where(eq(users.id, targetUserId))
          .limit(1);
        if (!existing) targetUserId = null;
        else if (existing.email) {
          // The account already has an email identity — registering a second one is
          // an identity-linking operation, which is stubbed in v1.
          throw new AppException('VALIDATION_FAILED', { field: 'email' }, 'error.email_already_registered');
        }
      }

      if (!targetUserId) {
        const [created] = await tx
          .insert(users)
          .values({
            countryCode: ctx.countryCode,
            locale: ctx.locale,
            email,
            displayName: input.displayName ?? null,
          })
          .returning({ id: users.id });
        targetUserId = created.id;
      } else {
        await tx
          .update(users)
          .set({
            email,
            displayName: input.displayName ?? undefined,
            updatedAt: new Date(),
          })
          .where(eq(users.id, targetUserId));
      }

      await tx.insert(userIdentities).values({
        userId: targetUserId,
        provider: 'email',
        providerSubject: email,
        passwordHash,
      });

      return targetUserId;
    });

    return this.issueTokens(userId);
  }

  async login(email: string, password: string): Promise<AuthTokensDto> {
    const normalized = email.trim().toLowerCase();
    const [identity] = await this.db
      .select({ userId: userIdentities.userId, passwordHash: userIdentities.passwordHash })
      .from(userIdentities)
      .where(and(eq(userIdentities.provider, 'email'), eq(userIdentities.providerSubject, normalized)))
      .limit(1);

    // Unknown email and wrong password are deliberately indistinguishable.
    if (!identity?.passwordHash) {
      throw new AppException('UNAUTHORIZED', null, 'error.invalid_credentials');
    }
    const ok = await argonVerify(identity.passwordHash, password).catch(() => false);
    if (!ok) {
      throw new AppException('UNAUTHORIZED', null, 'error.invalid_credentials');
    }
    return this.issueTokens(identity.userId);
  }

  /** Single-use refresh with rotation: the presented token is revoked here. */
  async refresh(refreshToken: string): Promise<AuthTokensDto> {
    const tokenHash = TokenService.hashRefreshToken(refreshToken);
    const now = new Date();

    // Revocation IS the guard: one atomic conditional UPDATE, so of two concurrent
    // requests presenting the same token exactly one wins the row — no
    // SELECT-then-UPDATE window in which both could redeem it.
    const [row] = await this.db
      .update(refreshTokens)
      .set({ revokedAt: now })
      .where(
        and(
          eq(refreshTokens.tokenHash, tokenHash),
          isNull(refreshTokens.revokedAt),
          gt(refreshTokens.expiresAt, now),
        ),
      )
      .returning({ userId: refreshTokens.userId });

    if (!row) {
      throw new AppException('UNAUTHORIZED', null, 'error.invalid_refresh_token');
    }

    return this.issueTokens(row.userId);
  }

  private async issueTokens(userId: string): Promise<AuthTokensDto> {
    const refresh = this.tokens.generateRefreshToken();
    await this.db.insert(refreshTokens).values({
      userId,
      tokenHash: refresh.hash,
      expiresAt: refresh.expiresAt,
    });
    return {
      accessToken: this.tokens.signAccessToken(userId),
      refreshToken: refresh.token,
      expiresIn: this.tokens.accessTtlSeconds,
    };
  }
}
