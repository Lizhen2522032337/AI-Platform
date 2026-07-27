import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { QueryFailedError } from 'typeorm';
import { Repository } from 'typeorm';
import type { AuthenticatedUser } from '../auth/auth.types';
import { errorBody } from '../common/api-error.filter';
import { hashPassword } from '../auth/password';
import { RedisService } from '../infrastructure/redis.service';
import { Role } from './role.entity';
import { AppUser } from './user.entity';
import { CreateUserDto, UpdateUserDto } from './user.dto';

export interface UserView {
  id: number;
  username: string;
  displayName: string;
  role: string;
  permissions: string[];
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(AppUser)
    private readonly users: Repository<AppUser>,
    @InjectRepository(Role)
    private readonly roles: Repository<Role>,
    private readonly redisService: RedisService,
  ) {}

  normalizeUsername(username: string): string {
    return username.trim().toLocaleLowerCase('en-US');
  }

  async findForLogin(username: string): Promise<AppUser | null> {
    return this.users
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .leftJoinAndSelect('user.role', 'role')
      .leftJoinAndSelect('role.permissions', 'permission')
      .where('user.usernameNormalized = :username', {
        username: this.normalizeUsername(username),
      })
      .getOne();
  }

  async authenticatedUser(id: number): Promise<AuthenticatedUser | null> {
    const user = await this.users.findOne({
      where: { id },
      relations: { role: { permissions: true } },
    });
    if (!user || !user.isActive) return null;
    return this.toAuthenticatedUser(user);
  }

  async markLogin(id: number): Promise<void> {
    await this.users.update(id, { lastLoginAt: new Date() });
  }

  async list(): Promise<UserView[]> {
    const users = await this.users.find({
      relations: { role: { permissions: true } },
      order: { id: 'ASC' },
    });
    return users.map((user) => this.toView(user));
  }

  async create(payload: CreateUserDto): Promise<UserView> {
    const role = await this.roles.findOne({
      where: { code: payload.role },
      relations: { permissions: true },
    });
    if (!role) {
      throw new NotFoundException(errorBody('ROLE_NOT_FOUND', 'role not found'));
    }
    try {
      const user = await this.users.save(
        this.users.create({
          username: payload.username.trim(),
          usernameNormalized: this.normalizeUsername(payload.username),
          displayName: payload.displayName.trim(),
          passwordHash: await hashPassword(payload.password),
          role,
          isActive: true,
          tokenVersion: 1,
          lastLoginAt: null,
        }),
      );
      user.role = role;
      return this.toView(user);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException(
          errorBody('USERNAME_EXISTS', 'username already exists'),
        );
      }
      throw error;
    }
  }

  async update(
    id: number,
    payload: UpdateUserDto,
    actor: AuthenticatedUser,
  ): Promise<UserView> {
    const user = await this.users.findOne({
      where: { id },
      relations: { role: { permissions: true } },
    });
    if (!user) {
      throw new NotFoundException(errorBody('NOT_FOUND', 'user not found'));
    }
    if (
      actor.id === id &&
      ((payload.role !== undefined && payload.role !== user.role.code) ||
        payload.isActive === false)
    ) {
      throw new ForbiddenException(
        errorBody('SELF_PROTECTION', 'cannot disable or change your own role'),
      );
    }

    let invalidateTokens = false;
    if (payload.displayName !== undefined) {
      user.displayName = payload.displayName.trim();
    }
    if (payload.password !== undefined) {
      user.passwordHash = await hashPassword(payload.password);
      invalidateTokens = true;
    }
    if (payload.role !== undefined && payload.role !== user.role.code) {
      const role = await this.roles.findOne({
        where: { code: payload.role },
        relations: { permissions: true },
      });
      if (!role) {
        throw new NotFoundException(
          errorBody('ROLE_NOT_FOUND', 'role not found'),
        );
      }
      user.role = role;
      invalidateTokens = true;
    }
    if (payload.isActive !== undefined && payload.isActive !== user.isActive) {
      user.isActive = payload.isActive;
      invalidateTokens = true;
    }
    if (invalidateTokens) user.tokenVersion += 1;

    const saved = await this.users.save(user);
    if (invalidateTokens) {
      await this.redisService.setAuthTokenVersion(saved.id, saved.tokenVersion);
    }
    return this.toView(saved);
  }

  async createInitialAdmin(payload: CreateUserDto): Promise<UserView> {
    if (payload.role !== 'admin') {
      throw new Error('initial user must be admin');
    }
    return this.create(payload);
  }

  toAuthenticatedUser(user: AppUser): AuthenticatedUser {
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role.code,
      permissions: user.role.permissions.map((permission) => permission.code).sort(),
      tokenVersion: user.tokenVersion,
    };
  }

  private toView(user: AppUser): UserView {
    const auth = this.toAuthenticatedUser(user);
    return {
      id: auth.id,
      username: auth.username,
      displayName: auth.displayName,
      role: auth.role,
      permissions: auth.permissions,
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  private isUniqueViolation(error: unknown): boolean {
    const queryError = error as QueryFailedError & {
      driverError?: { code?: string };
    };
    return queryError.driverError?.code === '23505';
  }
}
