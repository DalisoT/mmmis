import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/AuthContext';
import { supabase } from '@/lib/supabase';

export interface MemberOwnProfile {
  user_id: string;
  service_number: string;
  full_name: string;
  rank: string | null;
  unit: string | null;
  email: string | null;
  phone: string | null;
  chit_balance: number;
  credit_limit: number;
  is_blacklisted: boolean;
}

export interface MemberLedgerEntry {
  id: string;
  txn_date: string;
  txn_at: string;
  description: string;
  debit: number;
  payment: number;
  balance: number;
  source_type: 'sale' | 'payment' | 'adjustment';
}

export interface MemberPurchase {
  id: string;
  sale_date: string;
  sold_at: string;
  total_amount: number;
  sale_type: 'cash' | 'chit';
  payment_status: string;
  remarks: string | null;
  items: { id: string; quantity: number; unit_price: number; line_total: number; product: { name: string; unit: string } | null }[];
}

export interface MemberPayment {
  id: string;
  amount: number;
  payment_method: 'cash' | 'payslip_deduction' | 'manual_recovery';
  paid_at: string;
  reference: string | null;
  receipt_number: string | null;
  remarks: string | null;
  receiver: { full_name: string; service_number: string } | null;
}

const memberKeys = {
  all: ['member-portal'] as const,
  profile: () => [...memberKeys.all, 'profile'] as const,
  ledger: () => [...memberKeys.all, 'ledger'] as const,
  purchases: () => [...memberKeys.all, 'purchases'] as const,
  payments: () => [...memberKeys.all, 'payments'] as const,
};

export function useMemberOwnProfile() {
  const { user } = useAuth();
  return useQuery({
    queryKey: memberKeys.profile(),
    queryFn: async (): Promise<MemberOwnProfile | null> => {
      if (!user) return null;
      const { data, error } = await supabase
        .from('members')
        .select('user_id, service_number, first_name, last_name, rank, unit, chit_balance, credit_limit, is_blacklisted, user:users(phone, email, full_name)')
        .eq('user_id', user.id)
        .is('deleted_at', null)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const u = data.user as unknown as { phone: string | null; email: string | null; full_name: string } | Array<{ phone: string | null; email: string | null; full_name: string }> | null;
      const userObj = Array.isArray(u) ? u[0] : u;
      return {
        user_id: data.user_id,
        service_number: data.service_number,
        full_name: userObj?.full_name ?? `${data.first_name} ${data.last_name}`,
        rank: data.rank,
        unit: data.unit,
        email: userObj?.email ?? null,
        phone: userObj?.phone ?? null,
        chit_balance: Number(data.chit_balance),
        credit_limit: Number(data.credit_limit),
        is_blacklisted: data.is_blacklisted,
      } satisfies MemberOwnProfile;
    },
    enabled: !!user,
  });
}

export function useMemberOwnLedger(from?: string, to?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: [...memberKeys.ledger(), from, to],
    queryFn: async (): Promise<MemberLedgerEntry[]> => {
      if (!user) return [];
      let q = supabase.from('ledger').select('id, txn_date, txn_at, description, debit, payment, balance, source_type, member_id').eq('member_id', user.id).order('txn_at', { ascending: true });
      if (from) q = q.gte('txn_date', from);
      if (to) q = q.lte('txn_date', to);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as MemberLedgerEntry[];
    },
    enabled: !!user,
  });
}

export function useMemberOwnPurchases(daysBack = 30) {
  const { user } = useAuth();
  return useQuery({
    queryKey: [...memberKeys.purchases(), daysBack],
    queryFn: async (): Promise<MemberPurchase[]> => {
      if (!user) return [];
      const since = new Date(); since.setDate(since.getDate() - daysBack);
      const sinceDate = since.toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from('sales')
        .select(`id, sale_date, sold_at, total_amount, sale_type, payment_status, remarks, member_id, items:sale_items(id, quantity, unit_price, line_total, product:products(name, unit))`)
        .eq('member_id', user.id)
        .is('deleted_at', null)
        .gte('sale_date', sinceDate)
        .order('sold_at', { ascending: false });
      if (error) throw error;
      return (data ?? []).map((row) => {
        const items = (row.items ?? []).map((it) => {
          const p = it.product as unknown as { name: string; unit: string } | Array<{ name: string; unit: string }> | null;
          const productObj = Array.isArray(p) ? p[0] ?? null : p;
          return { ...it, product: productObj };
        });
        return { ...row, items } as MemberPurchase;
      });
    },
    enabled: !!user,
  });
}

export function useMemberOwnPayments() {
  const { user } = useAuth();
  return useQuery({
    queryKey: memberKeys.payments(),
    queryFn: async (): Promise<MemberPayment[]> => {
      if (!user) return [];
      const { data, error } = await supabase
        .from('chit_payments')
        .select('id, amount, payment_method, paid_at, reference, receipt_number, remarks, member_id, receiver:users(full_name, service_number)')
        .eq('member_id', user.id)
        .is('deleted_at', null)
        .order('paid_at', { ascending: false });
      if (error) throw error;
      return (data ?? []).map((row) => {
        const r = row.receiver as unknown as { full_name: string; service_number: string } | Array<{ full_name: string; service_number: string }> | null;
        return { ...row, receiver: Array.isArray(r) ? r[0] ?? null : r } as MemberPayment;
      });
    },
    enabled: !!user,
  });
}
