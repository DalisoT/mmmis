import { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ResponsiveTable } from '@/components/ui/responsive-table';
import { formatCurrency } from '@/lib/utils';
import { useCashAtHand } from './treasurer.service';

export function CashAtHandPage() {
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const { data, isLoading } = useCashAtHand(from, to);

  const totals = useMemo(
    () =>
      (data ?? []).reduce(
        (a, d) => ({
          sales: a.sales + d.cash_sales,
          recovery: a.recovery + d.chit_recovery,
          expenses: a.expenses + d.expenses,
          net: a.net + d.net,
        }),
        { sales: 0, recovery: 0, expenses: 0, net: 0 }
      ),
    [data]
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Cash at Hand</h1>
        <p className="text-sm text-muted-foreground">
          Cash sales plus CHIT recovery less recorded expenses.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Period</CardTitle>
          <CardDescription>Select one day or a date range.</CardDescription>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-sm text-muted-foreground">Cash sales</p>
              <p className="text-2xl font-bold">{formatCurrency(totals.sales)}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">CHIT recovery</p>
              <p className="text-2xl font-bold">{formatCurrency(totals.recovery)}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Expenses</p>
              <p className="text-2xl font-bold text-destructive">{formatCurrency(totals.expenses)}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Net cash at hand</p>
              <p className="text-2xl font-bold text-primary">{formatCurrency(totals.net)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Daily movement</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <ResponsiveTable
              rows={data ?? []}
              rowKey={(d) => d.date}
              headers={['Date', 'Cash sales', 'CHIT recovery', 'Expenses', 'Net']}
              headerClassNames={['', 'text-right', 'text-right', 'text-right', 'text-right']}
              cells={[
                (d) => d.date,
                (d) => <span className="font-mono tabular-nums">{formatCurrency(d.cash_sales)}</span>,
                (d) => <span className="font-mono tabular-nums">{formatCurrency(d.chit_recovery)}</span>,
                (d) => <span className="font-mono tabular-nums">{formatCurrency(d.expenses)}</span>,
                (d) => <span className="font-mono tabular-nums font-semibold">{formatCurrency(d.net)}</span>,
              ]}
              cardTitle={(d) => d.date}
              cardFields={[
                { label: 'Cash sales', value: (d: any) => <span className="font-mono tabular-nums">{formatCurrency(d.cash_sales)}</span> },
                { label: 'CHIT recovery', value: (d: any) => <span className="font-mono tabular-nums">{formatCurrency(d.chit_recovery)}</span> },
                { label: 'Expenses', value: (d: any) => <span className="font-mono tabular-nums">{formatCurrency(d.expenses)}</span> },
                { label: 'Net', value: (d: any) => <span className="font-mono tabular-nums font-semibold">{formatCurrency(d.net)}</span>, emphasis: true, fullWidth: true },
              ]}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}