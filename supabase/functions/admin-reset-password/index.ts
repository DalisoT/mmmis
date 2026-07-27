// Supabase Edge Function: admin-reset-password
//
// Resets a user's password (admin-initiated) and emails them the new
// temporary password. Generates a strong 16-char password on the server
// unless the admin supplies one.
//
// Deploy:
//   supabase functions deploy admin-reset-password --no-verify-jwt

// @ts-nocheck  -- Deno runtime.
// deno-lint-ignore-file no-explicit-any

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface ResetRequest {
  user_id: string;            // public.users.id
  password?: string;          // optional override
  send_email?: boolean;       // default true
}

function genTempPassword(): string {
  const alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const sym = '!@#$%^&*';
  const all = alpha + digits + sym;
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let out = '';
  out += alpha[bytes[0] % alpha.length];
  out += digits[bytes[1] % digits.length];
  out += sym[bytes[2] % sym.length];
  for (let i = 3; i < 16; i++) out += all[bytes[i] % all.length];
  const arr = out.split('');
  for (let i = arr.length - 1; i > 0; i--) {
    const j = bytes[i] % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.join('');
}

async function sendEmail(to: string, fullName: string, temp: string): Promise<boolean> {
  const apiKey = Deno.env.get('MAILGUN_API_KEY');
  const domain = Deno.env.get('MAILGUN_DOMAIN');
  const from = Deno.env.get('MAIL_FROM') ?? `MMMIS <noreply@${domain ?? 'example.com'}>`;
  if (!apiKey || !domain) return false;
  const subject = 'Your MMMIS password was reset';
  const text =
    `Hello ${fullName},\n\n` +
    `Your MMMIS password has been reset. Your new temporary password is:\n\n` +
    `  ${temp}\n\n` +
    `Sign in and change it immediately.\n\n— MMMIS`;
  const form = new FormData();
  form.append('from', from);
  form.append('to', to);
  form.append('subject', subject);
  form.append('text', text);
  const res = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + btoa(`api:${apiKey}`) },
    body: form,
  });
  return res.ok;
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

  // Administrator only.
  const { data: caller } = await userClient
    .from('users').select('role:roles(code)').eq('auth_id', userData.user.id).single();
  const callerRole = (caller as any)?.role?.code;
  if (callerRole !== 'administrator') return new Response('Forbidden', { status: 403 });

  const body: ResetRequest = await req.json();
  if (!body.user_id) {
    return new Response(JSON.stringify({ error: 'user_id required' }), {
      status: 400, headers: { 'content-type': 'application/json' },
    });
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const { data: target, error: targetErr } = await admin
    .from('users').select('id, auth_id, email, full_name').eq('id', body.user_id).single();
  if (targetErr || !target?.auth_id) {
    return new Response(JSON.stringify({ error: 'User not found' }), {
      status: 404, headers: { 'content-type': 'application/json' },
    });
  }

  const temp = body.password && body.password.length >= 8 ? body.password : genTempPassword();
  const { error: updErr } = await admin.auth.admin.updateUserById(target.auth_id, { password: temp });
  if (updErr) {
    return new Response(JSON.stringify({ error: updErr.message }), {
      status: 400, headers: { 'content-type': 'application/json' },
    });
  }

  // Flip must_reset_pw so the next login forces a change.
  await admin.from('users').update({ must_reset_pw: true }).eq('id', target.id);

  let mailed = false;
  if (body.send_email !== false && target.email) {
    mailed = await sendEmail(target.email, target.full_name, temp);
  }

  try {
    await admin.rpc('log_audit_event', {
      p_action: 'user.password_reset',
      p_meta: { target_user_id: target.id, via: 'admin-reset-password', mailed },
    });
  } catch (_) { /* ignore */ }

  return new Response(
    JSON.stringify({ ok: true, mailed, temp_password: temp }),
    { headers: { 'content-type': 'application/json' } }
  );
});
