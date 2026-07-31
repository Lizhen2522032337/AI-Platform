import type { Repository } from 'typeorm';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { AiTask } from '../tasks/task.entity';
import type { TasksService } from '../tasks/tasks.service';
import type { AiArtifactsService } from '../infrastructure/ai-artifacts.service';
import type { RedisService } from '../infrastructure/redis.service';
import { ChatConversation } from './conversation.entity';
import { ConversationsService } from './conversations.service';

const user: AuthenticatedUser = {
  id: 7,
  username: 'tester',
  displayName: '测试用户',
  role: 'user',
  permissions: ['tasks:create', 'tasks:read:own'],
  tokenVersion: 1,
};

function conversation(): ChatConversation {
  return {
    id: 3,
    title: '新对话',
    modelProvider: 'deepseek',
    databaseType: 'postgresql',
    createdById: 7,
    createdAt: new Date('2026-07-28T00:00:00.000Z'),
    updatedAt: new Date('2026-07-28T00:00:00.000Z'),
  };
}

describe('ConversationsService', () => {
  const conversations = {
    find: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    findOneBy: jest.fn(),
    remove: jest.fn(),
  } as unknown as jest.Mocked<Repository<ChatConversation>>;
  const tasks = {
    find: jest.fn(),
    exists: jest.fn(),
  } as unknown as jest.Mocked<Repository<AiTask>>;
  const tasksService = {
    create: jest.fn(),
  } as unknown as jest.Mocked<TasksService>;
  const artifactsService = {
    deleteTaskArtifacts: jest.fn(),
  } as unknown as jest.Mocked<AiArtifactsService>;
  const redisService = {
    deleteTaskStates: jest.fn(),
  } as unknown as jest.Mocked<RedisService>;
  let service: ConversationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ConversationsService(
      conversations,
      tasks,
      tasksService,
      artifactsService,
      redisService,
    );
  });

  it('lists only the current user conversations', async () => {
    conversations.find.mockResolvedValue([conversation()]);
    await expect(service.findAll(user)).resolves.toHaveLength(1);
    expect(conversations.find).toHaveBeenCalledWith({
      where: { createdById: 7 },
      order: { updatedAt: 'DESC' },
      take: 100,
    });
  });

  it('creates a task in the conversation and derives the first title', async () => {
    const current = conversation();
    const task = { id: 9 } as AiTask;
    conversations.findOneBy.mockResolvedValue(current);
    conversations.save.mockImplementation(
      async (value) => value as ChatConversation,
    );
    tasks.exists.mockResolvedValue(false);
    tasksService.create.mockResolvedValue(task);

    const result = await service.sendMessage(
      3,
      {
        content: '请记住我的项目名称是星河计划',
        modelProvider: 'qwen',
        databaseType: 'postgresql',
      },
      user,
    );

    expect(result.task).toBe(task);
    expect(result.conversation.title).toBe('请记住我的项目名称是星河计划');
    expect(result.conversation.modelProvider).toBe('qwen');
    expect(result.conversation.databaseType).toBe('postgresql');
    expect(tasksService.create).toHaveBeenCalledWith(
      {
        prompt: '请记住我的项目名称是星河计划',
        modelProvider: 'qwen',
        databaseType: 'postgresql',
      },
      user,
      3,
    );
  });

  it('deletes owned conversation tasks and external artifacts', async () => {
    const current = conversation();
    const completed = {
      id: 11,
      status: 'completed',
      objectKey: 'tasks/11/result.json',
    } as AiTask;
    conversations.findOneBy.mockResolvedValue(current);
    conversations.remove.mockResolvedValue(current);
    tasks.find.mockResolvedValue([completed]);

    await expect(service.remove(3, user)).resolves.toBeUndefined();

    expect(artifactsService.deleteTaskArtifacts).toHaveBeenCalledWith([
      { taskId: 11, objectKey: 'tasks/11/result.json' },
    ]);
    expect(redisService.deleteTaskStates).toHaveBeenCalledWith([11]);
    expect(conversations.remove).toHaveBeenCalledWith(current);
  });

  it('does not delete a conversation while a task is active', async () => {
    conversations.findOneBy.mockResolvedValue(conversation());
    tasks.find.mockResolvedValue([
      { id: 12, status: 'processing', objectKey: null } as AiTask,
    ]);

    await expect(service.remove(3, user)).rejects.toMatchObject({
      status: 409,
    });
    expect(artifactsService.deleteTaskArtifacts).not.toHaveBeenCalled();
    expect(conversations.remove).not.toHaveBeenCalled();
  });
});
