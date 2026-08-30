import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Inject,
  Injectable,
  Module,
  Param,
  Patch,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { IsIn, IsOptional, IsString, Matches, MinLength } from 'class-validator';
import { and, eq } from 'drizzle-orm';
import { Response } from 'express';
import type {
  DeviceDto,
  DeviceRegisterRequestDto,
  DeviceUpdateRequestDto,
} from '../../common/api/schemas';
import { AppException } from '../../common/errors/app-exception';
import { ParseUuidPipe } from '../../common/validation/uuid.pipe';
import { DATABASE, Database } from '../../database/database.module';
import { DevicePlatform, devices } from '../../database/schema';
import { CurrentUserId } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

export class DeviceRegisterDto implements DeviceRegisterRequestDto {
  @IsIn(['ios', 'android'])
  platform!: DevicePlatform;

  @IsString()
  @MinLength(1)
  pushToken!: string;

  @IsString()
  @MinLength(1)
  appVersion!: string;

  @Matches(/^[a-z]{2}(-[A-Z]{2})?$/)
  locale!: string;
}

export class DeviceUpdateDto implements DeviceUpdateRequestDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  pushToken?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  appVersion?: string;

  @IsOptional()
  @Matches(/^[a-z]{2}(-[A-Z]{2})?$/)
  locale?: string;
}

interface DeviceRow {
  id: string;
  platform: DevicePlatform;
  pushToken: string;
  appVersion: string;
  locale: string;
  createdAt: Date;
  lastSeenAt: Date;
}

const DEVICE_COLUMNS = {
  id: devices.id,
  platform: devices.platform,
  pushToken: devices.pushToken,
  appVersion: devices.appVersion,
  locale: devices.locale,
  createdAt: devices.createdAt,
  lastSeenAt: devices.lastSeenAt,
} as const;

function toDeviceDto(row: DeviceRow): DeviceDto {
  return {
    id: row.id,
    platform: row.platform,
    pushToken: row.pushToken,
    appVersion: row.appVersion,
    locale: row.locale,
    createdAt: row.createdAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
  };
}

@Injectable()
export class DevicesService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Upsert on the natural key (user, platform, pushToken): 201 new / 200 refreshed. */
  async register(
    userId: string,
    input: DeviceRegisterDto,
  ): Promise<{ device: DeviceDto; created: boolean }> {
    const [existing] = await this.db
      .select(DEVICE_COLUMNS)
      .from(devices)
      .where(
        and(
          eq(devices.userId, userId),
          eq(devices.platform, input.platform),
          eq(devices.pushToken, input.pushToken),
        ),
      )
      .limit(1);

    if (existing) {
      const [refreshed] = await this.db
        .update(devices)
        .set({ appVersion: input.appVersion, locale: input.locale, lastSeenAt: new Date() })
        .where(eq(devices.id, existing.id))
        .returning(DEVICE_COLUMNS);
      return { device: toDeviceDto(refreshed), created: false };
    }

    const [row] = await this.db
      .insert(devices)
      .values({
        userId,
        platform: input.platform,
        pushToken: input.pushToken,
        appVersion: input.appVersion,
        locale: input.locale,
      })
      .returning(DEVICE_COLUMNS);
    return { device: toDeviceDto(row), created: true };
  }

  async update(userId: string, deviceId: string, patch: DeviceUpdateDto): Promise<DeviceDto> {
    const update: Record<string, unknown> = { lastSeenAt: new Date() };
    if (patch.pushToken !== undefined) update.pushToken = patch.pushToken;
    if (patch.appVersion !== undefined) update.appVersion = patch.appVersion;
    if (patch.locale !== undefined) update.locale = patch.locale;

    const rows = await this.db
      .update(devices)
      .set(update)
      .where(and(eq(devices.id, deviceId), eq(devices.userId, userId)))
      .returning(DEVICE_COLUMNS);

    if (rows.length === 0) throw AppException.resourceNotFound('device');
    return toDeviceDto(rows[0]);
  }

  async remove(userId: string, deviceId: string): Promise<void> {
    await this.db.delete(devices).where(and(eq(devices.id, deviceId), eq(devices.userId, userId)));
  }

  /** Push targets for the notification dispatcher. */
  async listForUser(userId: string): Promise<DeviceRow[]> {
    return this.db.select(DEVICE_COLUMNS).from(devices).where(eq(devices.userId, userId));
  }
}

@Controller('devices')
@UseGuards(JwtAuthGuard)
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Post()
  async registerDevice(
    @CurrentUserId() userId: string,
    @Body() body: DeviceRegisterDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<DeviceDto> {
    const { device, created } = await this.devicesService.register(userId, body);
    res.status(created ? 201 : 200);
    return device;
  }

  @Patch(':deviceId')
  updateDevice(
    @CurrentUserId() userId: string,
    @Param('deviceId', ParseUuidPipe) deviceId: string,
    @Body() body: DeviceUpdateDto,
  ): Promise<DeviceDto> {
    return this.devicesService.update(userId, deviceId, body);
  }

  @Delete(':deviceId')
  @HttpCode(204)
  deleteDevice(
    @CurrentUserId() userId: string,
    @Param('deviceId', ParseUuidPipe) deviceId: string,
  ): Promise<void> {
    return this.devicesService.remove(userId, deviceId);
  }
}

@Module({
  controllers: [DevicesController],
  providers: [DevicesService],
  exports: [DevicesService],
})
export class DevicesModule {}
