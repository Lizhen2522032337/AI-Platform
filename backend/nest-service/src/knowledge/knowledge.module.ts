import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeDocument } from './knowledge-document.entity';
import { KnowledgeIndexService } from './knowledge-index.service';
import { KnowledgeService } from './knowledge.service';

@Module({
  imports: [TypeOrmModule.forFeature([KnowledgeDocument])],
  controllers: [KnowledgeController],
  providers: [KnowledgeService, KnowledgeIndexService],
})
export class KnowledgeModule {}
