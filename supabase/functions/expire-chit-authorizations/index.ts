// Supabase Edge Function: expire-chit-authorizations
//
// Scheduled fallback for public.expire_chit_authorizations() on Supabase
// plans that do NOT have the pg_cron extension. Originally migration 0028
// scheduled that function via pg_cron; when pg_cron is missing this
// Edge Function is the substitute.
//
// Flow:
//   1. GitHub Actions cron job POSTs here once a minute (see
//      .github/workflows/expire-chit.yml).
//   2. We verify the caller's X-Cron-Secret header against the
//      CRON_SECRET secret. Without a match we 401 — this stops any
//      random internet caller from churning your DB.
//   3. With the service-role key we call public.expire_chit_authorizations().
//      That function is SECURITY DEFINER and atomically flips status='pending'
//      rows whose expires_at has passed to 'expired'.
//   4. We return { ok: true, expired_count: N } so the GH Actions log
//      shows what each minute's invocation cleaned up.
//
// This is deliberately NOT user-facing. Deploy with:
//   supabase functions deploy expire-chit-authorizations --no-verify-jwt
//   supabase secrets set CRON_SECRET=<32+ random chars>
// Then mirror CRON_SECRET as a GitHub Actions repo secret.

// @ts-nocheck  -- Deno runtime.
// deno-lint-ignore-file no-explicit-any

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info, x-cron-secret',
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

  // 1. Authenticate the cron caller. Without this header match we 401.
  //    The CRON_SECRET is set via `supabase secrets set` and mirrored as
  //    a GitHub Actions repository secret named CRON_SECRET.
  const expected = Deno.env.get('CRON_SECRET');
  if (!expected) {
    // Fail closed if the secret isn't configured — never invoke the RPC
    // without it. This prevents an accidental "deploy without secret"
    // path from churning the DB on every public POST.
    return json({ error: 'CRON_SECRET not configured on the function' }, 503);
  }
  const supplied = req.headers.get('x-cron-secret') ?? '';
  if (supplied.length === 0 || supplied !== expected) {
    return json({ error: 'Unauthorized' }, 401);
  }

  // 2. Use the service-role key to call the RPC. The RPC is SECURITY
  //    DEFINER and doesn't care who calls it; service-role bypasses RLS.
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  let expired_count = 0;
  try {
    // expire_chit_authorizations() (0022) returns the number of rows
    // it flipped from 'pending' to 'expired'. It is SECURITY DEFINER
    // and revoked from public, so we must call via service-role.
    const { data, error } = await admin.rpc('expire_chit_authorizations');
    if (error) {
      console.error('expire_chit_authorizations failed', error);
      return json({ error: error.message }, 500);
    }
    expired_count = typeof data === 'number' ? data : Number(data ?? 0);
  } catch (err) {
    console.error('expire-chit-authorizations invocation threw', err);
    return json({ error: (err as Error).message }, 500);
  }

  return json({
    ok: true,
    expired_count,
    captured_at: new Date().toISOString(),
  });
});
