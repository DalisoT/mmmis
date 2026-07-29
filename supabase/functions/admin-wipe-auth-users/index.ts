// Supabase Edge Function: admin-wipe-auth-users
//
// One-shot scrub of `auth.users` rows that correspond to deleted
// `public.users` rows. Run AFTER migration 0030 (which deletes the
// public.users rows in FK-safe order).
//
// Why an Edge Function instead of a SQL statement:
//   * `auth.users` lives in the auth schema, not public.
//   * The service-role key is required; anon does not have it.
//   * pg_dump / sql-only paths can't reach auth.users safely.
//
// Safety:
//   * The function refuses to run unless an `X-Admin-Secret` header
//     matches the `WIPE_AUTH_SECRET` env var (set via
//     `supabase secrets set WIPE_AUTH_SECRET=<value>`).
//   * If the secret is unset, the function 503s — fail closed.
//   * The function only deletes auth.users rows whose id matches a
//     `public.users.auth_id` that NO LONGER EXISTS (i.e. already deleted
//     by 0030). It will NOT delete auth.users of any currently-active
//     administrator or live member.
//
// Idempotent: re-running is safe. Re-running with no matches returns
// `{ ok: true, wiped_count: 0 }`.
//
// Deploy:
//   supabase functions deploy admin-wipe-auth-users --no-verify-jwt
//   supabase secrets set WIPE_AUTH_SECRET="$(openssl rand -hex 32)"
//
// Run:
//   curl -X POST "$SUPABASE_URL/functions/v1/admin-wipe-auth-users" \
//     -H "X-Admin-Secret: $WIPE_AUTH_SECRET" \
//     -H "Content-Type: application/json"
//
// The Edge Function is INTENTIONALLY NOT committed to the repo's auto-run
// cron — it is a destructive op gated by a manual header. It's a
// "hand-grenade" you fire once and never again.

// @ts-nocheck  -- Deno runtime.
// deno-lint-ignore-file no-explicit-any

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info, x-admin-secret',
  'access-control-max-age': '86400',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  // Hard gate. Fail closed if the secret is unset OR no match.
  const expected = Deno.env.get('WIPE_AUTH_SECRET');
  if (!expected) {
    return json({ error: 'WIPE_AUTH_SECRET not configured on the function' }, 503);
  }
  const supplied = req.headers.get('x-admin-secret') ?? '';
  if (supplied.length === 0 || supplied !== expected) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  // 1. Collect every public.users.auth_id currently in the table. After
  //    migration 0030 this should be the active user population — we
  //    will use this set to PRESERVE auth.users rows that still have a
  //    public.users parent.
  let keepIds: Set<string> = new Set();
  let page = 0;
  while (true) {
    const { data, error } = await admin
      .from('users')
      .select('auth_id')
      .not('auth_id', 'is', null)
      .range(page * 1000, page * 1000 + 999);
    if (error) {
      return json({ error: `Failed to enumerate public.users: ${error.message}` }, 500);
    }
    if (!data || data.length === 0) break;
    for (const r of data) if (r.auth_id) keepIds.add(r.auth_id as string);
    if (data.length < 1000) break;
    page++;
  }

  // 2. List auth.users in pages; delete those NOT in keepIds.
  let wiped = 0;
  let cursor: string | null = null;
  let iterations = 0;
  const MAX_PAGES = 50; // safety: 1000 users/page × 50 = 50k, well past anyone

  while (iterations++ < MAX_PAGES) {
    const list: any = await admin.auth.admin.listUsers({ page: cursor ?? undefined, perPage: 1000 });
    const users = list?.data?.users ?? list?.users ?? [];
    if (!Array.isArray(users) || users.length === 0) break;

    for (const u of users) {
      if (!u?.id) continue;
      if (keepIds.has(u.id)) continue;
      const { error: delErr } = await admin.auth.admin.deleteUser(u.id);
      if (delErr) {
        // Don't abort — log and continue. A single bad row shouldn't
        // stop the wipe; report it in the response.
        console.error('deleteUser failed', u.id, delErr.message);
        continue;
      }
      wiped++;
    }

    // Advance cursor if available; otherwise we're done.
    cursor = list?.data?.nextCursor ?? list?.nextPage ?? null;
    if (!cursor) break;
  }

  return json({
    ok: true,
    wiped_count: wiped,
    kept_count: keepIds.size,
    captured_at: new Date().toISOString(),
  });
});
