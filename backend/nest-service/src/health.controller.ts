import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RabbitService } from './infrastructure/rabbit.service';
import { RedisService } from './infrastructure/redis.service';
import { Public } from './auth/public.decorator';

interface HealthResult {
  status: 'ok';
  service: 'nest-service';
  dependencies: {
    postgres: 'ok';
    redis: 'ok';
    rabbitmq: 'ok';
    fastapi: 'ok';
  };
}

@Controller('health')
export class HealthController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly redisService: RedisService,
    private readonly rabbitService: RabbitService,
  ) {}

  // 核心后端只有在数据库、缓存、消息队列和 AI 服务都可用时才报告健康。
  @Public()
  @Get()
  async health(): Promise<HealthResult> {
    const aiServiceUrl = process.env.AI_SERVICE_URL ?? 'http://fastapi-service:8000';
    try {
      await Promise.all([
        this.dataSource.query('SELECT 1'),
        this.redisService.ping(),
        this.rabbitService.ping(),
        fetch(`${aiServiceUrl}/health`, { signal: AbortSignal.timeout(5000) }).then(
          (response) => {
            if (!response.ok) {
              throw new Error(`FastAPI health returned ${response.status}`);
            }
          },
        ),
      ]);
    } catch {
      throw new ServiceUnavailableException('dependency unavailable');
    }

    return {
      status: 'ok',
      service: 'nest-service',
      dependencies: {
        postgres: 'ok',
        redis: 'ok',
        rabbitmq: 'ok',
        fastapi: 'ok',
      },
    };
  }
}
