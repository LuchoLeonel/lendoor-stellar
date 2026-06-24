// src/entities/audit-log.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
} from 'typeorm';

@Entity('audit_logs')
@Index('idx_audit_action', ['action'])
@Index('idx_audit_wallet', ['walletAddress'])
@Index('idx_audit_created_at', ['createdAt'])
export class AuditLog {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 50 })
  action!: string; // e.g. 'LOAN_OPENED', 'LOAN_REPAID', 'USER_VERIFIED', etc.

  @Column({ type: 'text', nullable: true })
  walletAddress?: string | null;

  @Column({ type: 'int', nullable: true })
  userId?: number | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null; // additional context (loanId, amount, etc.)

  @Column({ type: 'varchar', length: 50, nullable: true })
  ip?: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
