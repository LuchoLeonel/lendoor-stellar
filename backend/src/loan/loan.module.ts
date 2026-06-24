// src/contract/contract.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';

import { LoanService } from './loan.service';
import { LoanController } from 'src/infrastructure/http/loan.controller';
import { PublicStatsController } from './public-stats.controller';
import { CreditPolicyService } from 'src/domain/services/credit-policy.service';
import { ChainSyncService } from './chain-sync.service';
import { LoanCalculationsService } from './loan-calculations.service';
import { ChainSyncProcessor } from 'src/infrastructure/queue/chain-sync.processor';
import { ChainSyncScheduler } from 'src/infrastructure/queue/chain-sync.scheduler';
import { BlockchainProcessor } from 'src/infrastructure/queue/blockchain.processor';
import { BlockchainQueueService } from './blockchain-queue.service';

import { User } from 'src/domain/entities/user.entity';
import { Loan } from 'src/domain/entities/loan.entity';
import { ChainScanCursor } from 'src/domain/entities/chain-scan-cursor.entity';
import { Metric } from 'src/domain/entities/metric.entity';
import { UserModule } from 'src/user/user.module';
import { AuthModule } from 'src/auth/auth.module';
import { SelfModule } from 'src/self/self.module';
import { BLOCKCHAIN_GATEWAY } from 'src/domain/ports/outbound/blockchain-gateway.port';
import { EthersBlockchainGateway } from 'src/infrastructure/blockchain/ethers-blockchain.gateway';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Loan, ChainScanCursor, Metric]),
    BullModule.registerQueue({ name: 'chain-sync' }, { name: 'blockchain' }),
    UserModule,
    AuthModule,
    SelfModule,
  ],
  providers: [
    LoanService,
    CreditPolicyService,
    ChainSyncService,
    ChainSyncProcessor,
    ChainSyncScheduler,
    BlockchainProcessor,
    BlockchainQueueService,
    LoanCalculationsService,
    { provide: BLOCKCHAIN_GATEWAY, useClass: EthersBlockchainGateway },
  ],
  controllers: [LoanController, PublicStatsController],
  exports: [
    LoanService,
    CreditPolicyService,
    BlockchainQueueService,
    LoanCalculationsService,
  ],
})
export class ContractModule {}
