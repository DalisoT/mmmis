/**
 * Backup verification helper.
 *
 * Usage (Node 20+):
 *   SUPABASE_DB_URL=postgres://...  npx tsx scripts/backup-verify.ts
 *
 * What it does:
 *   1. Connects to the database using the connection string.
 *   2. Runs sanity counts on the critical tables and prints them.
 *   3. Emits a non-zero exit code if any table is empty (something the
 *      backup should be able to capture) so the caller can wire it into
 *      a scheduled job and alert on failure.
 *
 * This is intentionally read-only: it never writes to the database.
 */

import { Client } from 'pg';

const REQUIRED_TABLES = [
  'users',
  'members',
  'sales',
  'sale_items',
  'chit_payments',
  'expenses',
  'ledger',
  'products',
  'stock_receipts',
  'stock_sheet',
  'daily_summary',
  'audit_log',
  'mess_settings',
  'login_attempts',
];

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL');
  process.exit(2);
}

async function main() {
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();

  console.log('Backup verification — snapshot taken at', new Date().toISOString());
  let failed = false;

  for (const table of REQUIRED_TABLES) {
    try {
      const { rows } = await client.query<{ count: string }>(
        `select count(*)::text as count from public.${table}`
      );
      const count = Number(rows[0]?.count ?? '0');
      const ok = count > 0 || table === 'mess_settings' || table === 'login_attempts';
      console.log(`  ${ok ? 'OK ' : 'WARN'}  ${table.padEnd(20)} rows=${count}`);
      if (!ok) failed = true;
    } catch (err) {
      console.error(`  ERR  ${table} — ${(err as Error).message}`);
      failed = true;
    }
  }

  await client.end();

  if (failed) {
    console.error('\nBackup verification FAILED');
    process.exit(1);
  }
  console.log('\nBackup verification passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});