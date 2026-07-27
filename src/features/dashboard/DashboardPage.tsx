import { useAuth } from '@/features/auth/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useMemberOwnPayments, useMemberOwnProfile, useMemberOwnPurchases } from '@/features/member/member.service';
import { formatCurrency, formatDateTime } from '@/lib/utils';

interface DashboardCardSpec {
  title: string;
  description: string;
  metric?: string;
  href?: string;
}

const CARDS_BY_ROLE = {
  administrator: [
    { title: "Today's Sales", description: 'Cash + CHIT total for the current trading day' },
    { title: 'Outstanding CHIT', description: 'Total mess-wide member debt' },
    { title: 'Cash at Hand', description: 'Opening + sales − expenses' },
    { title: 'Current Stock Value', description: 'Computed from Stock CF × buying price' },
    { title: 'Top Selling Products', description: 'Last 7 days' },
    { title: 'Recent Activity', description: 'Audit trail highlights' },
  ] satisfies DashboardCardSpec[],
  treasurer: [
    { title: 'Cash Sales', description: 'Today' },
    { title: 'CHIT Sales', description: 'Today' },
    { title: 'CHIT Recovery', description: 'Today' },
    { title: 'Expenses', description: 'Today' },
    { title: 'Cash at Hand', description: 'Live balance' },
    { title: 'Outstanding Members', description: 'Members with balance > 0' },
  ] satisfies DashboardCardSpec[],
  barman: [
    { title: "Today's Stock Sheet", description: 'Open and complete the daily sheet' },
    { title: 'Quick Sale', description: 'Cash sale shortcut' },
    { title: 'Quick CHIT', description: 'CHIT sale shortcut' },
    { title: 'Closing Stock', description: 'Record Stock CF at day end' },
    { title: 'Expense Entry', description: 'Record a unit-administration expense' },
  ] satisfies DashboardCardSpec[],
  member: [
    { title: 'Outstanding CHIT', description: 'Your current balance' },
    { title: 'Recent Purchases', description: 'Last 30 days' },
    { title: 'Recent Payments', description: 'Last 30 days' },
    { title: 'Statement', description: 'Generate a printable statement' },
  ] satisfies DashboardCardSpec[],
} as const;

export function DashboardPage() {
  const { user } = useAuth();
  const profile = useMemberOwnProfile();
  const purchases = useMemberOwnPurchases(30);
  const payments = useMemberOwnPayments();

  if (!user) return null;

  const memberCards = [
    {
      title: 'Outstanding CHIT',
      description: 'Your current balance',
      metric: formatCurrency(profile.data?.chit_balance ?? 0),
      href: '/portal/statement',
    },
    {
      title: 'Recent Purchases',
      description: 'Last 30 days',
      metric: formatCurrency((purchases.data ?? []).reduce((a, s) => a + Number(s.total_amount), 0)),
      href: '/portal/purchases',
    },
    {
      title: 'Recent Payments',
      description: 'Total recorded',
      metric: formatCurrency((payments.data ?? []).reduce((a, p) => a + Number(p.amount), 0)),
      href: '/portal/payments',
    },
    {
      title: 'Statement',
      description: 'Latest ledger entry',
      metric: formatDateTime(payments.data?.[0]?.paid_at ?? null),
      href: '/portal/statement',
    },
  ];

  const roleCards = CARDS_BY_ROLE[user.role_code] ?? [];
  const cards = user.role_code === 'member'
    ? memberCards
    : roleCards.map<DashboardCardSpec & { href?: string }>((c) => ({ ...c, metric: '—' }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Welcome, {user.full_name}</h1>
          <p className="text-sm text-muted-foreground">
            Logged in as <Badge variant="outline">{user.role_name}</Badge> · Service No{' '}
            <span className="font-mono">{user.service_number}</span>
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <Card key={c.title}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{c.title}</CardTitle>
              <CardDescription>{c.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold tracking-tight">{c.metric}</p>
              {c.href && (
                <a href={c.href} className="mt-2 inline-block text-xs text-primary hover:underline">
                  View details →
                </a>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
