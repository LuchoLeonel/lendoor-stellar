/* eslint-disable no-console */
// src/scripts/audit-debtor-data.ts
//
// Spec 064 — Voice Collections Orchestration.
//
// Audita la calidad de datos de los deudores actuales (loans OPEN vencidos)
// para decidir cómo construir el greeting del voice-agent:
//
//   A) firstName + lastName + phone + email      → "Hola Juan Pérez" (saludo completo)
//   B) firstName + phone (sin lastName)          → "Hola Juan" (solo nombre)
//   C) phone + email (sin firstName)             → derivar nombre desde email
//   D) solo phone (sin nombre ni email)          → NO callable, fuera del piloto
//
// Output: tabla con conteos + porcentajes + ejemplos enmascarados.
// Solo READ-ONLY. No escribe nada en la DB.
//
// CLI:
//   npm run audit:debtor-data
//   npm run audit:debtor-data -- --include-current   # también loans NO vencidos
//   npm run audit:debtor-data -- --show-emails       # mostrar primeros 3 emails sin enmascarar
//
// EXIT codes:
//   0 → audit OK
//   2 → fatal error

import { NestFactory } from '@nestjs/core';
import { Repository, LessThan } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';

// IMPORTANT: validateEnv() must run BEFORE AppModule loads — AppModule's
// decorators (LoggerModule.forRoot) call env() at module evaluation time.
// Keep AppModule out of the static import set; require() it lazily inside
// main() after validateEnv() succeeds.
import { validateEnv } from '../config/env';
import { Loan, LoanStatus } from '../domain/entities/loan.entity';

type Bucket = 'A_full' | 'B_no_lastname' | 'C_no_name_has_email' | 'D_only_phone' | 'E_no_phone';

interface AuditRow {
  loanId: number;
  userId: number;
  bucket: Bucket;
  daysOverdue: number;
  firstName: string | null;
  lastName: string | null;
  hasEmail: boolean;
  emailLocalPart: string | null; // for showing "would-be derived name"
  phoneMasked: string | null;
  emailDerivable: boolean; // could derive_name_from_email succeed?
}

interface CliArgs {
  includeCurrent: boolean;
  showEmails: boolean;
}

function parseArgs(): CliArgs {
  const args: CliArgs = { includeCurrent: false, showEmails: false };
  for (const a of process.argv.slice(2)) {
    if (a === '--include-current') args.includeCurrent = true;
    if (a === '--show-emails') args.showEmails = true;
  }
  return args;
}

function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  if (phone.length <= 5) return phone;
  return `${phone.slice(0, 5)}***${phone.slice(-2)}`;
}

function isE164(phone: string | null | undefined): boolean {
  if (!phone) return false;
  return /^\+\d{8,15}$/.test(phone);
}

/**
 * Predice si derive_name_from_email() podría resolver un nombre.
 * Reglas conservadoras:
 *   - email = local@domain
 *   - local tiene "."  o "_" → divide y capitaliza → derivable
 *   - local es solo letras (>= 3 chars) → derivable
 *   - local con números, símbolos extra, demasiado corto → no derivable
 */
function isEmailDerivable(email: string | null | undefined): boolean {
  if (!email) return false;
  const local = email.split('@')[0]?.toLowerCase() ?? '';
  if (!local) return false;
  // Cases like flopa84, juan99, x → undefined first name; reject.
  if (/\d/.test(local)) return false;
  if (local.length < 3) return false;
  // dot/underscore-separated → almost always firstname.lastname
  if (/[._]/.test(local)) return true;
  // pure alpha string >=3 chars → can use as firstname
  if (/^[a-záéíóúñ]+$/i.test(local)) return true;
  return false;
}

function classify(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  email: string | null | undefined,
  phone: string | null | undefined,
): Bucket {
  const hasFirst = !!firstName && firstName.trim().length > 0;
  const hasLast = !!lastName && lastName.trim().length > 0;
  const hasEmail = !!email && email.trim().length > 0;
  const hasPhone = isE164(phone);

  if (!hasPhone) return 'E_no_phone';
  if (hasFirst && hasLast) return 'A_full';
  if (hasFirst) return 'B_no_lastname';
  if (hasEmail) return 'C_no_name_has_email';
  return 'D_only_phone';
}

async function main(): Promise<number> {
  const args = parseArgs();
  console.log('[audit-debtor-data] starting');
  console.log(
    `  includeCurrent=${args.includeCurrent} showEmails=${args.showEmails}\n`,
  );

  validateEnv();

  // Lazy-load AppModule AFTER validateEnv() so its top-level env() calls
  // see a validated env. require() (not import) keeps it out of static graph.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AppModule } = require('../app.module');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });

  try {
    const loanRepo: Repository<Loan> = app.get(getRepositoryToken(Loan));

    const whereClause = args.includeCurrent
      ? { status: LoanStatus.OPEN }
      : { status: LoanStatus.OPEN, dueAt: LessThan(new Date()) };

    const loans = await loanRepo.find({
      where: whereClause,
      relations: ['user'],
      order: { dueAt: 'ASC' },
    });

    console.log(
      `[audit] found ${loans.length} loans (${args.includeCurrent ? 'all OPEN' : 'OPEN + overdue'})`,
    );

    const now = new Date();
    const rows: AuditRow[] = loans.map((loan) => {
      const u = loan.user;
      const bucket = classify(u?.firstName, u?.lastName, u?.email, u?.phone);
      const local = u?.email ? u.email.split('@')[0]?.toLowerCase() ?? null : null;
      const daysOverdue = Math.max(
        0,
        Math.floor((now.getTime() - loan.dueAt.getTime()) / (1000 * 60 * 60 * 24)),
      );
      return {
        loanId: loan.id,
        userId: u?.id ?? -1,
        bucket,
        daysOverdue,
        firstName: u?.firstName ?? null,
        lastName: u?.lastName ?? null,
        hasEmail: !!u?.email,
        emailLocalPart: local,
        phoneMasked: maskPhone(u?.phone),
        emailDerivable: isEmailDerivable(u?.email),
      };
    });

    // ─── Aggregate counts ────────────────────────────────────
    const byBucket: Record<Bucket, AuditRow[]> = {
      A_full: [],
      B_no_lastname: [],
      C_no_name_has_email: [],
      D_only_phone: [],
      E_no_phone: [],
    };
    for (const r of rows) byBucket[r.bucket].push(r);

    const total = rows.length;
    const pct = (n: number) =>
      total > 0 ? `${((n / total) * 100).toFixed(1)}%` : '0%';

    console.log('\n──────────────────────────────────────────────────────────');
    console.log('SUMMARY by data quality bucket');
    console.log('──────────────────────────────────────────────────────────');
    console.log(
      `A) firstName + lastName + phone        (greeting "Juan Pérez")     : ${byBucket.A_full.length.toString().padStart(4)} (${pct(byBucket.A_full.length)})`,
    );
    console.log(
      `B) firstName + phone (sin apellido)    (greeting "Juan")           : ${byBucket.B_no_lastname.length.toString().padStart(4)} (${pct(byBucket.B_no_lastname.length)})`,
    );
    console.log(
      `C) phone + email (sin firstName)       (derivar de email)          : ${byBucket.C_no_name_has_email.length.toString().padStart(4)} (${pct(byBucket.C_no_name_has_email.length)})`,
    );
    console.log(
      `D) solo phone (sin email ni nombre)    (NO callable en piloto)     : ${byBucket.D_only_phone.length.toString().padStart(4)} (${pct(byBucket.D_only_phone.length)})`,
    );
    console.log(
      `E) sin phone E.164                     (NO callable, sin contacto) : ${byBucket.E_no_phone.length.toString().padStart(4)} (${pct(byBucket.E_no_phone.length)})`,
    );
    console.log('──────────────────────────────────────────────────────────');

    const callableBuckets =
      byBucket.A_full.length +
      byBucket.B_no_lastname.length +
      byBucket.C_no_name_has_email.length;
    console.log(
      `📞 Callable hoy (A+B+C):  ${callableBuckets} (${pct(callableBuckets)})`,
    );
    const dCallableIfWeBuildEmailDerive = byBucket.C_no_name_has_email.filter(
      (r) => r.emailDerivable,
    ).length;
    console.log(
      `📧 Bucket C derivable desde email:  ${dCallableIfWeBuildEmailDerive}/${byBucket.C_no_name_has_email.length}`,
    );

    // ─── Sample rows per bucket ──────────────────────────────
    function printSample(bucket: Bucket, label: string, n = 3) {
      const sample = byBucket[bucket].slice(0, n);
      if (sample.length === 0) return;
      console.log(`\n${label} — ejemplos (primeros ${sample.length}):`);
      for (const r of sample) {
        const emailShown = args.showEmails
          ? r.emailLocalPart ?? '—'
          : r.emailLocalPart
            ? `${r.emailLocalPart.slice(0, 3)}***`
            : '—';
        console.log(
          `  loan=${r.loanId} user=${r.userId} days=${r.daysOverdue}  ` +
            `name="${r.firstName ?? '∅'} ${r.lastName ?? '∅'}"  ` +
            `email_local=${emailShown}  ` +
            `phone=${r.phoneMasked ?? '∅'}` +
            (r.bucket === 'C_no_name_has_email'
              ? `  derivable=${r.emailDerivable}`
              : ''),
        );
      }
    }

    printSample('A_full', 'A) full data');
    printSample('B_no_lastname', 'B) sin apellido');
    printSample('C_no_name_has_email', 'C) sin nombre, con email');
    printSample('D_only_phone', 'D) solo phone');
    printSample('E_no_phone', 'E) sin phone');

    // ─── Recommendation ──────────────────────────────────────
    console.log('\n──────────────────────────────────────────────────────────');
    console.log('RECOMENDACIÓN');
    console.log('──────────────────────────────────────────────────────────');
    if (byBucket.C_no_name_has_email.length === 0) {
      console.log(
        '✅ Realidad A — todos los deudores con phone tienen al menos firstName.',
      );
      console.log(
        '   NO hace falta lógica de fallback email→name. Solo ajustar el prompt',
      );
      console.log(
        '   para usar nombre+apellido (A) o solo nombre (B) en el greeting.',
      );
    } else if (
      byBucket.C_no_name_has_email.length / Math.max(callableBuckets, 1) <
      0.05
    ) {
      console.log(
        `⚠️  Realidad B (marginal) — ${byBucket.C_no_name_has_email.length} usuarios sin firstName con email`,
      );
      console.log(
        '   (<5% del total). Probablemente no vale la pena el fallback email→name.',
      );
      console.log(
        '   Filtralos del piloto inicial; agregalo cuando el volumen lo justifique.',
      );
    } else {
      console.log(
        `🚨 Realidad B/C (significativa) — ${byBucket.C_no_name_has_email.length} usuarios necesitan email→name`,
      );
      console.log(
        '   SÍ vale la pena implementar derive_name_from_email. Ganamos',
      );
      console.log(
        `   +${dCallableIfWeBuildEmailDerive} deudores callable (${pct(dCallableIfWeBuildEmailDerive)}).`,
      );
    }

    return 0;
  } catch (err) {
    console.error('[audit-debtor-data] fatal:', err);
    return 2;
  } finally {
    await app.close();
  }
}

main().then((code) => process.exit(code));
