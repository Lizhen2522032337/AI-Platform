import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { ModelProvider } from './create-task.dto';

export type TaskStatus = 'queued' | 'processing' | 'completed' | 'failed';

@Entity({ name: 'ai_tasks' })
export class AiTask {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text' })
  prompt: string;

  @Column({ type: 'varchar', length: 20, default: 'queued' })
  status: TaskStatus;

  @Column({ type: 'jsonb', nullable: true })
  result: Record<string, unknown> | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ name: 'object_key', type: 'text', nullable: true })
  objectKey: string | null;

  @Column({ name: 'vector_id', type: 'text', nullable: true })
  vectorId: string | null;

  @Column({ name: 'model_provider', type: 'varchar', length: 20, default: 'deepseek' })
  modelProvider: ModelProvider;

  @Column({ name: 'model_name', type: 'text', nullable: true })
  modelName: string | null;

  @Column({ type: 'text', nullable: true })
  answer: string | null;

  @Column({ name: 'created_by', type: 'integer', nullable: true })
  createdById: number | null;

  @Column({ name: 'conversation_id', type: 'integer', nullable: true })
  conversationId: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
