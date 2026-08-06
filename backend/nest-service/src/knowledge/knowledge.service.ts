import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { AuthenticatedUser } from '../auth/auth.types';
import { errorBody } from '../common/api-error.filter';
import { KnowledgeIndexService } from './knowledge-index.service';
import { KnowledgeDocument, type KnowledgeVisibility } from './knowledge-document.entity';

export interface UploadedKnowledgeFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);
  private static readonly supportedExtensions = new Set(['.pdf', '.docx', '.txt', '.md', '.csv', '.json']);

  constructor(
    @InjectRepository(KnowledgeDocument)
    private readonly repository: Repository<KnowledgeDocument>,
    private readonly indexService: KnowledgeIndexService,
  ) {}

  list(): Promise<KnowledgeDocument[]> {
    return this.repository.find({ order: { id: 'DESC' }, take: 200 });
  }

  async upload(
    title: string,
    visibility: KnowledgeVisibility,
    file: UploadedKnowledgeFile | undefined,
    actor: AuthenticatedUser,
  ): Promise<KnowledgeDocument> {
    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      throw new BadRequestException(errorBody('TITLE_REQUIRED', '请输入知识文档标题。'));
    }
    if (!file?.buffer?.length) {
      throw new BadRequestException(errorBody('FILE_REQUIRED', '请选择要上传的知识文档'));
    }
    const dot = file.originalname.lastIndexOf('.');
    const extension = dot >= 0 ? file.originalname.slice(dot).toLowerCase() : '';
    if (!KnowledgeService.supportedExtensions.has(extension)) {
      throw new BadRequestException(errorBody('UNSUPPORTED_FILE', '仅支持 PDF、DOCX、TXT、Markdown、CSV 和 JSON 文件'));
    }
    let document = await this.repository.save(
      this.repository.create({
        title: normalizedTitle,
        originalFilename: file.originalname.slice(0, 255),
        contentType: (file.mimetype || 'application/octet-stream').slice(0, 150),
        visibility,
        status: 'processing',
        fileSize: String(file.size),
        chunkCount: 0,
        createdById: actor.id,
      }),
    );
    try {
      const indexed = await this.indexService.ingest({
        documentId: document.id,
        title: document.title,
        fileName: document.originalFilename,
        contentType: document.contentType,
        visibility,
        content: file.buffer,
      });
      document.status = 'ready';
      document.objectKey = indexed.objectKey;
      document.chunkCount = indexed.chunkCount;
      document.checksum = indexed.checksum;
      document.errorMessage = null;
      return await this.repository.save(document);
    } catch (error) {
      document.status = 'failed';
      document.errorMessage = error instanceof Error ? error.message.slice(0, 1000) : '知识库索引失败';
      await this.repository.save(document);
      throw error;
    }
  }

  async updateVisibility(id: number, visibility: KnowledgeVisibility): Promise<KnowledgeDocument> {
    const document = await this.find(id);
    if (document.status !== 'ready') {
      throw new BadRequestException(errorBody('DOCUMENT_NOT_READY', '只有已完成索引的文档可以修改可见性'));
    }
    const previousVisibility = document.visibility;
    await this.indexService.updateVisibility(id, visibility);
    document.visibility = visibility;
    try {
      return await this.repository.save(document);
    } catch (error) {
      // PostgreSQL 台账写入失败时尽力回滚 Qdrant ACL，避免两处权限事实不一致。
      try {
        await this.indexService.updateVisibility(id, previousVisibility);
      } catch (rollbackError) {
        this.logger.error(
          `knowledge visibility rollback failed: document_id=${id}`,
          rollbackError instanceof Error ? rollbackError.stack : undefined,
        );
      }
      throw error;
    }
  }

  async delete(id: number): Promise<void> {
    const document = await this.find(id);
    await this.indexService.delete(id, document.objectKey);
    await this.repository.remove(document);
  }

  private async find(id: number): Promise<KnowledgeDocument> {
    const document = await this.repository.findOneBy({ id });
    if (!document) throw new NotFoundException(errorBody('NOT_FOUND', '知识文档不存在'));
    return document;
  }
}
