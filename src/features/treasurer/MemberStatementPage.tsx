import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ResponsiveTable } from '@/components/ui/responsive-table';
import { formatCurrency } from '@/lib/utils';
import { downloadCsv } from '@/lib/csv';
import { useMember, useMemberLedger } from './treasurer.service';

export function MemberStatementPage() {
  const { id } = useParams<{ id: string }>();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const { data: member } = useMember(id);
  const { data: entries, isLoading } = useMemberLedger(id, from || undefined, to || undefined);

  const rows = useMemo(() => {
    let running = 0;
    return (entries ?? []).map((e) => {
      running += Number(e.debit) - Number(e.payment);
      return { ...e, running };
    });
  }, [entries]);

  const exportCsv = () => {
    downloadCsv(
      `${member?.service_number ?? 'member'}-statement.csv`,
      [
        ['Date', 'Description', 'Debit', 'Payment', 'Balance'],
        ...rows.map((e) => [e.txn_date, e.description, e.debit, e.payment, e.running]),
      ],
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Member Statement</h1>
        <p className="text-sm text-muted-foreground">
          {member ? `${member.service_number} · ${member.full_name}` : 'Loading member…'}
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base">CHIT ledger</CardTitle>
              <CardDescription>Debits increase the balance; payments reduce it.</CardDescription>
            </div>
            <Button variant="outline" onClick={exportCsv}>
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No ledger entries found.</p>
          ) : (
            <ResponsiveTable
              rows={rows}
              rowKey={(e) => e.id}
              headers={['Date', 'Description', 'Debit', 'Payment', 'Balance']}
              headerClassNames={['', '', 'text-right', 'text-right', 'text-right']}
              cells={[
                (e) => e.txn_date,
                (e) => e.description,
                (e) => <span className="font-mono tabular-nums">{formatCurrency(Number(e.debit))}</span>,
                (e) => <span className="font-mono tabular-nums">{formatCurrency(Number(e.payment))}</span>,
                (e) => <span className="font-mono tabular-nums font-semibold">{formatCurrency(e.running)}</span>,
              ]}
              cardTitle={(e) => e.description}
              cardSubtitle={(e) => e.txn_date}
              cardFields={[
                { label: 'Debit', value: (e: any) => <span className="font-mono tabular-nums">{formatCurrency(Number(e.debit))}</span> },
                { label: 'Payment', value: (e: any) => <span className="font-mono tabular-nums">{formatCurrency(Number(e.payment))}</span> },
                { label: 'Balance', value: (e: any) => <span className="font-mono tabular-nums font-semibold">{formatCurrency(e.running)}</span>, emphasis: true, fullWidth: true },
              ]}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}