// src/entities/achievement.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { UserAchievement } from './user-achievement.entity';

@Entity('achievements')
export class Achievement {
  @PrimaryGeneratedColumn()
  id: number;

  // código estable para usar en el front: "FIRST_LOAN_REPAID"
  @Column({ unique: true })
  code: string;

  @Column()
  title: string; // "Primer préstamo pagado"

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'int', default: 0 })
  xp: number; // XP si querés sumar al score/gamificación

  // Emoji / nombre de icono / lo que sea, como string simple
  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  icon: string | null;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => UserAchievement, (ua) => ua.achievement)
  userAchievements: UserAchievement[];
}
