import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'siwe_nonces' })
@Index('idx_siwe_nonce_value', ['nonce'], { unique: true })
export class SiweNonce {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 128 })
  nonce!: string;

  @Column({ type: 'boolean', default: false })
  used!: boolean;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
