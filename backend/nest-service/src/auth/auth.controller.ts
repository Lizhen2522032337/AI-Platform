import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { CurrentUser } from './current-user.decorator';
import type { AuthenticatedUser, LoginResponse } from './auth.types';
import { AuthService, jwtCookieName } from './auth.service';
import { LoginDto } from './login.dto';
import { Public } from './public.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() payload: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResponse> {
    const result = await this.authService.login(
      payload,
      request.ip ?? request.socket.remoteAddress ?? 'unknown',
    );
    response.cookie(jwtCookieName(), result.accessToken, {
      httpOnly: true,
      secure: process.env.COOKIE_SECURE === 'true',
      sameSite: 'strict',
      maxAge: result.expiresIn * 1000,
      path: '/',
    });
    response.setHeader('Cache-Control', 'no-store');
    return result;
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser): Omit<AuthenticatedUser, 'tokenVersion'> {
    const { tokenVersion: _, ...publicUser } = user;
    return publicUser;
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Res({ passthrough: true }) response: Response): void {
    response.clearCookie(jwtCookieName(), {
      httpOnly: true,
      secure: process.env.COOKIE_SECURE === 'true',
      sameSite: 'strict',
      path: '/',
    });
    response.setHeader('Cache-Control', 'no-store');
  }
}
