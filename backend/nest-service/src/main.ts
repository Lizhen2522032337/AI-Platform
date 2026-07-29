import { BadRequestException, Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ApiErrorFilter, errorBody } from './common/api-error.filter';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  // 创建 NestJS 应用，并使用 PORT 环境变量或默认的 3000 端口。
  const app = await NestFactory.create(AppModule);
  // NestJS 只由内部 Nginx 访问，信任一层代理以正确获取登录来源 IP。
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.useGlobalFilters(new ApiErrorFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: () =>
        new BadRequestException(
          errorBody('VALIDATION_ERROR', 'invalid request'),
        ),
    }),
  );
  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  logger.log(`NestJS service listening: port=${port}`);
}
void bootstrap();
