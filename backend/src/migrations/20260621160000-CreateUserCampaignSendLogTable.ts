import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * User outreach campaigns — audit trail for bulk emails sent to segmented users
 * (by credit limit / loan status). One row per campaign send.
 */
export class CreateUserCampaignSendLogTable20260621160000
  implements MigrationInterface
{
  name = 'CreateUserCampaignSendLogTable20260621160000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_campaign_send_log" (
        "id"             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        "segment"        TEXT        NOT NULL,
        "subject"        TEXT        NOT NULL,
        "body"           TEXT        NOT NULL,
        "sentByWallet"   TEXT,
        "recipientCount" INTEGER     NOT NULL,
        "sentCount"      INTEGER     NOT NULL,
        "failedCount"    INTEGER     NOT NULL,
        "failures"       TEXT,
        "sentAt"         TIMESTAMPTZ NOT NULL,
        "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "user_campaign_send_log"`);
  }
}
