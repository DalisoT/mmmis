import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { PasswordInput } from '@/components/ui/password-input';
import { BrandLockup } from '@/components/brand/BrandMark';
import { supabase } from '@/lib/supabase';
import { toast } from '@/lib/toast';

const registerSchema = z.object({
  service_number: z.string()
    .min(3, 'Service number is required')
    .regex(/^[A-Za-z0-9-]+$/, 'Letters, numbers and dashes only'),
  full_name: z.string().min(2, 'Full name is required'),
  email: z.string().email('Valid email is required'),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Add at least one uppercase letter')
    .regex(/[a-z]/, 'Add at least one lowercase letter')
    .regex(/[0-9]/, 'Add at least one number'),
  confirm: z.string(),
}).refine((d) => d.password === d.confirm, {
  message: 'Passwords do not match',
  path: ['confirm'],
});
type RegisterValues = z.infer<typeof registerSchema>;

export function RegisterPage() {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const {
    register, handleSubmit,
    formState: { errors },
  } = useForm<RegisterValues>({ resolver: zodResolver(registerSchema) });

  const onSubmit = handleSubmit(async (values) => {
    setSubmitting(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: values.email.trim(),
        password: values.password,
        options: {
          data: {
            service_number: values.service_number.trim(),
            full_name: values.full_name.trim(),
            self_register: true,
          },
        },
      });
      if (error) throw error;

      // Supabase returns a user but with a null session when email
      // confirmation is required. The trigger we added in
      // supabase/migrations/0015_phase15_member_self_signup.sql will have
      // already created the public.users + public.members rows.
      if (data.session) {
        toast.success('Account created. You are now signed in.');
        navigate('/portal', { replace: true });
      } else {
        setDone(true);
        toast.success('Account created. Check your email to confirm, then sign in.');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create account');
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-4 text-center">
          <BrandLockup />
          <CardTitle className="text-xl">Create your account</CardTitle>
          <CardDescription>
            Register as a mess member. Your administrator will add rank and unit details after sign-up.
          </CardDescription>
        </CardHeader>
        {done ? (
          <CardContent className="space-y-3 text-sm">
            <p className="rounded-md border bg-muted/40 p-3">
              Your account has been created. Check your inbox for a confirmation email, then sign in.
            </p>
            <Button asChild variant="outline" className="w-full">
              <Link to="/login"><ArrowLeft className="mr-2 h-4 w-4" /> Back to sign in</Link>
            </Button>
          </CardContent>
        ) : (
          <form onSubmit={onSubmit} noValidate>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="service_number">Service number</Label>
                <Input
                  id="service_number"
                  autoComplete="username"
                  placeholder="e.g. ZM-12345"
                  {...register('service_number')}
                  aria-invalid={!!errors.service_number}
                />
                {errors.service_number && (
                  <p className="text-xs text-destructive">{errors.service_number.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="full_name">Full name</Label>
                <Input
                  id="full_name"
                  autoComplete="name"
                  {...register('full_name')}
                  aria-invalid={!!errors.full_name}
                />
                {errors.full_name && (
                  <p className="text-xs text-destructive">{errors.full_name.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  {...register('email')}
                  aria-invalid={!!errors.email}
                />
                {errors.email && (
                  <p className="text-xs text-destructive">{errors.email.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <PasswordInput
                  id="password"
                  autoComplete="new-password"
                  {...register('password')}
                  aria-invalid={!!errors.password}
                />
                {errors.password ? (
                  <p className="text-xs text-destructive">{errors.password.message}</p>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    At least 8 characters with upper, lower, and a number.
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm">Confirm password</Label>
                <PasswordInput
                  id="confirm"
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
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create account
              </Button>
              <Button asChild variant="ghost" className="w-full">
                <Link to="/login">
                  <ArrowLeft className="mr-2 h-4 w-4" /> Back to sign in
                </Link>
              </Button>
            </CardFooter>
          </form>
        )}
      </Card>
    </div>
  );
}
