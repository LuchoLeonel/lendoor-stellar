import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';

import { User } from './user.entity';
import { Loan } from './loan.entity';

/**
 * Spec 045 PR-6 (part 1) — Point-in-time feature snapshot.
 *
 * Stores the exact feature vector + model prediction for every
 * scoring decision the risk system makes. Used as the source of
 * truth for training (read) AND as the audit log for production
 * inference (write).
 *
 * One row per decision. Decision types:
 *   - 'admission'      — waitlist scoring of a new wallet
 *   - 'borrow'         — per-loan scoring at borrow request time (post PR-5)
 *   - 'training_synth' — historical replay synthesized by PR-6 part 2
 */
@Entity({ name: 'risk_feature_snapshots' })
@Index('uq_risk_feat_snap_decision', ['userId', 'decisionTimestamp', 'decisionType'], { unique: true })
@Index('idx_risk_feat_snap_user', ['userId', 'decisionTimestamp'])
@Index('idx_risk_feat_snap_type_time', ['decisionType', 'decisionTimestamp'])
export class RiskFeatureSnapshot {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'int' })
  userId!: number;

  @ManyToOne(() => User, { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'userId' })
  user?: User;

  /** NULL for admission decisions (no specific loan yet). */
  @Column({ type: 'int', nullable: true })
  loanId?: number | null;

  @ManyToOne(() => Loan, { onDelete: 'NO ACTION', nullable: true })
  @JoinColumn({ name: 'loanId' })
  loan?: Loan | null;

  /** Exact moment the model was invoked. Frozen forever. */
  @Column({ type: 'timestamptz', default: () => 'NOW()' })
  decisionTimestamp!: Date;

  /** 'admission' | 'borrow' | 'training_synth'. */
  @Column({ type: 'varchar', length: 20 })
  decisionType!: string;

  /**
   * The full feature dict that was sent to the model. JSONB so the
   * schema doesn't need to change when features evolve.
   */
  @Column({ type: 'jsonb' })
  featureVector!: Record<string, unknown>;

  /** e.g., "v3_2026_05_15" — for trace, drift detection, A/B. */
  @Column({ type: 'varchar', length: 40, nullable: true })
  modelVersion?: string | null;

  /** Calibrated probability of default predicted by the model. */
  @Column({
    type: 'decimal',
    precision: 6,
    scale: 4,
    nullable: true,
    transformer: {
      to: (v?: number | null) => (v == null ? null : v.toString()),
      from: (v: string | null) => (v == null ? null : Number(v)),
    },
  })
  pDefault?: number | null;

  /** 'admit' | 'admit_restricted' | 'waitlist' | 'reject' | (borrow-time variants). */
  @Column({ type: 'varchar', length: 20, nullable: true })
  decision?: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}
