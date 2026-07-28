// Supabase Edge Function: invite-email
//
// Sends a Supabase Auth invite email to a new staff member. Triggered by
// an authenticated POST from the Users page. The caller must be an
// administrator (checked via the JWT role claim against public.users).
//
// Note: the invite goes through Supabase Auth's built-in
// inviteUserByEmail(), which sends the Supabase-branded template from
// a `supabase.io` address. This is the only email-sending path in this
// function — there is no Mailgun call here. Branded Mailgun invites
// (matching the create-user / admin-reset-password flow) are not
// implemented in this Edge Function.
//
// Deploy:
//   supabase functions deploy invite-email --no-verify-jwt

// @ts-nocheck  -- Edge Functions run on Deno; the type checker on the
//                 Node/Vite side does not need to validate this file.
// deno-lint-ignore-file no-explicit-any

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface InviteRequest {
  service_number: string;
  email: string;
  full_name: string;
  role_code: 'administrator' | 'treasurer' | 'barman' | 'member';
}

const APP_URL = Deno.env.get('APP_URL') ?? 'https://mmmis.example.com';

// CORS — admin-only, but the SPA at mmmis.vercel.app calls this from the
// browser. Without these headers the preflight OPTIONS gets a 405 and
// `fetch` rejects with "Failed to fetch". See chit-authorize for the
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

  const auth = req.headers.get('authorization') ?? '';
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: auth } } }
  );

  // 1. Verify caller is an administrator.
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    return json({ error: 'Unauthorized' }, 401);
  }
  const { data: caller } = await supabase
    .from('users')
    .select('role:roles(code)')
    .eq('auth_id', userData.user.id)
    .single();
  const callerRole = (caller as any)?.role?.code;
  if (callerRole !== 'administrator') {
    return json({ error: 'Forbidden' }, 403);
  }

  const body: InviteRequest = await req.json();

  // 2. Use Supabase Auth admin API to send the invite (handles link/email).
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );
  const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(body.email, {
    redirectTo: `${APP_URL}/login`,
  });
  if (inviteErr) {
    return json({ error: inviteErr.message }, 400);
  }

  // 3. Audit it via the same RPC the client uses.
  await supabase.rpc('log_audit_event', {
    p_action: 'user.create',
    p_meta: {
      service_number: body.service_number,
      email: body.email,
      role_code: body.role_code,
      via: 'invite-email',
    },
  });

  return json({ ok: true });
});