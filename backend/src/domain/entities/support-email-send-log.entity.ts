// src/domain/entities/support-email-send-log.entity.ts
//
// Spec 082 Phase 2 — Email Operator Dashboard.
// Audit trail for every outbound support reply sent via EmailReplyService.
// One row per send attempt (status = 'sent' | 'failed').

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
} from 'typeorm';

@Entity({ name: 'support_email_send_log' })
export class SupportEmailSendLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** FK to support_emails.id (uuid). Not a hard TypeORM relation — audit rows
   * must survive even if the parent email is deleted. */
  @Index('idx_send_log_email_id')
  @Column({ type: 'uuid' })
  emailId!: string;

  /** Recipient address (the original sender of the inbound email). */
  @Column({ type: 'text' })
  toAddress!: string;

  /** Subject of the outbound email (includes Re: prefix). */
  @Column({ type: 'text' })
  subject!: string;

  /** Exact body text sent to the user. */
  @Column({ type: 'text' })
  bodySent!: string;

  /** Wallet address of the operator who triggered the send. Nullable (future: system auto-send). */
  @Column({ type: 'text', nullable: true })
  sentByWallet?: string | null;

  /** Timestamp when the send was attempted. */
  @Column({ type: 'timestamptz' })
  sentAt!: Date;

  /** Message-ID returned by the SMTP server (nodemailer info.messageId). Nullable on failure. */
  @Column({ type: 'varchar', length: 500, nullable: true })
  smtpMessageId?: string | null;

  /** Outcome: 'sent' | 'failed'. */
  @Column({ type: 'varchar', length: 20 })
  status!: string;

  /** Error message if status = 'failed'. */
  @Column({ type: 'text', nullable: true })
  failureReason?: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}
