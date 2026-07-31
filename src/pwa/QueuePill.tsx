/**
 * Queue + sync pill.
 *
 * Renders next to the theme toggle in the app shell:
 *   - Idle, no pending: nothing rendered.
 *   - Idle, N pending: small amber pill "N queued". Click to flush.
 *   - Flushing: small spinner "Syncing N…".
 *   - Auth-required: red pill "Sign in to sync".
 *   - Error: red pill with last error.
 */
import { CloudOff, Loader2, RefreshCw, ShieldAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useOfflineFlush } from './useOfflineFlush';

export function QueuePill() {
  const { status, pending, lastError, flushNow } = useOfflineFlush();

  if (pending === 0 && status === 'idle') return null;

  if (status === 'auth-required') {
    return (
      <Badge variant="destructive" className="gap-1" title={lastError ?? ''}>
        <ShieldAlert className="h-3 w-3" />
        Sign in to sync
      </Badge>
    );
  }

  if (status === 'error' && pending > 0) {
    return (
      <Button size="sm" variant="ghost" onClick={() => void flushNow()}
              className="h-8 gap-1 px-2 text-xs text-destructive" title={lastError ?? ''}>
        <CloudOff className="h-3 w-3" />
        Retry ({pending})
      </Button>
    );
  }

  if (status === 'flushing') {
    return (
      <Badge variant="secondary" className="gap-1">
        <Loader2 className="h-3 w-3 animate-spin" />
        Syncing {pending}…
      </Badge>
    );
  }

  return (
    <Button size="sm" variant="ghost" onClick={() => void flushNow()}
            className="h-8 gap-1 px-2 text-xs">
      <RefreshCw className="h-3 w-3" />
      {pending} queued
    </Button>
  );
}