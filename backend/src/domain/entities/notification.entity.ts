// src/domain/entities/notification.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Unique,
} from 'typeorm';
import { User } from './user.entity';
import { Loan } from './loan.entity';

export enum NotificationType {
  LOAN_DUE_TOMORROW = 'loan_due_tomorrow',
  LOAN_DEFAULTED = 'loan_defaulted',
  LOAN_DEFAULTED_WEEKLY_REMINDER = 'loan_defaulted_weekly_reminder',
  FIRST_SURVEY = 'first_survey',
  WA_LOAN_DUE_3D = 'wa_loan_due_3d',
  WA_LOAN_DUE_TOMORROW = 'wa_loan_due_tomorrow',
  WA_LOAN_DUE_TODAY = 'wa_loan_due_today',
  WA_LOAN_OVERDUE = 'wa_loan_overdue',
  WA_LOAN_OVERDUE_WEEKLY = 'wa_loan_overdue_weekly',
}

export enum NotificationStatus {
  PENDING = 'pending',
  SENT = 'sent',
  FAILED = 'failed',
  /**
   * Spec 053 — set by NotificationStateService when the underlying
   * loan was already closed (paid/defaulted) before the notification
   * could be dispatched. Distinct from FAILED (which implies a real
   * send attempt that errored).
   */
  CANCELLED = 'cancelled',
}

@Entity({ name: 'notifications' })
@Index('idx_notification_user', ['userId'])
@Index('idx_notification_loan', ['loanId'])
@Unique('uq_notification_type_user_loan', ['type', 'userId', 'loanId'])
export class Notification {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  userId!: number;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column({ nullable: true })
  loanId!: number | null;

  @ManyToOne(() => Loan, { nullable: true })
  @JoinColumn({ name: 'loanId' })
  loan!: Loan | null;

  @Column({
    type: 'enum',
    enum: NotificationType,
  })
  type!: NotificationType;

  @Column({
    type: 'enum',
    enum: NotificationStatus,
    default: NotificationStatus.PENDING,
  })
  status!: NotificationStatus;

  /** canal por si mañana agregás push / in-app */
  @Column({ type: 'varchar', length: 16, default: 'email' })
  channel!: string;

  /** para guardar info extra si hace falta */
  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null;

  @Column({ type: 'timestamptz', nullable: true })
  sentAt?: Date | null;

  @Column({ type: 'text', nullable: true })
  lastError?: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
