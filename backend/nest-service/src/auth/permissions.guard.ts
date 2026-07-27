import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { errorBody } from '../common/api-error.filter';
import type { AuthenticatedUser } from './auth.types';
import { REQUIRED_PERMISSIONS_KEY } from './permissions.decorator';

type AuthenticatedRequest = Request & { user?: AuthenticatedUser };

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(
      REQUIRED_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) return true;

    const user = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>().user;
    if (user && required.some((permission) => user.permissions.includes(permission))) {
      return true;
    }
    throw new ForbiddenException(
      errorBody('FORBIDDEN', 'insufficient permission'),
    );
  }
}
