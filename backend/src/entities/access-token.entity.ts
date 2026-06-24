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

@Entity({ name: 'access_tokens' })
@Index('idx_access_token_value', ['token'], { unique: true })
@Index('idx_access_token_wallet', ['walletAddress'])
export class AccessToken {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'text' })
  token!: string;

  @Column({ type: 'text', transformer: lowercase })
  walletAddress!: string;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  expiresAt?: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
