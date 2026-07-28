// Supabase Edge Function: bulk-seed-members
//
// Admin-only one-shot path for onboarding many mess members at once. Pairs
// with migration 0023_bulk_member_seed.sql.
//
// Flow:
//   1. Caller (admin) populates public.bulk_member_seed (e.g. via SQL
//      Editor + COPY).
//   2. POST this function with { dry_run?: boolean }.
//   3. dry_run=true  -> validate every row, return JSON report, do not write.
//   4. dry_run=false -> for each row:
//        a. Resolve role_id for 'member'.
//        b. Call auth.admin.createUser with email_confirm:true, a generated
//           temp password, and user_metadata = { bulk_seed:'1', ... }.
//           The fn_handle_new_auth_user() trigger (extended in 0023)
//           materialises public.users + public.members atomically.
//        c. Stamp bulk_member_seed.status='seeded' with the new auth_id.
//        d. On conflict (auth email already taken, or partial unique on
//           service_number blocks), mark 'skipped' with the error message.
//   5. After the loop, call bulk_member_seed_clear() and write one
//      'bulk_member_seed' audit row summarising counts.
//
// Deploy:
//   supabase functions deploy bulk-seed-members --no-verify-jwt

// @ts-nocheck  -- Deno runtime.
// deno-lint-ignore-file no-explicit-any

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

/** Strip a leading salutation ("MR", "MRS", "MS", "DR") from a name string. */
function stripSalutation(name: string, salutation: string | null): string {
  if (!name) return name;
  if (!salutation) return name;
  const re = new RegExp(`^${salutation}\\s+`, 'i');
  return name.replace(re, '').trim();
}

/** Best-effort first/last split for an admin preview. Mirrors parse_name_for_bulk_seed(). */
function splitName(name: string, salutation: string | null): { first: string; last: string; normalised: string } {
  const normalised = stripSalutation(name, salutation).replace(/\s+/g, ' ').trim();
  const tokens = normalised.split(' ').filter(Boolean);
  if (tokens.length === 0) return { first: '', last: '', normalised };
  if (tokens.length === 1) return { first: tokens[0], last: '', normalised };
  return { first: tokens[0], last: tokens.slice(1).join(' '), normalised };
}

interface StagingRow {
  id: number;
  service_number: string;
  rank: string | null;
  name: string;
  salutation: string | null;
  email: string | null;
}

interface SeedReport {
  ok: boolean;
  dry_run: boolean;
  total: number;
  seeded: number;
  skipped: number;
  failed: number;
  credentials: Array<{ service_number: string; email: string; temp_password: string; placeholder_email: boolean }>;
  errors: Array<{ service_number: string; message: string }>;
  previews: Array<{
    service_number: string;
    first_name: string;
    last_name: string;
    email_provided: string | null;
    email_to_use: string;
    email_was_placeholder: boolean;
  }>;
}

function isValidEmail(e: string | null | undefined): boolean {
  if (!e) return false;
  // Pragmatic — Supabase auth uses the same loose check.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

/**
 * Resolve the email address to use for a given row.
 *   - If the CSV provided a valid email, use it.
 *   - Otherwise derive a placeholder "<service_no>@<domain>". The member can
 *     later sign in and update the real email from /portal/profile; the
 *     placeholder is just a unique auth.users.email so the unique constraint
 *     is satisfied.
 */
const PLACEHOLDER_EMAIL_DOMAIN =
  Deno.env.get('PLACEHOLDER_EMAIL_DOMAIN') ?? 'mess.zm.local';

function resolveEmail(row: StagingRow): { email: string; placeholder: boolean } {
  const provided = row.email?.trim();
  if (provided && isValidEmail(provided)) {
    return { email: provided.toLowerCase(), placeholder: false };
  }
  // Strip leading zeros so 003678 doesn't look like a number to some MTAs.
  const svc = row.service_number.replace(/^0+/, '') || row.service_number;
  return { email: `${svc}@${PLACEHOLDER_EMAIL_DOMAIN}`, placeholder: true };
}

async function sendCredentialsEmail(
  to: string,
  fullName: string,
  serviceNumber: string,
  tempPassword: string
): Promise<{ ok: boolean; error?: string }> {
  const apiKey = Deno.env.get('MAILGUN_API_KEY');
  const domain = Deno.env.get('MAILGUN_DOMAIN');
  const from = Deno.env.get('MAIL_FROM') ?? `MMMIS <noreply@${domain ?? 'example.com'}>`;
  if (!apiKey || !domain) return { ok: false, error: 'mail_not_configured' };
  const subject = `Welcome to MMMIS — your temporary password`;
  const text = [
    `Hello ${fullName},`,
    ``,
    `An MMMIS (Military Mess Management Information System) account has been created for you.`,
    ``,
    `  Service number : ${serviceNumber}`,
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

  // 1. Auth: caller must be an administrator.
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
  const { data: caller } = await userClient
    .from('users')
    .select('role:roles(code)')
    .eq('auth_id', userData.id)
    .single();
  const callerRole = (caller as any)?.role?.code;
  if (callerRole !== 'administrator') return new Response('Forbidden', { status: 403 });

  // 2. Body.
  const body = (await req.json().catch(() => ({}))) as { dry_run?: boolean; send_email?: boolean };
  const dryRun = body.dry_run !== false;  // default true (safe)
  const sendEmail = body.send_email === true;

  // 3. Admin client.
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // 4. Load staging rows.
  const { data: rows, error: rowsErr } = await admin
    .from('bulk_member_seed')
    .select('id, service_number, rank, name, salutation, email')
    .eq('status', 'pending')
    .order('id', { ascending: true });
  if (rowsErr) {
    return new Response(JSON.stringify({ error: rowsErr.message }), {
      status: 400, headers: { 'content-type': 'application/json' },
    });
  }
  const staging = (rows ?? []) as StagingRow[];
  const report: SeedReport = {
    ok: true,
    dry_run: dryRun,
    total: staging.length,
    seeded: 0,
    skipped: 0,
    failed: 0,
    credentials: [],
    errors: [],
    previews: [],
  };

  // 5. dry_run path: validate everything, return preview, no writes.
  if (dryRun) {
    for (const r of staging) {
      const split = splitName(r.name, r.salutation);
      const resolved = resolveEmail(r);
      report.previews.push({
        service_number: r.service_number,
        first_name: split.first,
        last_name: split.last,
        email_provided: r.email?.trim() || null,
        email_to_use: resolved.email,
        email_was_placeholder: resolved.placeholder,
      });
      if (!split.first) {
        report.failed += 1;
        report.errors.push({
          service_number: r.service_number,
          message: 'name produced empty first_name',
        });
      }
    }
    return new Response(JSON.stringify(report, null, 2), {
      headers: { 'content-type': 'application/json' },
    });
  }

  // 6. Real run: loop and createUser.
  for (const r of staging) {
    const split = splitName(r.name, r.salutation);
    if (!split.first) {
      report.failed += 1;
      report.errors.push({
        service_number: r.service_number,
        message: 'name produced empty first_name',
      });
      await admin.from('bulk_member_seed')
        .update({ status: 'failed', message: 'validation: empty first_name' })
        .eq('id', r.id);
      continue;
    }

    const resolved = resolveEmail(r);
    const tempPassword = genTempPassword();
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: resolved.email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: {
        bulk_seed: '1',
        service_number: r.service_number.trim(),
        full_name: split.normalised,
        rank: r.rank ?? null,
      },
    });
    if (createErr || !created?.user) {
      report.failed += 1;
      const msg = createErr?.message ?? 'createUser failed';
      report.errors.push({ service_number: r.service_number, message: msg });
      await admin.from('bulk_member_seed')
        .update({ status: 'failed', message: msg })
        .eq('id', r.id);
      continue;
    }
    const authId = created.user.id;

    // Wait briefly for the AFTER INSERT trigger on auth.users to fire, then
    // check whether public.users + public.members were materialised.
    let seeded = false;
    for (let i = 0; i < 20 && !seeded; i++) {
      const { data: u } = await admin.from('users')
        .select('id').eq('auth_id', authId).maybeSingle();
      if (u?.id) {
        seeded = true;
        await admin.from('bulk_member_seed').update({
          status: 'seeded',
          created_user_id: u.id,
          message: `auth=${authId}${resolved.placeholder ? ' (placeholder email)' : ''}`,
        }).eq('id', r.id);
      } else {
        await new Promise((r) => setTimeout(r, 150));
      }
    }
    if (!seeded) {
      report.failed += 1;
      report.errors.push({ service_number: r.service_number, message: 'trigger did not materialise public.users within 3s' });
      await admin.from('bulk_member_seed')
        .update({ status: 'failed', message: 'no public.users after trigger' })
        .eq('id', r.id);
      // Best-effort cleanup of the orphaned auth user.
      await admin.auth.admin.deleteUser(authId).catch(() => {});
      continue;
    }

    report.seeded += 1;
    report.credentials.push({
      service_number: r.service_number,
      email: resolved.email,
      temp_password: tempPassword,
      placeholder_email: resolved.placeholder,
    });

    if (sendEmail && !resolved.placeholder) {
      // Skip email for placeholder rows — there's nothing to deliver to.
      await sendCredentialsEmail(resolved.email, split.normalised, r.service_number, tempPassword)
        .catch(() => {});
    }
  }

  // 7. Audit + clear staging.
  const placeholderCount = report.credentials.filter((c) => c.placeholder_email).length;
  try {
    await admin.rpc('log_audit_event', {
      p_action: 'bulk_member_seed',
      p_meta: {
        total: report.total,
        seeded: report.seeded,
        skipped: report.skipped,
        failed: report.failed,
        placeholder_emails: placeholderCount,
        emailed: sendEmail,
        first_credentials_count: report.credentials.length,
      },
    });
  } catch (_) { /* ignore */ }

  try {
    await admin.rpc('bulk_member_seed_clear');
  } catch (_) { /* ignore — leave rows for the admin to inspect if clear fails */ }

  return new Response(JSON.stringify(report, null, 2), {
    headers: { 'content-type': 'application/json' },
  });
});
