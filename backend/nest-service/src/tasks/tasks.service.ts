import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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

  findAll(): Promise<AiTask[]> {
    return this.repository.find({ order: { id: 'DESC' }, take: 100 });
  }

  async findOne(id: number): Promise<AiTask> {
    const task = await this.repository.findOneBy({ id });
    if (!task) {
      throw new NotFoundException(errorBody('NOT_FOUND', 'task not found'));
    }
    return task;
  }

  async create(payload: CreateTaskDto): Promise<AiTask> {
    let task = await this.repository.save(
      this.repository.create({
        prompt: payload.prompt,
        status: 'queued',
        result: null,
        errorMessage: null,
        objectKey: null,
        vectorId: null,
      }),
    );

    try {
      await this.redisService.setTaskState(Number(task.id), task);
      await this.rabbitService.publishTask({
        id: Number(task.id),
        prompt: task.prompt,
        createdAt: task.createdAt.toISOString(),
      });
    } catch (error) {
      task.status = 'failed';
      task.errorMessage = 'failed to enqueue task';
      task = await this.repository.save(task);
      try {
        await this.redisService.setTaskState(Number(task.id), task);
      } catch {
        // 原始依赖异常继续向上抛出，避免 Redis 二次异常覆盖根因。
      }
      throw error;
    }
    return task;
  }
}
