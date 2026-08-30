import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppConfigService } from './app-config.service';
import configuration from './configuration';

/**
 * Global so that ANY service can read market defaults without importing a config
 * module — the alternative is developers reaching for `process.env` or a literal,
 * which is exactly what constitution §24 forbids.
 */
@Global()
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, load: [configuration], cache: true })],
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {}
