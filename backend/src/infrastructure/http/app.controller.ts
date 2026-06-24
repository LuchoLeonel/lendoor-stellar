// src/infrastructure/http/app.controller.ts
import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppService } from 'src/app.service';
import { Metric } from 'src/domain/entities/metric.entity';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    @InjectRepository(Metric)
    private readonly metricRepo: Repository<Metric>,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  getHealth(): string {
    return 'OK';
  }

  /**
   * Spec 065 Layer 5 — DB ↔ chain loan-count parity.
   */
  @Get('health/db-chain-parity')
  async getDbChainParity() {
    const metric = await this.metricRepo.findOne({
      where: { key: 'db_chain_loan_diff' },
    });
    const THRESHOLD = 3;
    const diff = metric ? Number(metric.value) : null;
    const healthy = diff !== null && Math.abs(diff) < THRESHOLD;
    const snapshot = {
      diff,
      updatedAt: metric?.updatedAt ?? null,
      healthy,
      threshold: THRESHOLD,
    };
    if (!healthy) {
      throw new HttpException(snapshot, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return snapshot;
  }
}
