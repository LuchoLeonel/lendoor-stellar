// src/domain/entities/wallet-link-session.entity.ts
// Spec 084 — sesión del companion. Una fila por email: guarda el challenge OTP
// y, tras validarlo, el token OPACO (linkSession). NO es JWT (consistente con
// access_tokens). Vive en tabla SEPARADA de access_tokens → un token de acá
// NUNCA pasa el AccessTokenGuard de /loan, y viceversa: el aislamiento de scope
// (spec 084 decisión #2) sale GRATIS por construcción.
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

@Entity({ name: 'wallet_link_sessions' })
@Index('uq_wls_email', ['email'], { unique: true })
@Index('idx_wls_token', ['token'])
export class WalletLinkSession {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'text', transformer: lowercase })
  email!: string;

  /** Resuelto desde email→user al emitir OTP (null si el email no es un user). */
  @Column({ type: 'int', nullable: true })
  userId?: number | null;

  // --- Challenge OTP ---
  @Column({ type: 'text', nullable: true })
  otpCodeHash?: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  otpExpiresAt?: Date | null;

  @Column({ type: 'int', default: 0 })
  otpAttemptCount!: number;

  @Column({ type: 'timestamptz', nullable: true })
  lastOtpSentAt?: Date | null;

  // --- Token opaco (linkSession), set tras validar OTP ---
  @Column({ type: 'text', nullable: true })
  token?: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  tokenExpiresAt?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  verifiedAt?: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
