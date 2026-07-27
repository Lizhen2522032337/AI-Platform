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
import { CreateTaskDto } from './create-task.dto';
import { AiTask } from './task.entity';
import { TasksService } from './tasks.service';

@Controller('tasks')
export class TasksController {
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
