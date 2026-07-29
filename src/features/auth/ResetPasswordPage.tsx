import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2, KeyRound, AlertCircle, CheckCircle2, ArrowLeft } from 'lucide-react';
import { BrandLockup } from '@/components/brand/BrandMark';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/lib/supabase';
import { toast } from '@/lib/toast';
import { useAuth } from './AuthContext';

/**
 * Password rules. Mirrored exactly from MemberProfilePage so the same
 * password works whether the user changes it from /portal/profile or is
 * redirected here from the must_reset_pw guard or recovery flow.
 */
function passwordChecks(pw: string) {
  return {
    length: pw.length >= 8,
    upper: /[A-Z]/.test(pw),
    lower: /[a-z]/.test(pw),
    digit: /[0-9]/.test(pw),
  };
}

function PwRule({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className={`flex items-center gap-1 ${ok ? 'text-emerald-600' : 'text-muted-foreground'}`}>
      {ok ? <CheckCircle2 className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
      {label}
    </li>
  );
}

/**
 * Three entry paths land here:
 *  1. ProtectedRoute redirected because `must_reset_pw = true`. The user
 *     is authenticated and `user.must_reset_pw === true`.
 *  2. User clicked the link in the recovery email. The auth listener
 *     fires `PASSWORD_RECOVERY`, the user lands on `/login?reset=1`, and
 *     we route them here because `recoveryEventPending` is true. The
 *     user is authenticated but `must_reset_pw` may be either value.
 *  3. The admin reset flow: admin clicked "Reset password" in the user
 *     dialog, which sends a Mailgun email containing a temp password.
 *     On next login, `must_reset_pw` is set and they land here via path 1.
 *
 * On submit we:
 *  - call `supabase.auth.updateUser({ password })`
 *  - clear `public.users.must_reset_pw = false` (via the existing
 *    `users_self_update` RLS policy; the user is authenticated at this
 *    point in all three paths)
 *  - call `refreshUser()` so the in-memory profile reflects the flag flip
 *  - clear the recovery-event flag in context
 *  - navigate to /
 */
export function ResetPasswordPage() {
  const navigate = useNavigate();
  const { user, recoveryEventPending, clearRecoveryEventPending, refreshUser, signOut } = useAuth();

  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  // We render this page outside ProtectedRoute, so it has to handle the
  // "user opened /reset-password directly without being signed in" case
  // by itself. The only legitimate way to get here without a session is
  // if the user types the URL manually (or has it bookmarked from a
  // previous session). Show a friendly nudge.
  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      setAuthChecked(true);
      if (!data.session) {
        // No session and no recovery event pending → the user got here
        // the wrong way. Send them to /login.
        navigate('/login', { replace: true });
      }
    })();
    return () => {
      active = false;
    };
  }, [navigate]);

  // Acknowledge the recovery flag as soon as we've rendered so a hard
  // refresh on /reset-password doesn't re-fire the prompt.
  useEffect(() => {
    if (recoveryEventPending) clearRecoveryEventPending();
    // We deliberately only fire once on mount; we don't want to clear
    // again if the user opens the page a second time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checks = useMemo(() => passwordChecks(newPw), [newPw]);
  const allChecksPass = checks.length && checks.upper && checks.lower && checks.digit;
  const confirmError = confirmPw.length > 0 && newPw !== confirmPw;
  const canSubmit = authChecked && allChecksPass && newPw === confirmPw && !submitting;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        throw new Error('Your session has expired. Please request a new reset link.');
      }

      // 1. Set the new password on the auth user.
      const { error: updErr } = await supabase.auth.updateUser({ password: newPw });
      if (updErr) throw updErr;

      // 2. Clear must_reset_pw on the public.users row. RLS allows it
      //    via users_self_update (auth_id = auth.uid()).
      const { error: clearErr } = await supabase
        .from('users')
        .update({ must_reset_pw: false })
        .eq('auth_id', sess.session.user.id);
      // Soft-fail this step — the password has been changed, which is
      // what matters. The user may end up redirected again on next
      // login; we surface an error and proceed.
      if (clearErr) {
        // eslint-disable-next-line no-console
        console.warn('Could not clear must_reset_pw flag', clearErr);
        toast.error(
          'Password updated, but a flag in your profile could not be cleared. If you are asked to reset again on next login, contact the administrator.',
        );
      } else {
        toast.success('Password updated. Redirecting...');
      }

      // 3. Re-fetch the profile so the in-memory copy of must_reset_pw
      //    reflects the DB. Without this the guard would loop.
      await refreshUser();

      // 4. Sign out cleanly to avoid any stale session quirks from the
      //    recovery-link flow — the guard-free /reset-password route is
      //    reached only once, and the user can re-auth with the new
      //    password immediately.
      await signOut();
      navigate('/login', { replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update password');
    } finally {
      setSubmitting(false);
    }
  };

  // Friendly headline telling the user WHY they're here.
  // (If they got here from a stale bookmark, the no-session useEffect
  // above will redirect them to /login before they ever see this.)
  const headline = user?.must_reset_pw
    ? {
        title: 'Set a new password',
        body: 'Your administrator created your account with a temporary password. Choose a new one before continuing.',
      }
    : {
        title: 'Set a new password',
        body: 'You are signed in with a one-time recovery session. Choose a new password to replace the old one.',
      };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-4 text-center">
          <BrandLockup />
          <CardTitle className="text-xl">
            <KeyRound className="mr-2 inline h-5 w-5" />
            {headline.title}
          </CardTitle>
          <CardDescription>{headline.body}</CardDescription>
        </CardHeader>
        <form onSubmit={onSubmit} noValidate>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-pw">New password</Label>
              <Input
                id="new-pw"
                type="password"
                autoComplete="new-password"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                minLength={8}
                required
                aria-describedby="pw-strength"
              />
              {newPw.length > 0 && (
                <ul id="pw-strength" className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-xs">
                  <PwRule ok={checks.length} label="8+ characters" />
                  <PwRule ok={checks.upper} label="Uppercase" />
                  <PwRule ok={checks.lower} label="Lowercase" />
                  <PwRule ok={checks.digit} label="Digit" />
                </ul>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-pw">Confirm new password</Label>
              <Input
                id="confirm-pw"
                type="password"
                autoComplete="new-password"
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
                minLength={8}
                required
                aria-invalid={confirmError || undefined}
              />
              {confirmError && (
                <p className="flex items-center gap-1 text-xs text-destructive">
                  <AlertCircle className="h-3 w-3" />
                  Passwords do not match.
                </p>
              )}
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-2">
            <Button type="submit" className="w-full" disabled={!canSubmit}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save new password
            </Button>
            <Button
              asChild
              variant="ghost"
              className="w-full"
              type="button"
            >
              <Link to="/login">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Sign out and return to login
              </Link>
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
