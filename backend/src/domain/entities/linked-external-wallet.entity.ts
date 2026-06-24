// src/domain/entities/linked-external-wallet.entity.ts
// Spec 084 — wallet externa verificada por firma (companion "firmá desde la
// computadora"). Señal de score L3 (spec 081).
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
} from 'typeorm';

const lowercase = {
  to: (v?: string | null) => (v == null ? null : v.toLowerCase()),
  from: (v?: string | null) => (v == null ? null : v.toLowerCase()),
};

@Entity({ name: 'linked_wallets' })
// Idempotente: un user no vincula la misma wallet dos veces.
@Index('uq_linked_wallet_user_addr', ['userId', 'address'], { unique: true })
// Anti-sybil: una EOA mapea a UN solo user (global).
@Index('uq_linked_wallet_addr', ['address'], { unique: true })
export class LinkedExternalWallet {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int' })
  userId!: number;

  @Column({ type: 'varchar', length: 42, transformer: lowercase })
  address!: string;

  @Column({ type: 'int', default: 1 })
  chainId!: number;

  @Column({ type: 'timestamptz' })
  verifiedAt!: Date;

  /** 'companion_web' (v1). */
  @Column({ type: 'text', default: 'companion_web' })
  source!: string;

  /** 'ecdsa_companion' (v1) | 'erc1271' (v2). */
  @Column({ type: 'text', default: 'ecdsa_companion' })
  verificationMethod!: string;

  /** Mensaje firmado (auditoría). */
  @Column({ type: 'text', nullable: true })
  message?: string | null;

  /** Firma (auditoría). */
  @Column({ type: 'text', nullable: true })
  signature?: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}
