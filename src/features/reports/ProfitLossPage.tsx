import { useMemo, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCurrency } from '@/lib/utils';
import { downloadCsv } from '@/lib/csv';
import { getReportRange, useProfitLossReport, type ReportPeriod } from './reports.service';

export function ProfitLossPage() {
  const [period, setPeriod] = useState<ReportPeriod>('monthly');
  const [from, setFrom] = useState(getReportRange('monthly').from);
  const [to, setTo] = useState(getReportRange('monthly').to);
  const report = useProfitLossReport(period, { from, to });
  const data = report.data;

  const cards = useMemo(
    () =>
      data
        ? ([
            ['Revenue', data.revenue],
            ['Gross profit', data.gross_profit],
            ['Approved expenses', data.approved_expenses],
            ['Net profit', data.net_profit],
          ] as const)
        : [],
    [data]
  );

  const exportCsv = () => {
    if (!data) return;
    downloadCsv(
      `profit-loss-${data.from}-${data.to}.csv`,
      [
        ['Metric', 'Amount'],
        ['Cash sales', data.cash_sales],
        ['CHIT sales', data.chit_sales],
        ['Revenue', data.revenue],
        ['Cash CHIT recovery', data.chit_recovery_cash],
        ['Non-cash CHIT recovery', data.chit_recovery_non_cash],
        ['COGS', data.cogs],
        ['Gross profit', data.gross_profit],
        ['Approved expenses', data.approved_expenses],
        ['Pending expenses', data.pending_expenses],
        ['Net profit', data.net_profit],
        ['Stock value', data.stock_value],
        ['Outstanding CHIT', data.outstanding_chit],
      ],
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Profit & Loss</h1>
          <p className="text-sm text-muted-foreground">
            Committee financial report for {from} to {to}.
          </p>
        </div>
        <Button variant="outline" onClick={exportCsv} disabled={!data}>
          <Download className="mr-2 h-4 w-4" />
          Export CSV
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Report period</CardTitle>
          <CardDescription>Choose a standard period or enter custom dates.</CardDescription>
          <div className="grid gap-2 sm:grid-cols-3">
            <select
              className="h-10 rounded-md border bg-background px-3 text-sm"
              value={period}
              onChange={(e) => {
                const value = e.target.value as ReportPeriod;
                setPeriod(value);
                const range = getReportRange(value);
                setFrom(range.from);
                setTo(range.to);
              }}
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </CardHeader>
      </Card>

      {report.isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        data && (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {cards.map(([title, value]) => (
                <Card key={title}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">{title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p
                      className={`text-2xl font-bold ${title === 'Net profit' && value < 0 ? 'text-destructive' : ''}`}
                    >
                      {formatCurrency(value)}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Financial breakdown</CardTitle>
                <CardDescription>
                  <Badge variant={data.net_profit >= 0 ? 'success' : 'destructive'}>
                    {data.net_profit >= 0 ? 'Profit' : 'Loss'}
                  </Badge>{' '}
                  · {data.sale_count} sales
                </CardDescription>
              </CardHeader>
              <CardContent>
                {/* Phone: cards. Desktop: 2-column grid. */}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Breakdown label="Cash sales" value={data.cash_sales} />
                  <Breakdown label="CHIT sales" value={data.chit_sales} />
                  <Breakdown label="Cash CHIT recovery" value={data.chit_recovery_cash} />
                  <Breakdown label="Non-cash recovery" value={data.chit_recovery_non_cash} />
                  <Breakdown label="Cost of goods sold" value={data.cogs} />
                  <Breakdown label="Pending expenses" value={data.pending_expenses} />
                  <Breakdown label="Current stock value" value={data.stock_value} />
                  <Breakdown label="Outstanding CHIT" value={data.outstanding_chit} />
                </div>
              </CardContent>
            </Card>
          </>
        )
      )}
    </div>
  );
}

function Breakdown({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between rounded-md border bg-card px-3 py-2 text-sm shadow-sm">
      <span className="text-muted-foreground">{label}</span>
      <strong className="font-mono tabular-nums">{formatCurrency(value)}</strong>
    </div>
  );
}