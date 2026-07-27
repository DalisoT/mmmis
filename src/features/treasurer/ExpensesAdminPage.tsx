import { useMemo, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ResponsiveTable } from '@/components/ui/responsive-table';
import { formatCurrency } from '@/lib/utils';
import { downloadCsv } from '@/lib/csv';
import { useAllExpenses, useApproveExpense } from './treasurer.service';

export function ExpensesAdminPage() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [approved, setApproved] = useState<'all' | 'yes' | 'no'>('all');
  const { data: expenses, isLoading } = useAllExpenses({
    from: from || undefined,
    to: to || undefined,
    approved,
  });
  const approve = useApproveExpense();
  const total = useMemo(() => (expenses ?? []).reduce((sum, e) => sum + Number(e.amount), 0), [expenses]);

  const exportCsv = () => {
    downloadCsv(
      `expenses-${from || 'all'}-${to || 'all'}.csv`,
      [
        ['Date', 'Description', 'Purpose', 'Amount', 'Approved', 'Released by'],
        ...(expenses ?? []).map((e) => [
          e.expense_date,
          e.description,
          e.purpose,
          e.amount,
          e.approved_at ? 'Yes' : 'No',
          e.creator?.full_name ?? '',
        ]),
      ],
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Expenses</h1>
          <p className="text-sm text-muted-foreground">Review and approve mess expenditure.</p>
        </div>
        <Button variant="outline" onClick={exportCsv}>
          <Download className="mr-2 h-4 w-4" />
          Export CSV
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Expense records</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{expenses?.length ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Total expenditure</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{formatCurrency(total)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Pending approval</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-amber-600">
              {(expenses ?? []).filter((e) => !e.approved_at).length}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Expense register</CardTitle>
          <CardDescription>Use the filters to review daily, weekly, or monthly periods.</CardDescription>
          <div className="grid gap-2 sm:grid-cols-3">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            <select
              className="h-10 rounded-md border bg-background px-3 text-sm"
              value={approved}
              onChange={(e) => setApproved(e.target.value as typeof approved)}
            >
              <option value="all">All statuses</option>
              <option value="no">Pending</option>
              <option value="yes">Approved</option>
            </select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <ResponsiveTable
              rows={expenses ?? []}
              rowKey={(e) => e.id}
              headers={['Date', 'Description', 'Purpose', 'Released by', 'Amount', 'Status', 'Action']}
              headerClassNames={['', '', '', '', 'text-right', '', 'text-right']}
              cells={[
                (e) => e.expense_date,
                (e) => <span className="font-medium">{e.description}</span>,
                (e) => e.purpose,
                (e) => e.creator?.full_name ?? '—',
                (e) => <span className="font-mono tabular-nums">{formatCurrency(Number(e.amount))}</span>,
                (e) => e.approved_at ? <Badge variant="success">Approved</Badge> : <Badge variant="warning">Pending</Badge>,
                (e) => (
                  <Button
                    size="sm"
                    variant={e.approved_at ? 'outline' : 'default'}
                    disabled={approve.isPending}
                    onClick={() => approve.mutate({ id: e.id, approved: !e.approved_at })}
                  >
                    {e.approved_at ? 'Unapprove' : 'Approve'}
                  </Button>
                ),
              ]}
              cardTitle={(e) => e.description}
              cardSubtitle={(e) => `${e.expense_date} · ${e.purpose}`}
              cardBadge={(e) => e.approved_at ? <Badge variant="success">Approved</Badge> : <Badge variant="warning">Pending</Badge>}
              cardFields={[
                { label: 'Released by', value: (e: any) => e.creator?.full_name ?? '—' },
                { label: 'Amount', value: (e: any) => <span className="font-mono tabular-nums">{formatCurrency(Number(e.amount))}</span>, emphasis: true },
                {
                  label: 'Action',
                  value: (e: any) => (
                    <Button
                      size="sm"
                      variant={e.approved_at ? 'outline' : 'default'}
                      disabled={approve.isPending}
                      onClick={() => approve.mutate({ id: e.id, approved: !e.approved_at })}
                    >
                      {e.approved_at ? 'Unapprove' : 'Approve'}
                    </Button>
                  ),
                  fullWidth: true,
                },
              ]}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}