import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthController } from 'src/infrastructure/http/health.controller';
import { Metric } from 'src/domain/entities/metric.entity';

@Module({
  imports: [TerminusModule, TypeOrmModule.forFeature([Metric])],
  controllers: [HealthController],
})
export class HealthModule {}
