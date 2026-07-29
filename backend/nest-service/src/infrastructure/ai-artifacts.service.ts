import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { errorBody } from '../common/api-error.filter';

export interface TaskArtifact {
  taskId: number;
  objectKey: string | null;
}

@Injectable()
export class AiArtifactsService {
  private readonly logger = new Logger(AiArtifactsService.name);
  private readonly baseUrl = (
    process.env.AI_SERVICE_URL ?? 'http://fastapi-service:8000'
  ).replace(/\/$/, '');

  async deleteTaskArtifacts(tasks: TaskArtifact[]): Promise<void> {
    if (tasks.length === 0) return;
    this.logger.log(`AI artifact cleanup requested: tasks=${tasks.length}`);
    try {
      // FastAPI 单次最多接收 100 个任务，长会话按批次清理且每批都可安全重试。
      for (let offset = 0; offset < tasks.length; offset += 100) {
        const batch = tasks.slice(offset, offset + 100);
        const response = await fetch(`${this.baseUrl}/artifacts/tasks`, {
          method: 'DELETE',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ tasks: batch }),
        });
        if (!response.ok) {
          this.logger.error(
            `AI artifact cleanup rejected: status=${response.status} batch=${batch.length}`,
          );
          throw new ServiceUnavailableException(
            errorBody('AI_STORAGE_UNAVAILABLE', '无法清理会话的 AI 存储数据'),
          );
        }
      }
      this.logger.log(`AI artifact cleanup completed: tasks=${tasks.length}`);
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      this.logger.error(
        `AI artifact cleanup connection failed: error_type=${error instanceof Error ? error.name : 'unknown'}`,
      );
      throw new ServiceUnavailableException(
        errorBody('AI_STORAGE_UNAVAILABLE', '无法连接 AI 存储清理服务'),
      );
    }
  }
}
