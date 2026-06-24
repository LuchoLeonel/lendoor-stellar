import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Spec 064 — Voice Collections Orchestration.
 *
 * Tabla de tracking exhaustivo de cada llamada outbound del voice-agent.
 * Una fila por intento de llamada (incluso si no se atendió). El voice-agent
 * postea aquí via POST /collections/agent/webhook al final de cada call.
 *
 * Indexes elegidos para los hot reads del orchestrator:
 *   - user+attemptedAt: "¿ya llamé hoy a este user? ¿cuántas veces esta semana?"
 *   - loan: "todas las llamadas relacionadas a este loan" (multi-attempt timeline)
 *   - outcome+attemptedAt: KPIs por outcome (RPC, PTP, etc)
 *   - voice+attemptedAt: A/B testing Sofía vs Catalina
 */
export class CreateVoiceCallLogTable20260518100000
  implements MigrationInterface
{
  name = 'CreateVoiceCallLogTable20260518100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "voice_call_outcome_enum" AS ENUM (
        'completed_ptp',
        'acknowledged_no_commitment',
        'escalated',
        'hostile_dnc',
        'wrong_person',
        'transferred_or_evaded',
        'user_hangup',
        'user_no_answer',
        'timeout_hard_cap',
        'technical_error',
        'unknown'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "voice_call_log" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),

        -- Identificación
        "loanId" INT NOT NULL REFERENCES "loans"("id"),
        "userId" INT NOT NULL REFERENCES "users"("id"),
        "livekitRoom" VARCHAR(80),
        "livekitDispatch" VARCHAR(80),
        "sipCallId" VARCHAR(80),

        -- Timing
        "attemptedAt" TIMESTAMPTZ NOT NULL,
        "answeredAt" TIMESTAMPTZ,
        "endedAt" TIMESTAMPTZ,
        "ringDurationSec" NUMERIC(8,2) NOT NULL DEFAULT 0,
        "durationSec" NUMERIC(8,2) NOT NULL,
        "weekday" VARCHAR(10) NOT NULL,
        "hourLocal" INT NOT NULL,
        "countryLocalTz" VARCHAR(50),
        "attemptNum" INT NOT NULL DEFAULT 1,
        "retryCountToday" INT NOT NULL DEFAULT 1,
        "retryCountWeek" INT NOT NULL DEFAULT 1,
        "isRetry" BOOLEAN NOT NULL DEFAULT FALSE,

        -- Voice profile (A/B attribution)
        "voiceName" VARCHAR(20) NOT NULL,
        "voiceId" VARCHAR(40) NOT NULL,
        "voicePreset" VARCHAR(40),
        "ttsModel" VARCHAR(40),
        "llmProvider" VARCHAR(20),
        "llmModel" VARCHAR(60),

        -- Snapshot del préstamo al momento de la llamada
        "principalOutstandingUsd" NUMERIC(18,2),
        "lateFeesUsd" NUMERIC(18,2),
        "amountDueTotalUsd" NUMERIC(18,2),
        "daysOverdue" INT,
        "dueDateOriginal" DATE,
        "loanCurrency" VARCHAR(10) NOT NULL DEFAULT 'USDC',

        -- Outcome
        "outcome" voice_call_outcome_enum NOT NULL DEFAULT 'unknown',
        "category" INT,
        "sentiment" VARCHAR(20),

        -- PTP
        "ptpAmountUsd" NUMERIC(18,2),
        "ptpDate" DATE,
        "ptpMethod" VARCHAR(20),
        "ptpFulfilled" BOOLEAN,
        "ptpFulfilledAt" TIMESTAMPTZ,
        "ptpLagHours" INT,

        -- Banderas comportamiento (spec 063)
        "reportedProblem" VARCHAR(40),
        "hardshipMentioned" BOOLEAN NOT NULL DEFAULT FALSE,
        "identityVerified" BOOLEAN NOT NULL DEFAULT FALSE,
        "disputeRaised" BOOLEAN NOT NULL DEFAULT FALSE,
        "askedToPassTo" VARCHAR(40),

        -- Métricas técnicas
        "userTurns" INT NOT NULL DEFAULT 0,
        "agentTurns" INT NOT NULL DEFAULT 0,
        "avgLagSec" NUMERIC(6,2),
        "maxLagSec" NUMERIC(6,2),
        "llmCallsTotal" INT NOT NULL DEFAULT 0,
        "llmInputTokens" INT NOT NULL DEFAULT 0,
        "llmOutputTokens" INT NOT NULL DEFAULT 0,
        "ttsChars" INT NOT NULL DEFAULT 0,
        "ttsAudioSec" NUMERIC(8,2) NOT NULL DEFAULT 0,
        "sttAudioSec" NUMERIC(8,2) NOT NULL DEFAULT 0,

        -- Costos desglosados (USD)
        "costLlmUsd" NUMERIC(10,6) NOT NULL DEFAULT 0,
        "costTtsUsd" NUMERIC(10,6) NOT NULL DEFAULT 0,
        "costSttUsd" NUMERIC(10,6) NOT NULL DEFAULT 0,
        "costLivekitUsd" NUMERIC(10,6) NOT NULL DEFAULT 0,
        "costLivekitSipUsd" NUMERIC(10,6) NOT NULL DEFAULT 0,
        "costTelnyxUsd" NUMERIC(10,6) NOT NULL DEFAULT 0,
        "costTotalUsd" NUMERIC(10,6) NOT NULL,

        -- Carrier
        "carrierName" VARCHAR(40),
        "carrierCountry" VARCHAR(4),
        "callerIdShown" VARCHAR(40),

        -- Transcripts
        "transcriptUrl" TEXT,
        "summaryShort" TEXT,

        -- Compliance
        "withinLegalHours" BOOLEAN NOT NULL DEFAULT TRUE,
        "complianceNotes" TEXT,

        -- Metadata
        "agentVersion" VARCHAR(40),
        "promptVersion" VARCHAR(20),
        "notes" TEXT,
        "destinationPhone" VARCHAR(20),

        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Hot read 1: dedupe + retry counters per user.
    // "¿llamé hoy a este user? ¿cuántas esta semana?" — covered by attemptedAt range.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_voice_call_log_user_attempted"
        ON "voice_call_log" ("userId", "attemptedAt" DESC)
    `);

    // Hot read 2: timeline by loan (for spec 063 longitudinal memory).
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_voice_call_log_loan"
        ON "voice_call_log" ("loanId", "attemptedAt" DESC)
    `);

    // Hot read 3: KPIs by outcome (RPC%, PTP%, hostile_dnc count).
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_voice_call_log_outcome"
        ON "voice_call_log" ("outcome", "attemptedAt" DESC)
    `);

    // Hot read 4: A/B comparison Sofía vs Catalina.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_voice_call_log_voice"
        ON "voice_call_log" ("voiceName", "attemptedAt" DESC)
    `);

    // Hot read 5: PTP follow-up cron — find unfulfilled promises.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_voice_call_log_ptp_unfulfilled"
        ON "voice_call_log" ("ptpFulfilled", "attemptedAt" DESC)
        WHERE "ptpAmountUsd" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_voice_call_log_ptp_unfulfilled"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_voice_call_log_voice"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_voice_call_log_outcome"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_voice_call_log_loan"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_voice_call_log_user_attempted"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "voice_call_log"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "voice_call_outcome_enum"`);
  }
}
