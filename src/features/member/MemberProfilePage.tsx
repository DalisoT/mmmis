import { useMemo, useState } from 'react';
import { Loader2, Save, KeyRound, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/lib/toast';
import { formatCurrency } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthContext';
import { useMemberOwnProfile } from './member.service';

/**
 * Loose international phone-number shape: 7 to 15 digits, optional leading
 * '+', spaces and hyphens allowed. This is the same check most auth forms
 * use; we don't enforce a specific country code.
 */
const PHONE_RE = /^\+?[0-9 \-()]{7,20}$/;

function passwordChecks(pw: string) {
  return {
    length: pw.length >= 8,
    upper: /[A-Z]/.test(pw),
    lower: /[a-z]/.test(pw),
    digit: /[0-9]/.test(pw),
  };
}

export function MemberProfilePage() {
  const { user, refreshUser } = useAuth();
  const profile = useMemberOwnProfile();
  const [phone, setPhone] = useState(profile.data?.phone ?? '');
  const [savingProfile, setSavingProfile] = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [changing, setChanging] = useState(false);

  const checks = useMemo(() => passwordChecks(newPw), [newPw]);
  const allChecksPass = checks.length && checks.upper && checks.lower && checks.digit;
  const phoneError = phone && !PHONE_RE.test(phone);
  const confirmError = confirmPw.length > 0 && newPw !== confirmPw;

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (phoneError) {
      toast.error('Phone number looks invalid. Use digits, spaces and an optional leading +.');
      return;
    }
    setSavingProfile(true);
    try {
      const { error } = await supabase.from('users').update({ phone }).eq('id', user.id);
      if (error) throw error;
      toast.success('Profile updated');
      await refreshUser();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unable to update profile');
    } finally {
      setSavingProfile(false);
    }
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!allChecksPass) {
      toast.error('Password must be at least 8 characters with upper, lower, and a digit.');
      return;
    }
    if (newPw !== confirmPw) {
      toast.error('Passwords do not match');
      return;
    }
    setChanging(true);
    try {
      const { error: reauth } = await supabase.auth.signInWithPassword({
        email: user?.email ?? '',
        password: currentPw,
      });
      if (reauth) throw new Error('Current password is incorrect');
      const { error } = await supabase.auth.updateUser({ password: newPw });
      if (error) throw error;
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
      toast.success('Password updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unable to change password');
    } finally {
      setChanging(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">My Profile</h1>
        <p className="text-sm text-muted-foreground">
          Update your contact details and password.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Service Number</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="break-words text-xl font-bold">{profile.data?.service_number}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Rank / Unit</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="break-words text-xl font-bold">{profile.data?.rank ?? '—'}</p>
            <p className="break-words text-xs text-muted-foreground">{profile.data?.unit ?? '—'}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">CHIT balance</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="break-words text-xl font-bold tabular-nums">
              {formatCurrency(profile.data?.chit_balance ?? 0)}
            </p>
            {profile.data?.is_blacklisted && (
              <Badge variant="destructive" className="mt-2">Blacklisted</Badge>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Contact details</CardTitle>
          <CardDescription>Email and phone are used for recovery reminders.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveProfile} className="max-w-lg space-y-4">
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={profile.data?.email ?? ''} readOnly />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+260…"
                aria-invalid={phoneError || undefined}
                aria-describedby={phoneError ? 'phone-error' : undefined}
              />
              {phoneError && (
                <p id="phone-error" className="flex items-center gap-1 text-xs text-destructive">
                  <AlertCircle className="h-3 w-3" />
                  Use digits, spaces, parentheses or hyphens, optionally starting with +.
                </p>
              )}
            </div>
            <Button type="submit" disabled={savingProfile} className="w-full sm:w-auto">
              {savingProfile && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <Save className="mr-2 h-4 w-4" />Save profile
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            <KeyRound className="mr-2 inline h-4 w-4" />
            Change password
          </CardTitle>
          <CardDescription>Use at least 8 characters.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={changePassword} className="max-w-lg space-y-4">
            <div className="space-y-2">
              <Label>Current password</Label>
              <Input
                type="password"
                value={currentPw}
                onChange={(e) => setCurrentPw(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-pw">New password</Label>
              <Input
                id="new-pw"
                type="password"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                required
                minLength={8}
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
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
                required
                minLength={8}
                aria-invalid={confirmError || undefined}
                aria-describedby={confirmError ? 'confirm-pw-error' : undefined}
              />
              {confirmError && (
                <p id="confirm-pw-error" className="flex items-center gap-1 text-xs text-destructive">
                  <AlertCircle className="h-3 w-3" />
                  Passwords do not match.
                </p>
              )}
            </div>
            <Button type="submit" disabled={changing || !allChecksPass || newPw !== confirmPw} className="w-full sm:w-auto">
              {changing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Update password
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function PwRule({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className={`flex items-center gap-1 ${ok ? 'text-emerald-600' : 'text-muted-foreground'}`}>
      {ok ? <CheckCircle2 className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
      {label}
    </li>
  );
}
