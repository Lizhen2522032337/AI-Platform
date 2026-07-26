import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  // 提供根路径所需的欢迎文本。
  getInfo(): Record<string, string> {
    return {
      service: 'nest-service',
      role: 'core-business-api',
      status: 'running',
    };
  }
}
