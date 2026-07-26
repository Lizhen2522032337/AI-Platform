import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ApiErrorFilter, errorBody } from './common/api-error.filter';

async function bootstrap() {
  // 创建 NestJS 应用，并使用 PORT 环境变量或默认的 3000 端口。
  const app = await NestFactory.create(AppModule);
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
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
