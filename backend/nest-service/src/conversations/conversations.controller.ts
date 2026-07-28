import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequireAnyPermission } from '../auth/permissions.decorator';
import { AiTask } from '../tasks/task.entity';
import {
  CreateConversationDto,
  SendMessageDto,
} from './conversation.dto';
import { ChatConversation } from './conversation.entity';
import { ConversationsService } from './conversations.service';

@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Get()
  @RequireAnyPermission('tasks:read:own', 'tasks:read:any')
  findAll(@CurrentUser() user: AuthenticatedUser): Promise<ChatConversation[]> {
    return this.conversations.findAll(user);
  }

  @Post()
  @RequireAnyPermission('tasks:create')
  create(
    @Body() payload: CreateConversationDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ChatConversation> {
    return this.conversations.create(payload, user);
  }

  @Get(':id')
  @RequireAnyPermission('tasks:read:own', 'tasks:read:any')
  detail(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ conversation: ChatConversation; tasks: AiTask[] }> {
    return this.conversations.detail(id, user);
  }

  @Post(':id/messages')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequireAnyPermission('tasks:create')
  sendMessage(
    @Param('id', ParseIntPipe) id: number,
    @Body() payload: SendMessageDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ conversation: ChatConversation; task: AiTask }> {
    return this.conversations.sendMessage(id, payload, user);
  }
}
