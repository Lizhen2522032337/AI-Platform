import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import type { KnowledgeVisibility } from './knowledge-document.entity';

export class UploadKnowledgeDocumentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;

  @IsIn(['public', 'admin'])
  visibility: KnowledgeVisibility;
}

export class UpdateKnowledgeVisibilityDto {
  @IsIn(['public', 'admin'])
  visibility: KnowledgeVisibility;
}
