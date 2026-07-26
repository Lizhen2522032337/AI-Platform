import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

interface ErrorBody {
  error: {
    code: string;
    message: string;
  };
}

export function errorBody(code: string, message: string): ErrorBody {
  return { error: { code, message } };
}

// 将 NestJS 和数据库异常统一为公共 API 契约格式。
@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();
    const status: number =
      exception instanceof HttpException
        ? exception.getStatus()
        : Number(HttpStatus.INTERNAL_SERVER_ERROR);

    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      const apiError =
        typeof body === 'object' && body !== null && 'error' in body
          ? body.error
          : null;
      if (
        typeof apiError === 'object' &&
        apiError !== null &&
        'code' in apiError &&
        'message' in apiError
      ) {
        response.status(status).json(body);
        return;
      }
    }

    if (status >= Number(HttpStatus.INTERNAL_SERVER_ERROR)) {
      this.logger.error(
        `request failed: ${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    const code =
      status === Number(HttpStatus.BAD_REQUEST)
        ? 'VALIDATION_ERROR'
        : 'INTERNAL_ERROR';
    const message =
      status === Number(HttpStatus.BAD_REQUEST)
        ? 'invalid request'
        : 'internal server error';
    response.status(status).json(errorBody(code, message));
  }
}
