import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link } from 'react-router-dom';
import { Loader2, ArrowLeft } from 'lucide-react';
import { BrandLockup } from '@/components/brand/BrandMark';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/lib/supabase';
import { toast } from '@/lib/toast';

const schema = z.object({
  serviceNumber: z.string().min(3, 'Service number is required'),
});
type FormValues = z.infer<typeof schema>;

export function ForgotPasswordPage() {
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = handleSubmit(async (values) => {
    setSubmitting(true);
    try {
      const { error } = await supabase.functions.invoke('password-reset', {
        body: { service_number: values.serviceNumber.trim() },
      });
      if (error) throw error;
      setDone(true);
      toast.success('If the service number exists, a reset email is on its way.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not request password reset');
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-4 text-center">
          <BrandLockup />
          <CardTitle className="text-xl">Reset password</CardTitle>
          <CardDescription>
            Enter your service number. If your account is active, you will receive an email with a recovery link.
          </CardDescription>
        </CardHeader>
        {done ? (
          <CardContent className="space-y-3 text-sm">
            <p className="rounded-md border bg-muted/40 p-3">
              If the service number exists in our records, a recovery email is on its way. Check your inbox (and spam folder).
            </p>
            <Button asChild variant="outline" className="w-full">
              <Link to="/login"><ArrowLeft className="mr-2 h-4 w-4" /> Back to sign in</Link>
            </Button>
          </CardContent>
        ) : (
          <form onSubmit={onSubmit} noValidate>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="serviceNumber">Service number</Label>
                <Input
                  id="serviceNumber"
                  autoComplete="username"
                  placeholder="e.g. ZM-12345"
                  {...register('serviceNumber')}
                  aria-invalid={!!errors.serviceNumber}
                />
                {errors.serviceNumber && (
                  <p className="text-xs text-destructive">{errors.serviceNumber.message}</p>
                )}
              </div>
            </CardContent>
            <CardFooter className="flex flex-col gap-2">
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Send recovery email
              </Button>
              <Button asChild variant="ghost" className="w-full">
                <Link to="/login"><ArrowLeft className="mr-2 h-4 w-4" /> Back to sign in</Link>
              </Button>
            </CardFooter>
          </form>
        )}
      </Card>
    </div>
  );
}