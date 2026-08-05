import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequireAnyPermission } from '../auth/permissions.decorator';
import { CreateTaskDto } from './create-task.dto';
import { AiTask } from './task.entity';
import { TasksService } from './tasks.service';

@Controller('tasks')
export class TasksController {
  // 旧任务接口保留给管理员审计；聊天界面主要使用 /conversations 接口。
  constructor(private readonly tasksService: TasksService) {}

  @Get()
  @RequireAnyPermission('tasks:read:own', 'tasks:read:any')
  findAll(@CurrentUser() user: AuthenticatedUser): Promise<AiTask[]> {
    return this.tasksService.findAll(user);
  }

  @Get(':id')
  @RequireAnyPermission('tasks:read:own', 'tasks:read:any')
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AiTask> {
    return this.tasksService.findOne(id, user);
  }

  @Get(':id/artifacts/:artifactIndex')
  @RequireAnyPermission('tasks:read:own', 'tasks:read:any')
  async downloadArtifact(
    @Param('id', ParseIntPipe) id: number,
    @Param('artifactIndex', ParseIntPipe) artifactIndex: number,
    @CurrentUser() user: AuthenticatedUser,
    @Res() response: Response,
  ): Promise<void> {
    const artifact = await this.tasksService.downloadArtifact(
      id,
      artifactIndex,
      user,
    );
    response.setHeader('Content-Type', artifact.contentType);
    response.setHeader('Content-Length', artifact.content.length.toString());
    response.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(artifact.name)}`,
    );
    response.send(artifact.content);
  }

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @RequireAnyPermission('tasks:create')
  create(
    @Body() payload: CreateTaskDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AiTask> {
    return this.tasksService.create(payload, user);
  }
}
