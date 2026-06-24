// src/domain/entities/support-email.entity.ts
//
// Spec 082 — Email Operator Dashboard.
// One row per inbound email received at admin@lendoor.xyz via Zoho Mail.
// Synced by EmailSyncService (IMAP, every 3 min). Deduped by zohoMessageId.

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'support_emails' })
@Index('idx_support_emails_status_received', ['status', 'receivedAt'])
@Index('idx_support_emails_matched_user', ['matchedUserId'])
export class SupportEmail {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Message ID from Zoho (used for deduplication). Unique. */
  @Index('uq_support_emails_zoho_message_id', { unique: true })
  @Column({ type: 'text', unique: true })
  zohoMessageId!: string;

  /** Thread ID from Zoho (used to thread reply). */
  @Index('idx_support_emails_zoho_thread')
  @Column({ type: 'text' })
  zohoThreadId!: string;

  /** Sender address. */
  @Index('idx_support_emails_from_address')
  @Column({ type: 'text' })
  fromAddress!: string;

  /** Recipient address (usually admin@lendoor.xyz). */
  @Column({ type: 'text' })
  toAddress!: string;

  @Column({ type: 'text' })
  subject!: string;

  /** Plain-text body (for the LLM in Phase 3). */
  @Column({ type: 'text' })
  bodyText!: string;

  /** HTML body for frontend rendering. Nullable. */
  @Column({ type: 'text', nullable: true })
  bodyHtml?: string | null;

  @Index('idx_support_emails_received_at')
  @Column({ type: 'timestamptz' })
  receivedAt!: Date;

  @Column({ type: 'boolean', default: false })
  isRead!: boolean;

  /**
   * Workflow status. Default = 'unanswered'.
   * Values: unanswered | answered | snoozed | archived | spam
   */
  @Column({ type: 'varchar', length: 20, default: 'unanswered' })
  status!: string;

  /**
   * FK to users.id (integer). Matched by fromAddress against
   * users.email and users.lemonEmail (case-insensitive).
   * Null when the sender is not a known user.
   */
  @Column({ type: 'integer', nullable: true })
  matchedUserId?: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  answeredAt?: Date | null;

  /** Wallet address of the operator who sent the reply (Phase 2). */
  @Column({ type: 'text', nullable: true })
  answeredByWallet?: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
