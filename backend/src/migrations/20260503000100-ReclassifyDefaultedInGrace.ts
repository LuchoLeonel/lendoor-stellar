import { MigrationInterface, QueryRunner } from 'typeorm';

export class ReclassifyDefaultedInGrace20260503000100
  implements MigrationInterface
{
  name = 'ReclassifyDefaultedInGrace20260503000100';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Move loans currently labelled 'defaulted' but still inside the 16-day
    // grace window to the new 'defaulted_in_grace' status. After this:
    //   status='defaulted'          ⇒ pastDue ≥ 16d (real default)
    //   status='defaulted_in_grace' ⇒ 24h ≤ pastDue < 16d (still payable)
    const result = await queryRunner.query(`
      UPDATE loans
         SET status = 'defaulted_in_grace'
       WHERE status = 'defaulted'
         AND NOW() < "dueAt" + INTERVAL '16 days'
      RETURNING id
    `);

    const rows = Array.isArray(result) ? result[0] : result;
    const count = Array.isArray(rows) ? rows.length : 0;
    console.log(
      `[ReclassifyDefaultedInGrace] reclassified ${count} loans from defaulted → defaulted_in_grace`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE loans
         SET status = 'defaulted'
       WHERE status = 'defaulted_in_grace'
    `);
  }
}
