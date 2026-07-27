import { useEffect, useState } from 'react';
import { Loader2, ShieldCheck, LogOut, Clock } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/features/auth/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/lib/toast';
import { formatDateTime } from '@/lib/utils';

interface SessionInfo {
  isCurrent: boolean;
  createdAt: string;
  expiresAt: string | number;
  userAgent: string;
}

function describeBrowser(ua: string): string {
  if (/Edg\//.test(ua)) return 'Edge';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Safari\//.test(ua)) return 'Safari';
  if (/MesselBook|Android|iPhone|iPad/.test(ua)) return 'Mobile device';
  return 'Unknown device';
}

export function SecurityPage() {
  const { user, signOut } = useAuth();
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const load = async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;
    setSessions([
      {
        isCurrent: true,
        createdAt: data.session.user.created_at,
        expiresAt: data.session.expires_at ?? 0,
        userAgent: navigator.userAgent,
      },
    ]);
  };

  useEffect(() => {
    void load();
  }, []);

  const signOutOthers = async () => {
    setSigningOut(true);
    try {
      const { error } = await supabase.auth.signOut({ scope: 'others' });
      if (error) throw error;
      toast.success('Other sessions signed out');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not sign out other sessions');
    } finally {
      setSigningOut(false);
    }
  };

  const signOutCurrent = async () => {
    await signOut();
    window.location.assign('/login');
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <ShieldCheck className="h-5 w-5" /> Security
        </h1>
        <p className="text-sm text-muted-foreground">
          Manage your signed-in devices and recent sign-ins.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Account</CardTitle>
          <CardDescription>{user?.email}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Service number</span>
            <span className="font-mono">{user?.service_number}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Last sign-in</span>
            <span>{formatDateTime(user?.last_login_at ?? null)}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Active sessions</CardTitle>
          <CardDescription>
            Supabase does not enumerate devices server-side. The list below reflects the device you are
            currently using; you can sign out any other devices that may still hold a refresh token.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!sessions ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active session detected.</p>
          ) : (
            sessions.map((s, i) => (
              <div key={i} className="flex items-center justify-between rounded-md border p-3">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {describeBrowser(s.userAgent)}
                    {s.isCurrent && <Badge variant="secondary">This device</Badge>}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> Signed in {formatDateTime(s.createdAt)}</span>
                  </div>
                </div>
              </div>
            ))
          )}

          <div className="flex flex-wrap gap-2 pt-2">
            <Button variant="outline" onClick={signOutOthers} disabled={signingOut}>
              {signingOut && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <LogOut className="mr-2 h-4 w-4" /> Sign out other devices
            </Button>
            <Button variant="destructive" onClick={signOutCurrent}>
              <LogOut className="mr-2 h-4 w-4" /> Sign out this device
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}