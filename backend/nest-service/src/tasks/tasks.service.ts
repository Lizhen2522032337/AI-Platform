import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { AuthenticatedUser } from '../auth/auth.types';
import { errorBody } from '../common/api-error.filter';
import { RabbitService } from '../infrastructure/rabbit.service';
import { RedisService } from '../infrastructure/redis.service';
import { CreateTaskDto } from './create-task.dto';
import { AiTask } from './task.entity';

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(AiTask)
    private readonly repository: Repository<AiTask>,
    private readonly rabbitService: RabbitService,
    private readonly redisService: RedisService,
  ) {}

  findAll(user: AuthenticatedUser): Promise<AiTask[]> {
    return this.repository.find({
      where: user.permissions.includes('tasks:read:any')
        ? undefined
        : { createdById: user.id },
      order: { id: 'DESC' },
      take: 100,
    });
  }

  async findOne(id: number, user: AuthenticatedUser): Promise<AiTask> {
    const task = await this.repository.findOneBy(
      user.permissions.includes('tasks:read:any')
        ? { id }
        : { id, createdById: user.id },
    );
    if (!task) {
      throw new NotFoundException(errorBody('NOT_FOUND', 'task not found'));
    }
    return task;
  }

  async create(
    payload: CreateTaskDto,
    user: AuthenticatedUser,
  ): Promise<AiTask> {
    let task = await this.repository.save(
      this.repository.create({
        prompt: payload.prompt,
        status: 'queued',
        result: null,
        errorMessage: null,
        objectKey: null,
        vectorId: null,
        modelProvider: payload.modelProvider,
        modelName: null,
        answer: null,
        createdById: user.id,
      }),
    );

    try {
      await this.redisService.setTaskState(Number(task.id), {
        id: Number(task.id),
        ownerId: user.id,
        status: task.status,
        modelProvider: task.modelProvider,
      });
      await this.rabbitService.publishTask({
        id: Number(task.id),
        ownerId: user.id,
        prompt: task.prompt,
        modelProvider: task.modelProvider,
        createdAt: task.createdAt.toISOString(),
      });
    } catch (error) {
      task.status = 'failed';
      task.errorMessage = 'failed to enqueue task';
      task = await this.repository.save(task);
      try {
        await this.redisService.setTaskState(Number(task.id), {
          id: Number(task.id),
          ownerId: user.id,
          status: task.status,
          modelProvider: task.modelProvider,
          errorMessage: task.errorMessage,
        });
      } catch {
        // 原始依赖异常继续向上抛出，避免 Redis 二次异常覆盖根因。
      }
      throw error;
    }
    return task;
  }
}
