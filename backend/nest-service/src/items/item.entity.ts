import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// 显式映射共享表，禁止 TypeORM 自动同步数据库结构。
@Entity({ name: 'platform_items' })
export class Item {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'text', default: '' })
  description: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
