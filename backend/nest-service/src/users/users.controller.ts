import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequireAnyPermission } from '../auth/permissions.decorator';
import { CreateUserDto, UpdateUserDto } from './user.dto';
import { UsersService, type UserView } from './users.service';

@Controller('users')
export class UsersController {
  // 所有路由都由 PermissionsGuard 进行服务端授权，前端隐藏按钮不属于安全边界。
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @RequireAnyPermission('users:read', 'users:manage')
  list(): Promise<UserView[]> {
    return this.usersService.list();
  }

  @Post()
  @RequireAnyPermission('users:manage')
  create(@Body() payload: CreateUserDto): Promise<UserView> {
    return this.usersService.create(payload);
  }

  @Patch(':id')
  @RequireAnyPermission('users:manage')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() payload: UpdateUserDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<UserView> {
    return this.usersService.update(id, payload, actor);
  }
}
