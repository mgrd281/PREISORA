import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig, APP_CONFIG_NAMESPACE, buildConfig } from './configuration';

/**
 * Typed accessor over the loaded configuration. Everything that needs a market
 * default injects this — never `process.env` and never a literal.
 */
@Injectable()
export class AppConfigService {
  private readonly config: AppConfig;

  constructor(configService: ConfigService) {
    this.config = configService.get<AppConfig>(APP_CONFIG_NAMESPACE) ?? buildConfig();
  }

  get all(): AppConfig {
    return this.config;
  }

  get defaults(): AppConfig['defaults'] {
    return this.config.defaults;
  }

  get pricing(): AppConfig['pricing'] {
    return this.config.pricing;
  }

  get jwt(): AppConfig['jwt'] {
    return this.config.jwt;
  }

  get alerts(): AppConfig['alerts'] {
    return this.config.alerts;
  }

  get isTest(): boolean {
    return this.config.isTest;
  }
}
