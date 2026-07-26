import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  // 处理根路径请求并返回服务的默认欢迎信息。
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
