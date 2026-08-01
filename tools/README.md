# tools/

Operational scripts for the MMMIS project. **Read this before running anything.**

Every file here is operator-only. None of these scripts ship with the app, and
they are kept out of the deployment pipeline. They are versioned in git so
the operations team has a paper trail.

## Severity legend

- **SAFE** — read-only or one-shot insert that can be re-run harmlessly
- **DESTRUCTIVE** — deletes data; verify twice before running on a non-empty DB
- **ONE-OFF** — meant to be run once and forgotten; re-running may error or no-op

---

## SQL scripts (run in Supabase SQL editor)

| File                                          | Severity     | What it does |
|-----------------------------------------------|--------------|--------------|
| `apply_pending_migrations.sql`                | SAFE         | Applies 0028 (CHIT expiry cron) + 0029 (create_sale product validation). Idempotent. |
| `apply_phase19_pwa_push.sql`                  | SAFE         | One-time setup for PWA push notifications. Companion README explains the steps. |
| `fix_chit_trigger.sql`                        | SAFE         | Patches the chit_authorization_requests trigger when `members.id` is missing. |
| `seed_mess_settings.sql`                      | SAFE         | Inserts the singleton `mess_settings` row (id=1) the Settings page expects. |
| `wipe_all_sales.sql`                          | **DESTRUCTIVE** | Deletes every `sales`, `sale_item`, and sale-sourced `ledger` row. Global. |
| `wipe_user_106759.sql`                        | **DESTRUCTIVE** | Deletes transactions tied to service_number 106759. Keeps the user account. |

## Destructive scripts — read this

Both wipe scripts use `begin; ... commit;` blocks and roll back on any error.
They are still dangerous because:

- A mis-paste could target the wrong database.
- Re-running after partial data loss won't restore what was deleted.
- They do **not** drop `audit_log` / `audit_logs` rows (kept for traceability).

Before running either wipe:

1. Confirm the project URL is `gkegnmshivmgqhenqkzr.supabase.co` and that
   you are signed into the right Supabase org.
2. Run the sanity-check `select count(*)` queries listed at the bottom of the
   file to confirm the script will hit rows you actually want gone.
3. Have a recent backup (`scripts/backup-verify.ts` + dashboard PITR).

## PowerShell wrappers

| File                          | What it does |
|-------------------------------|--------------|
| `supabase.ps1`                | Wrapper around the cached Supabase CLI (`npx --yes supabase`). Invoke as `pwsh tools/supabase.ps1 <args>`. |
| `bootstrap_admin_create_user.ps1` | Provisions the first administrator after a wipe. See `run_bootstrap.ps1`. |
| `run_bootstrap.ps1`           | Drives `bootstrap_admin_create_user.ps1` and prints the credentials. |
| `run_wipe.ps1`                | Runs the destructive SQL scripts in the right order. Inspect before use. |

## Node scripts

| File                          | What it does |
|-------------------------------|--------------|
| `regen-credentials-md.cjs`    | Regenerates `bulk_member_passwords.md` from the bulk-seed run output. |

---

## When to run what

| Scenario                                            | File |
|-----------------------------------------------------|------|
| First time on a fresh Supabase project              | `apply_pending_migrations.sql`, then `seed_mess_settings.sql` |
| Setting up PWA + push for the first time            | `apply_phase19_pwa_push.sql` (+ README) |
| CHIT trigger is throwing 23503 because `members.id` is missing | `fix_chit_trigger.sql` |
| First admin after a destructive wipe               | `run_bootstrap.ps1` |
| Removing test transactions for service 106759       | `wipe_user_106759.sql` |
| Removing every sale in the DB (full reset)          | `wipe_all_sales.sql` |
| Deploying an Edge Function                          | `supabase.ps1 functions deploy <name> --no-verify-jwt` |

---

## Don't put scripts here that…

- Have hard-coded credentials.
- Run automatically on `npm install` or `npm run build`.
- Reference your local machine paths (`C:\Users\you\…`).

Those belong in `scripts/` (committed build tooling) or your local
`.env` / shell config (machine-specific), not in this shared folder.
