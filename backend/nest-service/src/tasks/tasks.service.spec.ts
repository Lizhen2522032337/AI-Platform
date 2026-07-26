import { NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import type { RabbitService } from '../infrastructure/rabbit.service';
import type { RedisService } from '../infrastructure/redis.service';
import { AiTask } from './task.entity';
import { TasksService } from './tasks.service';

function sampleTask(): AiTask {
  return {
    id: 1,
    prompt: '测试 AI 任务',
    status: 'queued',
    result: null,
    errorMessage: null,
    objectKey: null,
    vectorId: null,
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

  let service: TasksService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TasksService(repository, rabbitService, redisService);
  });

  it('creates a queued task and publishes a durable work message', async () => {
    const task = sampleTask();
    repository.create.mockReturnValue(task);
    repository.save.mockResolvedValue(task);

    await expect(service.create({ prompt: task.prompt })).resolves.toEqual(task);
    expect(rabbitService.publishTask).toHaveBeenCalledWith({
      id: 1,
      prompt: task.prompt,
      createdAt: '2026-07-26T00:00:00.000Z',
    });
    expect(redisService.setTaskState).toHaveBeenCalledWith(1, task);
  });

  it('returns tasks newest first', async () => {
    repository.find.mockResolvedValue([sampleTask()]);
    await expect(service.findAll()).resolves.toHaveLength(1);
    expect(repository.find).toHaveBeenCalledWith({
      order: { id: 'DESC' },
      take: 100,
    });
  });

  it('throws 404 when a task does not exist', async () => {
    repository.findOneBy.mockResolvedValue(null);
    await expect(service.findOne(999)).rejects.toBeInstanceOf(NotFoundException);
  });
});
