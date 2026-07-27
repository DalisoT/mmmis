import { Suspense, lazy, useState } from 'react';
import { format } from 'date-fns';
import { Loader2, Receipt, ShoppingBag, Wallet, TrendingUp, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import { ResponsiveTable } from '@/components/ui/responsive-table';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/features/auth/AuthContext';
import { formatCurrency } from '@/lib/utils';
import {
  useDailySummary, useSalesForDate, useExpensesForDate,
} from './sales.service';

// The whole PDF downloader (PDFDownloadLink + DailySummaryPDF) is loaded
// lazily so the ~1.9 MB @react-pdf/renderer bundle is only fetched when
// a barman/treasurer actually visits this page.
const PdfDownloadButton = lazy(() =>
  import('./DailySummaryPDFDownload').then((m) => ({ default: m.PdfDownloadButton }))
);

export function DailySummaryPage() {
  const { user } = useAuth();
  const [date, setDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const summary = useDailySummary(date);
  const sales = useSalesForDate(date);
  const expenses = useExpensesForDate(date);

  const grandCash = (summary.data?.cash_sales ?? 0)
    + (summary.data?.chit_recovery ?? 0)
    - (summary.data?.expenses ?? 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Daily Summary</h1>
          <p className="text-sm text-muted-foreground">
            Cash + CHIT sales, CHIT recovery, and expenses for the selected date.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-auto" />
          <Suspense fallback={<Button size="sm" variant="secondary" disabled><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Loading…</Button>}>
            <PdfDownloadButton
              date={date}
              sales={sales.data ?? []}
              expenses={expenses.data ?? []}
              chitRecovery={summary.data?.chit_recovery ?? 0}
              cashier={user?.full_name ?? '—'}
              totals={{
                cash_sales: summary.data?.cash_sales ?? 0,
                chit_sales: summary.data?.chit_sales ?? 0,
                expenses: summary.data?.expenses ?? 0,
                sale_count: summary.data?.sale_count ?? 0,
                item_count: summary.data?.item_count ?? 0,
              }}
            />
          </Suspense>
        </div>
      </div>

      {summary.isLoading ? (
        <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              title="Cash Sales"
              icon={Wallet}
              value={summary.data?.cash_sales ?? 0}
              variant="emerald"
            />
            <StatCard
              title="CHIT Sales"
              icon={Receipt}
              value={summary.data?.chit_sales ?? 0}
              variant="primary"
            />
            <StatCard
              title="CHIT Recovery"
              icon={TrendingUp}
              value={summary.data?.chit_recovery ?? 0}
            />
            <StatCard
              title="Expenses"
              icon={ShoppingBag}
              value={summary.data?.expenses ?? 0}
              variant="warning"
            />
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Gross Cash at Hand</CardTitle>
              <CardDescription>Cash Sales + CHIT Recovery − Expenses</CardDescription>
            </CardHeader>
            <CardContent>
              <p className={`text-3xl font-bold font-mono ${grandCash >= 0 ? 'text-emerald-600' : 'text-destructive'}`}>
                {formatCurrency(grandCash)}
              </p>
              {grandCash < 0 && (
                <p className="mt-2 flex items-center gap-2 text-xs text-destructive">
                  <AlertTriangle className="h-4 w-4" />
                  Cash at Hand is negative. Verify expenses and recovery entries.
                </p>
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Sales Detail</CardTitle>
                <CardDescription>{(sales.data ?? []).length} sales</CardDescription>
              </CardHeader>
              <CardContent>
                {(sales.data ?? []).length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">No sales today.</p>
                ) : (
                  <ResponsiveTable
                    rows={sales.data ?? []}
                    rowKey={(s) => s.id}
                    headers={['Time', 'Type', 'Member', 'Amount']}
                    headerClassNames={['', '', '', 'text-right']}
                    cells={[
                      (s) => <span className="font-mono text-xs">{format(new Date(s.sold_at), 'HH:mm')}</span>,
                      (s) => <Badge variant={s.sale_type === 'cash' ? 'success' : 'warning'}>{s.sale_type.toUpperCase()}</Badge>,
                      (s) => s.member ? `${s.member.service_number} ${s.member.first_name}` : '—',
                      (s) => <span className="font-mono tabular-nums">{formatCurrency(s.total_amount)}</span>,
                    ]}
                    cardTitle={(s) => s.member ? `${s.member.first_name}` : 'Sale'}
                    cardSubtitle={(s) => s.member ? s.member.service_number : 'Walk-in'}
                    cardBadge={(s) => <Badge variant={s.sale_type === 'cash' ? 'success' : 'warning'}>{s.sale_type.toUpperCase()}</Badge>}
                    cardFields={[
                      { label: 'Time', value: (s: any) => <span className="font-mono">{format(new Date(s.sold_at), 'HH:mm')}</span> },
                      { label: 'Amount', value: (s: any) => <span className="font-mono tabular-nums">{formatCurrency(s.total_amount)}</span>, emphasis: true, fullWidth: true },
                    ]}
                  />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Expenses Detail</CardTitle>
                <CardDescription>{(expenses.data ?? []).length} expenses</CardDescription>
              </CardHeader>
              <CardContent>
                {(expenses.data ?? []).length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">No expenses today.</p>
                ) : (
                  <ResponsiveTable
                    rows={expenses.data ?? []}
                    rowKey={(e) => e.id}
                    headers={['Description', 'Purpose', 'Amount']}
                    headerClassNames={['', '', 'text-right']}
                    cells={[
                      (e) => e.description,
                      (e) => <span className="text-sm text-muted-foreground">{e.purpose}</span>,
                      (e) => <span className="font-mono tabular-nums">{formatCurrency(e.amount)}</span>,
                    ]}
                    cardTitle={(e) => e.description}
                    cardSubtitle={(e) => e.purpose}
                    cardFields={[
                      { label: 'Amount', value: (e: any) => <span className="font-mono tabular-nums">{formatCurrency(e.amount)}</span>, emphasis: true, fullWidth: true },
                    ]}
                  />
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({
  title, value, icon: Icon, variant = 'default',
}: {
  title: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  variant?: 'default' | 'emerald' | 'primary' | 'warning';
}) {
  const color = {
    default: 'text-foreground',
    emerald: 'text-emerald-600',
    primary: 'text-primary',
    warning: 'text-amber-600',
  }[variant];
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm font-medium">
          <span>{title}</span>
          <Icon className={`h-4 w-4 ${color}`} />
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className={`text-2xl font-bold font-mono ${color}`}>{formatCurrency(value)}</p>
      </CardContent>
    </Card>
  );
}
