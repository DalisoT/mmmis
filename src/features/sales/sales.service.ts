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
