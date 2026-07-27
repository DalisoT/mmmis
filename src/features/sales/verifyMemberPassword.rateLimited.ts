import { supabase } from '@/lib/supabase';
import { logAudit } from '@/features/audit/audit';

const RATE_LIMIT_PER_5_MIN = 5;

export type VerifyResult = { ok: true; email: string } | { ok: false; error: string };

/**
 * Phase 8 hardening: rate-limited wrapper around verifyMemberPassword.
 *
 * 1. Asks the DB how many `chit.verify_password` attempts have hit the
 *    same service_number in the last 5 minutes.
 * 2. Refuses to attempt sign-in if the limit is hit; every refused attempt
 *    is itself audited so the administrator can spot probing.
 * 3. Otherwise delegates to the existing headless-client flow and audits
 *    the result (success or failure) via the public.log_audit_event RPC.
 *
 * The original verifyMemberPassword is left untouched so existing call
 * sites do not change behaviour; new call sites should prefer this.
 */
export async function verifyMemberPasswordRateLimited(
  serviceNumber: string,
  password: string
): Promise<VerifyResult> {
  const trimmed = serviceNumber.trim();

  const { data: recent } = await supabase.rpc('count_recent_chit_verifications', {
    p_service_number: trimmed,
    p_minutes: 5,
  });
  const count = Number(recent ?? 0);
  if (count >= RATE_LIMIT_PER_5_MIN) {
    await logAudit({
      action: 'chit.verify_password',
      meta: { service_number: trimmed, result: 'rate_limited', recent: count },
    });
    return { ok: false, error: 'Too many verification attempts. Please wait 5 minutes.' };
  }

  const { data: userRow, error: lookupErr } = await supabase
    .from('users')
    .select('email')
    .eq('service_number', trimmed)
    .is('deleted_at', null)
    .eq('is_active', true)
    .maybeSingle();

  if (lookupErr || !userRow?.email) {
    await logAudit({
      action: 'chit.verify_password',
      meta: { service_number: trimmed, result: 'unknown_user' },
    });
    return { ok: false, error: 'Member not found' };
  }

  const { createClient } = await import('@supabase/supabase-js');
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  const headless = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error: signInErr } = await headless.auth.signInWithPassword({
    email: userRow.email,
    password,
  });

  await logAudit({
    action: 'chit.verify_password',
    meta: {
      service_number: trimmed,
      result: signInErr ? 'failed' : 'success',
    },
  });

  if (signInErr) {
    await headless.auth.signOut();
    return { ok: false, error: signInErr.message };
  }
  await headless.auth.signOut();
  return { ok: true, email: userRow.email };
}