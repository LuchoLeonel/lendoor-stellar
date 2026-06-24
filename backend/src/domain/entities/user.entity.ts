// src/domain/entities/user.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  Unique,
  CreateDateColumn,
  UpdateDateColumn,
  Check,
} from 'typeorm';

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

  /**
   * Spec 072 day-2 — nombre exclusivo para greetings del voice-agent (Sofía/Catalina).
   * Si está seteado, override `firstName`/`lastName` SOLO para la llamada.
   * NO toca la identidad canónica del user (firstName/lastName quedan intactos para
   * KYC, reportes, etc). Editable manualmente desde `/admin/voice`.
   * 1 palabra → flow GREETINGS_NAME_ONLY. 2+ palabras → flow GREETINGS_FULL formal.
   */
  @Column({ type: 'text', nullable: true })
  voiceDisplayName?: string | null;

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

  // ── Risk scoring fields ──────────────────────────────────────────────────

  /** Decisión del motor de riesgo: 'admit' | 'admit_restricted' | 'waitlist' | 'reject'. */
  @Column({ type: 'varchar', length: 20, nullable: true, default: null })
  riskDecision?: string | null;

  /** Probabilidad de default estimada por el motor (0.0000 – 1.0000). */
  @Column({
    type: 'decimal',
    precision: 6,
    scale: 4,
    nullable: true,
    default: null,
    transformer: decimalNumber,
  })
  riskPDefault?: number | null;

  /** Clase de riesgo histórico: 'clean' | 'first_default' | 'repeat_default'. */
  @Column({ type: 'varchar', length: 20, nullable: true, default: null })
  riskClass?: string | null;

  /** Timestamp en que se ejecutó el último scoring de riesgo. */
  @Column({ type: 'timestamptz', nullable: true, default: null })
  riskScoredAt?: Date | null;

  /** UUID devuelto por la API de riesgo para trazabilidad de auditoría. */
  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  riskDecisionId?: string | null;

  /** Límite de crédito sugerido por el motor de riesgo (USD). */
  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    nullable: true,
    default: null,
    transformer: decimalNumber,
  })
  riskCreditLimitUsd?: number | null;

  /** Wallet quality classification: buena / media / fea. Column already exists in DB. */
  @Column({ type: 'varchar', length: 5, nullable: true, default: null })
  walletQuality?: string | null;


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

  /**
   * Spec 064 — DNCL temporal automático para voice collections. Se setea a
   * `now + 30d` cuando el user no atiende 4 llamadas consecutivas en la
   * misma ventana semanal (no_answer_week). Mientras `voiceDncTemporaryUntil
   * > now()`, el orchestrator no lo incluye en eligible-for-call.
   *
   * Distinto de `hostile_dnc` outcome (permanente, set manualmente por el
   * tool `do_not_call` durante la llamada): este es soft y vence solo.
   */
  @Column({ type: 'timestamptz', nullable: true })
  voiceDncTemporaryUntil?: Date | null;

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

  /**
   * Spec 034 — permanent flag set when the user paid back a loan that
   * was already past the 16-day default window (= cron `markDefault`
   * had fired before the user paid).
   *
   * The risk policy uses this flag (NOT the count of REPAID_LATE
   * loans) to decide whether to apply post-default penalty in
   * subsequent borrows. Pre-default late repays are NOT a penalty —
   * the mora cost on-chain is the only fair charge for that case.
   *
   * Once `true`, never reset (permanent record).
   */
  @Column({ type: 'boolean', default: false })
  hadDefaultEver!: boolean;

  /**
   * Spec 038 — counter of real defaults this user has had over their
   * lifetime. A "real default" is a loan that crossed 16 days past due
   * (whether eventually paid as repaid_late or still in defaulted
   * status). Increments inside the spec 036 promotion cron when a loan
   * crosses 16d.
   *
   * Sister of `hadDefaultEver` — that flag stays untouched. The counter
   * exists so the dashboard can distinguish single- vs multi-defaulters.
   */
  @Column({ type: 'int', default: 0 })
  defaultsCount!: number;

  // ── Spec 044: Lemon SDK identity claims ──────────────────────────────

  /** Lemon Cash handle (lowercase). Unique partial index. */
  @Column({
    type: 'varchar',
    length: 64,
    nullable: true,
    transformer: lowercase,
  })
  lemonTag?: string | null;

  /** Politically Exposed Person flag from Lemon claims. NULL = not asked. */
  @Column({ type: 'boolean', nullable: true })
  pep?: boolean | null;

  /**
   * Country reported by Lemon (`OPERATION_COUNTRY` claim).
   * Separate from `nationality` which comes from Self KYC.
   */
  @Column({ type: 'varchar', length: 3, nullable: true })
  lemonCountry?: string | null;

  /** When the user last granted claims via Lemon `authenticate()`. */
  @Column({ type: 'timestamptz', nullable: true })
  lemonAuthenticatedAt?: Date | null;

  /** When the backend last cross-checked Lemon vs Self identity fields. */
  @Column({ type: 'timestamptz', nullable: true })
  identityCrossCheckedAt?: Date | null;

  /**
   * Confidence score (0–100) of Lemon claims matching Self KYC fields.
   * +40 firstName, +40 lastName, +20 email. NULL = no Self data to compare.
   */
  @Column({ type: 'smallint', nullable: true })
  identityMatchScore?: number | null;

  /**
   * Spec 045 PR-9 — Lemon Cash email address as returned by the Lemon SDK
   * EMAIL claim. Stored separately from `email` (which is what the user
   * provided at Lendoor signup) for two reasons:
   *  - Anti-fraud feature: mismatch between this and `email` is a sybil /
   *    account-takeover signal.
   *  - Collections reach: this is the email tied to the user's financial
   *    account on Lemon → far more active than a possibly-stale signup
   *    email when chasing defaulted loans.
   */
  @Column({
    type: 'text',
    nullable: true,
    transformer: lowercase,
  })
  lemonEmail?: string | null;

  /**
   * Spec 045 PR-9 — Whether `email` (Lendoor signup) matches `lemonEmail`
   * (Lemon claim) after lowercase + trim normalization. Computed at every
   * `upsertLemonProfile` call when both sides are present.
   *  - NULL = either side missing (cannot compare yet)
   *  - true = both present and identical
   *  - false = both present and different (anti-fraud signal)
   *
   * Used directly as a model feature in admission and rescoring v3.
   */
  @Column({ type: 'boolean', nullable: true })
  emailMatchesLemon?: boolean | null;
}
