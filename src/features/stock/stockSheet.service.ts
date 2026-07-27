import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthContext';
import { auditUserChange } from '@/features/audit/audit';

/**
 * Daily Stock Sheet — one row per product per sheet_date.
 *
 * Field names match the paper form exactly:
 *   Stock BF, Stock RCV, Total Stock, Allergy, Sold, Stock CF, Price, Total
 */

export const stockSheetRowSchema = z.object({
  product_id: z.string().uuid(),
  stock_bf: z.coerce.number().int().min(0),
  stock_rcv: z.coerce.number().int().min(0),
  allergy: z.coerce.number().int().min(0),
  sold: z.coerce.number().int().min(0),
  stock_cf: z.coerce.number().int().min(0),
  price: z.coerce.number().min(0),
});
export type StockSheetRowInput = z.infer<typeof stockSheetRowSchema>;

export interface StockSheetRow extends StockSheetRowInput {
  id: string;
  sheet_date: string;
  // generated columns are computed on the DB; we re-derive here for UI typing
  total_stock: number;
  total: number;
  product: { id: string; name: string; category: string; unit: string; buying_price: number } | null;
}

export const stockSheetKeys = {
  all: ['stock-sheet'] as const,
  byDate: (date: string) => [...stockSheetKeys.all, date] as const,
};

export function useStockSheet(date: string) {
  return useQuery({
    queryKey: stockSheetKeys.byDate(date),
    queryFn: async (): Promise<StockSheetRow[]> => {
      const { data, error } = await supabase
        .from('stock_sheet')
        .select(`
          id, sheet_date, product_id, stock_bf, stock_rcv, total_stock,
          allergy, sold, stock_cf, price, total,
          product:products ( id, name, category, unit, buying_price )
        `)
        .eq('sheet_date', date)
        .is('deleted_at', null);
      if (error) throw error;

      return (data ?? []).map((row) => {
        const p = row.product as unknown as StockSheetRow['product'];
        return {
          ...row,
          product: Array.isArray(p) ? p[0] ?? null : p,
        } as StockSheetRow;
      });
    },
    enabled: !!date,
  });
}

/**
 * Read the previous trading day's closing stock so we can default Stock BF.
 * Returns a map of product_id -> stock_cf.
 */
export async function fetchPreviousDayClosing(
  beforeDate: string,
  productIds: string[]
): Promise<Record<string, number>> {
  if (productIds.length === 0) return {};
  const { data, error } = await supabase
    .from('stock_sheet')
    .select('product_id, sheet_date, stock_cf')
    .in('product_id', productIds)
    .lt('sheet_date', beforeDate)
    .is('deleted_at', null)
    .order('sheet_date', { ascending: false });
  if (error) throw error;

  const latest: Record<string, number> = {};
  for (const row of data ?? []) {
    if (!(row.product_id in latest)) latest[row.product_id] = row.stock_cf;
  }
  return latest;
}

export function useUpsertStockSheet() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({
      sheet_date, rows,
    }: { sheet_date: string; rows: StockSheetRowInput[] }) => {
      if (!user) throw new Error('Not authenticated');
      const payload = rows.map((r) => ({ ...r, sheet_date, recorded_by: user.id }));
      const { data, error } = await supabase
        .from('stock_sheet')
        .upsert(payload, { onConflict: 'sheet_date,product_id' })
        .select('id');
      if (error) throw error;
      await auditUserChange(
        'stock.sheet.upsert' as never,
        sheet_date,
        undefined,
        { rows: payload.length } as never
      );
      return data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: stockSheetKeys.byDate(vars.sheet_date) });
    },
  });
}
