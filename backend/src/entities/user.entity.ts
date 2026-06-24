// src/entities/user.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  Unique,
  CreateDateColumn,
  UpdateDateColumn,
  Check,
  OneToMany,
} from 'typeorm';
import { UserAchievement } from './user-achievement.entity';

const lowercase = {
  to: (v?: string | null) => (v == null ? null : v.toLowerCase()),
  from: (v?: string | null) => (v == null ? null : v.toLowerCase()),
};

// decimal <-> number
export const decimalNumber = {
  to: (v?: number | null) => (v == null ? null : v.toString()),
  from: (v: string | null) => (v == null ? null : Number(v)),
};

@Entity({ name: 'users' })
@Unique('uq_user_document', ['documentType', 'documentNumber'])
@Index('idx_user_wallet', ['walletAddress'], { unique: true })
@Index('uq_user_email', ['email'], { unique: true })
@Check(`score >= 0 AND score <= 1000`)
export class User {
  /** ID numérico autoincremental: nos sirve como "número de usuario" (1,2,3,...) */
  @PrimaryGeneratedColumn()
  id!: number;

  /** Wallet address (minúsculas). Único. */
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

  @Column({ type: 'text', nullable: true })
  firstName?: string | null;

  @Column({ type: 'text', nullable: true })
  lastName?: string | null;

  /** Fecha de nacimiento como texto (ej: "1996-04-12"). */
  @Column({ type: 'text', nullable: true })
  birthdate?: string | null;

  /** ISO 3166-1 alpha-3 (ARG, USA, ...). */
  @Column({ type: 'varchar', length: 3, nullable: true })
  nationality?: string | null;

  /** Tipo de documento (DNI, PASSPORT, ...). */
  @Column({ type: 'text', nullable: true })
  documentType?: string | null;

  /** Número de documento. */
  @Column({ type: 'text', nullable: true })
  documentNumber?: string | null;

  /** Límite de crédito (dinero). */
  @Column({
    type: 'decimal',
    precision: 18,
    scale: 2,
    nullable: true,
    default: null,
    transformer: decimalNumber,
  })
  creditLimit?: number | null;

  /** Score (0–1000). */
  @Column({ type: 'integer', nullable: true, default: null })
  score?: number | null;

  /** Email para contactar al usuario (waitlist, notificaciones, etc.). */
  @Column({ type: 'text', nullable: true, transformer: lowercase })
  email?: string | null;

  /** Momento en que se anotó a la waitlist (no se borra, sirve de historial). */
  @Column({ type: 'timestamptz', nullable: true })
  waitlistJoinedAt?: Date | null;

  /** Momento en que le avisaste "ya tenés cupo" (para no mandar mails duplicados). */
  @Column({ type: 'timestamptz', nullable: true })
  earlyAccessNotifiedAt?: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @Column({ type: 'integer', default: 1 })
  xp!: number; // XP si querés sumar al score/gamificación

  /** Prioridad en waitlist: 0 = default/verificado, 1+ = menor prioridad. Menor = mejor posición. */
  @Column({ type: 'integer', default: 0 })
  waitlistPriority!: number;

  @OneToMany(() => UserAchievement, (ua) => ua.user)
  achievements!: UserAchievement[];

  /** Encuesta simple sobre tipo de trabajo. */
  @Column({
    type: 'varchar',
    length: 32,
    nullable: true,
  })
  workType?: string | null; // 'app_driver' | 'app_delivery' | 'creator' | 'freelance_cripto' | 'other_job' | 'no_job'

  /** Fecha en que aceptó Términos y Condiciones. */
  @Column({ type: 'timestamp with time zone', nullable: true })
  termsAcceptedAt?: Date | null;

  /** Número de teléfono en formato E.164 (ej: +5491112345678). */
  @Index('idx_users_phone', { unique: true, where: '"phone" IS NOT NULL' })
  @Column({ type: 'varchar', length: 20, nullable: true })
  phone?: string | null;

  /** Momento en que se verificó el teléfono. */
  @Column({ type: 'timestamptz', nullable: true })
  phoneVerifiedAt?: Date | null;

  /** Si el usuario optó por no recibir mensajes de WhatsApp. */
  @Column({ type: 'boolean', default: false })
  whatsappOptOut!: boolean;

  /** Última vez que se envió un OTP de teléfono (para throttle de 1/min). */
  @Column({ type: 'timestamptz', nullable: true })
  lastPhoneOtpSentAt?: Date | null;

  /** Hash SHA-256 del código OTP de teléfono. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  phoneOtpCode?: string | null;

  /** Expiración del OTP de teléfono. */
  @Column({ type: 'timestamptz', nullable: true })
  phoneOtpExpiresAt?: Date | null;

  /** Intentos fallidos del OTP de teléfono. */
  @Column({ type: 'integer', default: 0 })
  phoneOtpAttemptCount!: number;
}
