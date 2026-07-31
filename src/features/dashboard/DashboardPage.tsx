import { useAuth } from '@/features/auth/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useMemberOwnPayments, useMemberOwnProfile, useMemberOwnPurchases } from '@/features/member/member.service';
import {
  useCashAtHandToday,
  useRecentAuditEvents,
  useStockValue,
  useTodayChitRecovery,
  useTodaySales,
  useTodayStockSheet,
  useTodayExpenses,
  useOutstandingChit,
  useTopSellingProducts,
} from './dashboard.service';
import { formatCurrency, formatDateTime } from '@/lib/utils';

interface DashboardCardSpec {
  title: string;
  description: string;
  metric?: string;
  href?: string;
  detail?: string;
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

function metric(value: string | number | undefined, loading: boolean, error: boolean): string {
  if (loading) return '…';
  if (error || value === undefined) return '—';
  return String(value);
}

export function DashboardPage() {
  const { user } = useAuth();
  const profile = useMemberOwnProfile();
  const purchases = useMemberOwnPurchases(30);
  const payments = useMemberOwnPayments();
  const todaySales = useTodaySales();
  const stockSheet = useTodayStockSheet();
  const expenses = useTodayExpenses();
  const chitRecovery = useTodayChitRecovery();
  const outstandingChit = useOutstandingChit();
  const cashAtHand = useCashAtHandToday();
  const stockValue = useStockValue();
  const topSelling = useTopSellingProducts(7, 5);
  const recentAudit = useRecentAuditEvents(5);

  if (!user) return null;

  const memberCards: DashboardCardSpec[] = [
    {
      title: 'Outstanding CHIT', description: 'Your current balance',
      metric: formatCurrency(profile.data?.chit_balance ?? 0), href: '/portal/statement',
    },
    {
      title: 'Recent Purchases', description: 'Last 30 days',
      metric: formatCurrency((purchases.data ?? []).reduce((a, s) => a + Number(s.total_amount), 0)), href: '/portal/purchases',
    },
    {
      title: 'Recent Payments', description: 'Total recorded',
      metric: formatCurrency((payments.data ?? []).reduce((a, p) => a + Number(p.amount), 0)), href: '/portal/payments',
    },
    {
      title: 'Statement', description: 'Latest ledger entry',
      metric: formatDateTime(payments.data?.[0]?.paid_at ?? null), href: '/portal/statement',
    },
  ];

  const salesTotal = (todaySales.data?.cash_total ?? 0) + (todaySales.data?.chit_total ?? 0);
  const roleMetrics: Record<string, DashboardCardSpec> = user.role_code === 'administrator'
    ? {
        "Today's Sales": { title: "Today's Sales", description: 'Cash + CHIT total for the current trading day', metric: metric(formatCurrency(salesTotal), todaySales.isLoading, !!todaySales.error), href: '/daily-summary' },
        'Outstanding CHIT': { title: 'Outstanding CHIT', description: 'Total mess-wide member debt', metric: metric(outstandingChit.data ? formatCurrency(outstandingChit.data.total) : undefined, outstandingChit.isLoading, !!outstandingChit.error), href: '/outstanding-chit' },
        'Cash at Hand': { title: 'Cash at Hand', description: 'Opening + sales − expenses', metric: metric(cashAtHand.data !== undefined ? formatCurrency(cashAtHand.data) : undefined, cashAtHand.isLoading, !!cashAtHand.error), href: '/cash-at-hand' },
        'Current Stock Value': { title: 'Current Stock Value', description: 'Computed from Stock CF × buying price', metric: metric(stockValue.data !== undefined ? formatCurrency(stockValue.data) : undefined, stockValue.isLoading, !!stockValue.error), href: '/stock-valuation' },
        'Top Selling Products': { title: 'Top Selling Products', description: topSelling.data?.length ? topSelling.data.map((p) => `${p.name} (${p.qty} ${p.unit})`).join(', ') : 'Last 7 days', metric: metric(topSelling.data?.length ?? 0, topSelling.isLoading, !!topSelling.error), href: '/reports/pnl' },
        'Recent Activity': { title: 'Recent Activity', description: recentAudit.data?.[0] ? `${recentAudit.data[0].action} · ${recentAudit.data[0].actor?.full_name ?? 'System'}` : 'Audit trail highlights', metric: metric(recentAudit.data?.length, recentAudit.isLoading, !!recentAudit.error), href: '/admin/audit' },
      }
    : user.role_code === 'treasurer'
      ? {
          'Cash Sales': { title: 'Cash Sales', description: 'Today', metric: metric(todaySales.data ? formatCurrency(todaySales.data.cash_total) : undefined, todaySales.isLoading, !!todaySales.error), href: '/daily-summary' },
          'CHIT Sales': { title: 'CHIT Sales', description: 'Today', metric: metric(todaySales.data ? formatCurrency(todaySales.data.chit_total) : undefined, todaySales.isLoading, !!todaySales.error), href: '/daily-summary' },
          'CHIT Recovery': { title: 'CHIT Recovery', description: 'Today', metric: metric(chitRecovery.data !== undefined ? formatCurrency(chitRecovery.data) : undefined, chitRecovery.isLoading, !!chitRecovery.error), href: '/chit-payments' },
          Expenses: { title: 'Expenses', description: 'Today', metric: metric(expenses.data !== undefined ? formatCurrency(expenses.data) : undefined, expenses.isLoading, !!expenses.error), href: '/expenses-admin' },
          'Cash at Hand': { title: 'Cash at Hand', description: 'Live balance', metric: metric(cashAtHand.data !== undefined ? formatCurrency(cashAtHand.data) : undefined, cashAtHand.isLoading, !!cashAtHand.error), href: '/cash-at-hand' },
          'Outstanding Members': { title: 'Outstanding Members', description: 'Members with balance > 0', metric: metric(outstandingChit.data?.member_count, outstandingChit.isLoading, !!outstandingChit.error), href: '/members-directory' },
        }
      : {
          "Today's Stock Sheet": { title: "Today's Stock Sheet", description: stockSheet.data ? `${stockSheet.data.row_count} product rows` : 'Open and complete the daily sheet', metric: stockSheet.data?.recorded ? 'Recorded' : metric(undefined, stockSheet.isLoading, !!stockSheet.error), href: '/stock-sheet' },
          'Quick Sale': { title: 'Quick Sale', description: 'Cash sale shortcut', metric: 'Open POS', href: '/pos' },
          'Quick CHIT': { title: 'Quick CHIT', description: 'CHIT sale shortcut', metric: 'Open POS', href: '/pos' },
          'Closing Stock': { title: 'Closing Stock', description: 'Record Stock CF at day end', metric: 'Open sheet', href: '/stock-sheet' },
          'Expense Entry': { title: 'Expense Entry', description: 'Record a unit-administration expense', metric: 'Open expenses', href: '/reports/cash-closing' },
        };

  const roleCards = CARDS_BY_ROLE[user.role_code] ?? [];
  const cards = user.role_code === 'member'
    ? memberCards
    : roleCards.map((c) => roleMetrics[c.title] ?? { ...c, metric: '—' });

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
