# CONTINUE_HERE.md

> Pick-up notes for resuming work on the MMMIS project after a break.
> Last updated: end of the current session (HEAD = `5bdc7bc` on `main`,
> with the local destructive-ops worktree NOT YET committed — see
> "Pending destructive ops" section).

---

## TL;DR — what this project is

**MMMIS** — Military Mess Management Information System. A mess (canteen/bar)
management app for a small military unit. SPA on Vercel + Supabase Postgres +
Supabase Edge Functions (Deno).

- **Live URL**: <https://mmmis.vercel.app>
- **Supabase project**: `gkegnmshivmgqhenqkzr` (region: eu-west-1)
- **Repo**: <https://github.com/DalisoT/mmmis> (default branch: `main`)

The original commit landed everything from a single `Initial commit`
(`038add5`) — see `git log --reverse` for the full feature history.

---

## Current state — what works end-to-end

The whole CHIT (mess credit) buyer-approval flow now works:

1. Barman POS opens `/pos`, builds a cart for a member, submits.
2. POS calls `create_chit_authorization()` (RPC) — pending row inserted.
3. Member scans QR / opens `/portal/authorize/<requestId>` on their phone.
4. Member re-enters password → `chit-authorize` Edge Function verifies via
   GoTrue, flips row to `authorized`.
5. POS Realtime subscription fires, calls `finalize_chit_authorization()`
   which atomically runs `create_sale()` + ledger row.
6. Sale shows up in `/daily-summary`, member's chit_balance updated.

Cash sales from `/pos` work via the same `create_sale()` RPC.

---

## Just shipped (HEAD = `4084800`)

The hardening batch:

| # | Change | Commit / file |
|---|--------|---------------|
| 1 | pg_cron job to call `expire_chit_authorizations()` every minute | `0028_chit_expiry_cron.sql` |
| 2 | `set-member-email` Edge Function now requires `current_password` on self-service path | `supabase/functions/set-member-email/index.ts` + `bulk_members_README.md` |
| 3 | SPA recursion → iteration in `callChitAuthorizeEdgeFunction` | `src/features/sales/sales.service.ts` |
| 4 | `create_sale()` validates every cart line's `product_id` (not soft-deleted, status=active) | `0029_create_sale_product_validation.sql` |

---

## What still needs operator action on Supabase

These haven't been run yet — they're **deferred** to a Supabase SQL Editor
session by the operator:

1. **Apply migration `0028`** — paste contents of
   `supabase/migrations/0028_chit_expiry_cron.sql` into the SQL Editor.
   Expected: `NOTICE: 0028 installed — expire_chit_authorizations() now runs every minute`.
   If pg_cron isn't installed on the plan, the migration degrades gracefully
   (just a notice, no schedule).

2. **Apply migration `0029`** — paste contents of
   `supabase/migrations/0029_create_sale_product_validation.sql`. Expected:
   `NOTICE: 0029 installed — create_sale() now validates products exist and are active`.

3. **Redeploy `set-member-email` Edge Function** — copy/paste into the
   Dashboard editor (clean any stale buffer first), OR
   ```bash
   supabase functions deploy set-member-email --no-verify-jwt
   ```
   The SPA doesn't currently call this function (only `curl` from the
   bulk_members_README.md doc does), but the password check is now enforced
   on the wire.

The SPA itself auto-deploys via Vercel on git push — no extra step.

---

## Key invariants to remember

These are non-obvious facts that have caused bugs before:

1. **`auth.uid()` is `auth.users.id`, not `public.users.id`.**
   They are two different UUIDs for the same person. Whenever a column
   FKs to `public.users(id)` (e.g. `sales.barman_id`,
   `chit_authorization_requests.member_id`), you must translate
   `auth.uid()` → `public.users.id` via `select id from public.users
   where auth_id = auth.uid()` before writing.
   - The bug `0027_sales_barman_id_fk_fix.sql` fixed was that
     `create_sale()` was writing the raw `auth.uid()` into
     `sales.barman_id`, which FKs to `public.users(id)`. Every INSERT
     failed the FK. The fix resolves the public UUID and writes that.

2. **The Supabase JS client's `auth.getUser(jwt)` is unreliable in Edge
   Functions.** Its in-memory session cache is empty in the Deno runtime,
   so it can short-circuit with `"Auth session missing!"` even when the
   JWT is valid. Workaround: bypass the JS client and call GoTrue
   directly:
   ```ts
   const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
     headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
   });
   ```
   This pattern is in all 5 Edge Functions after commit `cfbd4e8`.

3. **`session_not_found` from GoTrue means the JWT is signed but the
   `auth.sessions` row that issued it has been revoked server-side.**
   The token will *never* be accepted again. The SPA must call
   `supabase.auth.signOut()` and force the user to re-authenticate.
   See `src/features/sales/sales.service.ts:646-657`.

4. **SECURITY DEFINER plpgsql functions that `RETURNS TABLE` declare OUT
   parameters with the same names as the columns.** If the function body
   calls another `RETURNS TABLE` function with the same column names
   (e.g. `finalize_chit_authorization` calling `create_sale`), bare
   column references in `select into` are ambiguous (PG error 42702).
   Fix: alias the inner call: `from public.create_sale(...) as cs`
   then `select cs.sale_id, cs.total_amount`. See 0025 (expires_at) and
   0026 (sale_id, total_amount) for the pattern.

5. **Dashboard Edge Function editor has a stale-buffer bug.** If you
   paste a function and the deployment fails with a parse error showing
   `~~~~` tildes or random characters, hard-refresh the Dashboard
   (Ctrl+Shift+R) before re-pasting. CLI deploy (`supabase functions
   deploy`) doesn't have this issue.

6. **`vercel.json` rewrites everything to `/index.html`.** Required for
   SPA routes like `/portal/authorize/<uuid>` to work on refresh.
   Don't remove it.

---

## File map — where things live

```
mmmis/
├── vercel.json                       # SPA rewrite → /index.html
├── bulk_members_README.md            # How to bulk-seed members
├── CONTINUE_HERE.md                  # ← you are here
├── supabase/
│   ├── functions/
│   │   ├── chit-authorize/           # Buyer-side CHIT approval
│   │   ├── create-user/              # Admin creates user (mailgun temp pw)
│   │   ├── admin-reset-password/     # Admin resets pw (mailgun)
│   │   ├── bulk-seed-members/        # Admin bulk-seed from staging table
│   │   ├── set-member-email/         # Member self-service email update
│   │   ├── password-reset/           # Forgot password
│   │   └── README.md                 # Deploy instructions
│   ├── migrations/                   # Numbered SQL, run in order in SQL Editor
│   │   ├── 0001_init.sql             # Schema (users, members, sales, etc.)
│   │   ├── 0017_sales_atomic_rpc.sql # create_sale() RPC
│   │   ├── 0022_chit_authorization_requests.sql  # CHIT flow RPCs + table
│   │   ├── 0025/26/27/28/29_*.sql    # Recent fixes (see commit log)
│   │   └── seed_45_members.sql       # Optional 45-member seed
│   └── seed_45_members.sql           # (duplicate; gitignored)
└── src/
    ├── App.tsx                       # Routes
    ├── features/
    │   ├── auth/                     # Login, AuthContext, ProtectedRoute
    │   ├── sales/                    # POS, daily summary, sales.service.ts
    │   │                             #   (CHIT RPC + chit-authorize fetch)
    │   ├── member/                   # /portal/* and AuthorizeChitPage
    │   ├── treasurer/                # Outstanding chit, payments, expenses
    │   ├── admin/                    # Users, audit, settings, sessions
    │   ├── audit/                    # auditUserChange helper
    │   └── ...
    └── components/                   # shadcn/ui-based primitives
```

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

- **All five functions use the same auth pattern** (direct GoTrue fetch
  in `cfbd4e8`). Keep them in sync if you change one.
- **All five have CORS preflight** (`62fecc2`, `53caea1`). Don't remove.
- **Deploy via CLI when possible** to avoid the Dashboard stale-buffer:
  ```bash
  supabase functions deploy <fn-name> --no-verify-jwt
  ```

### SPA (TypeScript / React)

- **Auto-deploys via Vercel** on push to `main`. No extra step.
- **Cache-bust after deploy** with Ctrl+Shift+R — Vite hash-renames
  assets between deploys.
- **Sales service (`sales.service.ts`)** is the heart of the POS.
  Edit carefully and verify the CHIT flow end-to-end.

---

## Likely next steps when you return

In rough priority order, based on what's left on the hardening backlog:

1. **Verify 0028/0029 migrations + set-member-email redeploy actually
   happened.** Run the SQL Editor quick checks in the "What still needs
   operator action" section above.
2. **Test the hardened buyer flow end-to-end.** Create a CHIT
   purchase, approve it on the buyer's phone, confirm:
   - pg_cron expiry works (insert a fake old `pending` row with
     `expires_at = now() - interval '6 minutes'` and watch it flip
     to `expired` within 60s).
   - `create_sale` rejects a soft-deleted product (try via SQL Editor).
   - SPA recursion fix didn't break the normal refresh path.
3. **Set Mailgun secrets** if you want `create-user` /
   `admin-reset-password` to actually send emails:
   ```
   supabase secrets set MAILGUN_API_KEY=... MAILGUN_DOMAIN=... MAIL_FROM=...
   ```
   Without these the functions still work; `temp_password` is returned
   in the JSON response instead.
4. **Move all Edge Function deploys to CLI** to avoid the Dashboard
   stale-buffer bug. Write a `tools/deploy-functions.sh` if useful.
5. **Consider the remaining hardening backlog** (not yet shipped):
   - Migration-driven audit of every Edge Function for FK distinctions
     like the `sales.barman_id` one.
   - Rate limiting on `chit-authorize` (needs Supabase Pro or external).
   - Move `verifyMemberPassword` (SPA `sales.service.ts:118`) to a
     server-side RPC so the password doesn't transit the SPA.

---

## Pending destructive ops — clean-slate self-register rollout

Decision (recorded for posterity): members will self-register at `/register`
with their own email + password. Recovery becomes the stock Supabase flow.
All current test data is being wiped.

This work is **staged locally but not yet committed or applied**. The
intended run sequence is:

### 1. SQL migrations (Supabase SQL Editor)

Run these in order. Each is wrapped in a transaction so a failure
aborts cleanly:

```
-- 0030 — destructive: deletes every public row in FK-safe order.
--        Keeps public.roles (4 system roles).
--        Schema, triggers, and RLS policies survive.
\i supabase/migrations/0030_wipe_test_data.sql

-- 0031 — schema: drop public.users.must_reset_pw
\i supabase/migrations/0031_drop_must_reset_pw.sql
```

### 2. Edge Function deploy + secret

```
supabase functions deploy admin-wipe-auth-users --no-verify-jwt
supabase secrets set WIPE_AUTH_SECRET="$(openssl rand -hex 32)"
```

The function fails closed (503) if `WIPE_AUTH_SECRET` is unset. It only
deletes `auth.users` rows whose id is NOT in `public.users.auth_id` — so
after 0030 has run it scrubs exactly the orphan auth rows.

### 3. Run the wipe

```
curl -X POST "$SUPABASE_URL/functions/v1/admin-wipe-auth-users" \
  -H "X-Admin-Secret: $WIPE_AUTH_SECRET" \
  -H "Content-Type: application/json"
```

Expected response:

```json
{
  "ok": true,
  "wiped_count": <number of deleted auth.users rows>,
  "kept_count":  <number of preserved public.users.auth_id values>,
  "captured_at": "<ISO timestamp>"
}
```

### 4. Smoke check

`tests/sql/diagnostic_one_row.sql` should now report `active_members = 0`,
`active_barmen = 0`, `active_products = 0`.

### Files touched in this branch (not yet committed)

- `supabase/migrations/0030_wipe_test_data.sql` (new)
- `supabase/migrations/0031_drop_must_reset_pw.sql` (new)
- `supabase/functions/admin-wipe-auth-users/index.ts` (new)
- `supabase/migrations/0015_phase15_member_self_signup.sql` — removed
  `must_reset_pw` from the trigger INSERT
- `supabase/migrations/0023_bulk_member_seed.sql` — same
- `supabase/functions/create-user/index.ts` — removed `must_reset_pw`
  field from the request body
- `supabase/functions/admin-reset-password/index.ts` — removed
  `must_reset_pw` flip on reset
- `supabase/functions/set-member-email/index.ts` — removed `must_reset_pw`
  select/clear
- `supabase/migrations/0005_phase3_policies.sql` — comment cleanup
- `bulk_members_README.md`, `supabase/functions/README.md` — doc cleanup
- `tests/edge/run.sh` — removed `must_reset_pw` from create-user test
- `supabase/seed_45_members.sql` — same

### Files NOT touched (would need to be done in a future pass)

- `src/features/users/UsersPage.tsx` still has a `CreateUserDialog`
  defaultValues block referencing `password` (no `must_reset_pw` left,
  but the password default-empty UX should be reviewed alongside the
  self-register flow).
- A proper `/register` page that lets a brand-new member create their
  own auth.users row + public.users row + public.members row is **not
  built yet**. The branch only stages the wipe and the machinery
  removal. Building `/register` is the next step after this lands.

---

## Quick links

- Supabase SQL Editor: <https://supabase.com/dashboard/project/gkegnmshivmgqhenqkzr/sql/new>
- Supabase Edge Functions: <https://supabase.com/dashboard/project/gkegnmshivmgqhenqkzr/functions>
- Supabase Auth users: <https://supabase.com/dashboard/project/gkegnmshivmgqhenqkzr/auth/users>
- Vercel project: <https://vercel.com/dalisos-projects/mmmis>
- GitHub repo: <https://github.com/DalisoT/mmmis>

---

## Recent commit history (last 10)

```
4084800 Hardening batch: cron expiry, email pw check, SPA recursion, product validation
e9c7421 Add 0027: fix sales_barman_id_fkey violation in create_sale()
61268bf Fix chit-authorize: handle GoTrue session_not_found by clearing local session
cfbd4e8 Replace auth.getUser(token) with direct GoTrue /auth/v1/user fetch
386a8b6 Add 0026: fix ambiguous sale_id in finalize_chit_authorization
756f220 Apply explicit-token getUser() fix to bulk-seed-members and set-member-email
6931206 Fix Edge Function getUser() 'Auth session is missing' false-negative
569a8c0 Fix chit-authorize 'Not signed in' for buyers with stale sessions
927ede2 Retire invite-email Edge Function
53caea1 Add CORS preflight + headers to remaining Edge Functions
```

Full history: `git log --oneline` (currently ~30 commits, oldest is `038add5 Initial commit`).