// src/domain/entities/chain-scan-cursor.entity.ts
//
// Spec 065 Layer 2 — persistent cursor for the LoanOpened scanner.
//
// The scanner walks `LoanOpened` events on the LoanManager contract in
// chunks (capped at MAX_BLOCK_RANGE), so it must remember the last
// successfully-scanned block across runs and restarts. Keyed by `id`
// (a discriminator string) so future scanners — e.g. LoanDefaulted —
// can share the table.

import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'chain_scan_cursor' })
export class ChainScanCursor {
  @PrimaryColumn({ type: 'text' })
  id!: string;

  @Column({ type: 'bigint' })
  block!: string;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
