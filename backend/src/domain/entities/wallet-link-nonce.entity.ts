// src/domain/entities/wallet-link-nonce.entity.ts
// Spec 084 — nonce single-use SCOPEADO a (userId, address) con TTL 5 min.
// Entidad propia (NO reusa siwe_nonces, que no tiene scope, TTL 10min y mark-used
// no atómico → contaminaría el flujo de auth de Lemon).
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

@Entity({ name: 'wallet_link_nonces' })
@Index('uq_wln_nonce', ['nonce'], { unique: true })
export class WalletLinkNonce {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int' })
  userId!: number;

  @Column({ type: 'varchar', length: 42, transformer: lowercase })
  address!: string;

  @Column({ type: 'varchar', length: 128 })
  nonce!: string;

  /** Mensaje SIWE-like completo que el server armó y el cliente debe firmar. */
  @Column({ type: 'text' })
  message!: string;

  @Column({ type: 'boolean', default: false })
  used!: boolean;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @CreateDateColumn()
  createdAt!: Date;
}
