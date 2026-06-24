#!/usr/bin/env node
/**
 * Spec 070 — sync compiled contract ABIs from evk-periphery to backend.
 *
 * Run after any contract change:
 *   yarn sync-abi
 *
 * Idempotent. Reads JSON artifacts produced by Foundry (`forge build`)
 * and writes only the `abi` array to backend/src/abi/<Name>.abi.json.
 */
const fs = require('fs');
const path = require('path');

const CONTRACTS = ['LoanManagerV3'];

const ROOT = path.resolve(__dirname, '../..');
const SRC_DIR = path.join(ROOT, 'evk-periphery/out');
const DST_DIR = path.join(__dirname, '../src/abi');

if (!fs.existsSync(DST_DIR)) fs.mkdirSync(DST_DIR, { recursive: true });

let changed = 0;
for (const name of CONTRACTS) {
  const src = path.join(SRC_DIR, `${name}.sol`, `${name}.json`);
  const dst = path.join(DST_DIR, `${name}.abi.json`);
  if (!fs.existsSync(src)) {
    console.error(`✗ Source not found: ${src}\n  Did you run \`forge build\` in evk-periphery?`);
    process.exit(1);
  }
  const artifact = JSON.parse(fs.readFileSync(src, 'utf8'));
  const next = JSON.stringify(artifact.abi, null, 2);
  const prev = fs.existsSync(dst) ? fs.readFileSync(dst, 'utf8') : null;
  if (prev === next) {
    console.log(`= ${name} unchanged`);
    continue;
  }
  fs.writeFileSync(dst, next);
  console.log(`✓ ${name} updated (${artifact.abi.length} entries)`);
  changed++;
}

if (changed > 0) {
  console.log(`\n${changed} file(s) updated. Commit the changes to backend/src/abi/.`);
}
