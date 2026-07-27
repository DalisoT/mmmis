// Supabase Edge Function: create-user
//
// Admin-driven user creation. One round trip:
//   1. Validates the caller is an administrator.
//   2. Resolves the role_id from public.roles.
//   3. Calls auth.admin.createUser() with email_confirm: true, generating
//      a strong temporary password (or accepting one from the caller).
//   4. Inserts the matching public.users row in the same logical action.
//   5. Emails the new user their credentials.
//   6. Writes a user.create audit row.
//
// Deploy:
//   supabase functions deploy create-user --no-verify-jwt
// Then set MAILGUN_API_KEY / MAILGUN_DOMAIN / MAIL_FROM secrets.

// @ts-nocheck  -- Deno runtime.
// deno-lint-ignore-file no-explicit-any

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface CreateRequest {
  service_number: string;
  email: string;
  full_name: string;
  phone?: string | null;
  rank?: string | null;
  unit?: string | null;
  role_code: 'administrator' | 'treasurer' | 'barman' | 'member';
  /** Optional override; if omitted the function generates a strong random one. */
  password?: string;
  must_reset_pw?: boolean;
  is_active?: boolean;
}

const APP_URL = Deno.env.get('APP_URL') ?? 'https://mmmis.example.com';

function genTempPassword(): string {
  // 16 chars, mixed classes. Cryptographically secure.
  const alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const sym = '!@#$%^&*';
  const all = alpha + digits + sym;
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let out = '';
  // Guarantee at least one of each class.
  out += alpha[bytes[0] % alpha.length];
  out += digits[bytes[1] % digits.length];
  out += sym[bytes[2] % sym.length];
  for (let i = 3; i < 16; i++) out += all[bytes[i] % all.length];
  // Shuffle so the guaranteed classes aren't always at the front.
  const arr = out.split('');
  for (let i = arr.length - 1; i > 0; i--) {
    const j = bytes[i] % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.join('');
}

async function sendCredentialsEmail(
  to: string,
  fullName: string,
  serviceNumber: string,
  tempPassword: string,
  roleLabel: string
): Promise<{ ok: boolean; error?: string }> {
  const apiKey = Deno.env.get('MAILGUN_API_KEY');
  const domain = Deno.env.get('MAILGUN_DOMAIN');
  const from = Deno.env.get('MAIL_FROM') ?? `MMMIS <noreply@${domain ?? 'example.com'}>`;
  if (!apiKey || !domain) {
    // No SMTP configured — caller will still see the password in the
    // response so the admin can hand it over manually. This is the
    // explicit fallback the user requested.
    return { ok: false, error: 'mail_not_configured' };
  }
  const subject = `Welcome to MMMIS — your temporary password`;
  const text = [
    `Hello ${fullName},`,
    ``,
    `An account has been created for you in MMMIS (Military Mess Management Information System).`,
    ``,
    `  Service number : ${serviceNumber}`,
    `  Role           : ${roleLabel}`,
    `  Sign-in URL    : ${APP_URL}/login`,
    ``,
    `Your temporary password is:`,
    `  ${tempPassword}`,
    ``,
    `You will be asked to set a new password the first time you sign in.`,
    ``,
    `— MMMIS`,
  ].join('\n');
  const form = new FormData();
  form.append('from', from);
  form.append('to', to);
  form.append('subject', subject);
  form.append('text', text);
  const auth = 'Basic ' + btoa(`api:${apiKey}`);
  const res = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
    method: 'POST',
    headers: { Authorization: auth },
    body: form,
  });
  if (!res.ok) {
    const body = await res.text();
    return { ok: false, error: `mailgun_${res.status}:${body.slice(0, 200)}` };
  }
  return { ok: true };
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

  // Caller must be an administrator.
  const { data: caller } = await userClient
    .from('users')
    .select('role:roles(code)')
    .eq('auth_id', userData.user.id)
    .single();
  const callerRole = (caller as any)?.role?.code;
  if (callerRole !== 'administrator') return new Response('Forbidden', { status: 403 });

  const body: CreateRequest = await req.json();
  if (!body.service_number || !body.email || !body.full_name || !body.role_code) {
    return new Response(JSON.stringify({ error: 'service_number, email, full_name, role_code required' }), {
      status: 400, headers: { 'content-type': 'application/json' },
    });
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // 1. Resolve role_id.
  const { data: role, error: roleErr } = await admin
    .from('roles').select('id, name').eq('code', body.role_code).single();
  if (roleErr || !role) {
    return new Response(JSON.stringify({ error: 'Invalid role_code' }), {
      status: 400, headers: { 'content-type': 'application/json' },
    });
  }

  // 2. Create auth.users (email_confirm:true so no confirmation email is sent).
  const tempPassword = body.password && body.password.length >= 8 ? body.password : genTempPassword();
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: body.email.trim(),
    password: tempPassword,
    email_confirm: true,
    user_metadata: {
      service_number: body.service_number.trim(),
      full_name: body.full_name.trim(),
    },
  });
  if (createErr || !created?.user) {
    return new Response(JSON.stringify({ error: createErr?.message ?? 'createUser failed' }), {
      status: 400, headers: { 'content-type': 'application/json' },
    });
  }
  const authUserId = created.user.id;

  // 3. Insert public.users. If this fails we roll back the auth user so we
  // don't leave an orphan login.
  const { data: profile, error: profileErr } = await admin
    .from('users')
    .insert({
      auth_id: authUserId,
      service_number: body.service_number.trim(),
      full_name: body.full_name.trim(),
      email: body.email.trim(),
      phone: body.phone ?? null,
      role_id: role.id,
      rank: body.rank ?? null,
      unit: body.unit ?? null,
      is_active: body.is_active ?? true,
      must_reset_pw: body.must_reset_pw ?? true,
    })
    .select('id')
    .single();

  if (profileErr) {
    // Best-effort rollback.
    await admin.auth.admin.deleteUser(authUserId).catch(() => {});
    return new Response(JSON.stringify({ error: profileErr.message }), {
      status: 400, headers: { 'content-type': 'application/json' },
    });
  }

  // 4. Email the credentials. If mail isn't configured the temp_password
  // is still returned so the admin can communicate it.
  const mail = await sendCredentialsEmail(
    body.email.trim(),
    body.full_name.trim(),
    body.service_number.trim(),
    tempPassword,
    role.name,
  );

  // 5. Audit.
  try {
    await admin.rpc('log_audit_event', {
      p_action: 'user.create',
      p_meta: {
        service_number: body.service_number,
        email: body.email,
        role_code: body.role_code,
        via: 'create-user-edge',
        mailed: mail.ok,
      },
    });
  } catch (_) { /* ignore */ }

  return new Response(
    JSON.stringify({
      ok: true,
      user_id: profile.id,
      auth_id: authUserId,
      mailed: mail.ok,
      mail_error: mail.ok ? null : mail.error,
      temp_password: tempPassword,
    }),
    { headers: { 'content-type': 'application/json' } }
  );
});
