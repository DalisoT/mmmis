/**
 * Offline-aware sale submission.
 *
 * Wraps the barman's "Submit sale" call:
 *
 *   - If we're online, the call goes through immediately.
 *   - If we're offline (or the network call fails with a fetch / network
 *     error), the action is queued in IndexedDB and a friendly toast
 *     tells the barman it'll sync when the connection returns.
 *
 * Why wrap rather than touch the existing mutation hooks?
 *   The existing `useCreateChitAuthorization` / `useCreateSale` are
 *   tightly coupled to React Query's mutation lifecycle (loading state,
 *   cache invalidation, audit logging). Threading offline fallback
 *   through them would force every caller to handle the queued path.
 *   Wrapping at the call site keeps the original mutations pure and
 *   makes the offline behaviour opt-in per action.
 */
import { useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/lib/toast';
import { queueAction } from './offlineQueue';

export interface OfflineChitAuthPayload {
  member_id: string;
  items: Array<{ product_id: string; quantity: number; unit_price: number }>;
  total_amount?: number | null;
}

export interface OfflineCashSalePayload {
  items: Array<{ product_id: string; quantity: number; unit_price: number }>;
  remarks?: string | null;
}

/** A network error from supabase-js — its `name === 'AuthRetryableFetchError'`
 *  or it lacks any HTTP status. Anything with a status code is treated as
 *  a server response and surfaced normally (no queueing). */
function isOfflineish(e: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
  const err = e as { name?: string; message?: string; status?: number } | null;
  if (!err) return true;
  if (err.status && err.status >= 400 && err.status < 600) return false;
  if (err.name === 'AuthRetryableFetchError') return true;
  if (err.name === 'TypeError' && /fetch/i.test(err.message ?? '')) return true;
  // Generic "Failed to fetch" / "NetworkError" — offline.
  if (/failed to fetch|networkerror|load failed/i.test(err.message ?? '')) return true;
  return false;
}

/**
 * Submit a CHIT-sale authorization, queuing offline if the network drops.
 * Returns the server-side request_id (when online) or a synthetic id
 * derived from the queued row (when offline), so the rest of the flow
 * (UI confirmation, link to /portal/authorize/:id) keeps working.
 */
export function useOfflineChitAuthorization() {
  return useCallback(async (payload: OfflineChitAuthPayload): Promise<{ request_id: string; queued: boolean }> => {
    try {
      const { data, error } = await supabase.rpc('create_chit_authorization', {
        p_member_id: payload.member_id,
        p_cart: payload.items,
        p_total_amount: payload.total_amount ?? null,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      const request_id = (row as { request_id: string } | null)?.request_id;
      if (!request_id) throw new Error('create_chit_authorization: no request id returned');
      return { request_id, queued: false };
    } catch (e) {
      if (!isOfflineish(e)) throw e;
      const id = await queueAction({
        kind: 'chit-sale',
        payload: {
          member_id: payload.member_id,
          items: payload.items,
          remarks: null,
          // We persist the total so the toast can display the right
          // amount while the row sits in the queue.
          _total_amount: payload.total_amount ?? null,
        },
      });
      toast.show({
        title: 'Sale queued offline',
        description: 'We saved the CHIT sale on this device. It will sync automatically when the network returns.',
        variant: 'info',
        duration: 6000,
      });
      return { request_id: id, queued: true };
    }
  }, []);
}

/**
 * Submit a cash sale, queuing offline if the network drops.
 *
 * Note: cash sales do NOT show the member-approval flow, so a queued
 * cash sale is the more disruptive case (the barman may not realise
 * the drawer is now out of sync with the books until the queue flushes).
 * We make the toast louder and longer for cash sales.
 */
export function useOfflineCashSale() {
  return useCallback(async (payload: OfflineCashSalePayload): Promise<{ sale_id: string | null; queued: boolean }> => {
    try {
      const { data, error } = await supabase.rpc('create_sale', {
        p_sale_type: 'cash',
        p_member_id: null,
        p_items: payload.items,
        p_remarks: payload.remarks ?? null,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      const sale_id = (row as { sale_id: string } | null)?.sale_id ?? null;
      return { sale_id, queued: false };
    } catch (e) {
      if (!isOfflineish(e)) throw e;
      const id = await queueAction({
        kind: 'cash-sale',
        payload: {
          items: payload.items,
          remarks: payload.remarks ?? null,
        },
      });
      toast.show({
        title: 'Cash sale queued',
        description: 'Drawer will appear out of sync until the network returns and the queue flushes. Do NOT close the app.',
        variant: 'info',
        duration: 9000,
      });
      return { sale_id: id, queued: true };
    }
  }, []);
}