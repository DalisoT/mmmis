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
  // CORS preflight — short-circuit before the POST handler.
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const auth = req.headers.get('authorization') ?? '';
  if (!auth.toLowerCase().startsWith('bearer ')) {
    return json({ error: 'Unauthorized' }, 401);
  }
  const token = auth.slice(7).trim();
  if (!token) return json({ error: 'Unauthorized' }, 401);

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
    const detail = await goTrueRes.text().catch(() => '');
    return json(
      { error: `Unauthorized: GoTrue ${goTrueRes.status}${detail ? `: ${detail.slice(0, 200)}` : ''}` },
      401,
    );
  }
  const userData = await goTrueRes.json() as { id?: string };
  if (!userData.id) return json({ error: 'Unauthorized: empty user payload' }, 401);

  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  // Administrator only.
  const { data: caller } = await userClient
    .from('users').select('role:roles(code)').eq('auth_id', userData.id).single();
  const callerRole = (caller as any)?.role?.code;
  if (callerRole !== 'administrator') return json({ error: 'Forbidden' }, 403);

  const body: ResetRequest = await req.json();
  if (!body.user_id) {
    return json({ error: 'user_id required' }, 400);
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const { data: target, error: targetErr } = await admin
    .from('users').select('id, auth_id, email, full_name').eq('id', body.user_id).single();
  if (targetErr || !target?.auth_id) {
    return json({ error: 'User not found' }, 404);
  }

  const temp = body.password && body.password.length >= 8 ? body.password : genTempPassword();
  const { error: updErr } = await admin.auth.admin.updateUserById(target.auth_id, { password: temp });
  if (updErr) {
    return json({ error: updErr.message }, 400);
  }

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

  return json({ ok: true, mailed, temp_password: temp });
});
