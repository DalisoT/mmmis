import { useMemo, useState } from 'react';
import {
  Package, AlertTriangle, XCircle, CheckCircle2, RefreshCw, Loader2,
  TrendingDown, HelpCircle, Download,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from '@/lib/toast';
import { downloadCsv, csvTimestamp } from '@/lib/csv';
import { useLowStock, type LowStockStatus } from './products.lowstock.service';

const STATUS_STYLES: Record<LowStockStatus, { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
  ok:       { label: 'Healthy',  cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',  Icon: CheckCircle2 },
  low:      { label: 'Low',      cls: 'border-amber-500/30  bg-amber-500/10  text-amber-700  dark:text-amber-300',   Icon: AlertTriangle },
  critical: { label: 'Critical', cls: 'border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300', Icon: TrendingDown },
  out:      { label: 'Out',      cls: 'border-red-500/30    bg-red-500/10    text-red-700    dark:text-red-300',     Icon: XCircle },
  no_min:   { label: 'No min',   cls: 'border-slate-500/30  bg-slate-500/10  text-slate-700  dark:text-slate-300',   Icon: HelpCircle },
};

const LOW_STOCK_HEADERS = [
  'Name', 'Category', 'Unit', 'On hand', 'Minimum',
  'Status', 'Last sheet', 'Recorded by', 'Message',
] as const;

function StatusPill({ status }: { status: LowStockStatus }) {
  const s = STATUS_STYLES[status];
  return (
    <Badge variant="outline" className={`gap-1 ${s.cls}`}>
      <s.Icon className="h-3 w-3" /> {s.label}
    </Badge>
  );
}

export function ProductsLowStockPage() {
  const [onlyActive, setOnlyActive] = useState(true);
  const { data, isLoading, isFetching, refetch, isError, error } = useLowStock(onlyActive);

  const onRefresh = async () => {
    try {
      await refetch();
      toast.success('Stock report refreshed');
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
      `low-stock-${csvTimestamp()}.csv`,
      [
        [...LOW_STOCK_HEADERS],
        ...data.map((r) => [
          r.name, r.category, r.unit, r.on_hand, r.minimum_stock,
          STATUS_STYLES[r.status].label, r.last_sheet_date ?? '',
          r.last_recorded_by ?? '', r.status_message,
        ]),
      ],
    );
    toast.success(`Exported ${data.length} rows`);
  };

  const counts = useMemo(() => {
    const c = { ok: 0, low: 0, critical: 0, out: 0, no_min: 0 };
    (data ?? []).forEach((r) => c[r.status] += 1);
    return c;
  }, [data]);

  const alerts = (data ?? []).filter((r) => r.status === 'out' || r.status === 'critical').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Package className="h-5 w-5" /> Low stock
          </h1>
          <p className="text-sm text-muted-foreground">
            Products ranked by stock health against <code className="rounded bg-muted px-1 py-0.5 text-xs">minimum_stock</code>. Staff only.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={onlyActive}
              onChange={(e) => setOnlyActive(e.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            Active only
          </label>
          <Button variant="outline" size="sm" onClick={onExport} disabled={!data || data.length === 0}>
            <Download className="mr-2 h-4 w-4" /> Export
          </Button>
          <Button size="sm" onClick={onRefresh} disabled={isFetching}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {alerts > 0 && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="flex items-center gap-2 p-3 text-sm">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <span><strong>{alerts}</strong> product{alerts === 1 ? '' : 's'} need immediate attention (out of stock or critical).</span>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Tile label="Out"      value={counts.out}      variant="out" />
        <Tile label="Critical" value={counts.critical} variant="critical" />
        <Tile label="Low"      value={counts.low}      variant="low" />
        <Tile label="Healthy"  value={counts.ok}       variant="ok" />
        <Tile label="No min"   value={counts.no_min}   variant="no_min" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Results ({data?.length ?? 0})</CardTitle>
          <CardDescription>
            {isLoading
              ? 'Querying Supabase…'
              : isError
                ? <span className="text-destructive">{error instanceof Error ? error.message : 'Failed'}</span>
                : 'Sorted by severity — out → critical → low → no min → healthy.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading || !data ? (
            <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : data.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No products to show.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">On hand</TableHead>
                  <TableHead className="text-right">Minimum</TableHead>
                  <TableHead>Last sheet</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((r) => (
                  <TableRow key={r.product_id}>
                    <TableCell>
                      <div className="font-medium">{r.name}</div>
                      <div className="text-xs text-muted-foreground">{r.unit}</div>
                    </TableCell>
                    <TableCell className="text-xs">{r.category}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className={r.status === 'out' || r.status === 'critical' ? 'font-semibold text-destructive' : ''}>
                        {r.on_hand}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{r.minimum_stock || '—'}</TableCell>
                    <TableCell className="text-xs">
                      {r.last_sheet_date ?? <span className="text-muted-foreground">never</span>}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-0.5">
                        <StatusPill status={r.status} />
                        <span className="text-[10px] text-muted-foreground">{r.status_message}</span>
                      </div>
                    </TableCell>
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

function Tile({ label, value, variant }: { label: string; value: number; variant: LowStockStatus }) {
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
