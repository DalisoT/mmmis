import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Database, RefreshCw, AlertTriangle, CheckCircle2, XCircle,
  HelpCircle, ShieldCheck, Loader2,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from '@/lib/toast';
import { formatDateTime } from '@/lib/utils';
import { backupKeys, useBackupHealth, type BackupStatus } from './backup.service';

const STATUS_STYLES: Record<BackupStatus, { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
  ok:    { label: 'Healthy',  cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30', Icon: CheckCircle2 },
  warn:  { label: 'Stale',    cls: 'bg-amber-500/10  text-amber-700  dark:text-amber-300  border-amber-500/30',  Icon: AlertTriangle },
  error: { label: 'Stalled',  cls: 'bg-red-500/10    text-red-700    dark:text-red-300    border-red-500/30',    Icon: XCircle },
  empty: { label: 'Empty',    cls: 'bg-slate-500/10  text-slate-700  dark:text-slate-300  border-slate-500/30',  Icon: HelpCircle },
};

function StatusPill({ status }: { status: BackupStatus }) {
  const s = STATUS_STYLES[status];
  return (
    <Badge variant="outline" className={`gap-1 ${s.cls}`}>
      <s.Icon className="h-3 w-3" /> {s.label}
    </Badge>
  );
}

export function BackupHealthPage() {
  const [staleHours, setStaleHours] = useState(36);
  const [deadHours, setDeadHours]   = useState(72);

  const qc = useQueryClient();
  const { data, isLoading, isFetching, refetch, isError, error } = useBackupHealth(staleHours, deadHours);

  const onRefresh = async () => {
    try {
      await refetch();
      toast.success('Backup health refreshed');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Refresh failed');
    }
  };

  const onInvalidate = () => {
    qc.invalidateQueries({ queryKey: backupKeys.all });
    toast.success('Backup cache cleared');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <ShieldCheck className="h-5 w-5" /> Backup health
          </h1>
          <p className="text-sm text-muted-foreground">
            Row counts and last-write timestamps across the critical tables. Restricted to administrators and treasurers.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onInvalidate}>Clear cache</Button>
          <Button size="sm" onClick={onRefresh} disabled={isFetching}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Thresholds</CardTitle>
          <CardDescription>
            Tables with no activity for more than <strong>stale</strong> hours are flagged warning;
            longer than <strong>dead</strong> hours are flagged error.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 sm:max-w-md">
            <div className="space-y-1.5">
              <Label htmlFor="stale">Stale (hours)</Label>
              <Input
                id="stale"
                type="number"
                min={1}
                value={staleHours}
                onChange={(e) => setStaleHours(Math.max(1, Number(e.target.value) || 0))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dead">Dead (hours)</Label>
              <Input
                id="dead"
                type="number"
                min={staleHours + 1}
                value={deadHours}
                onChange={(e) => setDeadHours(Math.max(staleHours + 1, Number(e.target.value) || 0))}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {data && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SummaryTile label="Healthy" value={data.counts.ok}    variant="ok" />
          <SummaryTile label="Stale"   value={data.counts.warn}  variant="warn" />
          <SummaryTile label="Stalled" value={data.counts.error} variant="error" />
          <SummaryTile label="Empty"   value={data.counts.empty} variant="empty" />
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Database className="h-4 w-4" /> Tables ({data?.rows.length ?? '…'})
          </CardTitle>
          <CardDescription>
            {data
              ? <>Snapshot taken {formatDateTime(data.generated_at)} — values may be cached for up to 1 min.</>
              : 'Polling Supabase…'}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isError ? (
            <div className="p-6 text-sm text-destructive">
              {error instanceof Error ? error.message : 'Could not load backup health.'}
            </div>
          ) : isLoading || !data ? (
            <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Table</TableHead>
                  <TableHead className="text-right">Rows</TableHead>
                  <TableHead>Last write</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Message</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((r) => (
                  <TableRow key={r.table_name}>
                    <TableCell className="font-mono text-xs">{r.table_name}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.row_count.toLocaleString()}</TableCell>
                    <TableCell className="text-xs">
                      {r.last_write_at ? formatDateTime(r.last_write_at) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell><StatusPill status={r.status} /></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.status_message}</TableCell>
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

function SummaryTile({ label, value, variant }: { label: string; value: number; variant: BackupStatus }) {
  const s = STATUS_STYLES[variant];
  return (
    <div className={`flex flex-col gap-1 rounded-lg border p-3 ${s.cls}`}>
      <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide opacity-80">
        <s.Icon className="h-3 w-3" /> {label}
      </div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
