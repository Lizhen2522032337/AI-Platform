import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthController } from './health.controller';
import { InfrastructureModule } from './infrastructure/infrastructure.module';
import { AiTask } from './tasks/task.entity';
import { TasksModule } from './tasks/tasks.module';

function requiredPassword(): string {
  const password = process.env.POSTGRES_PASSWORD;
  if (!password) {
    throw new Error('POSTGRES_PASSWORD is required');
  }
  return password;
}

// 注册当前服务使用的控制器与业务服务。
@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.POSTGRES_HOST ?? 'host.docker.internal',
      port: Number(process.env.POSTGRES_PORT ?? 5432),
      database: process.env.POSTGRES_DB ?? 'enterprise_ai_platform',
      username: process.env.POSTGRES_USER ?? 'postgres',
      password: requiredPassword(),
      ssl:
        (process.env.POSTGRES_SSLMODE ?? 'disable') === 'disable'
          ? false
          : { rejectUnauthorized: false },
      entities: [AiTask],
      synchronize: false,
      retryAttempts: 5,
      retryDelay: 2000,
    }),
    InfrastructureModule,
    TasksModule,
  ],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule {}
