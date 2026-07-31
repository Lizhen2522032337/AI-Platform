import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import * as amqp from 'amqplib';

export interface AiTaskMessage {
  id: number;
  ownerId: number;
  prompt: string;
  modelProvider: 'deepseek' | 'qwen';
  databaseType: 'postgresql' | 'db2';
  conversationId: number | null;
  createdAt: string;
}

@Injectable()
export class RabbitService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitService.name);
  private connection?: amqp.ChannelModel;
  private channel?: amqp.ConfirmChannel;
  private readonly queue = process.env.RABBITMQ_TASK_QUEUE ?? 'ai_tasks';

  async onModuleInit(): Promise<void> {
    this.logger.log(`connecting to RabbitMQ: queue=${this.queue}`);
    this.connection = await amqp.connect({
      protocol: 'amqp',
      hostname: process.env.RABBITMQ_HOST ?? 'rabbitmq',
      port: Number(process.env.RABBITMQ_PORT ?? 5672),
      username: process.env.RABBITMQ_DEFAULT_USER ?? 'enterprise_ai',
      password: this.required('RABBITMQ_DEFAULT_PASS'),
      vhost: process.env.RABBITMQ_DEFAULT_VHOST ?? 'enterprise_ai',
    });
    this.channel = await this.connection.createConfirmChannel();
    await this.channel.assertQueue(this.queue, {
      durable: true,
      arguments: { 'x-queue-type': 'quorum' },
    });
    this.logger.log(`RabbitMQ ready: queue=${this.queue} type=quorum`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.channel?.close();
    await this.connection?.close();
    this.logger.log('RabbitMQ connection closed');
  }

  async publishTask(message: AiTaskMessage): Promise<void> {
    if (!this.channel) {
      throw new Error('RabbitMQ channel is not ready');
    }
    this.channel.sendToQueue(this.queue, Buffer.from(JSON.stringify(message)), {
      persistent: true,
      contentType: 'application/json',
    });
    await this.channel.waitForConfirms();
    this.logger.debug(`RabbitMQ publish confirmed: task_id=${message.id}`);
  }

  async ping(): Promise<void> {
    if (!this.channel) {
      throw new Error('RabbitMQ channel is not ready');
    }
    await this.channel.checkQueue(this.queue);
  }

  private required(name: string): string {
    const value = process.env[name];
    if (!value) {
      throw new Error(`${name} is required`);
    }
    return value;
  }
}
