import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { BrandLockup } from '@/components/brand/BrandMark';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/lib/supabase';
import { toast } from '@/lib/toast';

/**
 * /reset-password
 *
 * Lands here after the user clicks the recovery link emailed by the
 * password-reset Edge Function. Supabase's hosted auth flow redirects
 * to APP_URL with a fragment containing access_token + type=recovery;
 * the JS client (configured with detectSessionInUrl: true in
 * src/lib/supabase.ts) parses the fragment and fires
 * `onAuthStateChange('PASSWORD_RECOVERY', session)`.
 *
 * This page subscribes to that event, swaps in a "set new password"
 * form, calls supabase.auth.updateUser({ password }), then redirects
 * to /login.
 *
 * If the user arrives without a recovery event in flight, we show a
 * "link invalid or expired" panel and a back-to-login link.
 */

const schema = z
  .object({
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirm: z.string().min(8, 'Password must be at least 8 characters'),
  })
  .refine((data) => data.password === data.confirm, {
    message: 'Passwords do not match',
    path: ['confirm'],
  });
type FormValues = z.infer<typeof schema>;

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  useEffect(() => {
    // onAuthStateChange is the only reliable signal that the recovery
    // link was valid: Supabase's hosted flow only writes the access
    // token to the URL fragment when the link is unexpired and unused.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setRecoveryReady(true);
      }
    });

    // Fallback: if the user lands here WITHOUT a recovery event within
    // ~3s (e.g. they navigated directly, or the link was already used),
    // show the invalid-link panel. Supabase's hosted redirect flow
    // parses the fragment synchronously, so the event fires well
    // before this timeout.
    const t = window.setTimeout(() => {
      setRecoveryReady((ready) => {
        if (!ready) setInvalid(true);
        return ready;
      });
    }, 3000);

    return () => {
      sub.subscription.unsubscribe();
      window.clearTimeout(t);
    };
  }, []);

  const onSubmit = handleSubmit(async (values) => {
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: values.password });
      if (error) throw error;
      setSuccess(true);
      toast.success('Password updated. Sign in with your new password.');
      // Sign out so the next /login is a clean form, not an auto-redirect.
      await supabase.auth.signOut();
      window.setTimeout(() => navigate('/login', { replace: true }), 1500);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update password');
    } finally {
      setSubmitting(false);
    }
  });

  // 1. Link invalid or expired.
  if (invalid) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <Card className="w-full max-w-sm">
          <CardHeader className="space-y-4 text-center">
            <BrandLockup />
            <CardTitle className="text-xl">Reset link invalid</CardTitle>
            <CardDescription>
              This password reset link is invalid or has expired. Request a new one from the sign-in page.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button asChild variant="outline" className="w-full">
              <Link to="/login"><ArrowLeft className="mr-2 h-4 w-4" /> Back to sign in</Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  // 2. Success — show a brief confirmation before redirecting.
  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <Card className="w-full max-w-sm">
          <CardHeader className="space-y-4 text-center">
            <BrandLockup />
            <CheckCircle2 className="mx-auto h-10 w-10 text-green-600" />
            <CardTitle className="text-xl">Password updated</CardTitle>
            <CardDescription>Redirecting you to sign in…</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  // 3. Recovery event detected — show the new-password form.
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-4 text-center">
          <BrandLockup />
          <CardTitle className="text-xl">Set a new password</CardTitle>
          <CardDescription>
            Choose a new password for your account. At least 8 characters.
          </CardDescription>
        </CardHeader>
        <form onSubmit={onSubmit} noValidate>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">New password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                {...register('password')}
                aria-invalid={!!errors.password}
              />
              {errors.password && (
                <p className="text-xs text-destructive">{errors.password.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm">Confirm new password</Label>
              <Input
                id="confirm"
                type="password"
                autoComplete="new-password"
                {...register('confirm')}
                aria-invalid={!!errors.confirm}
              />
              {errors.confirm && (
                <p className="text-xs text-destructive">{errors.confirm.message}</p>
              )}
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-2">
            <Button
              type="submit"
              className="w-full"
              disabled={submitting || !recoveryReady}
            >
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Update password
            </Button>
            <Button asChild variant="ghost" className="w-full">
              <Link to="/login"><ArrowLeft className="mr-2 h-4 w-4" /> Back to sign in</Link>
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}