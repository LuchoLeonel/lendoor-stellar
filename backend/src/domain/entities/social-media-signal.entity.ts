import {
  Entity,
  PrimaryColumn,
  Column,
  Index,
  CreateDateColumn,
} from 'typeorm';

/**
 * Spec 045 PR-10 — Cache of social media presence per email.
 *
 * Populated by a daily cron that calls RapidAPI social-media-scanner1
 * (`/check_bulk` endpoint, 100 emails per call). Joined into the risk
 * feature vector at scoring time.
 *
 * `email` is the primary key (one row per unique email; a user with
 * email mismatch between Lendoor signup and Lemon claim has TWO rows).
 */
@Entity({ name: 'social_media_signals' })
export class SocialMediaSignal {
  @PrimaryColumn({ type: 'text' })
  email!: string;

  @Column({ type: 'boolean', nullable: true })
  facebook?: boolean | null;

  @Column({ type: 'boolean', nullable: true })
  instagram?: boolean | null;

  @Column({ type: 'boolean', nullable: true })
  snapchat?: boolean | null;

  @Column({ type: 'boolean', nullable: true })
  x?: boolean | null;

  @Column({ type: 'boolean', nullable: true })
  google?: boolean | null;

  @Column({ type: 'boolean', nullable: true })
  microsoft?: boolean | null;

  /** Sum of true platforms (0-6). 0 is a strong anti-fraud signal. */
  @Column({ type: 'smallint', default: 0 })
  totalCount!: number;

  @Column({ type: 'timestamptz', default: () => 'NOW()' })
  scannedAt!: Date;

  /** Rows past this timestamp are eligible for rescan by the cron. */
  @Index('idx_social_signals_rescan')
  @Column({ type: 'timestamptz' })
  reScanEligibleAt!: Date;
}
