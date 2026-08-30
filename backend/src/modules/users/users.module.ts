import {
  Body,
  Controller,
  Get,
  Inject,
  Injectable,
  Module,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { eq } from 'drizzle-orm';
import type { UserDto, UserPreferencesDto, UserUpdateRequestDto } from './users.types';
import { AppException } from '../../common/errors/app-exception';
import { DATABASE, Database } from '../../database/database.module';
import { users } from '../../database/schema';
import { CurrentUserId } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

export class UserUpdateDto implements UserUpdateRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  displayName?: string | null;

  @IsOptional()
  @Matches(/^[A-Z]{2}$/)
  countryCode?: string;

  @IsOptional()
  @Matches(/^[a-z]{2}(-[A-Z]{2})?$/)
  locale?: string;
}

@Injectable()
export class UsersService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async getById(userId: string): Promise<UserDto> {
    const [row] = await this.db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        countryCode: users.countryCode,
        locale: users.locale,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    // A valid token whose account vanished is an authentication problem, not a 404.
    if (!row) throw new AppException('UNAUTHORIZED');
    return {
      id: row.id,
      email: row.email,
      displayName: row.displayName,
      countryCode: row.countryCode.trim(),
      locale: row.locale,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async update(userId: string, patch: UserUpdateDto): Promise<UserDto> {
    const update: Record<string, unknown> = {};
    if (patch.displayName !== undefined) update.displayName = patch.displayName;
    if (patch.countryCode !== undefined) update.countryCode = patch.countryCode;
    if (patch.locale !== undefined) update.locale = patch.locale;

    if (Object.keys(update).length > 0) {
      update.updatedAt = new Date();
      await this.db.update(users).set(update).where(eq(users.id, userId));
    }
    return this.getById(userId);
  }
}

@Controller('users/me')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  getCurrentUser(@CurrentUserId() userId: string): Promise<UserDto> {
    return this.usersService.getById(userId);
  }

  @Patch()
  updateCurrentUser(
    @CurrentUserId() userId: string,
    @Body() body: UserUpdateDto,
  ): Promise<UserDto> {
    return this.usersService.update(userId, body);
  }

  // STUBBED (constitution §12 sync seam): the UserPreferences shape is final, the
  // storage is not built yet, so both operations answer 501 per the contract.
  @Get('preferences')
  getUserPreferences(): Promise<UserPreferencesDto> {
    throw AppException.notImplemented('users.preferences.read');
  }

  @Patch('preferences')
  updateUserPreferences(): Promise<UserPreferencesDto> {
    throw AppException.notImplemented('users.preferences.write');
  }
}

@Module({
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
