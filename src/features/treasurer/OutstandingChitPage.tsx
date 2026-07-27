import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Loader2, Search, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import { ResponsiveTable } from '@/components/ui/responsive-table';
import { formatCurrency } from '@/lib/utils';
import { useMembers } from './treasurer.service';

export function OutstandingChitPage() {
  const { data: members, isLoading } = useMembers();
  const [filter, setFilter] = useState('');

  const outstanding = useMemo(() => {
    return (members ?? [])
      .filter((m) => m.chit_balance > 0)
      .sort((a, b) => b.chit_balance - a.chit_balance);
  }, [members]);

  const filtered = outstanding.filter((m) => {
    const q = filter.trim().toLowerCase();
    if (!q) return true;
    return [m.service_number, m.full_name, m.rank ?? '', m.unit ?? '']
      .some((s) => s.toLowerCase().includes(q));
  });

  const totalDebt = outstanding.reduce((a, m) => a + m.chit_balance, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Outstanding CHIT</h1>
          <p className="text-sm text-muted-foreground">
            Members with a positive CHIT balance, sorted largest first.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Members in Debt</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{outstanding.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Outstanding</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-destructive">{formatCurrency(totalDebt)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Blacklisted</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">
              {outstanding.filter((m) => m.is_blacklisted).length}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="text-base">Members with Outstanding CHIT</CardTitle>
            <CardDescription>
              Click a row to view the ledger or record a payment.
            </CardDescription>
          </div>
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search service no / name / unit"
              className="pl-8"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No members have an outstanding CHIT balance.
            </p>
          ) : (
            <ResponsiveTable
              rows={filtered}
              rowKey={(m) => m.user_id}
              headers={['Service No', 'Name', 'Rank / Unit', 'Credit Limit', 'CHIT Balance', 'Status', 'Actions']}
              headerClassNames={['', '', '', 'text-right', 'text-right', '', 'text-right']}
              cells={[
                (m) => <span className="font-mono">{m.service_number}</span>,
                (m) => (
                  <div>
                    <div className="font-medium">{m.full_name}</div>
                    <div className="text-xs text-muted-foreground">{m.email}</div>
                  </div>
                ),
                (m) => (
                  <div>
                    <div className="text-sm">{m.rank ?? '—'}</div>
                    <div className="text-xs text-muted-foreground">{m.unit ?? '—'}</div>
                  </div>
                ),
                (m) => <span className="font-mono tabular-nums">{formatCurrency(m.credit_limit)}</span>,
                (m) => (
                  <span className={`font-mono tabular-nums ${m.chit_balance > m.credit_limit ? 'text-destructive' : ''}`}>
                    {formatCurrency(m.chit_balance)}
                  </span>
                ),
                (m) => m.is_blacklisted ? (
                  <Badge variant="destructive">
                    <AlertTriangle className="mr-1 h-3 w-3" /> Blacklisted
                  </Badge>
                ) : m.chit_balance > m.credit_limit ? (
                  <Badge variant="warning">Over limit</Badge>
                ) : (
                  <Badge variant="success">OK</Badge>
                ),
                (m) => (
                  <div className="flex justify-end gap-2">
                    <Button asChild size="sm" variant="outline">
                      <Link to={`/members/${m.user_id}/statement`}>
                        <Wallet className="mr-1 h-3 w-3" /> Statement
                      </Link>
                    </Button>
                    <Button asChild size="sm">
                      <Link to={`/chit-payments?member=${m.user_id}`}>
                        Pay
                      </Link>
                    </Button>
                  </div>
                ),
              ]}
              cardTitle={(m) => m.full_name}
              cardSubtitle={(m) => `${m.service_number} · ${m.rank ?? '—'}`}
              cardBadge={(m) => m.is_blacklisted ? (
                <Badge variant="destructive">
                  <AlertTriangle className="mr-1 h-3 w-3" /> Blacklisted
                </Badge>
              ) : m.chit_balance > m.credit_limit ? (
                <Badge variant="warning">Over limit</Badge>
              ) : (
                <Badge variant="success">OK</Badge>
              )}
              cardFields={[
                { label: 'Credit limit', value: (m: any) => <span className="font-mono tabular-nums">{formatCurrency(m.credit_limit)}</span> },
                { label: 'CHIT balance', value: (m: any) => (
                  <span className={`font-mono tabular-nums ${m.chit_balance > m.credit_limit ? 'text-destructive font-semibold' : ''}`}>
                    {formatCurrency(m.chit_balance)}
                  </span>
                ), emphasis: true },
                { label: 'Actions', value: (m: any) => (
                  <div className="flex flex-wrap gap-2">
                    <Button asChild size="sm" variant="outline">
                      <Link to={`/members/${m.user_id}/statement`}>
                        <Wallet className="mr-1 h-3 w-3" /> Statement
                      </Link>
                    </Button>
                    <Button asChild size="sm">
                      <Link to={`/chit-payments?member=${m.user_id}`}>
                        Pay
                      </Link>
                    </Button>
                  </div>
                ), fullWidth: true },
              ]}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
