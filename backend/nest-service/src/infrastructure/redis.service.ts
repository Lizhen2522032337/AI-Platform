import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createClient } from 'redis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly client = createClient({
    socket: {
      host: process.env.REDIS_HOST ?? 'redis',
      port: Number(process.env.REDIS_PORT ?? 6379),
    },
    password: process.env.REDIS_PASSWORD,
  });

  async onModuleInit(): Promise<void> {
    this.client.on('error', (error) => {
      console.error('Redis client error', error);
    });
    await this.client.connect();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.isOpen) {
      await this.client.close();
    }
  }

  async ping(): Promise<void> {
    await this.client.ping();
  }

  async setTaskState(taskId: number, value: unknown): Promise<void> {
    await this.client.set(`task:${taskId}`, JSON.stringify(value), { EX: 86400 });
  }
}
