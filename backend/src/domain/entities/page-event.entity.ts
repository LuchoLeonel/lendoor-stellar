import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('page_events')
export class PageEvent {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 64, nullable: true })
  sessionId: string | null;

  @Column({ type: 'text', nullable: true })
  walletAddress: string | null;

  @Column({ type: 'varchar', length: 32 })
  eventType: string;

  @Column({ type: 'text', nullable: true })
  path: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @Column({ type: 'bigint', nullable: true })
  clientTimestamp: number | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  ip: string | null;

  @Column({ type: 'text', nullable: true })
  userAgent: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
