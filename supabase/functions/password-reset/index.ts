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

// CORS — the password-reset flow is triggered from the unauthenticated
// /login page in the SPA (mmmis.vercel.app). Without these headers the
// browser's preflight OPTIONS gets a 405 with no Access-Control-Allow-Origin
// and `fetch` rejects with "Failed to fetch". See chit-authorize for the
// matching pattern (commit 62fecc2).
const corsHeaders: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info',
  'access-control-max-age': '86400',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders },
  });
}

Deno.serve(async (req) => {
  // CORS preflight — short-circuit before the POST handler.
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const body: ResetRequest = await req.json();
  if (!body.service_number) {
    return json({ error: 'service_number required' }, 400);
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
    return json({ ok: true });
  }
  if (userRow.is_active === false) {
    return json({ ok: true });
  }

  const { error } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email: userRow.email,
    options: { redirectTo: `${APP_URL}/login?reset=1` },
  });
  if (error) {
    return json({ error: error.message }, 500);
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

  return json({ ok: true });
});