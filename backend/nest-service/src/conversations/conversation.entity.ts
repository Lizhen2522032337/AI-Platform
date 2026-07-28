import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { ModelProvider } from '../tasks/create-task.dto';

@Entity({ name: 'chat_conversations' })
export class ChatConversation {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 120, default: '新对话' })
  title: string;

  @Column({ name: 'model_provider', type: 'varchar', length: 20, default: 'deepseek' })
  modelProvider: ModelProvider;

  @Column({ name: 'created_by', type: 'integer' })
  createdById: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
