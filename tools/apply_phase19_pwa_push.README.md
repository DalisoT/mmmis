# Phase 19 DB Apply Helper

A one-shot, idempotent SQL script that finishes the **Phase 19 PWA + push
notifications** DB changes on a Supabase project that's been in a
partially-applied state.

## What this is for

The two normal-phase migrations that ship these changes are:

- `supabase/migrations/0034_pwa_foundation.sql`
- `supabase/migrations/0035_push_notifications.sql`

Both are authored with `create table if not exists`,
`drop policy if exists`, `drop trigger if exists`, `create or replace
function` — so on a clean DB the standard `supabase db push` (or the
SQL editor's "Apply migration" UI) installs everything in one shot.

If the first apply attempt errored out, the SQL editor's wrapping
transaction rolled back, and your DB is in a clean state. The only time
this helper earns its keep is when partial application happened via
direct SQL-editor runs of individual statements (e.g. copy-pasted parts
of the migration files). Run this helper once and you're guaranteed to
end in the same final state as a successful `db push`.

## How to run

1. Open `supabase/.temp/apply_phase19_pwa_push.sql` in any text editor.
2. Copy its entire contents (Ctrl+A, Ctrl+C).
3. In Supabase Dashboard → SQL editor → New query, paste, click **Run**.
4. The end of the script prints a status report via `raise notice`.
   Check the Notices tab for confirmation.

If you want to re-run later, it's safe — every DDL is idempotent.

## What it creates / verifies

- `public.current_user_id()` helper (translates auth JWT subject to
  the public.users row id used by RLS policies)
- `public.offline_action_log` (idempotency log for the PWA offline
  queue)
- `public.push_subscriptions` (Web Push subscription records)
- `public.push_outbox` (notification queue consumed by the
  `push-dispatch` Edge Function)
- Two triggers on `public.chit_authorization_requests`:
  - `trg_chit_auth_request_notify` (INSERT → notify the member)
  - `trg_chit_auth_request_resolved` (UPDATE → notify the barman)
- `public.mark_push_outbox_dispatched(jsonb)` RPC (used by the
  `push-dispatch` Edge Function)

## After this script succeeds

Wire the rest (VAPID keys, secrets, webhook, deploy Edge Function):
see the deploy checklist in the conversation log / project docs.
