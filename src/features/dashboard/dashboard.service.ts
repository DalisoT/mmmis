import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { supabase } from '@/lib/supabase';

/**
 * Dashboard data hooks.
 *
 * Each hook is narrow on purpose (one card = one hook) so the dashboard
 * page is cheap to compose and a slow query in one card doesn't block
 * the others. Every hook accepts no arguments and reads "today" as the
 * local date in the user's timezone — Postgres `sale_date` is a DATE
 * column, so we compare against the ISO yyyy-MM-dd boundary.
 */

function todayLocal(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

export const dashKeys = {
  all: ['dashboard'] as const,
  todaySales: () => [...dashKeys.all, 'today-sales'] as const,
  todayStockSheet: () => [...dashKeys.all, 'today-stock-sheet'] as const,
  todayExpenses: () => [...dashKeys.all, 'today-expenses'] as const,
  todayChitRecovery: () => [...dashKeys.all, 'today-chit-recovery'] as const,
  todayChitRecoveryCash: () => [...dashKeys.all, 'today-chit-recovery-cash'] as const,
  outstandingChit: () => [...dashKeys.all, 'outstanding-chit'] as const,
  cashAtHandToday: () => [...dashKeys.all, 'cash-at-hand-today'] as const,
  stockValue: () => [...dashKeys.all, 'stock-value'] as const,
  topSelling: (days: number) => [...dashKeys.all, 'top-selling', days] as const,
  recentAudit: (n: number) => [...dashKeys.all, 'recent-audit', n] as const,
};

// ---------------- Today ----------------

export interface TodaySales {
  cash_total: number;
  chit_total: number;
  sale_count: number;
  item_count: number;
}

export function useTodaySales() {
  return useQuery({
    queryKey: dashKeys.todaySales(),
    queryFn: async (): Promise<TodaySales> => {
      const date = todayLocal();
      const { data, error } = await supabase
        .from('sales')
        .select('sale_type, total_amount, items:sale_items(quantity)')
        .eq('sale_date', date)
        .is('deleted_at', null)
        .neq('payment_status', 'voided');
      if (error) throw error;
      const rows = data ?? [];
      let cash_total = 0;
      let chit_total = 0;
      let item_count = 0;
      for (const r of rows) {
        const amt = Number(r.total_amount);
        if (r.sale_type === 'cash') cash_total += amt;
        else if (r.sale_type === 'chit') chit_total += amt;
        const items = (r as { items?: Array<{ quantity: number }> }).items ?? [];
        for (const it of items) item_count += Number(it.quantity);
      }
      return { cash_total, chit_total, sale_count: rows.length, item_count };
    },
  });
}

// ---------------- Barman: stock sheet status ----------------

export interface TodayStockSheet {
  recorded: boolean;
  row_count: number;
}

export function useTodayStockSheet() {
  return useQuery({
    queryKey: dashKeys.todayStockSheet(),
    queryFn: async (): Promise<TodayStockSheet> => {
      const date = todayLocal();
      const { data, error } = await supabase
        .from('stock_sheet')
        .select('id')
        .eq('sheet_date', date)
        .is('deleted_at', null);
      if (error) throw error;
      const rows = data ?? [];
      return { recorded: rows.length > 0, row_count: rows.length };
    },
  });
}

// ---------------- Today: expenses (approved only) ----------------

export function useTodayExpenses() {
  return useQuery({
    queryKey: dashKeys.todayExpenses(),
    queryFn: async (): Promise<number> => {
      const date = todayLocal();
      const { data, error } = await supabase
        .from('expenses')
        .select('amount')
        .eq('expense_date', date)
        .is('deleted_at', null)
        .not('approved_at', 'is', null);
      if (error) throw error;
      return (data ?? []).reduce((a, r) => a + Number(r.amount), 0);
    },
  });
}

// ---------------- Today: CHIT recovery (cash method only) ----------------

export function useTodayChitRecoveryCash() {
  return useQuery({
    queryKey: dashKeys.todayChitRecoveryCash(),
    queryFn: async (): Promise<number> => {
      const date = todayLocal();
      const start = `${date}T00:00:00Z`;
      const end = `${date}T23:59:59.999Z`;
      const { data, error } = await supabase
        .from('chit_payments')
        .select('amount')
        .eq('payment_method', 'cash')
        .gte('paid_at', start)
        .lte('paid_at', end)
        .is('deleted_at', null);
      if (error) throw error;
      return (data ?? []).reduce((a, r) => a + Number(r.amount), 0);
    },
  });
}

// ---------------- Today: CHIT recovery (all methods) ----------------

export function useTodayChitRecovery() {
  return useQuery({
    queryKey: dashKeys.todayChitRecovery(),
    queryFn: async (): Promise<number> => {
      const date = todayLocal();
      const start = `${date}T00:00:00Z`;
      const end = `${date}T23:59:59.999Z`;
      const { data, error } = await supabase
        .from('chit_payments')
        .select('amount')
        .gte('paid_at', start)
        .lte('paid_at', end)
        .is('deleted_at', null);
      if (error) throw error;
      return (data ?? []).reduce((a, r) => a + Number(r.amount), 0);
    },
  });
}

// ---------------- Mess-wide outstanding CHIT ----------------

export interface OutstandingChit {
  total: number;
  member_count: number;
  over_limit_count: number;
}

export function useOutstandingChit() {
  return useQuery({
    queryKey: dashKeys.outstandingChit(),
    queryFn: async (): Promise<OutstandingChit> => {
      const { data, error } = await supabase
        .from('members')
        .select('chit_balance, credit_limit')
        .is('deleted_at', null)
        .gt('chit_balance', 0);
      if (error) throw error;
      const rows = data ?? [];
      let total = 0;
      let over_limit_count = 0;
      for (const r of rows) {
        const bal = Number(r.chit_balance);
        total += bal;
        if (bal > Number(r.credit_limit)) over_limit_count += 1;
      }
      return { total, member_count: rows.length, over_limit_count };
    },
  });
}

// ---------------- Today's cash at hand ----------------
//   cash sales + cash chit recovery - approved expenses
export function useCashAtHandToday() {
  return useQuery({
    queryKey: dashKeys.cashAtHandToday(),
    queryFn: async (): Promise<number> => {
      const date = todayLocal();
      const start = `${date}T00:00:00Z`;
      const end = `${date}T23:59:59.999Z`;

      const [{ data: sales }, { data: chits }, { data: exp }] = await Promise.all([
        supabase
          .from('sales')
          .select('sale_type, total_amount')
          .eq('sale_date', date)
          .eq('sale_type', 'cash')
          .is('deleted_at', null)
          .neq('payment_status', 'voided'),
        supabase
          .from('chit_payments')
          .select('amount')
          .eq('payment_method', 'cash')
          .gte('paid_at', start)
          .lte('paid_at', end)
          .is('deleted_at', null),
        supabase
          .from('expenses')
          .select('amount')
          .eq('expense_date', date)
          .is('deleted_at', null)
          .not('approved_at', 'is', null),
      ]);

      const cashSales = (sales ?? []).reduce((a, r) => a + Number(r.total_amount), 0);
      const chitRecovery = (chits ?? []).reduce((a, r) => a + Number(r.amount), 0);
      const expenses = (exp ?? []).reduce((a, r) => a + Number(r.amount), 0);
      return cashSales + chitRecovery - expenses;
    },
  });
}

// ---------------- Stock value at buying price ----------------
//   Reuses the same logic as useStockValuation but rendered as a single number.
export function useStockValue() {
  return useQuery({
    queryKey: dashKeys.stockValue(),
    queryFn: async (): Promise<number> => {
      const asOf = todayLocal();
      const { data: products, error: pErr } = await supabase
        .from('products')
        .select('id, buying_price')
        .is('deleted_at', null)
        .eq('status', 'active');
      if (pErr) throw pErr;
      if (!products?.length) return 0;

      const { data: sheet, error: sErr } = await supabase
        .from('stock_sheet')
        .select('product_id, sheet_date, stock_cf')
        .lte('sheet_date', asOf)
        .is('deleted_at', null)
        .order('sheet_date', { ascending: false });
      if (sErr) throw sErr;

      const latestByProduct = new Map<string, number>();
      for (const row of sheet ?? []) {
        if (!latestByProduct.has(row.product_id)) {
          latestByProduct.set(row.product_id, Number(row.stock_cf));
        }
      }

      let total = 0;
      for (const p of products) {
        const cf = latestByProduct.get(p.id) ?? 0;
        total += cf * Number(p.buying_price);
      }
      return total;
    },
  });
}

// ---------------- Top selling products, last N days ----------------

export interface TopSellingRow {
  product_id: string;
  name: string;
  unit: string;
  qty: number;
  revenue: number;
}

export function useTopSellingProducts(days = 7, limit = 5) {
  return useQuery({
    queryKey: dashKeys.topSelling(days),
    queryFn: async (): Promise<TopSellingRow[]> => {
      const since = new Date();
      since.setDate(since.getDate() - days);
      const sinceDate = format(since, 'yyyy-MM-dd');

      const { data, error } = await supabase
        .from('sale_items')
        .select(
          'quantity, line_total, product_id, product:products(name, unit), sale:sales!inner(sale_date, deleted_at, payment_status)'
        )
        .gte('sale.sale_date', sinceDate)
        .is('sale.deleted_at', null)
        .neq('sale.payment_status', 'voided');
      if (error) throw error;

      const agg = new Map<string, TopSellingRow>();
      for (const r of data ?? []) {
        const product = (r as { product?: { name: string; unit: string } | Array<{ name: string; unit: string }> }).product;
        const productObj = Array.isArray(product) ? product[0] : product;
        if (!productObj) continue;
        const key = r.product_id;
        const existing = agg.get(key) ?? {
          product_id: key,
          name: productObj.name,
          unit: productObj.unit,
          qty: 0,
          revenue: 0,
        };
        existing.qty += Number(r.quantity);
        existing.revenue += Number(r.line_total);
        agg.set(key, existing);
      }
      return Array.from(agg.values())
        .sort((a, b) => b.qty - a.qty)
        .slice(0, limit);
    },
  });
}

// ---------------- Recent audit events ----------------

export interface RecentAuditRow {
  id: string;
  occurred_at: string;
  action: string;
  actor: { full_name: string; service_number: string } | null;
  target_table: string | null;
  target_id: string | null;
}

export function useRecentAuditEvents(limit = 5) {
  return useQuery({
    queryKey: dashKeys.recentAudit(limit),
    queryFn: async (): Promise<RecentAuditRow[]> => {
      const { data, error } = await supabase
        .from('audit_logs')
        .select(
          'id, occurred_at, action, target_table, target_id, actor:users!audit_logs_actor_id_fkey(full_name, service_number)'
        )
        .order('occurred_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []).map((row) => {
        const a = (row as unknown as { actor?: RecentAuditRow['actor'] | RecentAuditRow['actor'][] }).actor;
        const actor = Array.isArray(a) ? a[0] ?? null : a ?? null;
        return {
          id: row.id,
          occurred_at: row.occurred_at,
          action: row.action,
          actor,
          target_table: row.target_table,
          target_id: row.target_id,
        } satisfies RecentAuditRow;
      });
    },
  });
}
