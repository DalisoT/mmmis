import { Loader2, Trash2, MonitorSmartphone, Clock, ShieldCheck } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from '@/lib/toast';
import { formatDateTime } from '@/lib/utils';
import { useConfirm } from '@/hooks/useConfirm';
import { useActiveSessions, useRevokeSession } from './sessions.service';

function describeBrowser(ua: string | null): string {
  if (!ua) return 'Unknown device';
  if (/Edg\//.test(ua)) return 'Edge';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Safari\//.test(ua)) return 'Safari';
  if (/Android|iPhone|iPad/.test(ua)) return 'Mobile device';
  return 'Other';
}

export function SessionsListPage() {
  const { data, isLoading } = useActiveSessions();
  const revoke = useRevokeSession();
  const confirm = useConfirm();

  const rows = data ?? [];

  const onRevoke = async (id: string, who: string) => {
    const ok = await confirm({
      title: 'Revoke session?',
      description: `The session for ${who} will be signed out immediately. They will need to sign in again.`,
      confirmLabel: 'Revoke',
      destructive: true,
    });
    if (!ok) return;
    try {
      await revoke.mutateAsync(id);
      toast.success(`Revoked session for ${who}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not revoke session');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <ShieldCheck className="h-5 w-5" /> Active sessions
          </h1>
          <p className="text-sm text-muted-foreground">
            Every refresh token that is not yet revoked and not yet past its expiry.
          </p>
        </div>
        <Badge variant="outline">Administrator only</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sessions ({rows.length})</CardTitle>
          <CardDescription>Self-revoke is allowed for the caller's own sessions.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : rows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No active sessions.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Device</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Last seen</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="w-[80px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((s) => (
                  <TableRow key={s.session_id}>
                    <TableCell>
                      <div className="font-medium">{s.full_name ?? '—'}</div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {s.service_number ?? '—'}
                      </div>
                      {s.role_code && <Badge variant="secondary" className="mt-1">{s.role_code}</Badge>}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 text-sm">
                        <MonitorSmartphone className="h-3 w-3" /> {describeBrowser(s.user_agent)}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">{formatDateTime(s.created_at)}</TableCell>
                    <TableCell className="text-xs">
                      <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {formatDateTime(s.last_seen_at)}</span>
                    </TableCell>
                    <TableCell className="text-xs">{formatDateTime(s.expires_at)}</TableCell>
                    <TableCell>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => onRevoke(s.session_id, s.full_name ?? s.service_number ?? 'user')}
                        aria-label="Revoke session"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
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