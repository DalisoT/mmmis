// Supabase Edge Function: password-reset
//
// Generates a password-reset email for a member who has forgotten their
// password. Uses Supabase Auth admin API and writes an audit row.
//
// Deploy:
//   supabase functions deploy password-reset --no-verify-jwt

// @ts-nocheck  -- Edge Functions run on Deno.
// deno-lint-ignore-file no-explicit-any

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface ResetRequest {
  service_number: string;
}

const APP_URL = Deno.env.get('APP_URL') ?? 'https://mmmis.example.com';

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const body: ResetRequest = await req.json();
  if (!body.service_number) {
    return new Response(JSON.stringify({ error: 'service_number required' }), { status: 400 });
  }

  // Service-role client because we have to look up the email without auth.
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const { data: userRow, error: lookupErr } = await admin
    .from('users')
    .select('email, is_active')
    .eq('service_number', body.service_number.trim())
    .is('deleted_at', null)
    .maybeSingle();

  if (lookupErr || !userRow?.email) {
    // Do not leak existence. Return 200 either way.
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'content-type': 'application/json' },
    });
  }
  if (userRow.is_active === false) {
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'content-type': 'application/json' },
    });
  }

  const { error } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email: userRow.email,
    options: { redirectTo: `${APP_URL}/login?reset=1` },
  });
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  // Audit (best-effort; RPC expects authenticated user, so we use the
  // service-role client to call it directly).
  try {
    await admin.rpc('log_audit_event', {
      p_action: 'auth.password_reset',
      p_meta: { service_number: body.service_number, via: 'edge-fn' },
    });
  } catch (_) {
    // ignore audit failure
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'content-type': 'application/json' },
  });
});