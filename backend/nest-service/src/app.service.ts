import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  // 提供根路径所需的欢迎文本。
  getHello(): string {
    return 'Hello World!';
  }
}
