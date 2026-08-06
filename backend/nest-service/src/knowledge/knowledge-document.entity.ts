import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type KnowledgeVisibility = 'public' | 'admin';
export type KnowledgeDocumentStatus = 'processing' | 'ready' | 'failed';

@Entity({ name: 'knowledge_documents' })
export class KnowledgeDocument {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ name: 'original_filename', type: 'varchar', length: 255 })
  originalFilename: string;

  @Column({ name: 'content_type', type: 'varchar', length: 150 })
  contentType: string;

  @Column({ type: 'varchar', length: 20, default: 'public' })
  visibility: KnowledgeVisibility;

  @Column({ type: 'varchar', length: 20, default: 'processing' })
  status: KnowledgeDocumentStatus;

  @Column({ name: 'object_key', type: 'text', nullable: true })
  objectKey: string | null;

  @Column({ name: 'file_size', type: 'bigint' })
  fileSize: string;

  @Column({ name: 'chunk_count', type: 'integer', default: 0 })
  chunkCount: number;

  @Column({ type: 'char', length: 64, nullable: true })
  checksum: string | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ name: 'created_by', type: 'integer' })
  createdById: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
