// src/domain/entities/metric.entity.ts
//
// Spec 065 Layer 5 — small key/value table for chain-sync health metrics.
// We don't have Prometheus / a metrics gateway; a simple polled table is
// enough for `/health/db-chain-parity` and any future similar gauges.
//
// First key: `db_chain_loan_diff` — computed at the end of every chain-sync
// cycle. Healthy steady-state = 0.

import {
  Column,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'metrics' })
export class Metric {
  @PrimaryColumn({ type: 'text' })
  key!: string;

  @Column({ type: 'double precision' })
  value!: number;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
