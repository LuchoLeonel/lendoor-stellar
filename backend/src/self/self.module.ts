// src/self/self.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { SelfController } from 'src/infrastructure/http/self.controller';
import { SelfService } from './self.service';
import { SelfVerification } from 'src/domain/entities/self-verification.entity';
import { User } from 'src/domain/entities/user.entity';
import { AuthModule } from 'src/auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([SelfVerification, User]), AuthModule],
  controllers: [SelfController],
  providers: [SelfService],
  exports: [SelfService],
})
export class SelfModule {}
