/**
 * Background flush for the IndexedDB offline action queue.
 *
 * Exposed as `useOfflineFlush()` which a single mounted component (the
 * <AppShell />) calls. Returns the current queue depth so the UI can
 * surface a "2 queued, syncing…" pill.
 *
 * Strategy:
 *   - On mount, attempt a flush.
 *   - On the `online` event, attempt a flush.
 *   - Poll every 30s while online as a safety net (network-change events
 *     are unreliable on some Android Chromium builds).
 *   - While offline, do nothing.
 *   - Flushes run sequentially; a row that fails with an auth (401/403)
 *     error halts the queue so the barman can re-auth, then a manual
 *     retry (or the next online tick) resumes from where it stopped.
 *
 * The actual Supabase call for each `kind` lives in `flushOne()` —
 * kind-to-RPC routing table is right there so this hook stays small.
 */
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { listQueued, markAttempt, removeQueued, type QueuedAction } from './offlineQueue';
import { toast } from '@/lib/toast';

type Status = 'idle' | 'flushing' | 'auth-required' | 'error';

export interface OfflineFlushState {
  status: Status;
  pending: number;
  lastError?: string;
  /** Force an immediate flush attempt. */
  flushNow: () => Promise<void>;
}

const POLL_MS = 30_000;

async function flushOne(
  row: QueuedAction
): Promise<{ ok: true } | { ok: false; auth: boolean; error: string }> {
  try {
    if (row.kind === 'chit-sale') {
      // Replay: create a fresh authorization request. The member still
      // has to approve — the original (offline) tap never reached them.
      const { data, error } = await supabase.rpc('create_chit_authorization', {
        p_member_id: (row.payload as { member_id: string }).member_id,
        p_cart: (row.payload as { items: unknown[] }).items,
        p_total_amount:
          (row.payload as { total_amount?: number | null }).total_amount ?? null,
      });
      if (error) throw error;
      const r = Array.isArray(data) ? data[0] : data;
      if (!(r as { request_id?: string })?.request_id) {
        throw new Error('create_chit_authorization: no request id returned');
      }
      return { ok: true };
    }
    if (row.kind === 'cash-sale') {
      const { error } = await supabase.rpc('create_sale', {
        p_sale_type: 'cash',
        p_member_id: null,
        p_items: (row.payload as { items: unknown[] }).items,
        p_remarks: (row.payload as { remarks?: string | null }).remarks ?? null,
      });
      if (error) throw error;
      return { ok: true };
    }
    if (row.kind === 'expense') {
      const p = row.payload as {
        expense_date?: string;
        category: string;
        description: string;
        amount: number;
        vendor?: string;
        payment_method?: string;
      };
      const { error } = await supabase.from('expenses').insert({
        expense_date: p.expense_date ?? new Date().toISOString().slice(0, 10),
        category: p.category,
        description: p.description,
        amount: p.amount,
        vendor: p.vendor ?? null,
        payment_method: p.payment_method ?? 'cash',
      });
      if (error) throw error;
      return { ok: true };
    }
    return { ok: false, auth: false, error: `Unknown queue kind: ${row.kind}` };
  } catch (e) {
    const err = e as { code?: string; status?: number; message?: string } | null;
    const status = err?.status ?? 0;
    const msg = err?.message ?? String(e);
    const auth = status === 401 || status === 403 || err?.code === '42501';
    return { ok: false, auth, error: msg };
  }
}

export function useOfflineFlush(): OfflineFlushState {
  const [status, setStatus] = useState<Status>('idle');
  const [pending, setPending] = useState(0);
  const [lastError, setLastError] = useState<string | undefined>();

  const refreshCount = useCallback(async () => {
    try {
      const rows = await listQueued();
      setPending(rows.length);
    } catch {
      // IDB unavailable — keep silent, queue is a nice-to-have.
    }
  }, []);

  const flushNow = useCallback(async () => {
    if (status === 'flushing') return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    setStatus('flushing');
    try {
      const rows = await listQueued();
      if (rows.length === 0) {
        setStatus('idle');
        setLastError(undefined);
        return;
      }
      let flushed = 0;
      let halted = false;
      for (const row of rows) {
        const result = await flushOne(row);
        if (result.ok) {
          await removeQueued(row.id);
          flushed += 1;
          continue;
        }
        await markAttempt(row.id, result.error);
        if (result.auth) {
          halted = true;
          setStatus('auth-required');
          setLastError(result.error);
          toast.error('Sign in again to sync queued actions.');
          break;
        }
        // Non-auth error (likely transient). Stop this run; the next tick
        // will retry. We don't want to hammer a struggling server.
        setStatus('error');
        setLastError(result.error);
        break;
      }
      if (!halted && flushed > 0) {
        toast.success(`${flushed} queued action${flushed === 1 ? '' : 's'} synced.`);
      }
    } catch (e) {
      setStatus('error');
      setLastError((e as Error).message);
    } finally {
      await refreshCount();
      if (status !== 'auth-required') setStatus('idle');
    }
  }, [status, refreshCount]);

  useEffect(() => {
    refreshCount();
    const onOnline = () => { void flushNow(); };
    window.addEventListener('online', onOnline);
    const interval = window.setInterval(() => { void flushNow(); }, POLL_MS);
    // First attempt on mount — catches the case where the user came back
    // online while the app was closed (queued rows survive an app restart).
    void flushNow();
    return () => {
      window.removeEventListener('online', onOnline);
      window.clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { status, pending, lastError, flushNow };
}