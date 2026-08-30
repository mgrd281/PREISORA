import { Controller, Get, Module } from '@nestjs/common';
import type { CapabilitiesDto } from '../../common/api/schemas';
import { ReqContext } from '../../common/context/req-context.decorator';
import { RequestContext } from '../../common/context/request-context';
import { FeatureFlagsService } from './feature-flags.service';

@Controller('capabilities')
export class CapabilitiesController {
  constructor(private readonly flags: FeatureFlagsService) {}

  @Get()
  getCapabilities(@ReqContext() ctx: RequestContext): Promise<CapabilitiesDto> {
    return this.flags.resolveCapabilities(ctx);
  }
}

@Module({
  controllers: [CapabilitiesController],
  providers: [FeatureFlagsService],
  exports: [FeatureFlagsService],
})
export class CapabilitiesModule {}
