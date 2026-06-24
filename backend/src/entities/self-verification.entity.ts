import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  Index,
} from 'typeorm';
import { User } from './user.entity';

const lowercase = {
  to: (v?: string | null) => (v == null ? null : v.toLowerCase()),
  from: (v?: string | null) => (v == null ? null : v.toLowerCase()),
};

@Entity('self_verifications')
export class SelfVerification {
  @PrimaryGeneratedColumn()
  id!: number;

  // 🔗 Relación con User
  @ManyToOne(() => User, {
    onDelete: 'CASCADE',
  })
  user!: User;

  @Index('idx_self_verification_user_id', { unique: true })
  @Column()
  userId!: number;

  // La seguimos guardando por conveniencia, pero ya no es la primary key lógica
  @Index('idx_self_verification_wallet', { unique: true })
  @Column({ length: 42, transformer: lowercase })
  walletAddress!: string;

  @Column({ default: false })
  verified!: boolean;

  // Payload que devuelve Self (credentialSubject / discloseOutput)
  @Column({ type: 'jsonb', nullable: true })
  payload!: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
