// Supabase Edge Function: invite-email
//
// Sends a branded invite email to a new staff member. Triggered by an
// authenticated POST from the Users page. The caller must be an
// administrator (checked via the JWT role claim against public.users).
//
// Deploy:
//   supabase functions deploy invite-email --no-verify-jwt
// Then set the MAILGUN_API_KEY, MAILGUN_DOMAIN, MAIL_FROM secrets via:
//   supabase secrets set MAILGUN_API_KEY=… MAILGUN_DOMAIN=… MAIL_FROM=…

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

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
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
    return new Response('Unauthorized', { status: 401 });
  }
  const { data: caller } = await supabase
    .from('users')
    .select('role:roles(code)')
    .eq('auth_id', userData.user.id)
    .single();
  const callerRole = (caller as any)?.role?.code;
  if (callerRole !== 'administrator') {
    return new Response('Forbidden', { status: 403 });
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
    return new Response(JSON.stringify({ error: inviteErr.message }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
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

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'content-type': 'application/json' },
  });
});