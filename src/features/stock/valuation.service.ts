import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import * as XLSX from 'xlsx';
import { supabase } from '@/lib/supabase';

export interface StockValuationRow {
  product_id: string;
  name: string;
  category: string;
  unit: string;
  stock_cf: number | null;
  buying_price: number;
  /** stock_cf * buying_price */
  value: number;
}

/**
 * Aggregate the most recent Stock CF per product as of `asOfDate`.
 *
 * Implementation: fetch latest stock_sheet row per product where sheet_date <= asOfDate.
 */
export function useStockValuation(asOfDate: string) {
  return useQuery({
    queryKey: ['stock-valuation', asOfDate],
    queryFn: async (): Promise<StockValuationRow[]> => {
      // Pull all rows for the most recent date <= asOfDate per product.
      // Approach: ranked window via raw SQL view, but for simplicity we'll do two queries.
      const { data: products, error: pErr } = await supabase
        .from('products')
        .select('id, name, category, unit, buying_price')
        .is('deleted_at', null)
        .eq('status', 'active')
        .order('category').order('name');
      if (pErr) throw pErr;
      if (!products?.length) return [];

      const { data: sheet, error: sErr } = await supabase
        .from('stock_sheet')
        .select('product_id, sheet_date, stock_cf')
        .lte('sheet_date', asOfDate)
        .is('deleted_at', null)
        .order('sheet_date', { ascending: false });
      if (sErr) throw sErr;

      const latestByProduct = new Map<string, number>();
      for (const row of sheet ?? []) {
        if (!latestByProduct.has(row.product_id)) {
          latestByProduct.set(row.product_id, row.stock_cf);
        }
      }

      return products.map((p) => {
        const cf = latestByProduct.get(p.id) ?? 0;
        return {
          product_id: p.id,
          name: p.name,
          category: p.category,
          unit: p.unit,
          stock_cf: latestByProduct.has(p.id) ? cf : null,
          buying_price: p.buying_price,
          value: cf * Number(p.buying_price),
        } satisfies StockValuationRow;
      });
    },
  });
}

export function exportValuationToExcel(rows: StockValuationRow[], filename: string) {
  const data = rows.map((r) => ({
    Product: r.name,
    Category: r.category,
    Unit: r.unit,
    'Stock CF': r.stock_cf ?? 0,
    'Buying Price': Number(r.buying_price),
    'Stock Value': r.value,
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Valuation');
  XLSX.writeFile(wb, filename);
}

export function defaultValuationFilename(asOfDate: string): string {
  return `stock-valuation-${format(new Date(asOfDate), 'yyyyMMdd')}.xlsx`;
}
