import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthContext';
import { auditUserChange } from '@/features/audit/audit';

/**
 * SALES & CHIT service.
 *
 * One cart structure, two flows:
 *   - Cash: total_amount paid in cash, no member, no ledger entry.
 *   - CHIT: member_id captured, ledger entry appended via apply_member_ledger trigger.
 */

export const cartItemSchema = z.object({
  product_id: z.string().uuid(),
  name: z.string(),
  unit: z.string(),
  unit_price: z.coerce.number().min(0),
  quantity: z.coerce.number().int().positive(),
});
export type CartItem = z.infer<typeof cartItemSchema>;

export const expenseFormSchema = z.object({
  expense_date: z.string().min(1), // ISO date
  description: z.string().min(2, 'Description required'),
  amount: z.coerce.number().positive('Must be > 0'),
  purpose: z.string().min(2, 'Purpose required'),
  remarks: z.string().optional(),
});
export type ExpenseFormValues = z.infer<typeof expenseFormSchema>;

export interface MemberLookup {
  user_id: string;
  service_number: string;
  full_name: string;
  rank: string | null;
  unit: string | null;
  chit_balance: number;
  is_blacklisted: boolean;
}

export interface SaleRow {
  id: string;
  sale_date: string;
  sold_at: string;
  sale_type: 'cash' | 'chit';
  barman_id: string;
  member_id: string | null;
  total_amount: number;
  payment_status: string;
  remarks: string | null;
  member: { user_id: string; service_number: string; first_name: string; last_name: string } | null;
  barman: { id: string; service_number: string; full_name: string } | null;
  items: { id: string; product_id: string; quantity: number; unit_price: number; line_total: number; product: { name: string; unit: string } | null }[];
}

export interface DailySummary {
  date: string;
  cash_sales: number;
  chit_sales: number;
  chit_recovery: number;
  expenses: number;
  sale_count: number;
  item_count: number;
}

export const salesKeys = {
  all: ['sales'] as const,
  byDate: (date: string) => [...salesKeys.all, 'day', date] as const,
  summary: (date: string) => [...salesKeys.all, 'summary', date] as const,
  members: () => ['members', 'lookup'] as const,
  expenses: (date: string) => ['expenses', date] as const,
};

// ---------- Lookups ----------

export function useMemberSearch(query: string) {
  return useQuery({
    queryKey: [...salesKeys.members(), query],
    queryFn: async (): Promise<MemberLookup[]> => {
      if (!query || query.length < 2) return [];
      const { data, error } = await supabase
        .from('members')
        .select('user_id, service_number, chit_balance, is_blacklisted, user:users(full_name, rank, unit)')
        .ilike('service_number', `${query}%`)
        .limit(8);
      if (error) throw error;
      return (data ?? []).map((row) => {
        const u = row.user as unknown as { full_name: string; rank: string | null; unit: string | null } | Array<{ full_name: string; rank: string | null; unit: string | null }> | null;
        const userObj = Array.isArray(u) ? u[0] : u;
        return {
          user_id: row.user_id,
          service_number: row.service_number,
          full_name: userObj?.full_name ?? '',
          rank: userObj?.rank ?? null,
          unit: userObj?.unit ?? null,
          chit_balance: row.chit_balance,
          is_blacklisted: row.is_blacklisted ?? false,
        } satisfies MemberLookup;
      });
    },
    enabled: query.length >= 2,
    staleTime: 5_000,
  });
}

/**
 * Verify a member's password by attempting to sign in as them.
 * Used by the barman to confirm CHIT transactions.
 *
 * IMPORTANT: this temporarily signs in as the member. The caller is
 * responsible for any sign-out / sign-back-in flow. In the current
 * cashier workflow, we use supabase.auth.signInWithPassword on a
 * separate fresh client to avoid disrupting the barman's session.
 */
export async function verifyMemberPassword(
  serviceNumber: string,
  password: string
): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  // Resolve service_number -> email via the SECURITY DEFINER RPC
  // introduced by migration 0016. The public `users` table no longer
  // has an anon SELECT policy, so a direct .from('users') call here
  // would always fail.
  const { data: lookupEmail, error: lookupErr } = await supabase.rpc(
    'lookup_email_by_service_number',
    { p_service_number: serviceNumber.trim() }
  );
  if (lookupErr || !lookupEmail) {
    return { ok: false, error: 'Member not found' };
  }

  // Use a fresh headless client so the barman's session is not replaced.
  const { createClient } = await import('@supabase/supabase-js');
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  const headless = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error: signInErr } = await headless.auth.signInWithPassword({
    email: lookupEmail,
    password,
  });
  if (signInErr) return { ok: false, error: signInErr.message };
  await headless.auth.signOut();
  return { ok: true, email: lookupEmail };
}

// ---------- Sales (cash + CHIT) ----------

export function useCreateSale() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({
      sale_type,
      member_id,
      items,
      remarks,
    }: {
      sale_type: 'cash' | 'chit';
      member_id?: string | null;
      items: CartItem[];
      remarks?: string;
    }) => {
      if (!user) throw new Error('Not authenticated');
      if (sale_type === 'chit' && !member_id) throw new Error('Member required for CHIT');
      if (items.length === 0) throw new Error('Cart is empty');

      // Delegate the three inserts (sale, sale_items, ledger for CHIT) to
      // the atomic `create_sale` RPC introduced by migration 0017. This
      // guarantees all three rows commit together — no orphan sales, no
      // mismatched ledger entries if a network blip hits mid-flow.
      const { data, error } = await supabase.rpc('create_sale', {
        p_sale_type: sale_type,
        p_member_id: member_id ?? null,
        p_items: items.map((i) => ({
          product_id: i.product_id,
          quantity: i.quantity,
          unit_price: i.unit_price,
        })),
        p_remarks: remarks ?? null,
      });

      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      const saleId = (row as { sale_id: string } | null)?.sale_id;
      const totalAmount = (row as { total_amount: number } | null)?.total_amount;
      if (!saleId) throw new Error('create_sale: no sale id returned');

      await auditUserChange(
        'sale.create' as never,
        saleId,
        undefined,
        { sale_type, total_amount: totalAmount, items: items.length } as never
      );

      return { saleId, total_amount: totalAmount };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: salesKeys.all });
    },
  });
}

// ---------- Expenses ----------

export function useCreateExpense() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (values: ExpenseFormValues) => {
      if (!user) throw new Error('Not authenticated');
      const { data, error } = await supabase
        .from('expenses')
        .insert({
          ...values,
          released_by: user.id,
        })
        .select('id')
        .single();
      if (error) throw error;
      await auditUserChange('expense.create' as never, data.id, undefined, values as never);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expenses'] });
    },
  });
}

export function useExpensesForDate(date: string) {
  return useQuery({
    queryKey: salesKeys.expenses(date),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expenses')
        .select('id, expense_date, description, amount, purpose, remarks, released_by')
        .eq('expense_date', date)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

// ---------- Sales list / summary ----------

export function useSalesForDate(date: string) {
  return useQuery({
    queryKey: salesKeys.byDate(date),
    queryFn: async (): Promise<SaleRow[]> => {
      const { data, error } = await supabase
        .from('sales')
        .select(`
          id, sale_date, sold_at, sale_type, barman_id, member_id,
          total_amount, payment_status, remarks,
          member:members ( user_id, service_number, first_name, last_name ),
          barman:users ( id, service_number, full_name ),
          items:sale_items (
            id, product_id, quantity, unit_price, line_total,
            product:products ( name, unit )
          )
        `)
        .eq('sale_date', date)
        .is('deleted_at', null)
        .order('sold_at', { ascending: false });
      if (error) throw error;

      return (data ?? []).map((row) => {
        const member = row.member as unknown as SaleRow['member'];
        const barman = row.barman as unknown as SaleRow['barman'];
        const items = (row.items ?? []).map((it) => {
          const p = it.product as unknown as { name: string; unit: string } | Array<{ name: string; unit: string }> | null;
          const productObj = Array.isArray(p) ? p[0] ?? null : p;
          return { ...it, product: productObj };
        });
        return {
          ...row,
          member: Array.isArray(member) ? member[0] ?? null : member,
          barman: Array.isArray(barman) ? barman[0] ?? null : barman,
          items,
        } as SaleRow;
      });
    },
  });
}

/**
 * Aggregated daily summary. We compute the totals client-side from the
 * sales + expenses queries so the page works offline the DB summary row.
 */
export function useDailySummary(date: string) {
  const sales = useSalesForDate(date);
  const expenses = useExpensesForDate(date);
  const chit = useQuery({
    queryKey: ['chit-payments', date],
    queryFn: async () => {
      const start = `${date}T00:00:00Z`;
      const end = `${date}T23:59:59.999Z`;
      const { data, error } = await supabase
        .from('chit_payments')
        .select('id, amount, payment_method, paid_at, member_id, member:members(service_number, user:users(full_name))')
        .gte('paid_at', start)
        .lte('paid_at', end)
        .eq('payment_method', 'cash')
        .is('deleted_at', null)
        .order('paid_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  if (sales.isLoading || expenses.isLoading || chit.isLoading) {
    return { isLoading: true, data: null as DailySummary | null };
  }

  const rows = sales.data ?? [];
  const cash_sales = rows.filter((s) => s.sale_type === 'cash').reduce((a, s) => a + s.total_amount, 0);
  const chit_sales = rows.filter((s) => s.sale_type === 'chit').reduce((a, s) => a + s.total_amount, 0);
  const chit_recovery = (chit.data ?? []).reduce((a, p) => a + p.amount, 0);
  const expenses_total = (expenses.data ?? []).reduce((a, e) => a + e.amount, 0);
  const sale_count = rows.length;
  const item_count = rows.reduce((a, s) => a + s.items.reduce((b, i) => b + i.quantity, 0), 0);

  return {
    isLoading: false,
    data: {
      date,
      cash_sales,
      chit_sales,
      chit_recovery,
      expenses: expenses_total,
      sale_count,
      item_count,
    } satisfies DailySummary,
  };
}

// ---------- CHIT member-side authorization (Phase 22) ----------

export type ChitAuthStatus =
  | 'pending' | 'authorized' | 'manual_override'
  | 'rejected' | 'expired' | 'cancelled' | 'consumed';

export interface ChitAuthRequest {
  id: string;
  member_id: string;
  created_by: string;
  cart: Array<{ product_id: string; quantity: number; unit_price: number; name?: string; unit?: string }>;
  total_amount: number;
  status: ChitAuthStatus;
  authorized_at: string | null;
  authorized_via: 'buyer' | 'manual_override' | null;
  created_at: string;
  expires_at: string;
  consumed_sale_id: string | null;
  rejection_reason: string | null;
}

/**
 * POS-side: create the pending request before opening the authorization
 * dialog. Server recomputes the total and rejects this call if the cart
 * and total don't agree (caller can pass null total to defer to the
 * server's value).
 */
export function useCreateChitAuthorization() {
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({
      member_id,
      items,
      total_amount,
    }: {
      member_id: string;
      items: CartItem[];
      total_amount?: number;
    }): Promise<{ request_id: string; expires_at: string }> => {
      if (!user) throw new Error('Not authenticated');
      const { data, error } = await supabase.rpc('create_chit_authorization', {
        p_member_id: member_id,
        p_cart: items.map((i) => ({
          product_id: i.product_id,
          quantity: i.quantity,
          unit_price: i.unit_price,
        })),
        p_total_amount: total_amount ?? null,
      });
      if (error) {
        // PostgREST surfaces the Postgres exception text in error.message.
        // Include the status + code so the barman sees the actual reason
        // (e.g. "Forbidden: only staff can begin a CHIT sale") rather
        // than a generic toast.
        const detail = (error as { message?: string; code?: string; details?: string }).message
          ?? 'create_chit_authorization failed';
        const code = (error as { code?: string }).code;
        throw new Error(code ? `${detail} [${code}]` : detail);
      }
      const row = Array.isArray(data) ? data[0] : data;
      const request_id = (row as { request_id: string } | null)?.request_id;
      const expires_at = (row as { expires_at: string } | null)?.expires_at;
      if (!request_id) throw new Error('create_chit_authorization: no request id returned');
      return { request_id, expires_at: expires_at ?? '' };
    },
  });
}

/**
 * Barman fallback: stamp the request as `manual_override` after the barman
 * has typed the buyer's password. The POS then finalizes the sale via
 * `finalizeChitAuthorization`. This is the same membership path the
 * existing `verifyMemberPassword` uses, just routed through the audit
 * trail of the authorization table.
 */
export function useManualOverrideAuthorization() {
  return useMutation({
    mutationFn: async (request_id: string): Promise<void> => {
      const { error } = await supabase.rpc('manual_override_chit_authorization', {
        p_request_id: request_id,
      });
      if (error) throw error;
    },
  });
}

/** POS-only: cancel a pending request (e.g. barman aborted). */
export function useCancelChitAuthorization() {
  return useMutation({
    mutationFn: async (request_id: string): Promise<void> => {
      const { error } = await supabase.rpc('cancel_chit_authorization', {
        p_request_id: request_id,
      });
      if (error) throw error;
    },
  });
}

/** POS-only: convert an authorized/manual_override row into a real sale. */
export function useFinalizeChitAuthorization() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (
      request_id: string
    ): Promise<{ saleId: string; total_amount: number }> => {
      if (!user) throw new Error('Not authenticated');
      const { data, error } = await supabase.rpc('finalize_chit_authorization', {
        p_request_id: request_id,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      const saleId = (row as { sale_id: string } | null)?.sale_id;
      const totalAmount = (row as { total_amount: number } | null)?.total_amount;
      if (!saleId) throw new Error('finalize_chit_authorization: no sale id returned');

      await auditUserChange(
        'sale.create' as never,
        saleId,
        undefined,
        { via: 'chit_authorization', request_id } as never
      );

      return { saleId, total_amount: Number(totalAmount ?? 0) };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: salesKeys.all });
    },
  });
}

/**
 * Realtime subscription to a single authorization request. Returns the latest
 * row state plus a `connectionState` for the underlying WebSocket. Designed
 * to be called from the POS and the /portal page alike.
 *
 * We subscribe to UPDATE events on the row so the POS reacts the moment the
 * buyer flips status to 'authorized'. INSERT (new request) is handled by
 * the caller's separate fetch; this hook just keeps the row hot.
 *
 * Also falls back to a 5-second interval poll in case the WebSocket drops —
 * bars commonly have flaky network and we don't want sales to stall.
 */
export function useChitAuthorizationLive(requestId: string | null) {
  const [row, setRow] = useState<ChitAuthRequest | null>(null);
  const [connectionState, setConnectionState] =
    useState<'connecting' | 'connected' | 'polling' | 'unsubscribed'>('unsubscribed');

  useEffect(() => {
    if (!requestId) {
      setRow(null);
      setConnectionState('unsubscribed');
      return;
    }

    let cancelled = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let wsHealthy = true;
    let pollFallbackTimer: ReturnType<typeof setTimeout> | null = null;

    async function fetchOnce() {
      const { data, error } = await supabase
        .from('chit_authorization_requests')
        .select('id, member_id, created_by, cart, total_amount, status, authorized_at, authorized_via, created_at, expires_at, consumed_sale_id, rejection_reason')
        .eq('id', requestId)
        .maybeSingle();
      if (cancelled) return;
      if (!error && data) setRow(data as ChitAuthRequest);
    }

    function startPolling() {
      if (pollTimer) return;
      setConnectionState('polling');
      pollTimer = setInterval(fetchOnce, 5_000);
    }

    channel = supabase
      .channel(`chit-auth:${requestId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'chit_authorization_requests', filter: `id=eq.${requestId}` },
        (payload) => {
          if (cancelled) return;
          setRow((cur) => ({ ...(cur ?? ({} as ChitAuthRequest)), ...((payload.new as Partial<ChitAuthRequest>) ?? {}) } as ChitAuthRequest));
        }
      )
      .subscribe((status) => {
        if (cancelled) return;
        if (status === 'SUBSCRIBED') {
          wsHealthy = true;
          setConnectionState('connected');
          if (pollFallbackTimer) clearTimeout(pollFallbackTimer);
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          wsHealthy = false;
          // Fall back to polling after a brief grace period.
          pollFallbackTimer = setTimeout(() => {
            if (!cancelled) startPolling();
          }, 1_500);
        }
      });

    // Initial fetch for the current state.
    void fetchOnce().then(() => {
      if (cancelled) return;
      setConnectionState((s) => (s === 'unsubscribed' ? 'connecting' : s));
    });

    // Safety net: if we never see SUBSCRIBED within ~6s, start polling.
    pollFallbackTimer = setTimeout(() => {
      if (cancelled) return;
      if (!wsHealthy) startPolling();
    }, 6_000);

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
      if (pollTimer) clearInterval(pollTimer);
      if (pollFallbackTimer) clearTimeout(pollFallbackTimer);
      setConnectionState('unsubscribed');
    };
  }, [requestId]);

  return { row, connectionState };
}

/**
 * Buyer-side helper: reject a request from /portal/authorize/<id>.
 * Status must still be 'pending' for this to succeed; finalize happens
 * automatically on the POS side via the Realtime subscription.
 */
export function useRejectChitAuthorization() {
  return useMutation({
    mutationFn: async ({ request_id, reason }: { request_id: string; reason?: string }) => {
      const { error } = await supabase.rpc('reject_chit_authorization', {
        p_request_id: request_id,
        p_reason: reason ?? null,
      });
      if (error) throw error;
    },
  });
}

/**
 * Buyer-side helper: call the chit-authorize Edge Function with the buyer's
 * current JWT. The Edge Function validates the password against Supabase
 * Auth and flips the row to 'authorized'.
 *
 * Distinguishes three failure modes so the buyer's phone can show a
 * useful message instead of a generic "Not signed in":
 *   - 'Not signed in'       — no session at all (buyer must log in)
 *   - 'Session expired'     — session exists but the access token is past
 *                             expires_at (auto-refresh failed; ask buyer
 *                             to sign in again)
 *   - 'Session no longer valid — please sign in again'
 *                           — GoTrue rejected the JWT with
 *                             session_not_found, meaning the auth.sessions
 *                             row that issued this JWT has been deleted
 *                             server-side (revoked, GC'd, or signed out
 *                             from another tab). The SPA clears the local
 *                             session and forces re-auth.
 *   - '<server message>'    — Edge Function rejected the request
 */
export async function callChitAuthorizeEdgeFunction(
  requestId: string,
  password: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const { data: sess } = await supabase.auth.getSession();
  if (!sess.session) {
    return { ok: false, error: 'Not signed in' };
  }
  let token = sess.session.access_token;
  const expiresAtMs = sess.session.expires_at ? sess.session.expires_at * 1000 : 0;
  if (expiresAtMs && expiresAtMs < Date.now()) {
    // Token is expired. Try one refresh before bailing — sometimes
    // getSession() returns a session whose access_token is stale even
    // though the refresh token would still issue a new one. We compare
    // the refreshed access_token against the original to detect the
    // pathological case where GoTrue returned the same expired token
    // (would otherwise have caused infinite recursion under the previous
    // implementation).
    const { data: refreshed } = await supabase.auth.refreshSession();
    const next = refreshed.session?.access_token;
    if (next && next !== token) {
      token = next;
    } else {
      return { ok: false, error: 'Session expired — please sign in again' };
    }
  }
  try {
    const res = await fetch(`${url}/functions/v1/chit-authorize`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ request_id: requestId, password }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg: string = body?.error ?? `HTTP ${res.status}`;
      // GoTrue 403 with bad_jwt + session_not_found means the JWT is
      // signed but the auth.sessions row that issued it is gone. The
      // token will *never* be accepted again — drop it locally so the
      // buyer is forced to re-authenticate instead of retrying with the
      // same dead JWT.
      if (
        typeof msg === 'string' &&
        (msg.includes('session_not_found') ||
         msg.includes('Session from session_id claim'))
      ) {
        await supabase.auth.signOut().catch(() => {});
        return { ok: false, error: 'Session no longer valid — please sign in again' };
      }
      return { ok: false, error: msg };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
