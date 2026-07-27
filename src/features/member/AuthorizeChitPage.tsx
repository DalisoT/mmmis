import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Loader2, ShieldCheck, X, AlertCircle, Clock, Store } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatCurrency } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { toast } from '@/lib/toast';
import { useCountdown, formatCountdown } from '@/hooks/useCountdown';
import {
  useChitAuthorizationLive,
  useRejectChitAuthorization,
  callChitAuthorizeEdgeFunction,
  type ChitAuthRequest,
} from '@/features/sales/sales.service';

type Phase = 'loading' | 'pending' | 'approving' | 'approved' | 'rejected' | 'expired' | 'gone' | 'unauthorized';

/**
 * Buyer-side page: /portal/authorize/:requestId
 *
 * Three flows coexist:
 *  1. Buyer is signed in to /portal, request is 'pending' — show cart +
 *     countdown + an Approve/Reject pair.
 *  2. Buyer is signed in to /portal, request is already in a terminal state
 *     — show the outcome and link them back to /portal.
 *  3. Buyer is NOT signed in to /portal — bounce them to the login screen
 *     with `?next=…` so they come back here after authenticating.
 *
 * Approval goes through the chit-authorize Edge Function which:
 *  - confirms the password matches the buyer,
 *  - forwards the buyer's JWT to approve_chit_authorization() which stamps
 *    status='authorized'. The POS sees this via Realtime and finalizes.
 */
export function AuthorizeChitPage() {
  const { requestId = '' } = useParams<{ requestId: string }>();
  const navigate = useNavigate();
  const { row, connectionState } = useChitAuthorizationLive(requestId || null);
  const rejectAuth = useRejectChitAuthorization();

  const [phase, setPhase] = useState<Phase>('loading');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Detect "not signed in". Supabase will throw on protected queries when
  // there is no session, but the .maybeSingle() used in the live hook
  // returns null instead. So we probe the session once on mount.
  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      if (!data.session) {
        setPhase('unauthorized');
        return;
      }
      setPhase((cur) => (cur === 'loading' ? 'pending' : cur));
    })();
    return () => { active = false; };
  }, []);

  // Reflect Realtime-driven terminal states in the local phase.
  useEffect(() => {
    if (!row) return;
    if (row.status === 'authorized' || row.status === 'manual_override' || row.status === 'consumed') {
      setPhase('approved');
    } else if (row.status === 'rejected') {
      setPhase('rejected');
    } else if (row.status === 'expired' || row.status === 'cancelled') {
      setPhase('expired');
    } else if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
      setPhase('expired');
    }
  }, [row]);

  const expiresMs = row?.expires_at ? new Date(row.expires_at).getTime() : null;
  const secondsLeft = useCountdown(expiresMs);

  const approve = async () => {
    setError(null);
    setBusy(true);
    setPhase('approving');
    const r = await callChitAuthorizeEdgeFunction(requestId, password);
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      setPhase('pending');
      return;
    }
    setPassword('');
    // Realtime will flip the row to 'authorized' and our effect above will
    // move us to 'approved'. Fallback timer in case Realtime is down.
    setTimeout(() => {
      setPhase((cur) => (cur === 'approving' ? 'approved' : cur));
    }, 4_000);
  };

  const reject = async () => {
    setError(null);
    setBusy(true);
    try {
      await rejectAuth.mutateAsync({ request_id: requestId, reason: 'Buyer declined from phone' });
      setPhase('rejected');
    } catch (e: any) {
      setError(e?.message ?? String(e));
      toast.error(`Could not reject: ${e?.message ?? String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const goLogin = () => {
    navigate(`/login?next=${encodeURIComponent(`/portal/authorize/${requestId}`)}`);
  };

  const goPortal = () => navigate('/portal');

  // ---------- Render branches ----------

  if (phase === 'loading') {
    return <Center><Loader2 className="h-6 w-6 animate-spin" /></Center>;
  }

  if (phase === 'unauthorized') {
    return (
      <Center>
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5" /> Sign in required
            </CardTitle>
            <CardDescription>
              Sign in to your portal account to review this CHIT purchase.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={goLogin} className="w-full">Go to sign in</Button>
          </CardContent>
        </Card>
      </Center>
    );
  }

  if (phase === 'approved') {
    return (
      <Center>
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-emerald-600">
              <ShieldCheck className="h-5 w-5" /> Approved
            </CardTitle>
            <CardDescription>
              The barman has been notified. You can close this page.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={goPortal} variant="outline" className="w-full">Back to my portal</Button>
          </CardContent>
        </Card>
      </Center>
    );
  }

  if (phase === 'rejected') {
    return (
      <Center>
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <X className="h-5 w-5" /> Declined
            </CardTitle>
            <CardDescription>
              You declined this CHIT purchase. The barman has been notified.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={goPortal} variant="outline" className="w-full">Back to my portal</Button>
          </CardContent>
        </Card>
      </Center>
    );
  }

  if (phase === 'expired') {
    return (
      <Center>
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-amber-600">
              <Clock className="h-5 w-5" /> Expired
            </CardTitle>
            <CardDescription>
              The 5-minute window for this authorization has closed. Ask the
              barman to start a new purchase if you still want to proceed.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={goPortal} variant="outline" className="w-full">Back to my portal</Button>
          </CardContent>
        </Card>
      </Center>
    );
  }

  if (!row) {
    return (
      <Center>
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Waiting for details…</CardTitle>
            <CardDescription>
              Pulling the purchase from the bar. If this takes more than a
              few seconds, ask the barman to resend.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Loader2 className="h-4 w-4 animate-spin" />
          </CardContent>
        </Card>
      </Center>
    );
  }

  // phase === 'pending'
  return (
    <Center>
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-emerald-600" /> Approve CHIT purchase?
          </CardTitle>
          <CardDescription>
            <Store className="mr-1 inline h-3 w-3" /> Bar terminal is requesting
            your authorization for the purchase below.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border bg-muted/30 p-3">
            <Row label="Total" value={formatCurrency(Number(row.total_amount))} big />
            <ul className="mt-2 space-y-1 text-sm">
              {row.cart.map((line, i) => (
                <li key={i} className="flex justify-between">
                  <span className="truncate">{line.name ?? line.product_id.slice(0, 8)}</span>
                  <span className="ml-2 font-mono text-muted-foreground">×{line.quantity}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex items-center justify-between text-sm">
            <Badge variant={connectionState === 'connected' ? 'success' : 'outline'}>
              {connectionState === 'connected' ? 'Live' : connectionState === 'polling' ? 'Polling' : 'Connecting…'}
            </Badge>
            <span className={`flex items-center gap-1 font-mono ${secondsLeft <= 30 ? 'text-destructive' : ''}`}>
              <Clock className="h-3 w-3" /> {formatCountdown(secondsLeft)}
            </span>
          </div>

          <form
            onSubmit={(e) => { e.preventDefault(); void approve(); }}
            className="space-y-2"
          >
            <Label htmlFor="buyer-pw">Your password</Label>
            <Input
              id="buyer-pw"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              required
              disabled={busy || phase === 'approving'}
            />
            {error && (
              <p className="flex items-center gap-1 text-xs text-destructive">
                <AlertCircle className="h-3 w-3" /> {error}
              </p>
            )}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                variant="outline"
                onClick={() => void reject()}
                disabled={busy || phase === 'approving'}
                className="w-full sm:w-auto"
              >
                <X className="mr-2 h-4 w-4" /> Decline
              </Button>
              <Button
                type="submit"
                disabled={busy || !password || phase === 'approving'}
                className="w-full sm:flex-1"
              >
                {(busy || phase === 'approving') && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Approve purchase
              </Button>
            </div>
          </form>

          <p className="text-[11px] text-muted-foreground">
            Approving will add <strong>{formatCurrency(Number(row.total_amount))}</strong>
            to your CHIT balance. You'll see it on your next statement.
          </p>
        </CardContent>
      </Card>
    </Center>
  );
}

function Row({ label, value, big = false }: { label: string; value: string; big?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <strong className={`tabular-nums ${big ? 'text-2xl' : ''}`}>{value}</strong>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/20 p-4">
      {children}
    </div>
  );
}

// Re-export the type so app.tsx import doesn't have to dig for it.
export type { ChitAuthRequest };
