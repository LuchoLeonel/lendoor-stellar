import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

@Entity('device_sessions')
export class DeviceSession {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ nullable: true })
  userId: number | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'userId' })
  user?: User;

  @Column({ type: 'text', nullable: true })
  walletAddress: string | null;

  @Column({ type: 'varchar', length: 64, unique: true })
  sessionId: string;

  @Column({ type: 'text', nullable: true })
  userAgent: string | null;

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

  @Column({ type: 'varchar', length: 16, nullable: true })
  platform: string | null;

  @Column({ type: 'timestamptz', default: () => 'NOW()' })
  startedAt: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
