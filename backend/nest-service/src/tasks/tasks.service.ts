import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { AuthenticatedUser } from '../auth/auth.types';
import { errorBody } from '../common/api-error.filter';
import {
  AiArtifactsService,
  type DownloadedArtifact,
} from '../infrastructure/ai-artifacts.service';
import { RabbitService } from '../infrastructure/rabbit.service';
import { RedisService } from '../infrastructure/redis.service';
import { CreateTaskDto } from './create-task.dto';
import { AiTask } from './task.entity';

interface StoredArtifact {
  name: string;
  objectKey: string;
}

export interface TaskArtifactDownload extends DownloadedArtifact {
  name: string;
}

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    @InjectRepository(AiTask)
    private readonly repository: Repository<AiTask>,
    private readonly rabbitService: RabbitService,
    private readonly redisService: RedisService,
    private readonly artifactsService: AiArtifactsService,
  ) {}

  findAll(user: AuthenticatedUser): Promise<AiTask[]> {
    // 管理员可审计全部任务，普通用户的查询条件始终带 createdById。
    return this.repository.find({
      where: user.permissions.includes('tasks:read:any')
        ? undefined
        : { createdById: user.id },
      order: { id: 'DESC' },
      take: 100,
    });
  }

  async findOne(id: number, user: AuthenticatedUser): Promise<AiTask> {
    // 把归属条件放进 SQL，而不是查询后再判断，避免越权读取时间窗口。
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

  async downloadArtifact(
    id: number,
    artifactIndex: number,
    user: AuthenticatedUser,
  ): Promise<TaskArtifactDownload> {
    const task = await this.findOne(id, user);
    const artifacts = this.storedArtifacts(task);
    const artifact = artifacts[artifactIndex];
    if (!artifact) {
      throw new NotFoundException(
        errorBody('ARTIFACT_NOT_FOUND', '文件不存在或不属于当前任务'),
      );
    }
    const downloaded = await this.artifactsService.downloadTaskArtifact(
      task.id,
      artifact.objectKey,
    );
    return { name: artifact.name, ...downloaded };
  }

  async create(
    payload: CreateTaskDto,
    user: AuthenticatedUser,
    conversationId: number | null = null,
  ): Promise<AiTask> {
    // 先写 PostgreSQL，确保进入 RabbitMQ 的任务一定有可追踪的持久化 ID。
    let task = await this.repository.save(
      this.repository.create({
        prompt: payload.prompt,
        status: 'queued',
        result: null,
        errorMessage: null,
        objectKey: null,
        vectorId: null,
        modelProvider: payload.modelProvider,
        databaseType: payload.databaseType,
        modelName: null,
        answer: null,
        createdById: user.id,
        conversationId,
      }),
    );
    this.logger.log(
      `task persisted: task_id=${task.id} user_id=${user.id} conversation_id=${conversationId ?? 'none'} provider=${task.modelProvider} database=${task.databaseType}`,
    );

    try {
      // Redis 是实时状态快照，RabbitMQ 是异步执行入口；两者都不替代 PostgreSQL 主记录。
      await this.redisService.setTaskState(Number(task.id), {
        id: Number(task.id),
        ownerId: user.id,
        status: task.status,
        modelProvider: task.modelProvider,
        databaseType: task.databaseType,
        conversationId,
      });
      await this.rabbitService.publishTask({
        id: Number(task.id),
        ownerId: user.id,
        prompt: task.prompt,
        modelProvider: task.modelProvider,
        databaseType: task.databaseType,
        // 动态用户 SQL 只能由服务端 RBAC 授权，不能信任前端请求字段。
        allowDynamicSql: user.permissions.includes('users:manage'),
        conversationId,
        createdAt: task.createdAt.toISOString(),
      });
      this.logger.log(`task enqueued: task_id=${task.id}`);
    } catch (error) {
      this.logger.error(
        `task enqueue failed: task_id=${task.id} error_type=${error instanceof Error ? error.name : 'unknown'}`,
      );
      task.status = 'failed';
      task.errorMessage = 'failed to enqueue task';
      task = await this.repository.save(task);
      try {
        await this.redisService.setTaskState(Number(task.id), {
          id: Number(task.id),
          ownerId: user.id,
          status: task.status,
          modelProvider: task.modelProvider,
          databaseType: task.databaseType,
          conversationId,
          errorMessage: task.errorMessage,
        });
      } catch {
        // 原始依赖异常继续向上抛出，避免 Redis 二次异常覆盖根因。
        this.logger.warn(
          `failed task state could not be cached: task_id=${task.id}`,
        );
      }
      throw error;
    }
    return task;
  }

  private storedArtifacts(task: AiTask): StoredArtifact[] {
    const rawArtifacts = task.result?.['artifacts'];
    if (!Array.isArray(rawArtifacts)) return [];
    const prefix = `tasks/${task.id}/`;
    return rawArtifacts.flatMap((value) => {
      if (typeof value !== 'object' || value === null) return [];
      const record = value as Record<string, unknown>;
      const name = record.name;
      const objectKey = record.objectKey;
      if (
        typeof name !== 'string' ||
        !name.trim() ||
        typeof objectKey !== 'string' ||
        !objectKey.startsWith(prefix) ||
        objectKey.split('/').includes('..')
      ) {
        return [];
      }
      return [{ name: name.slice(0, 180), objectKey }];
    });
  }
}
