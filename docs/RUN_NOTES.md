# MMMIS — Run Notes

> Historical session notes from the MMMIS build. Newest entries at the top.
>
> This file supersedes the old `CONTINUE_HERE.md`. That path now points
> here (see `CONTINUE_HERE.md`).

---

## 2026-08-01 — Production-readiness pass (P0 + P1)

**Context.** A review surfaced that two migrations deferred in the previous
session (`0028` cron schedule, `0029` `create_sale` product validation) had
never been applied to the live DB. Code that exercised those features
(CRUD, POS) was also untested at the unit level. README and `CONTINUE_HERE.md`
were stale.

**Shipped.**

- `tools/apply_pending_migrations.sql` — one-paste SQL editor script that
  inlines migrations 0028 + 0029 with an `ON_ERROR_STOP`-style verification
  block. Detects missing `pg_cron` and degrades to a NOTICE.
- `tools/README.md` — severity-tagged inventory of every script in `tools/`,
  with explicit warnings on the destructive wipe scripts.
- `tools/seed_mess_settings.sql`, `tools/wipe_user_106759.sql`,
  `tools/wipe_all_sales.sql` — written during the same session.
- `README.md` rewritten — status now reads "Production pilot", feature
  table replaces the old "Phase 1 only" placeholder, full folder tree,
  operations section, test-coverage table.
- pg_cron enabled on `gkegnmshivmgqhenqkzr` via Database → Extensions, then
  `apply_pending_migrations.sql` re-run; `cron.job_run_details` confirms
  `expire_chit_authorizations()` is firing every minute.
- 0029 confirmed via `pg_description` lookup on `public.create_sale`.

**Deferred.**

- P2 (test coverage), P3 (operational scripts), P4 (hygiene), P5
  (code-quality) — see the original production-readiness plan.

---

## 2026-07-31 — Self-register rollout (HEAD `f118175`)

**Context.** Members will self-register at `/register` with their own email
+ password. `must_reset_pw` is gone from the schema. Recovery becomes the
stock Supabase flow.

**Shipped (commit `d12db89` + `f118175`):**

- `supabase/migrations/0030_wipe_test_data.sql` (new — applied to live DB)
- `supabase/migrations/0031_drop_must_reset_pw.sql` (new — applied to live DB)
- `supabase/functions/admin-wipe-auth-users/index.ts` (new — deployed; wiped
  46 orphan `auth.users` rows)
- `supabase/migrations/0015_phase15_member_self_signup.sql` — removed
  `must_reset_pw` from trigger INSERT
- `supabase/migrations/0023_bulk_member_seed.sql` — same
- `supabase/functions/create-user/index.ts` — removed `must_reset_pw` field
- `supabase/functions/admin-reset-password/index.ts` — same
- `supabase/functions/set-member-email/index.ts` — same
- `supabase/migrations/0005_phase3_policies.sql` — comment cleanup
- `bulk_members_README.md`, `supabase/functions/README.md` — doc cleanup
- `tests/edge/run.sh` — removed `must_reset_pw` from create-user test
- `supabase/seed_45_members.sql` — same

**Not done in this branch:**

- `src/features/users/UsersPage.tsx` `CreateUserDialog` still references
  `password` in defaultValues — review alongside the `/register` flow.
- A proper `/register` page (SPA self-register UI) is **not built yet**.
  Self-register machinery is staged; building `/register` is the next step
  after this lands.

---

## 2026-07-30 — Hardening batch (HEAD `4084800`)

**Shipped.**

1. pg_cron job to call `expire_chit_authorizations()` every minute
   (`0028_chit_expiry_cron.sql`).
2. `set-member-email` Edge Function now requires `current_password` on the
   self-service path (`supabase/functions/set-member-email/index.ts` +
   `bulk_members_README.md`).
3. SPA recursion → iteration in `callChitAuthorizeEdgeFunction`
   (`src/features/sales/sales.service.ts`).
4. `create_sale()` validates every cart line's `product_id` against
   `public.products` (rejects soft-deleted and inactive SKUs)
   (`0029_create_sale_product_validation.sql`).

---

## End-to-end state at last update

The CHIT (mess credit) buyer-approval flow works:

1. Barman POS opens `/pos`, builds a cart for a member, submits.
2. POS calls `create_chit_authorization()` (RPC) — pending row inserted.
3. Member scans QR / opens `/portal/authorize/<requestId>` on their phone.
4. Member re-enters password → `chit-authorize` Edge Function verifies via
   GoTrue, flips row to `authorized`.
5. POS Realtime subscription fires, calls `finalize_chit_authorization()`
   which atomically runs `create_sale()` + ledger row.
6. Sale shows up in `/daily-summary`, member's `chit_balance` updated.

Cash sales from `/pos` use the same `create_sale()` RPC.

---

## Key invariants

These are non-obvious facts that have caused bugs before. They don't go
stale.

1. **`auth.uid()` is `auth.users.id`, not `public.users.id`.** They are
   two different UUIDs for the same person. Whenever a column FKs to
   `public.users(id)` (e.g. `sales.barman_id`,
   `chit_authorization_requests.member_id`), you must translate
   `auth.uid()` → `public.users.id` via
   `select id from public.users where auth_id = auth.uid()` before writing.
   The bug `0027_sales_barman_id_fk_fix.sql` fixed was that `create_sale()`
   was writing the raw `auth.uid()` into `sales.barman_id`, which FKs to
   `public.users(id)`. Every INSERT failed the FK.

2. **The Supabase JS client's `auth.getUser(jwt)` is unreliable in Edge
   Functions.** Its in-memory session cache is empty in the Deno runtime,
   so it can short-circuit with `"Auth session missing!"` even when the JWT
   is valid. Workaround: bypass the JS client and call GoTrue directly:
   ```ts
   const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
     headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
   });
   ```
   This pattern is in every Edge Function since commit `cfbd4e8`.

3. **`session_not_found` from GoTrue means the JWT is signed but the
   `auth.sessions` row that issued it has been revoked server-side.** The
   token will *never* be accepted again. The SPA must call
   `supabase.auth.signOut()` and force the user to re-authenticate. See
   `src/features/sales/sales.service.ts:646-657`.

4. **SECURITY DEFINER plpgsql functions that `RETURNS TABLE` declare OUT
   parameters with the same names as the columns.** If the function body
   calls another `RETURNS TABLE` function with the same column names
   (e.g. `finalize_chit_authorization` calling `create_sale`), bare column
   references in `select into` are ambiguous (PG error 42702). Fix: alias
   the inner call: `from public.create_sale(...) as cs` then
   `select cs.sale_id, cs.total_amount`. See 0025 (expires_at) and 0026
   (sale_id, total_amount) for the pattern.

5. **Dashboard Edge Function editor has a stale-buffer bug.** If you paste
   a function and the deployment fails with a parse error showing `~~~~`
   tildes or random characters, hard-refresh the Dashboard (Ctrl+Shift+R)
   before re-pasting. CLI deploy (`supabase functions deploy`) doesn't
   have this issue.

6. **`vercel.json` rewrites everything to `/index.html`.** Required for
   SPA routes like `/portal/authorize/<uuid>` to work on refresh. Don't
   remove it.

---

## How to make changes safely

### SQL migrations

- **Always create a new `NNNN_*.sql`** — never edit existing migrations.
  The DB has the migrations applied; editing locally won't change
  production. Idempotent migrations (`create or replace function`,
  `if not exists`, `drop if exists then add`) are fine.
- **Sanity-check at the bottom** in the same style as 0025/0026/0027/0028/0029:
  ```sql
  do $$
  begin
    if not exists (select 1 from pg_proc where proname = 'my_new_fn' ...) then
      raise exception 'my_new_fn() missing after 00XX';
    end if;
    raise notice '00XX installed — ...';
  end $$;
  ```
- **Run in the Supabase SQL Editor**, not via CLI, so you see the notices.

### Edge Functions

- All Edge Functions use the same auth pattern (direct GoTrue fetch since
  `cfbd4e8`). Keep them in sync if you change one.
- All have CORS preflight. Don't remove.
- Deploy via CLI when possible to avoid the Dashboard stale-buffer:
  ```bash
  supabase functions deploy <fn-name> --no-verify-jwt
  ```

### SPA (TypeScript / React)

- Auto-deploys via Vercel on push to `main`. No extra step.
- Cache-bust after deploy with Ctrl+Shift+R — Vite hash-renames assets
  between deploys.
- Sales service (`src/features/sales/sales.service.ts`) is the heart of
  the POS. Edit carefully and verify the CHIT flow end-to-end.

---

## Open hardening backlog (not yet shipped)

- Migration-driven audit of every Edge Function for FK distinctions like
  the `sales.barman_id` one.
- Rate limiting on `chit-authorize` (needs Supabase Pro or external).
- Move `verifyMemberPassword` (SPA `sales.service.ts:118`) to a
  server-side RPC so the password doesn't transit the SPA.
- Add Vitest + starter tests (production-readiness plan, P2.1).
- Add a real migration runner script (P3.1).

---

## Quick links

See `README.md` for live URLs and Supabase project ref.

For commit history: `git log --oneline` (oldest is `038add5 Initial commit`).
