import { useState } from 'react';
import { Loader2, ScrollText } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDateTime } from '@/lib/utils';
import { useAuditLog } from '@/features/audit/audit.service';

const CATEGORY: Record<string, string> = {
  'user.': 'User',
  'sale.': 'Sales',
  'expense.': 'Expenses',
  'chit_payment.': 'CHIT',
  'stock_': 'Stock',
  'cash_closing.': 'Closing',
  'settings.': 'Settings',
  'auth.': 'Auth',
};

function categoryOf(action: string): string {
  for (const prefix of Object.keys(CATEGORY)) {
    if (action.startsWith(prefix)) return CATEGORY[prefix] ?? action;
  }
  return action;
}

export function AuditLogPage() {
  const [limit, setLimit] = useState(200);
  const [filter, setFilter] = useState('');
  const { data, isLoading } = useAuditLog(limit);

  const filtered = (data ?? []).filter((row) => {
    if (!filter) return true;
    const hay = `${row.action} ${row.target_table ?? ''} ${row.target_id ?? ''}`.toLowerCase();
    return hay.includes(filter.toLowerCase());
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <ScrollText className="h-5 w-5" /> Audit log
          </h1>
          <p className="text-sm text-muted-foreground">
            Append-only trail of sensitive actions. Showing the most recent {limit}.
          </p>
        </div>
        <Badge variant="outline">Administrator only</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
          <CardDescription>Filter by action, table, or target id.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Search</Label>
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="e.g. sale.create" />
          </div>
          <div className="space-y-2">
            <Label>Limit</Label>
            <Input type="number" min={10} max={500} value={limit} onChange={(e) => setLimit(Number(e.target.value) || 100)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : filtered.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No audit entries match.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[180px]">When</TableHead>
                  <TableHead className="w-[120px]">Category</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Actor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-xs">{formatDateTime(row.occurred_at)}</TableCell>
                    <TableCell><Badge variant="secondary">{categoryOf(row.action)}</Badge></TableCell>
                    <TableCell className="font-mono text-xs">{row.action}</TableCell>
                    <TableCell className="text-xs">
                      {row.target_table && <span className="text-muted-foreground">{row.target_table}</span>}
                      {row.target_id && <span className="ml-1 font-mono">{row.target_id.slice(0, 12)}…</span>}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{row.actor_id ? row.actor_id.slice(0, 8) + '…' : 'system'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}