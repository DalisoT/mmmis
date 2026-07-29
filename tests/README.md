# MMMIS test suite

Three layers of tests, each runnable independently:

| Layer | Path | What it covers |
|---|---|---|
| DB (SQL Editor) | `tests/sql/00_hardening_smoke.sql` | Migrations 0027 / 0028 / 0029 — pg_cron expiry, product validation, FK fix |
| Edge Functions (curl) | `tests/edge/run.sh` | chit-authorize, set-member-email, create-user, admin-reset-password |
| SPA (Playwright) | `tests/e2e/*.spec.ts` | CHIT happy path, expiry path, deep-link, set-member-email password gate |

The `tests/` directory is gitignored-friendly but the contents here are
checked in. Use a dedicated Supabase **test project** (or at minimum a
test schema) so you don't pollute production data.

---

## 1. SQL smoke tests — `tests/sql/00_hardening_smoke.sql`

Run this in the **Supabase SQL Editor** for the target project, after
applying migrations `0028` and `0029`.

```bash
# Open the file, paste into SQL Editor, run.
# Output will stream NOTICEs from each block.
```

Expected output (truncated):
```
=== MMMIS hardening smoke tests ===
--- Block 1: installation checks ---
NOTICE: pg_cron installed: t
NOTICE: cron.job expire-chit-authorizations present: t
NOTICE: public.create_sale() present: t
NOTICE: public.create_sale() signature: create_sale(text, uuid, jsonb, text)
--- Block 2: pg_cron expiry (0028) — DESTRUCTIVE ---
NOTICE: Inserted stale pending request <uuid> (expires_at = 6 min ago)
NOTICE: Waiting up to 90 seconds for cron to flip it...
...
--- Block 3: create_sale() product validation (0029) ---
NOTICE: PASS 3a: create_sale() rejected missing product_id (23503)
NOTICE: PASS 3b: create_sale() rejected soft-deleted product (23503)
NOTICE: PASS 3c: create_sale() rejected inactive product (23503)
NOTICE: PASS 3d: created sale <uuid> total=...
--- Block 4: sales.barman_id FK (0027) ---
NOTICE: PASS 4: sales.barman_id = public.users.id (<uuid>)
```

**Important**: Block 2 inserts a fake stale pending row. Block 5 cleans up
products that the script soft-deleted during Block 3b, but the stale
pending row stays so you can verify the cron job flips it. Delete it
manually if you want a clean slate:

```sql
delete from public.chit_authorization_requests
 where id = '<uuid-from-block-2>';
```

### Limitations

- The SQL Editor runs as the service role. `create_sale()` is `SECURITY
  DEFINER` and re-checks `auth.uid()`, so the happy-path tests will fail
  with `42501 Forbidden` if you run them from a pure service-role session
  (no signed-in user). Workarounds:
  1. Run them from a SQL Editor session while signed in as staff in the
     SPA in another tab.
  2. Skip blocks 3d and 4 and only run blocks 1, 2, 3a, 3b, 3c.
  3. Or run them from a `psql` session authenticated as a staff JWT:
     ```bash
     psql "$SUPABASE_DB_URL" \
       -v "member_id=<uuid>" \
       -f tests/sql/00_hardening_smoke.sql
     ```

---

## 2. Edge Function curl tests — `tests/edge/run.sh`

A bash script that hits each Edge Function with valid and invalid
requests, asserting HTTP status codes and CORS headers.

### Setup

```bash
cp tests/edge/.env.test.example tests/edge/.env.test
# Edit .env.test and fill in the JWTs/credentials.
# (See file comments for how to extract JWTs from the SPA.)

export $(grep -v '^#' tests/edge/.env.test | xargs)
bash tests/edge/run.sh
```

The script needs `curl` (any recent version) and a POSIX `mktemp`. It
prints a coloured PASS/FAIL/SKIP summary and exits non-zero if any test
failed.

### What it asserts

| Function | Test |
|---|---|
| **all 4** | `OPTIONS` (CORS preflight) returns 204 + `access-control-allow-*` headers |
| chit-authorize | no JWT → 401; missing fields → 400; happy path → 200 (or 409 if already-finalized); wrong password → 401 |
| set-member-email | no JWT → 401; missing `current_password` → 400 with that exact error; wrong password → 401; correct password → 200 |
| create-user | no JWT → 401; member caller → 403; missing fields → 400; bad `role_code` → 400; happy path → 200 with `user_id`/`auth_id`/`temp_password` |

### Limitations

- The script uses JWTs that may expire. If a test fails with 401 after
  the SPA has been idle for >1 hour, refresh the JWTs.
- `chit-authorize` happy-path and wrong-password tests require a
  pending `chit_authorization_requests` row (`REQUEST_ID`). Without it,
  those tests are SKIPped.
- `chit-authorize` with a **session_not_found** token (the `61268bf`
  fix path) is **not** testable via curl — it requires revoking the
  session in the Auth dashboard, which is destructive and out of scope
  for this script. That scenario is covered manually in the SPA test
  plan (`tests/e2e/chit-flow.spec.ts` would need a separate spec).

---

## 3. SPA end-to-end (Playwright) — `tests/e2e/`

Drives a real Chromium against the deployed SPA. Assumes the SPA is
already deployed (Vercel auto-deploys on push to `main`) and points at a
test Supabase project.

### Setup

This is a **new** dependency for the project. Install:

```bash
pnpm add -D @playwright/test
pnpm dlx playwright install chromium
```

Then add to `package.json` scripts:
```json
"test:e2e": "playwright test --config tests/e2e/playwright.config.ts"
```

Create `.env.test` in the project root (NOT in `tests/e2e/` — Playwright
reads env from the shell):
```bash
E2E_BASE_URL=https://mmmis.vercel.app
E2E_BARMAN_EMAIL=...
E2E_BARMAN_PASSWORD=...
E2E_MEMBER_EMAIL=...
E2E_MEMBER_PASSWORD=...
```

### What it tests

| Spec | What it does |
|---|---|
| Deep-link to `/portal/authorize/<uuid>` | Asserts the SPA loads (no 404) — verifies `vercel.json` rewrite |
| CHIT happy path | Barman on `/pos` builds a cart, submits; buyer on a second context opens the authorize URL, wrong-pw fails, correct-pw succeeds; POS shows the finalized sale |
| CHIT expiry path | Submit, ignore, wait 3 min, reload POS, assert the pending row is gone |
| set-member-email gate | Member opens profile, fills new email but no `current_password`, asserts the 400 message |

### Limitations and TODOs

The CHIT happy-path test has placeholder selectors (`TODO` comments in
the spec). The exact selectors for `add to cart`, `submit`, and the
`data-testid="auth-link"` element need to be matched against the real
`PointOfSalePage` and `AuthorizeChitPage` components. The test will be
skipped with a clear message if it can't find the elements.

To extend the suite:
1. Run Playwright in `--ui` mode and use the "record" button to capture
   the real selectors:
   ```bash
   pnpm playwright test --config tests/e2e/playwright.config.ts --ui
   ```
2. Replace the placeholder locators with the real ones.
3. Add `data-testid` attributes to key elements in the SPA to make the
   tests resilient to copy changes.

---

## Recommended order to run

1. **SQL** — fastest ROI, surfaces migration issues immediately.
2. **Edge Functions** — covers the auth + CORS matrix.
3. **SPA e2e** — last because it depends on the DB and Edge Functions
   being healthy.

```bash
# Quick smoke (after migrations applied + functions deployed):
psql ... -f tests/sql/00_hardening_smoke.sql     # or paste into SQL Editor
bash tests/edge/run.sh
pnpm test:e2e
```