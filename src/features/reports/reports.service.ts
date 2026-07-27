import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { supabase } from '@/lib/supabase';

export type ReportPeriod = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface ProfitLossReport {
  period: ReportPeriod;
  from: string;
  to: string;
  cash_sales: number;
  chit_sales: number;
  revenue: number;
  chit_recovery_cash: number;
  chit_recovery_non_cash: number;
  cogs: number;
  gross_profit: number;
  approved_expenses: number;
  pending_expenses: number;
  net_profit: number;
  stock_value: number;
  outstanding_chit: number;
  sale_count: number;
}

interface DateRange { from: string; to: string }

export function getReportRange(period: ReportPeriod, anchor = new Date()): DateRange {
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  if (period === 'daily') {
    const d = format(anchor, 'yyyy-MM-dd');
    return { from: d, to: d };
  }
  if (period === 'weekly') {
    const day = anchor.getDay();
    const start = new Date(anchor);
    start.setDate(anchor.getDate() - (day === 0 ? 6 : day - 1));
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { from: format(start, 'yyyy-MM-dd'), to: format(end, 'yyyy-MM-dd') };
  }
  if (period === 'monthly') {
    return { from: format(new Date(year, month, 1), 'yyyy-MM-dd'), to: format(new Date(year, month + 1, 0), 'yyyy-MM-dd') };
  }
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

export const reportKeys = {
  all: ['reports'] as const,
  pnl: (period: ReportPeriod, from: string, to: string) => [...reportKeys.all, 'pnl', period, from, to] as const,
};

export function useProfitLossReport(period: ReportPeriod, range?: DateRange) {
  const fallback = getReportRange(period);
  const from = range?.from || fallback.from;
  const to = range?.to || fallback.to;
  return useQuery({
    queryKey: reportKeys.pnl(period, from, to),
    queryFn: async (): Promise<ProfitLossReport> => {
      const [{ data: sales, error: salesError }, { data: items, error: itemsError }, { data: expenses, error: expenseError }, { data: payments, error: paymentError }, { data: members, error: memberError }, { data: products, error: productError }, { data: sheets, error: sheetError }] = await Promise.all([
        supabase.from('sales').select('id, sale_type, total_amount').is('deleted_at', null).gte('sale_date', from).lte('sale_date', to),
        supabase.from('sale_items').select('quantity, product_id, sale:sales!inner(sale_date, deleted_at), product:products(buying_price)').gte('sale.sale_date', from).lte('sale.sale_date', to).is('sale.deleted_at', null),
        supabase.from('expenses').select('amount, approved_at').is('deleted_at', null).gte('expense_date', from).lte('expense_date', to),
        supabase.from('chit_payments').select('amount, payment_method').is('deleted_at', null).gte('paid_at', `${from}T00:00:00Z`).lte('paid_at', `${to}T23:59:59.999Z`),
        supabase.from('members').select('chit_balance').is('deleted_at', null),
        supabase.from('products').select('id, buying_price').is('deleted_at', null).eq('status', 'active'),
        supabase.from('stock_sheet').select('product_id, sheet_date, stock_cf').is('deleted_at', null).lte('sheet_date', to).order('sheet_date', { ascending: false }),
      ]);
      const firstError = salesError || itemsError || expenseError || paymentError || memberError || productError || sheetError;
      if (firstError) throw firstError;
      const salesRows = sales ?? [];
      const cashSales = salesRows.filter((s) => s.sale_type === 'cash').reduce((a, s) => a + Number(s.total_amount), 0);
      const chitSales = salesRows.filter((s) => s.sale_type === 'chit').reduce((a, s) => a + Number(s.total_amount), 0);
      const cogs = (items ?? []).reduce((a, item) => {
        const product = Array.isArray(item.product) ? item.product[0] : item.product;
        return a + Number(item.quantity) * Number(product?.buying_price ?? 0);
      }, 0);
      const approvedExpenses = (expenses ?? []).filter((e) => e.approved_at).reduce((a, e) => a + Number(e.amount), 0);
      const pendingExpenses = (expenses ?? []).filter((e) => !e.approved_at).reduce((a, e) => a + Number(e.amount), 0);
      const cashRecovery = (payments ?? []).filter((p) => p.payment_method === 'cash').reduce((a, p) => a + Number(p.amount), 0);
      const nonCashRecovery = (payments ?? []).filter((p) => p.payment_method !== 'cash').reduce((a, p) => a + Number(p.amount), 0);
      const latest = new Map<string, number>();
      for (const row of sheets ?? []) if (!latest.has(row.product_id)) latest.set(row.product_id, Number(row.stock_cf));
      const stockValue = (products ?? []).reduce((a, p) => a + (latest.get(p.id) ?? 0) * Number(p.buying_price), 0);
      const outstanding = (members ?? []).reduce((a, m) => a + Number(m.chit_balance), 0);
      const revenue = cashSales + chitSales;
      return { period, from, to, cash_sales: cashSales, chit_sales: chitSales, revenue, chit_recovery_cash: cashRecovery, chit_recovery_non_cash: nonCashRecovery, cogs, gross_profit: revenue - cogs, approved_expenses: approvedExpenses, pending_expenses: pendingExpenses, net_profit: revenue + cashRecovery - cogs - approvedExpenses, stock_value: stockValue, outstanding_chit: outstanding, sale_count: salesRows.length };
    },
  });
}

export interface DailyClosing {
  id: string;
  summary_date: string;
  cash_at_hand_open: number;
  cash_at_hand_close: number;
  counted_cash: number | null;
  variance: number | null;
  closing_status: 'open' | 'counted' | 'approved' | 'disputed';
  closing_notes: string | null;
  counted_at: string | null;
}

export const closingKeys = { all: ['daily-closing'] as const, day: (date: string) => [...closingKeys.all, date] as const };

export function useDailyClosing(date: string) {
  return useQuery({ queryKey: closingKeys.day(date), queryFn: async (): Promise<DailyClosing | null> => {
    const { data, error } = await supabase.from('daily_summary').select('id, summary_date, cash_at_hand_open, cash_at_hand_close, counted_cash, variance, closing_status, closing_notes, counted_at').eq('summary_date', date).maybeSingle();
    if (error) throw error;
    return data as DailyClosing | null;
  } });
}

export function useSaveDailyClosing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ date, expectedCash, countedCash, notes }: { date: string; expectedCash: number; countedCash: number; notes?: string }) => {
      const { data, error } = await supabase.from('daily_summary').upsert({ summary_date: date, cash_at_hand_close: expectedCash, counted_cash: countedCash, closing_notes: notes || null, closing_status: 'counted', counted_at: new Date().toISOString() }, { onConflict: 'summary_date' }).select('id').single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, vars) => qc.invalidateQueries({ queryKey: closingKeys.day(vars.date) }),
  });
}
