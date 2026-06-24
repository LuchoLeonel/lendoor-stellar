// src/entities/loan.entity.ts
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
import { User, decimalNumber } from './user.entity'; // ajustá el path
export enum LoanStatus {
  OPEN = 'open',
  REPAID_ON_TIME = 'repaid_on_time',
  REPAID_LATE = 'repaid_late',
  DEFAULTED_IN_GRACE = 'defaulted_in_grace',
  DEFAULTED = 'defaulted',
}

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

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
