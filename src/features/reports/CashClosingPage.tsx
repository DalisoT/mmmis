import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { MoneyInput } from '@/components/ui/number-input';
import { formatCurrency } from '@/lib/utils';
import { useCashAtHand } from '@/features/treasurer/treasurer.service';
import { useDailyClosing, useSaveDailyClosing } from './reports.service';

export function CashClosingPage() {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [counted, setCounted] = useState('');
  const [notes, setNotes] = useState('');
  const cash = useCashAtHand(date, date);
  const closing = useDailyClosing(date);
  const save = useSaveDailyClosing();
  const movement = cash.data?.[0];
  const expected = movement?.net ?? 0;
  const variance = counted === '' ? null : Number(counted) - expected;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (counted === '') return;
    await save.mutateAsync({ date, expectedCash: expected, countedCash: Number(counted), notes });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Cash Closing</h1>
        <p className="text-sm text-muted-foreground">
          Reconcile physical cash against the system balance before closing.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Closing date</CardTitle>
          <CardDescription>
            Expected cash is calculated from cash sales, cash CHIT recovery, and approved expenses.
          </CardDescription>
          <Input
            className="w-full max-w-xs sm:w-auto"
            type="date"
            value={date}
            onChange={(e) => { setDate(e.target.value); setCounted(''); }}
          />
        </CardHeader>
        <CardContent>
          {cash.isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <p className="text-sm text-muted-foreground">Cash sales</p>
                <p className="text-xl font-bold">{formatCurrency(movement?.cash_sales ?? 0)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Cash CHIT recovery</p>
                <p className="text-xl font-bold">{formatCurrency(movement?.chit_recovery ?? 0)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Approved expenses</p>
                <p className="text-xl font-bold text-destructive">{formatCurrency(movement?.expenses ?? 0)}</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Physical cash count</CardTitle>
          <CardDescription>Enter the amount physically counted by the barman or treasurer.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="max-w-lg space-y-4">
            <div className="space-y-2">
              <Label>Expected cash at hand</Label>
              <Input value={formatCurrency(expected)} readOnly />
            </div>
            <div className="space-y-2">
              <Label>Physical cash counted</Label>
              <MoneyInput
                min="0"
                step="0.01"
                value={counted}
                onChange={(e) => setCounted(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Notes / explanation</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Explain any variance" />
            </div>
            {variance !== null && (
              <div className="rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <span>Variance</span>
                  <strong className={variance === 0 ? 'text-green-600' : 'text-destructive'}>
                    {formatCurrency(variance)}
                  </strong>
                </div>
                <div className="mt-2">
                  <Badge variant={variance === 0 ? 'success' : 'warning'}>
                    {variance === 0 ? 'Balanced' : 'Variance requires explanation'}
                  </Badge>
                </div>
              </div>
            )}
            <Button type="submit" disabled={save.isPending || cash.isLoading}>
              {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save closing
            </Button>
          </form>
          {closing.data && (
            <p className="mt-4 text-xs text-muted-foreground">
              Last saved status: {closing.data.closing_status} ·{' '}
              {closing.data.counted_at ? new Date(closing.data.counted_at).toLocaleString() : 'not yet counted'}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
