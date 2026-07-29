// Supabase Edge Function: bootstrap-admin
//
// One-shot promotion of an EXISTING user to the administrator role.
// Use case: after a clean-slate wipe (see 0030_wipe_test_data.sql +
// admin-wipe-auth-users) the deployment has zero administrators, so the
// normal admin-only code paths are unreachable. This function provides a
// secure, audited, fail-closed way to promote the first admin.
//
// Flow:
//   1. The new admin signs up at /register (creates auth.users + public.users
//      with role = member, via fn_handle_new_auth_user() trigger).
//   2. An operator runs this function with that user's email.
//   3. The function updates public.users.role_id to the administrator row.
//
// Safety:
//   * The function refuses to run unless an X-Bootstrap-Secret header
//     matches the BOOTSTRAP_SECRET env var. If the secret is unset, the
//     function 503s — fail closed.
//   * The function refuses to run if any administrator already exists
//     in public.users (returns 409 Conflict with the existing admin's
//     email). This prevents accidental re-promotion or demotion after
//     bootstrap is done; once an admin exists, normal admin tooling
//     (Users page, etc.) should be used instead.
//   * Only promotes; never demotes or deletes users.
//   * Idempotent — re-running against the same user just re-asserts the
//     administrator role.
//
// Deploy:
//   supabase functions deploy bootstrap-admin --no-verify-jwt
//   supabase secrets set BOOTSTRAP_SECRET="$(openssl rand -hex 32)"
//
// Run (PowerShell):
//   $secret = "..."   # the value you just set above
//   $email  = "the.new.admin@example.com"
//   $body   = @{ email = $email } | ConvertTo-Json
//   Invoke-RestMethod -Method Post \
//     -Uri "$env:SUPABASE_URL/functions/v1/bootstrap-admin" \
//     -Headers @{ "X-Bootstrap-Secret" = $secret } \
//     -ContentType "application/json" -Body $body
//
// After the first admin exists, you can unset BOOTSTRAP_SECRET and the
// function will 503 forever. It is intentionally a "fire once" hand-grenade.

// @ts-nocheck  -- Deno runtime.
// deno-lint-ignore-file no-explicit-any

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info, x-bootstrap-secret',
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

  // 1. Hard gate on the bootstrap secret.
  const expected = Deno.env.get('BOOTSTRAP_SECRET');
  if (!expected) {
    return json({ error: 'BOOTSTRAP_SECRET not configured on the function' }, 503);
  }
  const supplied = req.headers.get('x-bootstrap-secret') ?? '';
  if (supplied.length === 0 || supplied !== expected) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const body = await req.json().catch(() => ({} as any));
  const targetEmail = (body?.email ?? '').trim().toLowerCase();
  const targetPublicId: string | undefined = body?.public_user_id;

  if (!targetEmail && !targetPublicId) {
    return json({ error: 'email or public_user_id required' }, 400);
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  // 2. Refuse if an administrator already exists.
  const { data: existingAdmin, error: existingErr } = await admin
    .from('users')
    .select('id, email, role:roles(code)')
    .eq('is_active', true)
    .is('deleted_at', null)
    .limit(1);
  if (existingErr) {
    return json({ error: `Failed to enumerate users: ${existingErr.message}` }, 500);
  }
  for (const row of existingAdmin ?? []) {
    const code = (row as any)?.role?.code;
    if (code === 'administrator') {
      return json({
        error: 'An administrator already exists. Use normal admin tooling (Users page) to change roles.',
        existing_admin: { id: (row as any).id, email: (row as any).email },
      }, 409);
    }
  }

  // 3. Resolve the target public.users row.
  let target: any = null;
  if (targetPublicId) {
    const { data, error } = await admin
      .from('users')
      .select('id, auth_id, email, is_active, deleted_at, role:roles(code)')
      .eq('id', targetPublicId)
      .maybeSingle();
    if (error) return json({ error: `Lookup failed: ${error.message}` }, 500);
    target = data;
  } else {
    const { data, error } = await admin
      .from('users')
      .select('id, auth_id, email, is_active, deleted_at, role:roles(code)')
      .ilike('email', targetEmail)
      .maybeSingle();
    if (error) return json({ error: `Lookup failed: ${error.message}` }, 500);
    target = data;
  }

  if (!target) {
    return json({ error: 'Target user not found in public.users. They must /register first.' }, 404);
  }
  if (!target.auth_id) {
    return json({ error: 'Target user has no auth_id (orphan public row).' }, 400);
  }
  if (target.is_active === false || target.deleted_at) {
    return json({ error: 'Target user is inactive or deleted.' }, 400);
  }

  // 4. Look up the administrator role id.
  const { data: role, error: roleErr } = await admin
    .from('roles')
    .select('id, code, name')
    .eq('code', 'administrator')
    .single();
  if (roleErr || !role) {
    return json({ error: 'administrator role missing from public.roles' }, 500);
  }

  // 5. Promote.
  const { error: updErr } = await admin
    .from('users')
    .update({ role_id: role.id, updated_at: new Date().toISOString() })
    .eq('id', target.id);
  if (updErr) {
    return json({ error: `Update failed: ${updErr.message}` }, 500);
  }

  // 6. Audit.
  try {
    await admin.rpc('log_audit_event', {
      p_action: 'bootstrap.admin_promote',
      p_meta: {
        target_user_id: target.id,
        target_email: target.email,
        previous_role: (target as any)?.role?.code ?? null,
        via: 'bootstrap-admin-edge',
      },
    });
  } catch (_) { /* ignore — audit is best-effort */ }

  return json({
    ok: true,
    promoted_user_id: target.id,
    promoted_email: target.email,
    role_code: 'administrator',
    promoted_at: new Date().toISOString(),
  });
});