// src/domain/entities/user-campaign-send-log.entity.ts
//
// Audit trail for bulk outreach campaigns sent to segmented users (by credit
// limit / loan status). One row per campaign send (not per recipient).

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity({ name: 'user_campaign_send_log' })
export class UserCampaignSendLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Human-readable description of the segment/filter used. */
  @Column({ type: 'text' })
  segment!: string;

  @Column({ type: 'text' })
  subject!: string;

  /** The plain-text body template the operator wrote (before personalization). */
  @Column({ type: 'text' })
  body!: string;

  /** Operator wallet that triggered the campaign. */
  @Column({ type: 'text', nullable: true })
  sentByWallet?: string | null;

  /** How many recipients were targeted (eligible: with email, not opted out). */
  @Column({ type: 'integer' })
  recipientCount!: number;

  @Column({ type: 'integer' })
  sentCount!: number;

  @Column({ type: 'integer' })
  failedCount!: number;

  /** JSON array of { email, reason } for failures (truncated). Nullable. */
  @Column({ type: 'text', nullable: true })
  failures?: string | null;

  @Column({ type: 'timestamptz' })
  sentAt!: Date;

  @CreateDateColumn()
  createdAt!: Date;
}
