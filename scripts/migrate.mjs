#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = join(projectRoot, 'supabase', 'migrations');
const expectedProjectRef = process.env.SUPABASE_PROJECT_REF ?? 'gkegnmshivmgqhenqkzr';
const dangerousMigration = '0030_wipe_test_data.sql';

function fail(message) {
  console.error(`Migration runner: ${message}`);
  process.exit(1);
}

function runSupabase(args) {
  const result = spawnSync('npx', ['--no-install', 'supabase', ...args], {
    cwd: projectRoot,
    shell: process.platform === 'win32',
    stdio: 'inherit',
  });

  if (result.error) {
    fail(`could not start the project-local Supabase CLI: ${result.error.message}`);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const args = new Set(process.argv.slice(2));
const execute = args.has('--execute');
const allowDangerousHistory = args.has('--allow-dangerous-history');

if (!existsSync(migrationsDir)) fail('supabase/migrations was not found');

const migrations = readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'))
  .sort((left, right) => left.localeCompare(right, 'en'));

if (migrations.length === 0) fail('no SQL migrations were found');

const invalidNames = migrations.filter(
  (name) => !/^\d{4,14}[a-z]?_[a-z0-9][a-z0-9_-]*\.sql$/i.test(name),
);
if (invalidNames.length > 0) {
  fail(`unsupported migration filename(s): ${invalidNames.join(', ')}`);
}

const destructiveFiles = migrations.filter((name) => {
  const sql = readFileSync(join(migrationsDir, name), 'utf8');
  return /\b(delete\s+from|truncate\s+(?:table\s+)?|drop\s+schema)\b/i.test(sql);
});

console.log(`Target project: ${expectedProjectRef}`);
console.log(`Migrations found: ${migrations.length}`);
if (destructiveFiles.length > 0) {
  console.log(`Destructive SQL detected: ${destructiveFiles.join(', ')}`);
}

if (migrations.includes(dangerousMigration) && !allowDangerousHistory) {
  fail(
    `${dangerousMigration} is in the forward migration history. ` +
      'Refusing to automate db push until its remote migration-ledger status is reconciled. ' +
      'After reviewing `supabase migration list`, rerun with --allow-dangerous-history.',
  );
}

if (!execute) {
  console.log('\nPreflight only; no database changes were made.');
  console.log('Review remote/local status with: npm run db:migrate -- --allow-dangerous-history');
  console.log(
    'Execute only after reconciliation with: npm run db:migrate -- --execute --allow-dangerous-history',
  );
  process.exit(0);
}

if (process.env.CONFIRM_SUPABASE_PROJECT_REF !== expectedProjectRef) {
  fail(
    `set CONFIRM_SUPABASE_PROJECT_REF=${expectedProjectRef} to confirm the deployment target`,
  );
}

console.log('\nChecking migration status...');
runSupabase(['migration', 'list', '--linked']);
console.log('\nApplying pending migrations...');
runSupabase(['db', 'push', '--linked']);
console.log('\nMigration status after push:');
runSupabase(['migration', 'list', '--linked']);
console.log('\nMigration push completed.');
