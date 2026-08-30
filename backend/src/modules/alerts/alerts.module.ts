import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Module,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { PriceAlertDto, PriceAlertPageDto } from '../../common/api/schemas';
import { wholePage } from '../../common/pagination/page';
import { ParseUuidPipe } from '../../common/validation/uuid.pipe';
import { CurrentUserId } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NotificationsModule } from '../notifications/notifications.module';
import { OffersModule } from '../offers/offers.module';
import { ProductsModule } from '../products/products.module';
import { AlertEngineService } from './alert-engine.service';
import { AlertCreateDto, AlertUpdateDto } from './alerts.dto';
import { AlertsService } from './alerts.service';

@Controller('alerts')
@UseGuards(JwtAuthGuard)
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Get()
  async listAlerts(@CurrentUserId() userId: string): Promise<PriceAlertPageDto> {
    return wholePage(await this.alerts.listForUser(userId));
  }

  @Post()
  @HttpCode(201)
  createAlert(
    @CurrentUserId() userId: string,
    @Body() body: AlertCreateDto,
  ): Promise<PriceAlertDto> {
    return this.alerts.create(userId, body);
  }

  @Patch(':alertId')
  updateAlert(
    @CurrentUserId() userId: string,
    @Param('alertId', ParseUuidPipe) alertId: string,
    @Body() body: AlertUpdateDto,
  ): Promise<PriceAlertDto> {
    return this.alerts.update(userId, alertId, body);
  }

  @Delete(':alertId')
  @HttpCode(204)
  deleteAlert(
    @CurrentUserId() userId: string,
    @Param('alertId', ParseUuidPipe) alertId: string,
  ): Promise<void> {
    return this.alerts.remove(userId, alertId);
  }
}

@Module({
  imports: [ProductsModule, OffersModule, NotificationsModule],
  controllers: [AlertsController],
  providers: [AlertsService, AlertEngineService],
  exports: [AlertsService, AlertEngineService],
})
export class AlertsModule {}
