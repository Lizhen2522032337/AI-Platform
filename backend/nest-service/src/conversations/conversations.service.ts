import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import type { AuthenticatedUser } from '../auth/auth.types';
import { errorBody } from '../common/api-error.filter';
import { AiTask } from '../tasks/task.entity';
import { TasksService } from '../tasks/tasks.service';
import type {
  CreateConversationDto,
  SendMessageDto,
} from './conversation.dto';
import { ChatConversation } from './conversation.entity';

@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(
    @InjectRepository(ChatConversation)
    private readonly conversations: Repository<ChatConversation>,
    @InjectRepository(AiTask)
    private readonly tasks: Repository<AiTask>,
    private readonly tasksService: TasksService,
  ) {}

  findAll(user: AuthenticatedUser): Promise<ChatConversation[]> {
    // 会话列表始终是当前用户自己的；管理员审计仍可通过原任务接口完成。
    return this.conversations.find({
      where: { createdById: user.id },
      order: { updatedAt: 'DESC' },
      take: 100,
    });
  }

  create(
    payload: CreateConversationDto,
    user: AuthenticatedUser,
  ): Promise<ChatConversation> {
    const created = this.conversations.create({
      title: '新对话',
      modelProvider: payload.modelProvider,
      createdById: user.id,
    });
    this.logger.log(
      `conversation creation requested: user_id=${user.id} provider=${payload.modelProvider}`,
    );
    return this.conversations.save(
      created,
    );
  }

  async detail(
    id: number,
    user: AuthenticatedUser,
  ): Promise<{ conversation: ChatConversation; tasks: AiTask[] }> {
    const conversation = await this.requireOwned(id, user.id);
    const tasks = await this.tasks.find({
      where: { conversationId: id, createdById: user.id },
      order: { id: 'ASC' },
    });
    return { conversation, tasks };
  }

  async sendMessage(
    id: number,
    payload: SendMessageDto,
    user: AuthenticatedUser,
  ): Promise<{ conversation: ChatConversation; task: AiTask }> {
    const conversation = await this.requireOwned(id, user.id);
    const active = await this.tasks.exists({
      where: {
        conversationId: id,
        status: In(['queued', 'processing']),
      },
    });
    if (active) {
      this.logger.warn(
        `conversation is busy: conversation_id=${id} user_id=${user.id}`,
      );
      throw new ConflictException(
        errorBody('CONVERSATION_BUSY', '请等待当前回答完成后再发送下一条消息'),
      );
    }

    conversation.modelProvider = payload.modelProvider;
    if (conversation.title === '新对话') {
      conversation.title = this.titleFrom(payload.content);
    }
    // 先更新时间，让当前会话立即移动到侧栏顶部。
    conversation.updatedAt = new Date();
    const savedConversation = await this.conversations.save(conversation);
    const task = await this.tasksService.create(
      { prompt: payload.content, modelProvider: payload.modelProvider },
      user,
      id,
    );
    this.logger.log(
      `conversation message accepted: conversation_id=${id} task_id=${task.id} user_id=${user.id} provider=${payload.modelProvider}`,
    );
    return { conversation: savedConversation, task };
  }

  private async requireOwned(
    id: number,
    userId: number,
  ): Promise<ChatConversation> {
    const conversation = await this.conversations.findOneBy({
      id,
      createdById: userId,
    });
    if (!conversation) {
      throw new NotFoundException(
        errorBody('NOT_FOUND', 'conversation not found'),
      );
    }
    return conversation;
  }

  private titleFrom(content: string): string {
    const singleLine = content.replace(/\s+/g, ' ').trim();
    return singleLine.length > 36 ? `${singleLine.slice(0, 36)}…` : singleLine;
  }
}
