import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { errorBody } from '../common/api-error.filter';
import { UsersService } from '../users/users.service';
import { RedisService } from '../infrastructure/redis.service';
import type { AccessTokenPayload, AuthenticatedUser } from './auth.types';
import {
  jwtAudience,
  jwtCookieName,
  jwtExpiresSeconds,
  jwtIssuer,
} from './auth.service';
import { IS_PUBLIC_KEY } from './public.decorator';

type AuthenticatedRequest = Request & { user?: AuthenticatedUser };

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
    private readonly usersService: UsersService,
    private readonly redisService: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractToken(request);
    if (!token) {
      this.logger.warn(`authentication rejected: reason=missing_token path=${request.path}`);
      this.unauthorized();
    }

    try {
      // 同时校验签名算法、签发方、受众和过期时间，禁止算法降级。
      const payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token, {
        algorithms: ['HS256'],
        issuer: jwtIssuer(),
        audience: jwtAudience(),
      });
      const user = await this.usersService.authenticatedUser(Number(payload.sub));
      if (!user || user.tokenVersion !== Number(payload.ver)) this.unauthorized();
      await this.redisService.setAuthTokenVersion(
        user.id,
        user.tokenVersion,
        jwtExpiresSeconds() + 60,
      );
      request.user = user;
      this.logger.debug(`authentication accepted: user_id=${user.id} path=${request.path}`);
      return true;
    } catch {
      // 不记录 JWT 内容或解析异常正文，防止 Token 意外进入日志。
      this.logger.warn(`authentication rejected: reason=invalid_token path=${request.path}`);
      this.unauthorized();
    }
  }

  private extractToken(request: Request): string | undefined {
    // Bearer 供 API 调试；浏览器正常流程使用 HttpOnly Cookie。
    const [type, bearer] = request.headers.authorization?.split(' ') ?? [];
    if (type === 'Bearer' && bearer) return bearer;

    const cookies = request.headers.cookie?.split(';') ?? [];
    const cookieName = jwtCookieName();
    for (const item of cookies) {
      const separator = item.indexOf('=');
      if (separator < 0) continue;
      const name = item.slice(0, separator).trim();
      if (name === cookieName) {
        return decodeURIComponent(item.slice(separator + 1).trim());
      }
    }
    return undefined;
  }

  private unauthorized(): never {
    throw new UnauthorizedException(
      errorBody('UNAUTHORIZED', 'authentication required or token expired'),
    );
  }
}
