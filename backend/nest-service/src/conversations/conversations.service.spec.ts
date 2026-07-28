import type { Repository } from 'typeorm';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { AiTask } from '../tasks/task.entity';
import type { TasksService } from '../tasks/tasks.service';
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
  } as unknown as jest.Mocked<Repository<ChatConversation>>;
  const tasks = {
    find: jest.fn(),
    exists: jest.fn(),
  } as unknown as jest.Mocked<Repository<AiTask>>;
  const tasksService = {
    create: jest.fn(),
  } as unknown as jest.Mocked<TasksService>;
  let service: ConversationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ConversationsService(conversations, tasks, tasksService);
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
    conversations.save.mockImplementation(async (value) => value as ChatConversation);
    tasks.exists.mockResolvedValue(false);
    tasksService.create.mockResolvedValue(task);

    const result = await service.sendMessage(
      3,
      { content: '请记住我的项目名称是星河计划', modelProvider: 'qwen' },
      user,
    );

    expect(result.task).toBe(task);
    expect(result.conversation.title).toBe('请记住我的项目名称是星河计划');
    expect(result.conversation.modelProvider).toBe('qwen');
    expect(tasksService.create).toHaveBeenCalledWith(
      {
        prompt: '请记住我的项目名称是星河计划',
        modelProvider: 'qwen',
      },
      user,
      3,
    );
  });
});
