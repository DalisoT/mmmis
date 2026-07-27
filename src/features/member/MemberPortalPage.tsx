import { Link } from 'react-router-dom';
import { Calendar, CreditCard, Loader2, ShoppingBag, Wallet } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatCurrency } from '@/lib/utils';
import { useMemberOwnPayments, useMemberOwnProfile, useMemberOwnPurchases } from './member.service';

export function MemberPortalPage() {
  const profile = useMemberOwnProfile();
  const purchases = useMemberOwnPurchases(30);
  const payments = useMemberOwnPayments();
  const lastPurchase = purchases.data?.[0];
  const lastPayment = payments.data?.[0];
  const overLimit = profile.data
    ? profile.data.chit_balance > profile.data.credit_limit
    : false;
  const totalPurchases = (purchases.data ?? []).reduce(
    (a, s) => a + Number(s.total_amount),
    0,
  );
  const cashPurchases = (purchases.data ?? [])
    .filter((s) => s.sale_type === 'cash')
    .reduce((a, s) => a + Number(s.total_amount), 0);
  const chitPurchases = (purchases.data ?? [])
    .filter((s) => s.sale_type === 'chit')
    .reduce((a, s) => a + Number(s.total_amount), 0);
  const totalPayments = (payments.data ?? []).reduce((a, p) => a + Number(p.amount), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">My Mess</h1>
        <p className="break-words text-sm text-muted-foreground">
          {profile.data
            ? `${profile.data.service_number} · ${profile.data.full_name}`
            : 'Loading your account…'}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Outstanding CHIT</CardTitle>
          </CardHeader>
          <CardContent>
            <p
              className={`break-words text-3xl font-bold tabular-nums ${
                overLimit ? 'text-destructive' : ''
              }`}
            >
              {formatCurrency(profile.data?.chit_balance ?? 0)}
            </p>
            <p className="text-xs text-muted-foreground">
              Credit limit {formatCurrency(profile.data?.credit_limit ?? 0)}
            </p>
            {profile.data?.is_blacklisted && (
              <Badge variant="destructive" className="mt-2">Blacklisted</Badge>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Last purchase</CardTitle>
          </CardHeader>
          <CardContent>
            {lastPurchase ? (
              <>
                <p className="text-2xl font-bold tabular-nums">
                  {formatCurrency(Number(lastPurchase.total_amount))}
                </p>
                <p className="break-words text-xs text-muted-foreground">
                  {new Date(lastPurchase.sold_at).toLocaleString()}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No purchases yet.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Last payment</CardTitle>
          </CardHeader>
          <CardContent>
            {lastPayment ? (
              <>
                <p className="text-2xl font-bold tabular-nums">
                  {formatCurrency(Number(lastPayment.amount))}
                </p>
                <p className="break-words text-xs text-muted-foreground">
                  {new Date(lastPayment.paid_at).toLocaleString()} ·{' '}
                  {lastPayment.payment_method.replace('_', ' ')}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No payments yet.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Quick links</CardTitle>
            <CardDescription>Access your statements and history.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Button asChild variant="outline" className="h-11 w-full justify-start sm:h-10">
              <Link to="/portal/statement"><Calendar className="mr-2 h-4 w-4" />Statement</Link>
            </Button>
            <Button asChild variant="outline" className="h-11 w-full justify-start sm:h-10">
              <Link to="/portal/purchases"><ShoppingBag className="mr-2 h-4 w-4" />Purchases</Link>
            </Button>
            <Button asChild variant="outline" className="h-11 w-full justify-start sm:h-10">
              <Link to="/portal/payments"><Wallet className="mr-2 h-4 w-4" />Payments</Link>
            </Button>
            <Button asChild variant="outline" className="h-11 w-full justify-start sm:h-10">
              <Link to="/portal/profile"><CreditCard className="mr-2 h-4 w-4" />Profile</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Period totals</CardTitle>
            <CardDescription>Last 30 days of activity.</CardDescription>
          </CardHeader>
          <CardContent>
            {purchases.isLoading || payments.isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <div className="space-y-2 text-sm">
                <Row label="Total purchases" value={formatCurrency(totalPurchases)} />
                <Row label="Cash purchases"  value={formatCurrency(cashPurchases)} />
                <Row label="CHIT purchases"  value={formatCurrency(chitPurchases)} />
                <Row label="Total payments"  value={formatCurrency(totalPayments)} />
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="min-w-0 truncate text-muted-foreground">{label}</span>
      <strong className="tabular-nums">{value}</strong>
    </div>
  );
}
