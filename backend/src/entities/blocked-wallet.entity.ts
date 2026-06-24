// src/entities/blocked-wallet.entity.ts
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

@Entity({ name: 'blocked_wallets' })
@Index('uq_blocked_wallet_wallet', ['walletAddress'], { unique: true })
export class BlockedWallet {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'text', transformer: lowercase })
  walletAddress!: string;

  @Column({ type: 'text', nullable: true })
  reason?: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  blockedUntil?: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
