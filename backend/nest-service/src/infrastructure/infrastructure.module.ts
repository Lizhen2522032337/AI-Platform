import { Global, Module } from '@nestjs/common';
import { RabbitService } from './rabbit.service';
import { RedisService } from './redis.service';

@Global()
@Module({
  providers: [RabbitService, RedisService],
  exports: [RabbitService, RedisService],
})
export class InfrastructureModule {}
