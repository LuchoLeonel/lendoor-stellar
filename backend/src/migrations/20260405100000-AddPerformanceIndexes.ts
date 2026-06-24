import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPerformanceIndexes20260405100000 implements MigrationInterface {
  name = 'AddPerformanceIndexes20260405100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Partial index for notification queries that filter open loans by dueAt range
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_loans_open_due_at"
        ON "loans" (status, "dueAt")
        WHERE status = 'open' AND "closedAt" IS NULL;
    `);

    // Composite index for waitlist rank calculation queries
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_user_platform_priority_created"
        ON "users" (platform, "waitlistPriority" ASC, "createdAt" ASC);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_user_platform_priority_created";
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_loans_open_due_at";
    `);
  }
}
