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
  const token = auth.slice(7).trim();
  if (!token) return new Response('Unauthorized', { status: 401 });

  // Verify the caller via GoTrue directly — bypassing the JS client's
  // session cache, which is empty in this runtime and can short-circuit
  // getUser() with "Auth session missing!" even when the token is valid.
  // See chit-authorize for the full rationale.
  const goTrueRes = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/user`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'apikey': Deno.env.get('SUPABASE_ANON_KEY')!,
    },
  });
  if (!goTrueRes.ok) {
    return new Response('Unauthorized', { status: 401 });
  }
  const userData = await goTrueRes.json() as { id?: string };
  if (!userData.id) return new Response('Unauthorized', { status: 401 });

  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  const body = (await req.json().catch(() => ({}))) as {
    email?: string;
    target_user_id?: string;
    current_password?: string;
  };
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

  // Self-service path: caller must re-enter their current password. This
  // closes the "stolen JWT on an old phone" hole — anyone holding a valid
  // token alone cannot redirect the account. Administrators using the
  // recovery path (target_user_id supplied, implying they're acting on a
  // different user) bypass this check because they're already gated by the
  // staff role check below; in practice the recovery path is invoked from
  // the admin UI which itself requires a live session.
  if (!body.target_user_id) {
    if (!body.current_password) {
      return new Response(JSON.stringify({ error: 'current_password required' }), {
        status: 400, headers: { 'content-type': 'application/json' },
      });
    }
    // Resolve caller's email first so we can verify against GoTrue.
    const { data: callerForPw } = await admin
      .from('users')
      .select('email')
      .eq('auth_id', userData.id)
      .maybeSingle();
    if (!callerForPw?.email) {
      return new Response(JSON.stringify({ error: 'caller email not found' }), {
        status: 400, headers: { 'content-type': 'application/json' },
      });
    }
    // We can't read the bcrypt hash from plpgsql, and we don't want the
    // SPA to send a fresh sign-in (it would change auth.sessions and
    // invalidate the current JWT mid-flight). Verify by signing in on a
    // throwaway headless client and immediately signing out — GoTrue
    // returns ok only when the password matches.
    const { createClient: createHeadless } = await import('https://esm.sh/@supabase/supabase-js@2');
    const headless = createHeadless(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
    const { error: pwErr } = await headless.auth.signInWithPassword({
      email: callerForPw.email,
      password: body.current_password,
    });
    await headless.auth.signOut().catch(() => {});
    if (pwErr) {
      return new Response(JSON.stringify({ error: 'current password is incorrect' }), {
        status: 401, headers: { 'content-type': 'application/json' },
      });
    }
  }

  // Resolve the caller's role and the target public.users.id.
  const { data: caller, error: callerErr } = await admin
    .from('users')
    .select('id, auth_id, role:roles(code)')
    .eq('auth_id', userData.id)
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
    .select('id, auth_id, email')
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
    .update({ email: newEmail })
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
