#!/usr/bin/env node

/**
 * Read-only database verification helper.
 *
 * Run this against the live database before a backup and against an isolated
 * scratch database after restoring the dump. It verifies schema presence and
 * reports row counts; empty transactional tables are valid and do not fail.
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
  'offline_action_log',
  'push_subscriptions',
  'push_outbox',
] as const;

const dbUrl = process.env.BACKUP_VERIFY_DB_URL ?? process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error('Missing BACKUP_VERIFY_DB_URL (preferred) or SUPABASE_DB_URL');
  process.exit(2);
}

const isLiveCheck = !process.env.BACKUP_VERIFY_DB_URL && Boolean(process.env.SUPABASE_DB_URL);
if (isLiveCheck && process.env.ALLOW_LIVE_BACKUP_VERIFY !== 'true') {
  console.error(
    'Refusing to use SUPABASE_DB_URL without ALLOW_LIVE_BACKUP_VERIFY=true. ' +
      'Restore the dump to a scratch database and set BACKUP_VERIFY_DB_URL instead.',
  );
  process.exit(2);
}

async function main() {
  const client = new Client({
    connectionString: dbUrl,
    ssl: dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1') ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 15_000,
    query_timeout: 30_000,
  });

  let failed = false;
  try {
    await client.connect();
    await client.query('begin read only');
    console.log('Database verification — snapshot taken at', new Date().toISOString());

    for (const table of REQUIRED_TABLES) {
      const relation = `public.${table}`;
      const existence = await client.query<{ relation: string | null }>(
        'select to_regclass($1)::text as relation',
        [relation],
      );

      if (!existence.rows[0]?.relation) {
        console.error(`  ERR   ${table.padEnd(24)} missing`);
        failed = true;
        continue;
      }

      const result = await client.query<{ count: string }>(
        `select count(*)::text as count from "public"."${table}"`,
      );
      const count = Number(result.rows[0]?.count ?? '0');
      console.log(`  OK    ${table.padEnd(24)} rows=${count}`);
    }

    const singleton = await client.query<{ count: string }>(
      'select count(*)::text as count from public.mess_settings where id = 1',
    );
    if (Number(singleton.rows[0]?.count ?? '0') !== 1) {
      console.error('  ERR   mess_settings id=1 is missing or duplicated');
      failed = true;
    }

    await client.query('rollback');
  } finally {
    await client.end().catch(() => undefined);
  }

  if (failed) {
    console.error('\nDatabase verification FAILED');
    process.exitCode = 1;
    return;
  }
  console.log('\nDatabase verification passed');
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
