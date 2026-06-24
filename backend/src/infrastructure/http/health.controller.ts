// src/infrastructure/http/health.controller.ts
import { Controller, Get, Req, HttpException, HttpStatus } from '@nestjs/common';
import {
  HealthCheckService,
  TypeOrmHealthIndicator,
  MemoryHealthIndicator,
  DiskHealthIndicator,
  HealthCheck,
} from '@nestjs/terminus';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Request } from 'express';
import { Metric } from 'src/domain/entities/metric.entity';

@ApiTags('health')
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly memory: MemoryHealthIndicator,
    private readonly disk: DiskHealthIndicator,
    @InjectRepository(Metric)
    private readonly metricRepo: Repository<Metric>,
  ) {}

  @Get()
  @HealthCheck()
  @ApiOperation({ summary: 'Run health checks (DB, memory, disk)' })
  @ApiResponse({ status: 200, description: 'All checks passed' })
  @ApiResponse({ status: 503, description: 'One or more checks failed' })
  async check(@Req() req: Request) {
    const fullHealth = await this.health.check([
      () => this.db.pingCheck('database'),
      () => this.memory.checkHeap('memory_heap', 300 * 1024 * 1024),
      () =>
        this.disk.checkStorage('disk', { thresholdPercent: 0.9, path: '/' }),
    ]);

    if (this.isInternalRequest(req)) {
      return fullHealth;
    }

    return { status: fullHealth.status };
  }

  /**
   * Spec 065 Layer 5 — DB ↔ chain parity health.
   */
  @Get('db-chain-parity')
  @ApiOperation({ summary: 'DB ↔ chain loan-count parity (spec 065)' })
  @ApiResponse({ status: 200, description: 'In parity (|diff| < 3)' })
  @ApiResponse({ status: 503, description: 'Drift detected — see body' })
  async dbChainParity() {
    const metric = await this.metricRepo.findOne({
      where: { key: 'db_chain_loan_diff' },
    });

    const diff = metric ? Number(metric.value) : null;
    const healthy = diff !== null && Math.abs(diff) < 3;

    const snapshot = {
      diff,
      updatedAt: metric?.updatedAt ?? null,
      healthy,
      threshold: 3,
    };

    if (!healthy) {
      throw new HttpException(snapshot, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return snapshot;
  }

  private isInternalRequest(req: Request): boolean {
    const ip = req.socket?.remoteAddress ?? '';
    return /^(127\.|::1|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(ip);
  }
}
