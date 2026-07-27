import { useState } from 'react';
import {
  BarChart3, ScrollText, RefreshCw, Loader2, AlertTriangle, UserRound, Tag, Table2,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/lib/toast';
import { formatDateTime } from '@/lib/utils';
import { useAuditSummary } from '@/features/audit/audit.summary.service';

const RANGES = [
  { label: '24 h',  hours: 24  },
  { label: '7 d',   hours: 24 * 7 },
  { label: '30 d',  hours: 24 * 30 },
  { label: '90 d',  hours: 24 * 90 },
] as const;

function toLocalInputValue(d: Date): string {
  // <input type="datetime-local"> wants yyyy-mm-ddThh:mm in *local* time
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function AuditSummaryPage() {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  const [fromLocal, setFromLocal] = useState(toLocalInputValue(weekAgo));
  const [toLocal, setToLocal]     = useState(toLocalInputValue(now));

  const fromIso = new Date(fromLocal).toISOString();
  const toIso   = new Date(toLocal).toISOString();

  const { data, isLoading, isFetching, refetch, isError, error } = useAuditSummary(fromIso, toIso);

  const applyRange = (hours: number) => {
    const t = new Date();
    const f = new Date(t.getTime() - hours * 3600 * 1000);
    setFromLocal(toLocalInputValue(f));
    setToLocal(toLocalInputValue(t));
  };

  const onRefresh = async () => {
    try {
      await refetch();
      toast.success('Audit summary refreshed');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Refresh failed');
    }
  };

  // Compute max for the bar chart normalisation.
  const maxDaily = data ? data.daily.reduce((m, d) => Math.max(m, d.events), 0) : 0;
  const totalTop = (list: { events: number }[] | undefined) =>
    list?.reduce((s, x) => s + x.events, 0) ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <BarChart3 className="h-5 w-5" /> Audit summary
          </h1>
          <p className="text-sm text-muted-foreground">
            Aggregated activity from the audit log. Administrator only.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={onRefresh} disabled={isFetching}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Range</CardTitle>
          <CardDescription>
            Pick a window or use a quick preset. Both bounds are interpreted in your local timezone.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {RANGES.map((r) => (
              <Button key={r.label} size="sm" variant="outline" onClick={() => applyRange(r.hours)}>
                {r.label}
              </Button>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="from">From</Label>
              <Input
                id="from"
                type="datetime-local"
                value={fromLocal}
                onChange={(e) => setFromLocal(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="to">To</Label>
              <Input
                id="to"
                type="datetime-local"
                value={toLocal}
                onChange={(e) => setToLocal(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {isError && (
        <Card>
          <CardContent className="flex items-center gap-2 p-4 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4" />
            {error instanceof Error ? error.message : 'Could not load audit summary.'}
          </CardContent>
        </Card>
      )}

      {data && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatTile label="Total events"   value={data.total}                                     Icon={ScrollText} />
          <StatTile label="Top action share" value={`${pct(data.top_actions[0]?.events ?? 0, data.total)}%`} Icon={Tag} hint={String(data.top_actions[0]?.action ?? '—')} />
          <StatTile label="Top actor"      value={String(data.top_actors[0]?.service_number ?? '—')} Icon={UserRound} hint={String(data.top_actors[0]?.full_name ?? '—')} />
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="h-4 w-4" /> Daily activity
          </CardTitle>
          <CardDescription>
            {data
              ? <>Generated {formatDateTime(data.generated_at)} · max bucket = {maxDaily.toLocaleString()}</>
              : 'Loading…'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading || !data ? (
            <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : data.daily.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No events in the selected window.</p>
          ) : (
            <div className="space-y-1.5">
              {data.daily.map((b) => {
                const w = maxDaily > 0 ? Math.max(2, Math.round((b.events / maxDaily) * 100)) : 0;
                return (
                  <div key={b.day} className="flex items-center gap-2 text-xs">
                    <div className="w-24 shrink-0 font-mono text-muted-foreground">{b.day}</div>
                    <div className="relative h-5 flex-1 overflow-hidden rounded bg-muted/40">
                      <div
                        className="h-full rounded bg-primary/70 transition-all"
                        style={{ width: `${w}%` }}
                        aria-label={`${b.events} events on ${b.day}`}
                      />
                    </div>
                    <div className="w-16 shrink-0 text-right tabular-nums">{b.events.toLocaleString()}</div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <TopList
          title="Top actions"
          Icon={Tag}
          total={totalTop(data?.top_actions)}
          rows={data?.top_actions ?? []}
          labelKey="action"
        />
        <TopList
          title="Top tables"
          Icon={Table2}
          total={totalTop(data?.top_tables)}
          rows={data?.top_tables ?? []}
          labelKey="target_table"
        />
        <ActorList
          title="Top actors"
          rows={data?.top_actors ?? []}
        />
      </div>
    </div>
  );
}

function pct(part: number, whole: number): string {
  if (!whole) return '0';
  return ((part / whole) * 100).toFixed(1);
}

function StatTile({ label, value, hint, Icon }: { label: string; value: string | number; hint?: string; Icon: typeof ScrollText }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border bg-card p-3">
      <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="truncate text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

function TopList({
  title, Icon, total, rows, labelKey,
}: {
  title: string;
  Icon: typeof Tag;
  total: number;
  rows: Array<{ events: number } & Record<string, unknown>>;
  labelKey: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-4 w-4" /> {title}
        </CardTitle>
        <CardDescription>Top 10 · total {total.toLocaleString()}</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No data.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {rows.map((r, i) => {
              const label = String(r[labelKey] ?? '—');
              const events = r.events;
              const share = total > 0 ? Math.round((events / total) * 100) : 0;
              return (
                <li key={`${label}-${i}`} className="flex items-center gap-2">
                  <span className="w-5 shrink-0 text-right text-xs text-muted-foreground">{i + 1}.</span>
                  <span className="flex-1 truncate font-mono text-xs">{label}</span>
                  <Badge variant="outline" className="shrink-0 tabular-nums">{events.toLocaleString()}</Badge>
                  <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{share}%</span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ActorList({ title, rows }: { title: string; rows: Array<{ service_number: string; full_name: string; role_code: string | null; events: number }> }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <UserRound className="h-4 w-4" /> {title}
        </CardTitle>
        <CardDescription>Top 10 by event count</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No data.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {rows.map((r, i) => (
              <li key={`${r.service_number}-${i}`} className="flex items-center gap-2">
                <span className="w-5 shrink-0 text-right text-xs text-muted-foreground">{i + 1}.</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate">{r.full_name}</div>
                  <div className="truncate font-mono text-xs text-muted-foreground">{r.service_number}</div>
                </div>
                {r.role_code && <Badge variant="secondary" className="shrink-0">{r.role_code}</Badge>}
                <Badge variant="outline" className="shrink-0 tabular-nums">{r.events.toLocaleString()}</Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
