import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { Public } from './auth/public.decorator';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  // 处理根路径请求并返回服务的默认欢迎信息。
  @Public()
  @Get()
  getInfo(): Record<string, string> {
    return this.appService.getInfo();
  }
}
