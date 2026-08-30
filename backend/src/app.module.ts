import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerStorage } from '@nestjs/throttler';
import { RequestContextMiddleware } from './common/context/request-context.middleware';
import { GlobalExceptionFilter } from './common/errors/global-exception.filter';
import { RedisModule } from './common/redis/redis.module';
import { AppThrottlerGuard } from './common/throttler/app-throttler.guard';
import { RedisThrottlerStorage } from './common/throttler/redis-throttler.storage';
import { AppConfigService } from './config/app-config.service';
import { AppConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { AlertsModule } from './modules/alerts/alerts.module';
import { AuthModule } from './modules/auth/auth.module';
import { CapabilitiesModule } from './modules/capabilities/capabilities.module';
import { DevicesModule } from './modules/devices/devices.module';
import { FavoritesModule } from './modules/favorites/favorites.module';
import { HealthModule } from './modules/health/health.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OffersModule } from './modules/offers/offers.module';
import { OptimizerModule } from './modules/optimizer/optimizer.module';
import { ProductsModule } from './modules/products/products.module';
import { RetailersModule } from './modules/retailers/retailers.module';
import { SearchModule } from './modules/search/search.module';
import { ShoppingListsModule } from './modules/shopping-lists/shopping-lists.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    AppConfigModule,
    ScheduleModule.forRoot(),
    ThrottlerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        throttlers: [
          { ttl: config.all.throttle.ttlSeconds * 1000, limit: config.all.throttle.limit },
        ],
      }),
    }),
    RedisModule,
    DatabaseModule,
    AuthModule,
    HealthModule,
    ProductsModule,
    OffersModule,
    RetailersModule,
    SearchModule,
    UsersModule,
    DevicesModule,
    FavoritesModule,
    NotificationsModule,
    AlertsModule,
    OptimizerModule,
    ShoppingListsModule,
    CapabilitiesModule,
  ],
  providers: [
    // Redis-backed storage is what makes RATE_LIMITED a real, shared-state answer.
    { provide: ThrottlerStorage, useClass: RedisThrottlerStorage },
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*splat');
  }
}
