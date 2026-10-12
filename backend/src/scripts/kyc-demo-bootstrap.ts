// Bootstrap de schema para el demo D1.3 en DB fresca.
// La cadena completa de migraciones asume el schema de la DB viva; acá:
// 1) corre InitCoreSchema + AddNotifications (IF NOT EXISTS),
// 2) synchronize() alinea las tablas con las entities registradas,
// 3) DROPea las columnas KYC para que la migración KYC corra DE VERDAD en el boot,
// 4) marca todas las migraciones como aplicadas EXCEPTO AddKycFieldsToUsers.
import 'dotenv/config';
import { DataSource } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';

import { User } from 'src/domain/entities/user.entity';
import { NotVerifiedUser } from 'src/domain/entities/not-verified-user.entity';
import { SiweNonce } from 'src/domain/entities/siwe-nonce.entity';
import { AccessToken } from 'src/domain/entities/access-token.entity';
import { Loan } from 'src/domain/entities/loan.entity';
import { DeviceSession } from 'src/domain/entities/device-session.entity';
import { BorrowAttempt } from 'src/domain/entities/borrow-attempt.entity';
import { ChainScanCursor } from 'src/domain/entities/chain-scan-cursor.entity';
import { Metric } from 'src/domain/entities/metric.entity';
import { LinkedExternalWallet } from 'src/domain/entities/linked-external-wallet.entity';
import { WalletLinkSession } from 'src/domain/entities/wallet-link-session.entity';
import { WalletLinkNonce } from 'src/domain/entities/wallet-link-nonce.entity';
import { SelfVerification } from 'src/domain/entities/self-verification.entity';

const KYC_MIGRATION = 'AddKycFieldsToUsers20261011120000';

async function main() {
  const ds = new DataSource({
    type: 'postgres',
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT) || 5432,
    username: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
    entities: [User, NotVerifiedUser, SiweNonce, AccessToken, Loan, SelfVerification,
      DeviceSession, BorrowAttempt, ChainScanCursor, Metric, LinkedExternalWallet,
      WalletLinkSession, WalletLinkNonce],
    synchronize: false,
  });
  await ds.initialize();
  const qr = ds.createQueryRunner();

  // 1) migraciones base que crean las tablas núcleo (ambas IF NOT EXISTS)
  const migDir = path.join(__dirname, '../migrations');
  const base = ['20251129000000-initCoreSchema.ts', '20251208000000-createNotifications.ts'];
  for (const f of base) {
    const mod = require(path.join(migDir, f));
    const Cls = Object.values(mod)[0] as any;
    await new Cls().up(qr);
    console.log('ran base migration', f);
  }

  // 2) synchronize alinea entities (agrega columnas que las migraciones viejas agregaban)
  await ds.synchronize();
  console.log('synchronize done');

  // 3) drop de columnas KYC → la migración KYC real corre en el boot del backend
  for (const col of ['kycStatus', 'kycSessionId', 'kycProvider', 'kycApprovedAt']) {
    await qr.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "${col}"`);
  }
  console.log('kyc columns dropped');

  // 4) marcar todo menos la KYC como aplicado
  await qr.query(`CREATE TABLE IF NOT EXISTS "migrations" (
    "id" SERIAL PRIMARY KEY, "timestamp" bigint NOT NULL, "name" varchar NOT NULL)`);
  const names: string[] = [];
  for (const f of fs.readdirSync(migDir).filter((x) => x.endsWith('.ts'))) {
    const src = fs.readFileSync(path.join(migDir, f), 'utf8');
    const m = src.match(/export class (\w+)/);
    if (m) names.push(m[1]);
  }
  for (const name of names) {
    if (name === KYC_MIGRATION) continue;
    const ts = name.match(/(\d+)$/)![1];
    await qr.query(
      `INSERT INTO "migrations" ("timestamp","name") SELECT $1::bigint,$2::varchar
       WHERE NOT EXISTS (SELECT 1 FROM "migrations" WHERE "name"=$2)`, [ts, name]);
  }
  console.log('marked', names.length - 1, 'migrations as applied;', KYC_MIGRATION, 'left pending');
  await ds.destroy();
}
main().catch((e) => { console.error(e); process.exit(1); });
