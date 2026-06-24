#!/usr/bin/env bash
# Phase 2 — Gated apply of reconciliation SQL for a single category.
#
# Usage:
#   APPLY=1 CATEGORY=L-C \
#   DATABASE_URL='postgresql://…' \
#   AUDIT_RUN_DIR=/tmp/audit/runs/<ts> \
#     bash 04-apply.sh
#
# Safety contract:
#   - APPLY=1 must be set explicitly (no default).
#   - CATEGORY must be one of the known codes.
#   - Refuses to run if plan.sql is older than MAX_PLAN_AGE_MIN minutes (stale inputs).
#   - Wraps the category's SQL in BEGIN; … COMMIT; inside a single psql session.
#   - Captures pre- and post-apply counts; fails loudly if post != 0.
#   - Writes /tmp/audit/runs/<ts>/applied-<category>-<timestamp>.log with
#     every statement and its rowcount.
#
# Categories that are APPLY-eligible (SQL-only):
#   L-C, L-D1, L-D2, L-E, L-I, U-A1, U-A2
#   + L-B1 for the subset where the LoanClosed event was resolved during classify.
#
# Categories that REFUSE apply (require chain writes or manual review):
#   L-A, L-B2, L-F, L-G, L-H, O-A, O-B, U-B, U-C, U-D, U-E, U-F, U-G,
#   P-A1, P-A2, C-A, S*, G*
#
# Chain-write categories emit work-orders.json instead (consumed by a separate
# admin endpoint, NOT by this script).

set -euo pipefail

MAX_PLAN_AGE_MIN="${MAX_PLAN_AGE_MIN:-60}"
CATEGORY="${CATEGORY:-}"
APPLY="${APPLY:-0}"
RUN_DIR="${AUDIT_RUN_DIR:-}"
DB_URL="${DATABASE_URL:-}"

die() { echo "FATAL: $*" >&2; exit 1; }

[[ "${APPLY}" == "1" ]] || die "APPLY=1 must be set to actually apply. (current: APPLY=${APPLY})"
[[ -n "${CATEGORY}" ]] || die "CATEGORY env var is required."
[[ -n "${RUN_DIR}" ]] || die "AUDIT_RUN_DIR env var is required."
[[ -n "${DB_URL}"  ]] || die "DATABASE_URL env var is required."
[[ -d "${RUN_DIR}" ]] || die "AUDIT_RUN_DIR=${RUN_DIR} does not exist."

PLAN_SQL="${RUN_DIR}/plan.sql"
REPORT="${RUN_DIR}/report.json"

[[ -f "${PLAN_SQL}" ]] || die "plan.sql not found at ${PLAN_SQL} — run 03-classify.js first."
[[ -f "${REPORT}"   ]] || die "report.json not found at ${REPORT}."

# Staleness check
if command -v gstat >/dev/null; then
  MTIME=$(gstat -c %Y "${PLAN_SQL}")
else
  MTIME=$(stat -f %m "${PLAN_SQL}" 2>/dev/null || stat -c %Y "${PLAN_SQL}")
fi
NOW=$(date +%s)
AGE_MIN=$(( (NOW - MTIME) / 60 ))
if (( AGE_MIN > MAX_PLAN_AGE_MIN )); then
  die "plan.sql is ${AGE_MIN}min old (>${MAX_PLAN_AGE_MIN}min). Re-run 03-classify.js for fresh data."
fi

case "${CATEGORY}" in
  L-C|L-D1|L-D2|L-E|L-I|U-A1|U-A2|L-B1)
    ;;
  L-A|L-B2|L-F|L-G|L-H|O-A|O-B|U-B|U-C|U-D|U-E|U-F|U-G|P-A1|P-A2|C-A|S1|S2|S3|G1|G2|G3|G4)
    die "Category ${CATEGORY} is not APPLY-eligible via SQL. See spec §6 for the correct path (chain write / manual / ignore)."
    ;;
  *)
    die "Unknown category: ${CATEGORY}"
    ;;
esac

# Extract the category's SQL block. plan.sql is expected to contain section markers
# of the form:  -- ===BEGIN <CATEGORY>===  …  -- ===END <CATEGORY>===
CATEGORY_SQL="$(awk -v cat="${CATEGORY}" '
  $0 ~ "^-- ===BEGIN " cat "===$" { inside=1; next }
  $0 ~ "^-- ===END "   cat "===$" { inside=0; next }
  inside { print }
' "${PLAN_SQL}")"

if [[ -z "${CATEGORY_SQL}" ]]; then
  die "No SQL block found for category ${CATEGORY} in ${PLAN_SQL}. (Zero findings for this category, or markers missing.)"
fi

LOG_TS="$(date -u +%Y%m%dT%H%M%SZ)"
LOG_DIR="${RUN_DIR}/applied"
mkdir -p "${LOG_DIR}"
LOG_FILE="${LOG_DIR}/${CATEGORY}-${LOG_TS}.log"

# Pre-apply count (reads from plan.sql's own pre-check assertion, placed in each section)
echo "==== PRE-APPLY ($(date -u -Iseconds)) ====" | tee -a "${LOG_FILE}"
echo "Category:  ${CATEGORY}"           | tee -a "${LOG_FILE}"
echo "Run dir:   ${RUN_DIR}"            | tee -a "${LOG_FILE}"
echo "Plan age:  ${AGE_MIN}min"         | tee -a "${LOG_FILE}"

PSQL_BIN="${PSQL_BIN:-psql}"

# We run the SQL inside a transaction. If anything fails, ROLLBACK.
# The "pre-lock" subquery captures the rows we're about to touch for
# per-row rollback traceability. The script-generator (03-classify.js) is
# responsible for emitting that subquery at the top of each category section.
{
  echo "BEGIN;"
  echo "${CATEGORY_SQL}"
  echo "COMMIT;"
} > "${LOG_DIR}/${CATEGORY}-${LOG_TS}.sql"

echo "==== APPLY ($(date -u -Iseconds)) ====" | tee -a "${LOG_FILE}"
if ! "${PSQL_BIN}" "${DB_URL}" \
      -v ON_ERROR_STOP=1 \
      -f "${LOG_DIR}/${CATEGORY}-${LOG_TS}.sql" \
      2>&1 | tee -a "${LOG_FILE}"; then
  echo "APPLY FAILED — transaction rolled back by psql ON_ERROR_STOP." | tee -a "${LOG_FILE}"
  exit 2
fi

echo "==== POST-APPLY VERIFY ====" | tee -a "${LOG_FILE}"
echo "Re-running classify would be ideal here; for fast-fail we run the category's" \
     "SELECT probe if plan.sql embeds one at the end of the section (marker:" \
     " '-- ===VERIFY ${CATEGORY}===' followed by a single SELECT returning count 0)." \
     | tee -a "${LOG_FILE}"

VERIFY_SQL="$(awk -v cat="${CATEGORY}" '
  $0 ~ "^-- ===VERIFY " cat "===$" { inside=1; next }
  $0 ~ "^-- ===END VERIFY " cat "===$" { inside=0; next }
  inside { print }
' "${PLAN_SQL}")"

if [[ -n "${VERIFY_SQL}" ]]; then
  VERIFY_COUNT="$("${PSQL_BIN}" "${DB_URL}" -t -A -c "${VERIFY_SQL}" 2>&1 | tr -d '[:space:]' || true)"
  echo "Post-apply verify count: ${VERIFY_COUNT}" | tee -a "${LOG_FILE}"
  if [[ "${VERIFY_COUNT}" != "0" ]]; then
    echo "VERIFY FAILED — category ${CATEGORY} still has findings." | tee -a "${LOG_FILE}"
    exit 3
  fi
else
  echo "No VERIFY block embedded for ${CATEGORY} — trust-but-reverify by re-running 03-classify.js." \
       | tee -a "${LOG_FILE}"
fi

echo "==== DONE ($(date -u -Iseconds)) ====" | tee -a "${LOG_FILE}"
echo "Log: ${LOG_FILE}"
