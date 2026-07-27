import { supabase } from '@/lib/supabase';
import type { AuditLogRow } from './audit.service';
import { formatDateTime } from '@/lib/utils';

const EXPORT_COLUMNS: Array<{ header: string; pick: (r: AuditLogRow) => string }> = [
  { header: 'occurred_at', pick: (r) => r.occurred_at },
  { header: 'actor_role',   pick: (r) => r.actor_role ?? '' },
  { header: 'actor_id',     pick: (r) => r.actor_id ?? '' },
  { header: 'action',       pick: (r) => r.action },
  { header: 'target_table', pick: (r) => r.target_table ?? '' },
  { header: 'target_id',    pick: (r) => r.target_id ?? '' },
  { header: 'old_values',   pick: (r) => JSON.stringify(r.old_values ?? {}) },
  { header: 'new_values',   pick: (r) => JSON.stringify(r.new_values ?? {}) },
  { header: 'meta',         pick: (r) => JSON.stringify(r.meta ?? {}) },
  { header: 'when_local',   pick: (r) => formatDateTime(r.occurred_at) },
];

function escapeCsv(v: string): string {
  // RFC 4180 — quote if it contains comma, quote, or newline.
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function rowsToCsv(rows: AuditLogRow[]): string {
  const header = EXPORT_COLUMNS.map((c) => escapeCsv(c.header)).join(',');
  const body = rows
    .map((r) => EXPORT_COLUMNS.map((c) => escapeCsv(c.pick(r))).join(','))
    .join('\n');
  return `${header}\n${body}\n`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export interface ExportOptions {
  from?: Date;
  to?: Date;
  maxRows?: number;
}

/**
 * Fetch audit rows via the existing RLS-protected table. Administrators only.
 * Honours optional date range. Paginates via `occurred_at < cursor` until
 * either `maxRows` is hit or no more rows are returned.
 */
export async function fetchAuditForExport(opts: ExportOptions = {}): Promise<AuditLogRow[]> {
  const PAGE = 500;
  const max = opts.maxRows ?? 5000;
  const out: AuditLogRow[] = [];
  let cursor: string | null = null;

  while (out.length < max) {
    let q = supabase
      .from('audit_log')
      .select('id, occurred_at, actor_id, actor_role, action, target_table, target_id, old_values, new_values, meta')
      .order('occurred_at', { ascending: false })
      .limit(PAGE);
    if (opts.from) q = q.gte('occurred_at', opts.from.toISOString());
    if (opts.to) q = q.lte('occurred_at', opts.to.toISOString());
    if (cursor) q = q.lt('occurred_at', cursor);

    const { data, error } = await q;
    if (error) throw error;
    const page = (data ?? []) as AuditLogRow[];
    if (page.length === 0) break;
    out.push(...page);
    if (page.length < PAGE) break;
    cursor = page[page.length - 1]!.occurred_at;
  }

  return out.slice(0, max);
}

export async function exportAuditCsv(opts: ExportOptions = {}): Promise<{ count: number; filename: string }> {
  const rows = await fetchAuditForExport(opts);
  const blob = new Blob([rowsToCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const filename = `audit-log-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
  downloadBlob(blob, filename);
  return { count: rows.length, filename };
}

export async function exportAuditXlsx(opts: ExportOptions = {}): Promise<{ count: number; filename: string }> {
  const rows = await fetchAuditForExport(opts);
  // Lazy-import xlsx so it only loads on demand.
  const XLSX = await import('xlsx');
  const aoa = [
    EXPORT_COLUMNS.map((c) => c.header),
    ...rows.map((r) => EXPORT_COLUMNS.map((c) => c.pick(r))),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Audit log');
  const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  const filename = `audit-log-${new Date().toISOString().replace(/[:.]/g, '-')}.xlsx`;
  downloadBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
  return { count: rows.length, filename };
}