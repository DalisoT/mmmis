// Supabase Edge Function: set-member-email
//
// Lets an authenticated member update their own email without going through
// the standard Supabase "confirm the new address" email round-trip.
//
// Why this exists:
//   - The bulk-seeder creates accounts with placeholder emails like
//     "5083@mess.zm.local". The member signs in with the temp password,
//     then needs a way to set their real email before the barman can
//     recover the account if they ever forget the password.
//   - supabase.auth.updateUser({ email }) sends a confirmation link to the
//     new address. On a self-contained mess LAN with no outbound SMTP,
//     that link never arrives.
//
// Flow:
//   1. Caller is authenticated (their JWT is in the Authorization header).
//   2. POST { email: 'real@example.com' }.
//   3. We confirm the email is well-formed and unused.
//   4. With the service-role key we write:
//        auth.users.email          = new email
//        auth.users.email_confirmed_at = now()
//        public.users.email        = new email
//      and clear must_reset_pw if it was the first thing the member did.
//   5. Audit row written.
//
// Permission model:
//   - Members can only update their own row (caller auth_id == target).
//   - Administrators can update anyone (recovery path).
//
// Deploy:
//   supabase functions deploy set-member-email --no-verify-jwt

// @ts-nocheck  -- Deno runtime.
// deno-lint-ignore-file no-explicit-any

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

function isValidEmail(e: string | null | undefined): boolean {
  if (!e) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const auth = req.headers.get('authorization') ?? '';
  if (!auth.toLowerCase().startsWith('bearer ')) {
    return new Response('Unauthorized', { status: 401 });
  }
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: auth } } }
  );
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) return new Response('Unauthorized', { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { email?: string; target_user_id?: string };
  const newEmail = (body.email ?? '').trim().toLowerCase();
  if (!isValidEmail(newEmail)) {
    return new Response(JSON.stringify({ error: 'invalid email' }), {
      status: 400, headers: { 'content-type': 'application/json' },
    });
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // Resolve the caller's role and the target public.users.id.
  const { data: caller, error: callerErr } = await admin
    .from('users')
    .select('id, auth_id, role:roles(code)')
    .eq('auth_id', userData.user.id)
    .single();
  if (callerErr || !caller) return new Response('Forbidden', { status: 403 });
  const callerRole = (caller as any)?.role?.code;

  let targetPublicId = caller.id as string;
  if (body.target_user_id && body.target_user_id !== caller.id) {
    if (callerRole !== 'administrator') {
      return new Response('Forbidden', { status: 403 });
    }
    targetPublicId = body.target_user_id;
  }

  const { data: target, error: targetErr } = await admin
    .from('users')
    .select('id, auth_id, email, must_reset_pw')
    .eq('id', targetPublicId)
    .single();
  if (targetErr || !target) {
    return new Response(JSON.stringify({ error: 'target user not found' }), {
      status: 404, headers: { 'content-type': 'application/json' },
    });
  }

  // Refuse to clobber an existing account with that email (unless it's
  // already this user's email).
  const { data: existing } = await admin
    .from('users')
    .select('id')
    .eq('email', newEmail)
    .maybeSingle();
  if (existing && existing.id !== target.id) {
    return new Response(JSON.stringify({ error: 'email already in use' }), {
      status: 409, headers: { 'content-type': 'application/json' },
    });
  }

  // Update auth.users. Use admin.updateUserById so we can mark the email
  // confirmed without sending a confirmation link.
  const { error: authUpdErr } = await admin.auth.admin.updateUserById(
    target.auth_id,
    { email: newEmail, email_confirm: true }
  );
  if (authUpdErr) {
    return new Response(JSON.stringify({ error: authUpdErr.message }), {
      status: 400, headers: { 'content-type': 'application/json' },
    });
  }

  // Update public.users.
  const { error: publicUpdErr } = await admin
    .from('users')
    .update({ email: newEmail, must_reset_pw: false })
    .eq('id', target.id);
  if (publicUpdErr) {
    // Best-effort rollback of the auth row would risk clobbering data; just
    // surface the error.
    return new Response(JSON.stringify({ error: publicUpdErr.message }), {
      status: 400, headers: { 'content-type': 'application/json' },
    });
  }

  try {
    await admin.rpc('log_audit_event', {
      p_action: 'user.set_email',
      p_meta: {
        target_user_id: target.id,
        from_email: target.email,
        to_email: newEmail,
        via: body.target_user_id ? 'admin-recovery' : 'self',
        actor_role: callerRole,
      },
    });
  } catch (_) { /* ignore */ }

  return new Response(JSON.stringify({ ok: true, email: newEmail }), {
    headers: { 'content-type': 'application/json' },
  });
});
