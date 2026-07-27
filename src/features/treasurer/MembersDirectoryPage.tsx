import { useMemo, useState } from 'react';
import { UserRound, Search, RefreshCw, Loader2, Download, Mail, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from '@/lib/toast';
import { formatDateTime } from '@/lib/utils';
import { downloadCsv, csvTimestamp } from '@/lib/csv';
import { useMemberDirectory } from './members.directory.service';

function fmtK(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const DIRECTORY_HEADERS = [
  'Service number', 'Full name', 'First name', 'Last name',
  'Rank', 'Unit', 'Email', 'Active',
  'CHIT balance', 'Credit limit', 'Ledger entries', 'Last login',
] as const;

export function MembersDirectoryPage() {
  const [q, setQ] = useState('');
  const [onlyActive, setOnlyActive] = useState(true);

  const { data, isLoading, isFetching, refetch, isError, error } = useMemberDirectory(q, onlyActive);

  const onRefresh = async () => {
    try {
      await refetch();
      toast.success('Directory refreshed');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Refresh failed');
    }
  };

  const onExport = () => {
    if (!data || data.length === 0) {
      toast.error('Nothing to export');
      return;
    }
    downloadCsv(
      `member-directory-${csvTimestamp()}.csv`,
      [
        [...DIRECTORY_HEADERS],
        ...data.map((r) => [
          r.service_number, r.full_name, r.first_name, r.last_name,
          r.rank, r.unit, r.email, r.is_active,
          r.chit_balance, r.credit_limit, r.ledger_count, r.last_login_at ?? '',
        ]),
      ],
    );
    toast.success(`Exported ${data.length} members`);
  };

  // Light-weight in-page filter (the RPC already does case-insensitive ILIKE,
  // but a debounced local filter is overkill for the dataset sizes we expect).
  const rows = data ?? [];

  const totals = useMemo(() => {
    const owed = rows.reduce((s, r) => s + Number(r.chit_balance ?? 0), 0);
    const overLimit = rows.filter((r) => Number(r.chit_balance) > Number(r.credit_limit) && Number(r.credit_limit) > 0).length;
    return { owed, overLimit, count: rows.length };
  }, [rows]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <UserRound className="h-5 w-5" /> Member directory
          </h1>
          <p className="text-sm text-muted-foreground">
            Searchable list of all members with running CHIT balance. Restricted to administrators and treasurers.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onExport} disabled={!data || data.length === 0}>
            <Download className="mr-2 h-4 w-4" /> Export CSV
          </Button>
          <Button size="sm" onClick={onRefresh} disabled={isFetching}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Search</CardTitle>
          <CardDescription>
            Match against service number, name, rank, or unit. Leave blank to list all.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Service number, name, rank, unit…"
                className="pl-8"
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={onlyActive}
                onChange={(e) => setOnlyActive(e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              Active members only
            </label>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center text-xs sm:max-w-md">
            <div className="rounded border bg-muted/30 p-2">
              <div className="font-medium uppercase tracking-wide text-muted-foreground">Count</div>
              <div className="text-lg font-semibold tabular-nums">{totals.count}</div>
            </div>
            <div className="rounded border bg-muted/30 p-2">
              <div className="font-medium uppercase tracking-wide text-muted-foreground">CHIT owed</div>
              <div className="text-lg font-semibold tabular-nums">{fmtK(totals.owed)}</div>
            </div>
            <div className="rounded border bg-muted/30 p-2">
              <div className="font-medium uppercase tracking-wide text-muted-foreground">Over limit</div>
              <div className="text-lg font-semibold tabular-nums">{totals.overLimit}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Results ({rows.length})</CardTitle>
          <CardDescription>
            {isLoading
              ? 'Querying Supabase…'
              : isError
                ? <span className="text-destructive">{error instanceof Error ? error.message : 'Failed'}</span>
                : data
                  ? `Snapshot at ${formatDateTime(new Date().toISOString())}`
                  : ''}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading || !data ? (
            <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : rows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No members match this query.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Service #</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Rank / Unit</TableHead>
                  <TableHead className="text-right">CHIT</TableHead>
                  <TableHead className="text-right">Limit</TableHead>
                  <TableHead>Last login</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const balance = Number(r.chit_balance);
                  const limit   = Number(r.credit_limit);
                  const over    = limit > 0 && balance > limit;
                  return (
                    <TableRow key={r.user_id}>
                      <TableCell className="font-mono text-xs">{r.service_number}</TableCell>
                      <TableCell>
                        <div className="font-medium">{r.full_name}</div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          {r.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" /> {r.email}</span>}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">
                        {r.rank && <div className="font-medium">{r.rank}</div>}
                        {r.unit && <div className="text-muted-foreground">{r.unit}</div>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <span className={over ? 'text-destructive font-semibold' : ''}>
                          {fmtK(balance)}
                        </span>
                        {over && (
                          <div className="mt-0.5 inline-flex items-center gap-0.5 text-[10px] uppercase tracking-wide text-destructive">
                            <AlertTriangle className="h-3 w-3" /> over
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{fmtK(limit)}</TableCell>
                      <TableCell className="text-xs">
                        {r.last_login_at ? formatDateTime(r.last_login_at) : <span className="text-muted-foreground">never</span>}
                      </TableCell>
                      <TableCell>
                        {r.is_active
                          ? <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">Active</Badge>
                          : <Badge variant="outline" className="border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300">Inactive</Badge>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
