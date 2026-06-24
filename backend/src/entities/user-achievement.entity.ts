// src/entities/user-achievement.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  Column,
  CreateDateColumn,
  Unique,
} from 'typeorm';
import { User } from './user.entity';
import { Achievement } from './achievement.entity';

@Entity('user_achievements')
@Unique('UQ_user_achievement', ['user', 'achievement'])
export class UserAchievement {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User, (u) => u.achievements, { eager: true })
  @JoinColumn({ name: 'userId' })
  user: User;

  @ManyToOne(() => Achievement, (a) => a.userAchievements, { eager: true })
  @JoinColumn({ name: 'achievementId' })
  achievement: Achievement;

  @CreateDateColumn()
  earnedAt: Date;

  // por si querés guardar info extra (loanId, txHash, etc.)
  @Column({ type: 'jsonb', nullable: true })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  meta: Record<string, any> | null;
}
