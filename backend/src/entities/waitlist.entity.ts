// src/entities/waitlist.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'waitlist' })
export class Waitlist {
  @PrimaryGeneratedColumn()
  id!: number;

  /**
   * Límite actual de usuarios que entran sin waitlist.
   * Es el reemplazo del USER_UNTIL_WAITLIST "duro".
   */
  @Column({ type: 'integer', nullable: false })
  value!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
