import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AccessTokenPayload, LoginResponse } from './auth.types';
import { LoginDto } from './login.dto';
import { verifyPassword } from './password';
import { UsersService } from '../users/users.service';
import { RedisService } from '../infrastructure/redis.service';
import { errorBody } from '../common/api-error.filter';

// 同一“来源地址 + 用户名”在 15 分钟内最多失败 5 次，计数保存在 Redis。
const LOGIN_WINDOW_SECONDS = 15 * 60;
const LOGIN_MAX_FAILURES = 5;
const DUMMY_PASSWORD_HASH = [
  'scrypt',
  '131072',
  '8',
  '1',
  Buffer.alloc(16, 1).toString('base64'),
  Buffer.alloc(64, 0).toString('base64'),
].join('$');

export function jwtExpiresSeconds(): number {
  const seconds = Number(process.env.JWT_EXPIRES_SECONDS ?? 3600);
  if (!Number.isInteger(seconds) || seconds < 60 || seconds > 86400) {
    throw new Error('JWT_EXPIRES_SECONDS must be between 60 and 86400');
  }
  return seconds;
}

export function requiredJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('JWT_SECRET is required and must contain at least 32 bytes');
  }
  return secret;
}

export const jwtIssuer = () =>
  process.env.JWT_ISSUER ?? 'enterprise-ai-platform';
export const jwtAudience = () =>
  process.env.JWT_AUDIENCE ?? 'enterprise-ai-platform-web';
export const jwtCookieName = () => process.env.JWT_COOKIE_NAME ?? 'eai_access';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly redisService: RedisService,
  ) {}

  async login(
    payload: LoginDto,
    clientAddress: string,
  ): Promise<LoginResponse> {
    const normalized = this.usersService.normalizeUsername(payload.username);
    const rateKey = `${clientAddress}:${normalized}`;
    if ((await this.redisService.loginFailureCount(rateKey)) >= LOGIN_MAX_FAILURES) {
      this.logger.warn(`login blocked by rate limit: client=${clientAddress}`);
      throw new HttpException(
        errorBody('RATE_LIMITED', 'too many login attempts; try again later'),
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const user = await this.usersService.findForLogin(payload.username);
    const validPassword = await verifyPassword(
      payload.password,
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );

    if (!user || !user.isActive || !validPassword) {
      const failures = await this.redisService.recordLoginFailure(
        rateKey,
        LOGIN_WINDOW_SECONDS,
      );
      // 不记录用户名和密码，只记录来源及累计次数，兼顾排错与敏感信息保护。
      this.logger.warn(
        `login rejected: client=${clientAddress} failures=${failures}`,
      );
      if (failures >= LOGIN_MAX_FAILURES) {
        throw new HttpException(
          errorBody('RATE_LIMITED', 'too many login attempts; try again later'),
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      throw new UnauthorizedException(
        errorBody('UNAUTHORIZED', 'invalid username or password'),
      );
    }

    await this.redisService.clearLoginFailures(rateKey);
    await this.usersService.markLogin(user.id);
    const authenticated = this.usersService.toAuthenticatedUser(user);
    const expiresIn = jwtExpiresSeconds();
    await this.redisService.setAuthTokenVersion(
      authenticated.id,
      authenticated.tokenVersion,
      expiresIn + 60,
    );
    const tokenPayload: AccessTokenPayload = {
      sub: String(authenticated.id),
      username: authenticated.username,
      role: authenticated.role,
      permissions: authenticated.permissions,
      ver: authenticated.tokenVersion,
    };
    const accessToken = await this.jwtService.signAsync(tokenPayload, {
      algorithm: 'HS256',
      expiresIn,
      issuer: jwtIssuer(),
      audience: jwtAudience(),
    });

    this.logger.log(
      `login succeeded: user_id=${authenticated.id} role=${authenticated.role} expires_in=${expiresIn}`,
    );
    // tokenVersion 只用于服务端撤销判断，不应出现在返回给浏览器的用户资料中。
    const { tokenVersion: _, ...publicUser } = authenticated;
    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn,
      user: publicUser,
    };
  }
}
