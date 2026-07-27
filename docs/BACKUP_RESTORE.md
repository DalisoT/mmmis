# Backup & restore runbook (MMMIS / Supabase)

This document covers **logical backups** of the MMMIS PostgreSQL database
(hosted on Supabase). It is intentionally lightweight — Supabase already
provides daily physical backups on the Pro plan; what we add here is:

1. A reproducible command-line backup you can run on demand from CI or a
   sysadmin workstation.
2. A verification script that fails fast if any critical table is missing
   rows from the dump.
3. A documented restore procedure with a checklist.

## 1. Environment

- **PostgreSQL client tools** (`pg_dump`, `pg_restore`) ≥ 15 — install via
  the official `postgresql-client` package.
- **Node.js** ≥ 20 — required for the verification script.
- **Connection string** — find it in Supabase Dashboard → Project Settings →
  Database → "Connection string" → "Direct connection". Store it as
  `SUPABASE_DB_URL` in your shell. **Never** commit it.

  ```bash
  export SUPABASE_DB_URL='postgres://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres'
  ```

## 2. Take a logical backup

```bash
pg_dump \
  --dbname="$SUPABASE_DB_URL" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --schema=public \
  --file="mmmis-$(date -u +%Y%m%dT%H%M%SZ).dump"
```

- `--format=custom` gives a compressed, restorable archive.
- `--no-owner --no-privileges` lets the dump be restored under a different
  role (e.g. during local dev) without permission errors.
- Restrict the dump to `public` so Supabase's internal schemas (`auth`,
  `storage`, `realtime`) are not touched.

Schedule: run daily from a cron / GitHub Actions job, upload to an S3
bucket with bucket-versioning enabled, and retain 30 daily + 12 monthly
copies.

## 3. Verify the backup

```bash
npx tsx scripts/backup-verify.ts
```

The script connects to the **live** database and prints the row count of
every critical table. Use it as a smoke test, then re-run it after a
restore to confirm the restored database has the expected volume.

For a stronger check, restore the dump to a scratch database and run the
verifier against that:

```bash
createdb mmmis_scratch
pg_restore --dbname=mmmis_scratch --no-owner --no-privileges mmmis-YYYYMMDD.dump
SUPABASE_DB_URL=postgres://localhost/mmmis_scratch npx tsx scripts/backup-verify.ts
dropdb mmmis_scratch
```

## 4. Restore procedure

> Runbook only — never execute on production without sign-off from the
> Unit Commander / System Administrator.

1. **Stop writes.** Set the mess into "Closing day" mode and disable new
   sales in the Point of Sale (Settings → Holiday mode).
2. **Identify the target.** Decide whether you are restoring to a new
   database or overwriting the existing one.
3. **Drop and recreate** the `public` schema on the target:

   ```sql
   drop schema public cascade;
   create schema public;
   grant usage on schema public to anon, authenticated, service_role;
   ```

4. **Restore migrations first** (so policies/triggers exist before data
   lands). The migrations in `supabase/migrations/` are idempotent enough
   to be applied in order against a fresh schema:

   ```bash
   for f in supabase/migrations/*.sql; do
     psql "$SUPABASE_DB_URL" -f "$f"
   done
   ```

5. **Restore the data**:

   ```bash
   pg_restore \
     --dbname="$SUPABASE_DB_URL" \
     --no-owner \
     --no-privileges \
     --schema=public \
     --data-only \
     --disable-triggers \
     mmmis-YYYYMMDD.dump
   ```

   `--disable-triggers` skips user-defined triggers during the restore to
   avoid cascading side effects; the trigger state is restored
   automatically once the restore completes.

6. **Re-apply migrations that are not idempotent** (audit-log helper
   functions, `mess_settings` seed row).

7. **Verify**:

   ```bash
   SUPABASE_DB_URL=$SUPABASE_DB_URL npx tsx scripts/backup-verify.ts
   ```

8. **Smoke test** by signing in as an administrator and:
   - Loading `/admin/audit` to confirm events are visible.
   - Loading `/admin/settings` to confirm configuration survived.
   - Running a cash sale on the test device.

## 5. Recovery targets

| Scenario                        | RPO (data loss) | RTO (restore time) |
|---------------------------------|-----------------|--------------------|
| Daily logical backup + verify   | ≤ 24 hours      | ≤ 30 minutes       |
| Supabase managed physical backup| ≤ 24 hours      | Hours (Supabase)   |
| Point-in-time recovery (PITR)*   | ≤ 5 minutes     | ≤ 1 hour           |

*Enable PITR in Supabase Dashboard → Database → Backups. Off by default
on the Free plan.

## 6. Credential hygiene

- Never check `SUPABASE_DB_URL` into git.
- Rotate the database password quarterly; Supabase allows it from the
  Dashboard → Settings → Database → "Reset database password".
- After rotating, update `SUPABASE_DB_URL` in every CI secret store.
- Restrict the database password to the `postgres` role only. Do not
  reuse it for the application anon key.

## 7. Session hygiene (Phase 7 add-on)

- Use **Settings → Holiday mode** to lock writes during the backup window
  so no transaction is half-restored.
- Members can request a forced sign-out from their **My Profile** page
  (future enhancement: `supabase.auth.signOut({ scope: 'others' })`); for
  now, an administrator can revoke sessions via
  Supabase Dashboard → Authentication → Users → "Sign out".

## 8. Audit log retention

- `public.audit_log` is append-only; prune it manually if it grows beyond
  ~1M rows by exporting to cold storage first:

  ```sql
  copy (
    select * from public.audit_log
    where occurred_at < now() - interval '12 months'
  ) to '/tmp/audit_archive.csv' with csv header;
  delete from public.audit_log
  where occurred_at < now() - interval '12 months';
  ```

  Run during the closing-day backup window.