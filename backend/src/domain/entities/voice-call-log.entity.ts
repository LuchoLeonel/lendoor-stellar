// src/domain/entities/voice-call-log.entity.ts
//
// Spec 064 — Voice Collections Orchestration.
// Tracking exhaustivo de cada llamada outbound del voice-agent (Sofía/Catalina).
// Schema completo para análisis posterior de KPIs (RPC, PTP, PTP-kept, etc).

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
  CreateDateColumn,
} from 'typeorm';
import { User, decimalNumber } from './user.entity';
import { Loan } from './loan.entity';

export enum VoiceCallOutcome {
  COMPLETED_PTP = 'completed_ptp',
  ACKNOWLEDGED_NO_COMMITMENT = 'acknowledged_no_commitment',
  ESCALATED = 'escalated',
  HOSTILE_DNC = 'hostile_dnc',
  WRONG_PERSON = 'wrong_person',
  TRANSFERRED_OR_EVADED = 'transferred_or_evaded',
  USER_HANGUP = 'user_hangup',
  USER_NO_ANSWER = 'user_no_answer',
  TIMEOUT_HARD_CAP = 'timeout_hard_cap',
  TECHNICAL_ERROR = 'technical_error',
  UNKNOWN = 'unknown',
}

@Entity({ name: 'voice_call_log' })
@Index('idx_voice_call_log_user_attempted', ['userId', 'attemptedAt'])
@Index('idx_voice_call_log_loan', ['loanId'])
@Index('idx_voice_call_log_outcome', ['outcome', 'attemptedAt'])
@Index('idx_voice_call_log_voice', ['voiceName', 'attemptedAt'])
export class VoiceCallLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // ──────────────────────────────────────────────────────────────────────────
  // Identificación
  // ──────────────────────────────────────────────────────────────────────────
  @Column({ type: 'integer' })
  loanId!: number;

  @ManyToOne(() => Loan, { nullable: false })
  @JoinColumn({ name: 'loanId' })
  loan!: Loan;

  @Column({ type: 'integer' })
  userId!: number;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column({ type: 'varchar', length: 80, nullable: true })
  livekitRoom?: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  livekitDispatch?: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  sipCallId?: string | null;

  // ──────────────────────────────────────────────────────────────────────────
  // Timing
  // ──────────────────────────────────────────────────────────────────────────
  @Column({ type: 'timestamptz' })
  attemptedAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  answeredAt?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  endedAt?: Date | null;

  @Column({ type: 'decimal', precision: 8, scale: 2, transformer: decimalNumber, default: 0 })
  ringDurationSec!: number;

  @Column({ type: 'decimal', precision: 8, scale: 2, transformer: decimalNumber })
  durationSec!: number;

  @Column({ type: 'varchar', length: 10 })
  weekday!: string; // "monday" | "tuesday" | ... | "sunday"

  @Column({ type: 'integer' })
  hourLocal!: number;

  @Column({ type: 'varchar', length: 50, nullable: true })
  countryLocalTz?: string | null;

  @Column({ type: 'integer', default: 1 })
  attemptNum!: number; // 1 = primera del día, 2 = retry tarde

  @Column({ type: 'integer', default: 1 })
  retryCountToday!: number; // cap 2

  @Column({ type: 'integer', default: 1 })
  retryCountWeek!: number; // cap 4

  @Column({ type: 'boolean', default: false })
  isRetry!: boolean;

  // ──────────────────────────────────────────────────────────────────────────
  // Voice profile (A/B test attribution)
  // ──────────────────────────────────────────────────────────────────────────
  @Column({ type: 'varchar', length: 20 })
  voiceName!: string; // "sofia" | "catalina"

  @Column({ type: 'varchar', length: 40 })
  voiceId!: string;

  @Column({ type: 'varchar', length: 40, nullable: true })
  voicePreset?: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  ttsModel?: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  llmProvider?: string | null; // "bedrock" | "anthropic" | "openai"

  @Column({ type: 'varchar', length: 60, nullable: true })
  llmModel?: string | null;

  // ──────────────────────────────────────────────────────────────────────────
  // Snapshot del préstamo AL MOMENTO de la llamada
  // ──────────────────────────────────────────────────────────────────────────
  @Column({ type: 'decimal', precision: 18, scale: 2, transformer: decimalNumber, nullable: true })
  principalOutstandingUsd?: number | null;

  @Column({ type: 'decimal', precision: 18, scale: 2, transformer: decimalNumber, nullable: true })
  lateFeesUsd?: number | null;

  @Column({ type: 'decimal', precision: 18, scale: 2, transformer: decimalNumber, nullable: true })
  amountDueTotalUsd?: number | null;

  @Column({ type: 'integer', nullable: true })
  daysOverdue?: number | null;

  @Column({ type: 'date', nullable: true })
  dueDateOriginal?: Date | null;

  @Column({ type: 'varchar', length: 10, default: 'USDC' })
  loanCurrency!: string;

  // ──────────────────────────────────────────────────────────────────────────
  // Outcome
  // ──────────────────────────────────────────────────────────────────────────
  @Column({ type: 'enum', enum: VoiceCallOutcome, default: VoiceCallOutcome.UNKNOWN })
  outcome!: VoiceCallOutcome;

  @Column({ type: 'integer', nullable: true })
  category?: number | null; // 1-8 spec 061

  @Column({ type: 'varchar', length: 20, nullable: true })
  sentiment?: string | null; // positive | neutral | negative

  // ──────────────────────────────────────────────────────────────────────────
  // PTP (Promise To Pay)
  // ──────────────────────────────────────────────────────────────────────────
  @Column({ type: 'decimal', precision: 18, scale: 2, transformer: decimalNumber, nullable: true })
  ptpAmountUsd?: number | null;

  @Column({ type: 'date', nullable: true })
  ptpDate?: Date | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  ptpMethod?: string | null;

  @Column({ type: 'boolean', nullable: true })
  ptpFulfilled?: boolean | null;

  @Column({ type: 'timestamptz', nullable: true })
  ptpFulfilledAt?: Date | null;

  @Column({ type: 'integer', nullable: true })
  ptpLagHours?: number | null;

  // ──────────────────────────────────────────────────────────────────────────
  // Banderas de comportamiento (spec 063)
  // ──────────────────────────────────────────────────────────────────────────
  @Column({ type: 'varchar', length: 40, nullable: true })
  reportedProblem?: string | null;

  @Column({ type: 'boolean', default: false })
  hardshipMentioned!: boolean;

  @Column({ type: 'boolean', default: false })
  identityVerified!: boolean;

  @Column({ type: 'boolean', default: false })
  disputeRaised!: boolean;

  @Column({ type: 'varchar', length: 40, nullable: true })
  askedToPassTo?: string | null;

  // ──────────────────────────────────────────────────────────────────────────
  // Métricas técnicas
  // ──────────────────────────────────────────────────────────────────────────
  @Column({ type: 'integer', default: 0 })
  userTurns!: number;

  @Column({ type: 'integer', default: 0 })
  agentTurns!: number;

  @Column({ type: 'decimal', precision: 6, scale: 2, transformer: decimalNumber, nullable: true })
  avgLagSec?: number | null;

  @Column({ type: 'decimal', precision: 6, scale: 2, transformer: decimalNumber, nullable: true })
  maxLagSec?: number | null;

  @Column({ type: 'integer', default: 0 })
  llmCallsTotal!: number;

  @Column({ type: 'integer', default: 0 })
  llmInputTokens!: number;

  @Column({ type: 'integer', default: 0 })
  llmOutputTokens!: number;

  @Column({ type: 'integer', default: 0 })
  ttsChars!: number;

  @Column({ type: 'decimal', precision: 8, scale: 2, transformer: decimalNumber, default: 0 })
  ttsAudioSec!: number;

  @Column({ type: 'decimal', precision: 8, scale: 2, transformer: decimalNumber, default: 0 })
  sttAudioSec!: number;

  // ──────────────────────────────────────────────────────────────────────────
  // Costos desglosados (USD)
  // ──────────────────────────────────────────────────────────────────────────
  @Column({ type: 'decimal', precision: 10, scale: 6, transformer: decimalNumber, default: 0 })
  costLlmUsd!: number;

  @Column({ type: 'decimal', precision: 10, scale: 6, transformer: decimalNumber, default: 0 })
  costTtsUsd!: number;

  @Column({ type: 'decimal', precision: 10, scale: 6, transformer: decimalNumber, default: 0 })
  costSttUsd!: number;

  @Column({ type: 'decimal', precision: 10, scale: 6, transformer: decimalNumber, default: 0 })
  costLivekitUsd!: number;

  @Column({ type: 'decimal', precision: 10, scale: 6, transformer: decimalNumber, default: 0 })
  costLivekitSipUsd!: number;

  @Column({ type: 'decimal', precision: 10, scale: 6, transformer: decimalNumber, default: 0 })
  costTelnyxUsd!: number;

  @Column({ type: 'decimal', precision: 10, scale: 6, transformer: decimalNumber })
  costTotalUsd!: number;

  // ──────────────────────────────────────────────────────────────────────────
  // Carrier (futuro: lookup contra Truecaller/Hiya)
  // ──────────────────────────────────────────────────────────────────────────
  @Column({ type: 'varchar', length: 40, nullable: true })
  carrierName?: string | null;

  @Column({ type: 'varchar', length: 4, nullable: true })
  carrierCountry?: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  callerIdShown?: string | null;

  // ──────────────────────────────────────────────────────────────────────────
  // Transcripts / referencias
  // ──────────────────────────────────────────────────────────────────────────
  @Column({ type: 'text', nullable: true })
  transcriptUrl?: string | null; // S3 URL del JSON guardado

  @Column({ type: 'text', nullable: true })
  summaryShort?: string | null;

  // ──────────────────────────────────────────────────────────────────────────
  // Compliance
  // ──────────────────────────────────────────────────────────────────────────
  @Column({ type: 'boolean', default: true })
  withinLegalHours!: boolean;

  @Column({ type: 'text', nullable: true })
  complianceNotes?: string | null;

  // ──────────────────────────────────────────────────────────────────────────
  // Metadata
  // ──────────────────────────────────────────────────────────────────────────
  @Column({ type: 'varchar', length: 40, nullable: true })
  agentVersion?: string | null; // git SHA / version tag

  @Column({ type: 'varchar', length: 20, nullable: true })
  promptVersion?: string | null;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  destinationPhone?: string | null;

  // ──────────────────────────────────────────────────────────────────────────
  // Spec 070 Phase 1.5 — admin overrides (set by Fabián or trainee)
  // When any of these are non-null, they take precedence over the auto-detected
  // value when rendered in the dashboard. Original values are preserved.
  // ──────────────────────────────────────────────────────────────────────────
  @Column({ type: 'varchar', length: 40, nullable: true })
  adminOutcomeOverride?: string | null;

  @Column({ type: 'smallint', nullable: true })
  adminCategoryOverride?: number | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  adminSentimentOverride?: string | null;

  @Column({ type: 'boolean', nullable: true })
  adminPtpFulfilledOverride?: boolean | null;

  /** Wallet that performed the most-recent override (audit trail). */
  @Column({ type: 'varchar', length: 42, nullable: true })
  adminOverrideBy?: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  adminOverrideAt?: Date | null;

  @CreateDateColumn()
  createdAt!: Date;
}
