// src/domain/entities/loan.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User, decimalNumber } from './user.entity';
export enum LoanStatus {
  OPEN = 'open',
  REPAID_ON_TIME = 'repaid_on_time',
  REPAID_LATE = 'repaid_late',
  DEFAULTED_IN_GRACE = 'defaulted_in_grace',
  DEFAULTED = 'defaulted',
}

export type CreditTier = {
  level: number;
  minOnTimeLoans: number;
  limitUsdc: number;
  baseRateMonthly: number;
};

@Entity({ name: 'loans' })
@Index('idx_loans_user', ['userId'])
@Index('idx_loans_user_status', ['userId', 'status'])
export class Loan {
  @PrimaryGeneratedColumn()
  id!: number;

  /** FK al user */
  @Column()
  userId!: number;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'userId' })
  user!: User;

  /** Redundancia útil para debug / joins rápidos por wallet */
  @Column({ type: 'text' })
  borrowerAddress!: string;

  /** Monto prestado (principal) */
  @Column({
    type: 'decimal',
    precision: 18,
    scale: 2,
    transformer: decimalNumber,
  })
  principal!: number;

  /**
   * Monto total a devolver al originar el préstamo
   * (principal + interés base, SIN mora).
   */
  @Column({
    type: 'decimal',
    precision: 18,
    scale: 2,
    transformer: decimalNumber,
  })
  amountDueAtOpen!: number;

  /**
   * Monto efectivamente pagado al cerrar el préstamo.
   * Siempre total (>= amountDueAtOpen).
   * Si hubo mora, amountPaid > amountDueAtOpen.
   */
  @Column({
    type: 'decimal',
    precision: 18,
    scale: 2,
    transformer: decimalNumber,
  })
  amountPaid!: number;

  /** Tenor en días (3, 7, 14, 30, etc.) */
  @Column({ type: 'integer' })
  tenorDays!: number;

  /** Fee total en basis points (ej: 1500 = 15%) */
  @Column({ type: 'integer' })
  feeBps!: number;

  /** Inicio del préstamo (block.timestamp de openLoan mapeado a Date) */
  @Column({ type: 'timestamptz' })
  startAt!: Date;

  /** Due date contractual (sin gracia) */
  @Column({ type: 'timestamptz' })
  dueAt!: Date;

  /** Momento en que se cerró el préstamo (cuando pagó todo) */
  @Column({ type: 'timestamptz', nullable: true })
  closedAt?: Date | null;

  /**
   * Estado del préstamo:
   * - open: mientras está abierto on-chain
   * - repaid_on_time: closedAt <= dueAt
   * - repaid_late:    closedAt > dueAt
   * - defaulted:      se marcó default (aunque después pague off-chain, etc.)
   */
  @Column({
    type: 'enum',
    enum: LoanStatus,
    default: LoanStatus.OPEN,
  })
  status!: LoanStatus;

  /**
   * Redundante pero cómodo para queries rápidas:
   * true  -> repaid_on_time
   * false -> repaid_late o defaulted
   */
  @Column({ type: 'boolean', default: false })
  repaidOnTime!: boolean;

  /** Opcionales: tx hashes on-chain */
  @Column({ type: 'text', nullable: true })
  openTxHash?: string | null;

  @Column({ type: 'text', nullable: true })
  closeTxHash?: string | null;

  /** True when the loan was reconciled by the chain-sync cron (not the frontend) */
  @Column({ type: 'boolean', default: false })
  syncedByChain!: boolean;

  // ── Spec 064 — Voice collections snapshot (populado por chain-sync) ──
  /**
   * Tasa de mora por segundo en formato WAD (1e18). Lectura de
   * `premiums(addr).lateRatePerSecWad`. NULL = no premium configurado todavía.
   * Almacenado como string (NUMERIC(40,0)) para no perder precisión bigint.
   */
  @Column({ type: 'numeric', precision: 40, scale: 0, nullable: true })
  lateRatePerSecWad?: string | null;

  /** Grace period en segundos. Lectura de `loans(addr).gracePeriod`. */
  @Column({ type: 'integer', nullable: true })
  gracePeriodSec?: number | null;

  /**
   * Late fees acumuladas al momento del último chain-sync. Calculado
   * offline con LoanCalculationsService (no es lectura on-chain — es
   * fórmula replicada). El orchestrator refresca con valor "live" antes
   * del dispatch para precisión al segundo.
   */
  @Column({
    type: 'decimal',
    precision: 18,
    scale: 2,
    nullable: true,
    transformer: decimalNumber,
  })
  lateFeesCurrentUsd?: number | null;

  /** Cuándo se calculó `lateFeesCurrentUsd`. Útil para alertar staleness. */
  @Column({ type: 'timestamptz', nullable: true })
  lateFeesSnapshotAt?: Date | null;

  /**
   * Mora cobrada al cierre del loan. Persistida al reconciliar el LoanClosed
   * event. Definición (mirrors admin overview formula):
   *   = amountPaid - amountDueAtOpen
   *     if status='repaid_late' AND closedAt - dueAt > 24h AND amountPaid > amountDueAtOpen
   *   = 0 si cerró sin mora (repaid_on_time u dentro de gracia)
   *   = NULL si loan no cerrado todavía (open/in_grace/defaulted sin paid)
   */
  @Column({
    type: 'decimal',
    precision: 18,
    scale: 2,
    nullable: true,
    transformer: decimalNumber,
  })
  lateFeesCollectedUsd?: number | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
