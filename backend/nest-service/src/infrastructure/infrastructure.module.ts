import { Global, Module } from '@nestjs/common';
import { RabbitService } from './rabbit.service';
import { RedisService } from './redis.service';
import { AiArtifactsService } from './ai-artifacts.service';

@Global()
@Module({
  providers: [AiArtifactsService, RabbitService, RedisService],
  exports: [AiArtifactsService, RabbitService, RedisService],
})
export class InfrastructureModule {}
