// src/domain/entities/voice-call-note.entity.ts
//
// Spec 070 Phase 1.5 — admin notes per voice call.
// Migration: 20260520200000-CreateVoiceCallNotesTable.

import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { VoiceCallLog } from './voice-call-log.entity';

@Entity({ name: 'voice_call_notes' })
@Index(['callId', 'createdAt'])
export class VoiceCallNote {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** FK to voice_call_log.id */
  @Column({ type: 'uuid' })
  callId!: string;

  @ManyToOne(() => VoiceCallLog, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'callId' })
  call?: VoiceCallLog;

  /** Wallet address of the admin who wrote the note (lowercase). */
  @Column({ type: 'varchar', length: 42 })
  authorWallet!: string;

  /** Free-text observation. */
  @Column({ type: 'text' })
  text!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  /** Soft delete — preserves audit trail. */
  @Column({ type: 'timestamptz', nullable: true })
  deletedAt?: Date | null;
}
