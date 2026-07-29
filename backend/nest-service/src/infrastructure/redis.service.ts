import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createClient } from 'redis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client = createClient({
    socket: {
      host: process.env.REDIS_HOST ?? 'redis',
      port: Number(process.env.REDIS_PORT ?? 6379),
    },
    password: process.env.REDIS_PASSWORD,
  });

  async onModuleInit(): Promise<void> {
    this.client.on('error', (error) => {
      this.logger.error(
        `Redis client error: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    });
    await this.client.connect();
    this.logger.log('Redis connection ready');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.isOpen) {
      await this.client.close();
      this.logger.log('Redis connection closed');
    }
  }

  async ping(): Promise<void> {
    await this.client.ping();
  }

  async setTaskState(taskId: number, value: unknown): Promise<void> {
    // 快照保存 24 小时，避免实时状态键无限增长。
    await this.client.set(`task:${taskId}`, JSON.stringify(value), { EX: 86400 });
  }

  async recordLoginFailure(key: string, ttlSeconds: number): Promise<number> {
    const redisKey = `auth:login-failures:${key}`;
    const count = await this.client.incr(redisKey);
    if (count === 1) await this.client.expire(redisKey, ttlSeconds);
    return count;
  }

  async loginFailureCount(key: string): Promise<number> {
    return Number((await this.client.get(`auth:login-failures:${key}`)) ?? 0);
  }

  async clearLoginFailures(key: string): Promise<void> {
    await this.client.del(`auth:login-failures:${key}`);
  }

  async setAuthTokenVersion(
    userId: number,
    version: number,
    ttlSeconds = 86400,
  ): Promise<void> {
    await this.client.set(`auth:user:${userId}:version`, String(version), {
      EX: ttlSeconds,
    });
  }
}
