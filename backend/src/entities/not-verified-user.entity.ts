// src/entities/not-verified-user.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

const lowercase = {
  to: (v?: string | null) => (v == null ? null : v.toLowerCase()),
  from: (v?: string | null) => (v == null ? null : v.toLowerCase()),
};

@Entity({ name: 'not_verified_users' })
@Index('idx_not_verified_wallet', ['walletAddress'], { unique: true })
export class NotVerifiedUser {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'text', transformer: lowercase })
  walletAddress!: string;

  /** Plataforma de origen: 'lemon' | 'farcaster' | 'webapp'. */
  @Column({
    type: 'varchar',
    length: 16,
    nullable: true,
    transformer: lowercase,
  })
  platform?: string | null;

  @Column({ type: 'text', nullable: true, transformer: lowercase })
  email?: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  otpCode?: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  otpExpiresAt?: Date | null;

  @Column({ type: 'integer', default: 0 })
  otpAttemptCount!: number;

  @Column({ type: 'timestamptz', nullable: true })
  lastOtpSentAt?: Date | null;

  /** Momento en que pidió entrar a la waitlist (para mantener el orden justo). */
  @Column({ type: 'timestamptz', nullable: true })
  waitlistJoinedAt?: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  /** Fecha en que aceptó Términos y Condiciones. */
  @Column({ type: 'timestamp with time zone', nullable: true })
  termsAcceptedAt?: Date | null;

  // ── Phone OTP fields ──
  @Column({ type: 'varchar', length: 20, nullable: true })
  phone?: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  phoneOtpCode?: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  phoneOtpExpiresAt?: Date | null;

  @Column({ type: 'integer', default: 0 })
  phoneOtpAttemptCount!: number;

  @Column({ type: 'timestamptz', nullable: true })
  lastPhoneOtpSentAt?: Date | null;
}
