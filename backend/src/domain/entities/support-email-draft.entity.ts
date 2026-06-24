// src/domain/entities/support-email-draft.entity.ts
//
// Spec 082 Phase 3 — AI draft layer.
//
// One row per Claude-generated draft. Append-only audit log, mirroring the
// token/cost audit pattern used by the voice dashboard AI calls.
// Allows per-draft cost accounting and inspection without touching the
// support_emails or send_log tables.

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'support_email_drafts' })
@Index('idx_support_email_drafts_email_id', ['emailId'])
export class SupportEmailDraft {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** UUID of the SupportEmail this draft was generated for. */
  @Column({ type: 'uuid' })
  emailId!: string;

  /** The Claude-generated draft text (post-linted). */
  @Column({ type: 'text' })
  draftText!: string;

  /**
   * Operator instruction supplied for REGENERATION requests.
   * NULL on first-generation (no instruction provided).
   */
  @Column({ type: 'text', nullable: true })
  operatorPrompt?: string | null;

  /** Model identifier used (e.g. claude-sonnet-4-6). */
  @Column({ type: 'varchar', length: 64 })
  model!: string;

  /** Input token count from the Anthropic API usage object. */
  @Column({ type: 'integer' })
  inputTokens!: number;

  /** Output token count from the Anthropic API usage object. */
  @Column({ type: 'integer' })
  outputTokens!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
