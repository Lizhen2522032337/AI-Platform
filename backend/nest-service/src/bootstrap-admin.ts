import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { UsersService } from './users/users.service';

async function bootstrapAdmin(): Promise<void> {
  const username = process.env.BOOTSTRAP_ADMIN_USERNAME?.trim();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  const displayName =
    process.env.BOOTSTRAP_ADMIN_DISPLAY_NAME?.trim() || '系统管理员';
  if (!username || !password || password.length < 12) {
    throw new Error(
      'BOOTSTRAP_ADMIN_USERNAME and a password of at least 12 characters are required',
    );
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const users = app.get(UsersService);
    const created = await users.createInitialAdmin({
      username,
      password,
      displayName,
      role: 'admin',
    });
    console.log(`管理员已创建：${created.username}（ID=${created.id}）`);
  } finally {
    await app.close();
  }
}

void bootstrapAdmin().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
