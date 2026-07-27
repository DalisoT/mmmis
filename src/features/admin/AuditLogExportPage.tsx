import { useState } from 'react';
import { Loader2, Download, FileText, FileSpreadsheet, ScrollText } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/lib/toast';
import { exportAuditCsv, exportAuditXlsx } from '@/features/audit/audit.export';

export function AuditLogExportPage() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState<null | 'csv' | 'xlsx'>(null);

  const dateOrUndef = (s: string) => (s ? new Date(`${s}T00:00:00Z`) : undefined);
  const dateToOrUndef = (s: string) => (s ? new Date(`${s}T23:59:59.999Z`) : undefined);

  const run = async (kind: 'csv' | 'xlsx') => {
    setBusy(kind);
    try {
      const fn = kind === 'csv' ? exportAuditCsv : exportAuditXlsx;
      const { count, filename } = await fn({
        from: dateOrUndef(from),
        to: dateToOrUndef(to),
      });
      toast.success(`Exported ${count} rows to ${filename}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <ScrollText className="h-5 w-5" /> Audit log export
          </h1>
          <p className="text-sm text-muted-foreground">
            Download the audit trail as CSV or XLSX. Honours the same RLS as the on-screen viewer.
          </p>
        </div>
        <Badge variant="outline">Administrator only</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Date range</CardTitle>
          <CardDescription>Leave both fields empty to export everything you can see.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>From (UTC)</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>To (UTC)</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Download</CardTitle>
          <CardDescription>Up to 5,000 rows per export. Larger ranges should be done via pg_dump.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button onClick={() => run('csv')} disabled={busy !== null}>
            {busy === 'csv' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
            CSV
          </Button>
          <Button onClick={() => run('xlsx')} disabled={busy !== null} variant="outline">
            {busy === 'xlsx' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileSpreadsheet className="mr-2 h-4 w-4" />}
            Excel (XLSX)
          </Button>
          <div className="ml-auto self-center text-xs text-muted-foreground">
            <Download className="mr-1 inline h-3 w-3" />
            Files are generated locally in your browser.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}