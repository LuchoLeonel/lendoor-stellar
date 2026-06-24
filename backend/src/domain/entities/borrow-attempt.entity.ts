import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

@Entity('borrow_attempts')
export class BorrowAttempt {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ nullable: true })
  userId: number | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'userId' })
  user?: User;

  @Column({ type: 'text' })
  walletAddress: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  sessionId: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  amountHuman: string | null;

  @Column({ type: 'int', nullable: true })
  tenorDays: number | null;

  @Column({ type: 'int', nullable: true })
  feeBps: number | null;

  @Column({ type: 'varchar', length: 20 })
  outcome: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  errorType: string | null;

  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  deviceBrand: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  deviceModel: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  deviceTier: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  osName: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  osVersion: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  ip: string | null;

  @Column({ type: 'varchar', length: 3, nullable: true })
  country: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  region: string | null;

  @Column({ type: 'int', nullable: true })
  durationMs: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
