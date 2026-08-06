import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequireAnyPermission } from '../auth/permissions.decorator';
import { UpdateKnowledgeVisibilityDto, UploadKnowledgeDocumentDto } from './knowledge.dto';
import { KnowledgeDocument } from './knowledge-document.entity';
import { KnowledgeService, type UploadedKnowledgeFile } from './knowledge.service';

@Controller('knowledge/documents')
export class KnowledgeController {
  constructor(private readonly service: KnowledgeService) {}

  @Get()
  @RequireAnyPermission('knowledge:manage')
  list(): Promise<KnowledgeDocument[]> {
    return this.service.list();
  }

  @Post()
  @RequireAnyPermission('knowledge:manage')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024, files: 1 } }))
  upload(
    @Body() payload: UploadKnowledgeDocumentDto,
    @UploadedFile() file: UploadedKnowledgeFile | undefined,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<KnowledgeDocument> {
    return this.service.upload(payload.title, payload.visibility, file, actor);
  }

  @Patch(':id/visibility')
  @RequireAnyPermission('knowledge:manage')
  updateVisibility(
    @Param('id', ParseIntPipe) id: number,
    @Body() payload: UpdateKnowledgeVisibilityDto,
  ): Promise<KnowledgeDocument> {
    return this.service.updateVisibility(id, payload.visibility);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireAnyPermission('knowledge:manage')
  async delete(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.service.delete(id);
  }
}
