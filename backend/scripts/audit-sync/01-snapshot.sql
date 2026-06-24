-- Phase 1b — DB snapshot for sync audit.
--
-- Produces JSON-lines output on stdout: two sections, delimited by literal
-- markers `===USERS===` and `===LOANS===`. Safe to pipe to a file.
--
-- Usage:
--   psql <CONN_STRING> -t -A -F'' -f 01-snapshot.sql > /tmp/audit/db-snapshot.txt
--
-- Or inside a backend container:
--   docker exec -i <backend-container> \
--     psql 'postgresql://lendoor:…@…:5432/lendoor_production' \
--     -t -A -F'' -f /app/scripts/audit-sync/01-snapshot.sql \
--     > /tmp/audit/db-snapshot.txt
--
-- Why JSONL from SQL: psql output is fastest to dump + easy to parse; we avoid
-- round-tripping via a Node ORM. Fields we know are sensitive (email, phone,
-- otp hash, names, DNI) are EXCLUDED from this dump — not needed for audit.

\echo ===META===
SELECT jsonb_build_object(
  'dumpTs', now(),
  'dbName', current_database(),
  'pgVersion', version(),
  'migrationsTotal', (SELECT count(*) FROM migrations),
  'migrationsTip', (SELECT name FROM migrations ORDER BY id DESC LIMIT 1),
  'usersCount', (SELECT count(*) FROM users),
  'loansCount', (SELECT count(*) FROM loans),
  'openLoansCount', (SELECT count(*) FROM loans WHERE status = 'open' AND "closedAt" IS NULL),
  'zombieOpenLoans', (SELECT count(*) FROM loans WHERE status = 'open' AND "closeTxHash" IS NOT NULL),
  'duplicateOpenTxHash', (
    SELECT count(*) FROM (
      SELECT "openTxHash" FROM loans
      WHERE "openTxHash" IS NOT NULL
      GROUP BY "openTxHash" HAVING count(*) > 1
    ) t
  )
);

\echo ===USERS===
SELECT jsonb_build_object(
  'id', id,
  'walletAddress', lower("walletAddress"),
  'score', score,
  'creditLimit', "creditLimit",
  'riskPDefault', "riskPDefault",
  'riskClass', "riskClass",
  'riskDecision', "riskDecision",
  'riskScoredAt', "riskScoredAt",
  'riskDecisionId', "riskDecisionId",
  'riskCreditLimitUsd', "riskCreditLimitUsd",
  'walletQuality', "walletQuality",
  'xp', xp,
  'platform', platform,
  'waitlistJoinedAt', "waitlistJoinedAt",
  'waitlistPriority', "waitlistPriority",
  'earlyAccessNotifiedAt', "earlyAccessNotifiedAt",
  'termsAcceptedAt', "termsAcceptedAt",
  'phoneVerifiedAt', "phoneVerifiedAt",
  'createdAt', "createdAt",
  'updatedAt', "updatedAt"
)
FROM users
ORDER BY id;

\echo ===LOANS===
SELECT jsonb_build_object(
  'id', id,
  'userId', "userId",
  'borrowerAddress', lower("borrowerAddress"),
  'principal', principal,
  'amountDueAtOpen', "amountDueAtOpen",
  'amountPaid', "amountPaid",
  'tenorDays', "tenorDays",
  'feeBps', "feeBps",
  'startAt', "startAt",
  'dueAt', "dueAt",
  'closedAt', "closedAt",
  'status', status,
  'repaidOnTime', "repaidOnTime",
  'openTxHash', "openTxHash",
  'closeTxHash', "closeTxHash",
  'syncedByChain', "syncedByChain",
  'createdAt', "createdAt",
  'updatedAt', "updatedAt"
)
FROM loans
ORDER BY id;

\echo ===MIGRATIONS===
SELECT jsonb_build_object(
  'id', id,
  'name', name,
  'timestamp', timestamp
)
FROM migrations
ORDER BY id;

\echo ===INDEXES_LOANS===
SELECT jsonb_build_object(
  'indexname', indexname,
  'indexdef', indexdef
)
FROM pg_indexes
WHERE tablename = 'loans'
ORDER BY indexname;

\echo ===ENUM_LOAN_STATUS===
SELECT jsonb_build_object(
  'enumlabel', enumlabel
)
FROM pg_enum e
JOIN pg_type t ON t.oid = e.enumtypid
WHERE t.typname LIKE '%loan_status%' OR t.typname LIKE '%loans_status%'
ORDER BY e.enumsortorder;

\echo ===END===
