import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthContext';
import { auditUserChange } from '@/features/audit/audit';
import { format } from 'date-fns';

// ---------------- Members ----------------

export interface MemberRow {
  user_id: string;
  service_number: string;
  first_name: string;
  last_name: string;
  rank: string | null;
  unit: string | null;
  chit_balance: number;
  credit_limit: number;
  is_blacklisted: boolean;
  joined_at: string;
  email: string | null;
  phone: string | null;
  full_name: string;
}

export const memberUpdateSchema = z.object({
  first_name: z.string().min(1).optional(),
  last_name: z.string().min(1).optional(),
  rank: z.string().optional(),
  unit: z.string().optional(),
  credit_limit: z.coerce.number().min(0).optional(),
  is_blacklisted: z.boolean().optional(),
});
export type MemberUpdateValues = z.infer<typeof memberUpdateSchema>;

export const memberKeys = {
  all: ['members'] as const,
  list: () => [...memberKeys.all, 'list'] as const,
  detail: (id: string) => [...memberKeys.all, 'detail', id] as const,
};

export function useMembers() {
  return useQuery({
    queryKey: memberKeys.list(),
    queryFn: async (): Promise<MemberRow[]> => {
      const { data, error } = await supabase
        .from('members')
        .select('user_id, service_number, first_name, last_name, rank, unit, chit_balance, credit_limit, is_blacklisted, joined_at, user:users(phone, email, full_name)')
        .is('deleted_at', null)
        .order('service_number');
      if (error) throw error;

      return (data ?? []).map((row) => {
        const u = row.user as unknown as { phone: string | null; email: string | null; full_name: string } | Array<{ phone: string | null; email: string | null; full_name: string }> | null;
        const userObj = Array.isArray(u) ? u[0] : u;
        return {
          user_id: row.user_id,
          service_number: row.service_number,
          first_name: row.first_name,
          last_name: row.last_name,
          rank: row.rank,
          unit: row.unit,
          chit_balance: Number(row.chit_balance),
          credit_limit: Number(row.credit_limit),
          is_blacklisted: row.is_blacklisted,
          joined_at: row.joined_at,
          email: userObj?.email ?? null,
          phone: userObj?.phone ?? null,
          full_name: userObj?.full_name ?? `${row.first_name} ${row.last_name}`.trim(),
        } satisfies MemberRow;
      });
    },
  });
}

export function useMember(id: string | undefined) {
  return useQuery({
    queryKey: memberKeys.detail(id ?? ''),
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await supabase
        .from('members')
        .select('user_id, service_number, first_name, last_name, rank, unit, chit_balance, credit_limit, is_blacklisted, joined_at, user:users(phone, email, full_name)')
        .eq('user_id', id)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const u = data.user as unknown as { phone: string | null; email: string | null; full_name: string } | Array<{ phone: string | null; email: string | null; full_name: string }> | null;
      const userObj = Array.isArray(u) ? u[0] : u;
      return {
        user_id: data.user_id,
        service_number: data.service_number,
        first_name: data.first_name,
        last_name: data.last_name,
        rank: data.rank,
        unit: data.unit,
        chit_balance: Number(data.chit_balance),
        credit_limit: Number(data.credit_limit),
        is_blacklisted: data.is_blacklisted,
        joined_at: data.joined_at,
        email: userObj?.email ?? null,
        phone: userObj?.phone ?? null,
        full_name: userObj?.full_name ?? `${data.first_name} ${data.last_name}`.trim(),
      } satisfies MemberRow;
    },
    enabled: !!id,
  });
}

export function useUpdateMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, values }: { id: string; values: MemberUpdateValues }) => {
      const { data, error } = await supabase
        .from('members')
        .update(values)
        .eq('user_id', id)
        .select('user_id')
        .single();
      if (error) throw error;
      await auditUserChange('member.update' as never, id, undefined, values as never);
      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: memberKeys.list() });
      qc.invalidateQueries({ queryKey: memberKeys.detail(vars.id) });
    },
  });
}

// ---------------- CHIT Payments ----------------

export const chitPaymentSchema = z.object({
  member_id: z.string().uuid(),
  amount: z.coerce.number().positive('Must be > 0'),
  payment_method: z.enum(['cash', 'payslip_deduction', 'manual_recovery']),
  paid_at: z.string().min(1),
  reference: z.string().optional(),
  receipt_number: z.string().optional(),
  remarks: z.string().optional(),
});
export type ChitPaymentValues = z.infer<typeof chitPaymentSchema>;

export interface ChitPaymentRow {
  id: string;
  member_id: string;
  amount: number;
  payment_method: 'cash' | 'payslip_deduction' | 'manual_recovery';
  received_by: string;
  paid_at: string;
  reference: string | null;
  receipt_number: string | null;
  remarks: string | null;
  member: { service_number: string; first_name: string; last_name: string } | null;
  receiver: { full_name: string; service_number: string } | null;
}

export const chitKeys = {
  all: ['chit-payments'] as const,
  list: () => [...chitKeys.all, 'list'] as const,
  forDate: (d: string) => [...chitKeys.all, 'date', d] as const,
};

export function useChitPayments(filters?: { from?: string; to?: string; member_id?: string }) {
  return useQuery({
    queryKey: [...chitKeys.list(), filters ?? {}],
    queryFn: async (): Promise<ChitPaymentRow[]> => {
      let q = supabase
        .from('chit_payments')
        .select(`
          id, member_id, amount, payment_method, received_by, paid_at,
          reference, receipt_number, remarks,
          member:members ( service_number, first_name, last_name ),
          receiver:users ( full_name, service_number )
        `)
        .is('deleted_at', null)
        .order('paid_at', { ascending: false })
        .limit(500);
      if (filters?.from) q = q.gte('paid_at', `${filters.from}T00:00:00Z`);
      if (filters?.to) q = q.lte('paid_at', `${filters.to}T23:59:59.999Z`);
      if (filters?.member_id) q = q.eq('member_id', filters.member_id);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map((row) => {
        const m = row.member as unknown as ChitPaymentRow['member'];
        const r = row.receiver as unknown as ChitPaymentRow['receiver'];
        return {
          ...row,
          member: Array.isArray(m) ? m[0] ?? null : m,
          receiver: Array.isArray(r) ? r[0] ?? null : r,
        } satisfies ChitPaymentRow;
      });
    },
  });
}

export function useCreateChitPayment() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (values: ChitPaymentValues) => {
      if (!user) throw new Error('Not authenticated');
      const { data: pay, error: payErr } = await supabase
        .from('chit_payments')
        .insert({ ...values, received_by: user.id })
        .select('id')
        .single();
      if (payErr) throw payErr;
      // Append a ledger entry (payment reduces balance).
      const { error: ledgerErr } = await supabase.from('ledger').insert({
        member_id: values.member_id,
        payment: values.amount,
        debit: 0,
        description: `CHIT payment · ${values.payment_method}${values.reference ? ' · ' + values.reference : ''}`,
        source_type: 'payment',
        source_id: pay.id,
        txn_date: values.paid_at.slice(0, 10),
      });
      if (ledgerErr) throw ledgerErr;
      await auditUserChange('chit.payment.create' as never, pay.id, undefined, values as never);
      return pay;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: chitKeys.all });
      qc.invalidateQueries({ queryKey: memberKeys.all });
    },
  });
}

// ---------------- Expenses (admin view) ----------------

export interface ExpenseAdminRow {
  id: string;
  expense_date: string;
  description: string;
  amount: number;
  purpose: string;
  remarks: string | null;
  released_by: string;
  approved_at: string | null;
  approved_by: string | null;
  creator: { full_name: string; service_number: string } | null;
  approver: { full_name: string; service_number: string } | null;
}

export function useAllExpenses(filters?: { from?: string; to?: string; approved?: 'all' | 'yes' | 'no' }) {
  return useQuery({
    queryKey: ['expenses-admin', filters ?? {}],
    queryFn: async (): Promise<ExpenseAdminRow[]> => {
      let q = supabase
        .from('expenses')
        .select(`
          id, expense_date, description, amount, purpose, remarks,
          released_by, approved_at, approved_by,
          creator:users!expenses_released_by_fkey ( full_name, service_number ),
          approver:users!expenses_approved_by_fkey ( full_name, service_number )
        `)
        .is('deleted_at', null)
        .order('expense_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(500);
      if (filters?.from) q = q.gte('expense_date', filters.from);
      if (filters?.to) q = q.lte('expense_date', filters.to);
      if (filters?.approved === 'yes') q = q.not('approved_at', 'is', null);
      if (filters?.approved === 'no') q = q.is('approved_at', null);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map((row) => {
        const c = row.creator as unknown as ExpenseAdminRow['creator'];
        const a = row.approver as unknown as ExpenseAdminRow['approver'];
        return {
          ...row,
          creator: Array.isArray(c) ? c[0] ?? null : c,
          approver: Array.isArray(a) ? a[0] ?? null : a,
        } satisfies ExpenseAdminRow;
      });
    },
  });
}

export function useApproveExpense() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ id, approved }: { id: string; approved: boolean }) => {
      if (!user) throw new Error('Not authenticated');
      const { data, error } = await supabase
        .from('expenses')
        .update({
          approved_at: approved ? new Date().toISOString() : null,
          approved_by: approved ? user.id : null,
        })
        .eq('id', id)
        .select('id')
        .single();
      if (error) throw error;
      await auditUserChange(
        approved ? ('expense.approve' as never) : ('expense.unapprove' as never),
        id
      );
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['expenses-admin'] }),
  });
}

// ---------------- Ledger / Statement ----------------

export interface LedgerRow {
  id: string;
  member_id: string;
  txn_date: string;
  txn_at: string;
  description: string;
  debit: number;
  payment: number;
  balance: number;
  source_type: 'sale' | 'payment' | 'adjustment';
  source_id: string | null;
}

export function useMemberLedger(memberId: string | undefined, from?: string, to?: string) {
  return useQuery({
    queryKey: ['ledger', memberId, from, to],
    queryFn: async (): Promise<LedgerRow[]> => {
      if (!memberId) return [];
      let q = supabase
        .from('ledger')
        .select('*')
        .eq('member_id', memberId)
        .order('txn_at', { ascending: true });
      if (from) q = q.gte('txn_date', from);
      if (to) q = q.lte('txn_date', to);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as LedgerRow[];
    },
    enabled: !!memberId,
  });
}

// ---------------- Cash at Hand ----------------

export interface CashAtHandDay {
  date: string;
  cash_sales: number;
  chit_recovery: number;
  expenses: number;
  net: number;
}

export function useCashAtHand(from: string, to: string) {
  return useQuery({
    queryKey: ['cash-at-hand', from, to],
    queryFn: async (): Promise<CashAtHandDay[]> => {
      // Pull sales, expenses, chit_payments in the date range.
      const [{ data: sales }, { data: exp }, { data: chits }] = await Promise.all([
        supabase.from('sales').select('sale_date, total_amount, sale_type').is('deleted_at', null).gte('sale_date', from).lte('sale_date', to),
        supabase.from('expenses').select('expense_date, amount, approved_at').is('deleted_at', null).not('approved_at', 'is', null).gte('expense_date', from).lte('expense_date', to),
        supabase.from('chit_payments').select('amount, paid_at, payment_method').is('deleted_at', null).eq('payment_method', 'cash').gte('paid_at', `${from}T00:00:00Z`).lte('paid_at', `${to}T23:59:59.999Z`),
      ]);

      const map = new Map<string, CashAtHandDay>();
      const seed = (d: string) => {
        if (!map.has(d)) map.set(d, { date: d, cash_sales: 0, chit_recovery: 0, expenses: 0, net: 0 });
        return map.get(d)!;
      };
      for (const s of sales ?? []) {
        if (s.sale_type !== 'cash') continue;
        seed(s.sale_date).cash_sales += Number(s.total_amount);
      }
      for (const e of exp ?? []) {
        seed(e.expense_date).expenses += Number(e.amount);
      }
      for (const c of chits ?? []) {
        const day = format(new Date(c.paid_at), 'yyyy-MM-dd');
        seed(day).chit_recovery += Number(c.amount);
      }
      const out = Array.from(map.values());
      out.sort((a, b) => a.date.localeCompare(b.date));
      for (const day of out) day.net = day.cash_sales + day.chit_recovery - day.expenses;
      return out;
    },
  });
}
