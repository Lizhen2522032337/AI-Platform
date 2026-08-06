import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { errorBody } from '../common/api-error.filter';
import type { KnowledgeVisibility } from './knowledge-document.entity';

interface IndexResult {
  objectKey: string;
  chunkCount: number;
  checksum: string;
}

@Injectable()
export class KnowledgeIndexService {
  private readonly baseUrl = process.env.AI_SERVICE_URL ?? 'http://fastapi-service:8000';

  async ingest(input: {
    documentId: number;
    title: string;
    fileName: string;
    contentType: string;
    visibility: KnowledgeVisibility;
    content: Buffer;
  }): Promise<IndexResult> {
    return this.request<IndexResult>('/knowledge/documents/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        documentId: input.documentId,
        title: input.title,
        fileName: input.fileName,
        contentType: input.contentType,
        visibility: input.visibility,
        contentBase64: input.content.toString('base64'),
      }),
    });
  }

  async updateVisibility(documentId: number, visibility: KnowledgeVisibility): Promise<void> {
    await this.request('/knowledge/documents/visibility', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentId, visibility }),
    });
  }

  async delete(documentId: number, objectKey: string | null): Promise<void> {
    await this.request('/knowledge/documents', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentId, objectKey }),
    });
  }

  private async request<T = void>(path: string, init: RequestInit): Promise<T> {
    try {
      const response = await fetch(`${this.baseUrl}${path}`, init);
      if (!response.ok) {
        let detail = '';
        try {
          const body = (await response.json()) as { detail?: string };
          detail = body.detail ?? '';
        } catch {
          // 内部服务可能返回空响应或代理错误页。
        }
        throw new Error(detail || `HTTP ${response.status}`);
      }
      if (response.status === 204) return undefined as T;
      return (await response.json()) as T;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      throw new ServiceUnavailableException(
        errorBody('KNOWLEDGE_INDEX_UNAVAILABLE', `知识库索引服务失败：${message}`),
      );
    }
  }
}
