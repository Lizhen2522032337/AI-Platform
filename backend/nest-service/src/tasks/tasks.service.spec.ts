import { NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import type { RabbitService } from '../infrastructure/rabbit.service';
import type { RedisService } from '../infrastructure/redis.service';
import type { AiArtifactsService } from '../infrastructure/ai-artifacts.service';
import { AiTask } from './task.entity';
import { TasksService } from './tasks.service';
import type { AuthenticatedUser } from '../auth/auth.types';

const user: AuthenticatedUser = {
  id: 7,
  username: 'tester',
  displayName: '测试用户',
  role: 'user',
  permissions: ['tasks:create', 'tasks:read:own'],
  tokenVersion: 1,
};

function sampleTask(): AiTask {
  return {
    id: 1,
    prompt: '测试 AI 任务',
    status: 'queued',
    result: null,
    errorMessage: null,
    objectKey: null,
    vectorId: null,
    modelProvider: 'deepseek',
    databaseType: 'postgresql',
    modelName: null,
    answer: null,
    createdById: 7,
    conversationId: null,
    createdAt: new Date('2026-07-26T00:00:00.000Z'),
    updatedAt: new Date('2026-07-26T00:00:00.000Z'),
  };
}

describe('TasksService', () => {
  const repository = {
    find: jest.fn(),
    findOneBy: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  } as unknown as jest.Mocked<Repository<AiTask>>;
  const rabbitService = {
    publishTask: jest.fn(),
  } as unknown as jest.Mocked<RabbitService>;
  const redisService = {
    setTaskState: jest.fn(),
  } as unknown as jest.Mocked<RedisService>;
  const artifactsService = {
    downloadTaskArtifact: jest.fn(),
  } as unknown as jest.Mocked<AiArtifactsService>;

  let service: TasksService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TasksService(
      repository,
      rabbitService,
      redisService,
      artifactsService,
    );
  });

  it('creates a queued task and publishes a durable work message', async () => {
    const task = sampleTask();
    repository.create.mockReturnValue(task);
    repository.save.mockResolvedValue(task);

    await expect(
      service.create(
        {
          prompt: task.prompt,
          modelProvider: 'deepseek',
          databaseType: 'postgresql',
        },
        user,
      ),
    ).resolves.toEqual(task);
    expect(rabbitService.publishTask.mock.calls[0]?.[0]).toEqual({
      id: 1,
      ownerId: 7,
      prompt: task.prompt,
      modelProvider: 'deepseek',
      databaseType: 'postgresql',
      allowDynamicSql: false,
      conversationId: null,
      createdAt: '2026-07-26T00:00:00.000Z',
    });
    expect(redisService.setTaskState.mock.calls[0]).toEqual([
      1,
      {
        id: 1,
        ownerId: 7,
        status: 'queued',
        modelProvider: 'deepseek',
        databaseType: 'postgresql',
        conversationId: null,
      },
    ]);
  });

  it('grants dynamic SQL only from the server-side admin permission', async () => {
    const task = sampleTask();
    repository.create.mockReturnValue(task);
    repository.save.mockResolvedValue(task);

    await service.create(
      {
        prompt: '整理所有用户',
        modelProvider: 'deepseek',
        databaseType: 'postgresql',
      },
      {
        ...user,
        role: 'admin',
        permissions: [...user.permissions, 'users:manage'],
      },
    );

    expect(rabbitService.publishTask.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ allowDynamicSql: true }),
    );
  });

  it('returns tasks newest first', async () => {
    repository.find.mockResolvedValue([sampleTask()]);
    await expect(service.findAll(user)).resolves.toHaveLength(1);
    expect(repository.find.mock.calls[0]?.[0]).toEqual({
      where: { createdById: 7 },
      order: { id: 'DESC' },
      take: 100,
    });
  });

  it('throws 404 when a task does not exist', async () => {
    repository.findOneBy.mockResolvedValue(null);
    await expect(service.findOne(999, user)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('downloads only an artifact recorded on the owned task', async () => {
    const task = sampleTask();
    task.status = 'completed';
    task.result = {
      artifacts: [
        {
          name: '数据报告.xlsx',
          objectKey: 'tasks/1/report.xlsx',
          contentType:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
      ],
    };
    repository.findOneBy.mockResolvedValue(task);
    artifactsService.downloadTaskArtifact.mockResolvedValue({
      content: Buffer.from('workbook'),
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    await expect(service.downloadArtifact(1, 0, user)).resolves.toMatchObject({
      name: '数据报告.xlsx',
      content: Buffer.from('workbook'),
    });
    expect(artifactsService.downloadTaskArtifact.mock.calls[0]).toEqual([
      1,
      'tasks/1/report.xlsx',
    ]);
  });

  it('rejects an artifact index that is not recorded on the task', async () => {
    const task = sampleTask();
    task.status = 'completed';
    task.result = { artifacts: [] };
    repository.findOneBy.mockResolvedValue(task);

    await expect(service.downloadArtifact(1, 0, user)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(artifactsService.downloadTaskArtifact.mock.calls).toHaveLength(0);
  });
});
